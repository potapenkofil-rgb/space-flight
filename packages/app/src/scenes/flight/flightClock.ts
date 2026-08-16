/**
 * The flight scene's *simulation-side* state advance — deliberately the only
 * piece of `scenes/flight/**` that mutates anything, so PLAN.md §3.2's rule
 * ("`render` must not mutate simulation state... two runs with a different
 * number of `render()` calls give bitwise-identical state") is structurally
 * true: `FlightScene.ts`'s `render(alpha)` never calls anything in this
 * file, only reads what the last `step(dt)` produced.
 *
 * Drives a real `@karman/core` `Vessel` end to end (PLAN.md §7 stage 2
 * integration, replacing the scripted-ascent fixture that used to live
 * here): `computeMass` → `consumeFuel`/`stepFlight` while off-rails,
 * `orbitFromState`/`stateFromOrbit` for the on-rails transition (PLAN.md
 * §3.3), `flight/timewarp.ts` for warp gating, and `evaluateStructure`-style
 * `splitVessel` for stage separation (PLAN.md §3.4 — voluntary separation
 * uses the same mechanism as a structural break, just with the joint chosen
 * by the player's `Space` press instead of a load check).
 */
import {
  canSelectWarpLevel,
  computeMass,
  orbitFromState,
  splitVessel,
  stateFromOrbit,
  stepFlight,
  v2,
  warpContextForVessel,
  WARP_LEVELS,
  MAX_ATMOSPHERIC_WARP,
  ZERO,
  type Body,
  type ControlInput,
  type FlightEnvironment,
  type Vec2,
  type Vessel,
  type WarpDenialReason,
} from '@karman/core';
import { kickShake, NO_SHAKE, thrustShakeImpulsePerSecond, updateShake, type CameraShake } from '../../render/cameraShake';
import { STAGE_SEPARATION_SHAKE_PX } from './constants';
import type { VesselSnapshot } from './types';

export interface FlightSimState {
  readonly shake: CameraShake;
  /** Heading (core `Vessel.rotation` convention) SAS is holding, captured the tick it was switched on; `null` while off. */
  readonly sasTarget: number | null;
}

export const INITIAL_FLIGHT_SIM_STATE: FlightSimState = Object.freeze({ shake: NO_SHAKE, sasTarget: null });

export interface FlightStepResult {
  readonly state: FlightSimState;
  readonly snapshot: VesselSnapshot;
  /**
   * The vessel that's actually flying after this tick — usually `=== vessel`
   * (the one passed in), but a *different* object the tick a stage
   * separates: `splitVessel` (PLAN.md §3.4) returns new `Vessel`s, one of
   * which keeps flying. Callers that hold a vessel reference elsewhere (the
   * shared `GameSession`) must swap it for this one.
   */
  readonly vessel: Vessel;
  readonly simTime: number;
  readonly appliedWarpMultiplier: number;
  readonly warpBlocked: boolean;
  readonly warpBlockedReason: WarpDenialReason | null;
}

/** `a = -μ·r̂/|r|²` (PLAN.md §5.1), plus atmosphere (§5.2), evaluated at `vessel`'s current position/time. */
function computeEnvironment(vessel: Vessel, t: number): FlightEnvironment {
  const body: Body = vessel.soi;
  const r = vessel.position;
  const rLen = v2.len(r);
  const gravity: Vec2 = rLen > 0 ? v2.scale(r, -body.mu / (rLen * rLen * rLen)) : ZERO;
  const altitude = rLen - body.radius;

  let airDensity = 0;
  let ambientPressure = 0;
  const atmo = body.atmosphere;
  if (atmo && altitude < atmo.top) {
    const h = Math.max(altitude, 0);
    airDensity = atmo.rho0 * Math.exp(-h / atmo.scaleHeight);
    ambientPressure = Math.min(1, Math.exp(-h / atmo.scaleHeight));
  }

  // Atmosphere co-rotates with the body (PLAN.md §5.2) — tangential velocity ω×r.
  const omega = body.rotationPeriod > 0 ? (2 * Math.PI) / body.rotationPeriod : 0;
  const atmosphereVelocity: Vec2 = { x: -omega * r.y, y: omega * r.x };

  return { t, body, gravity, airDensity, ambientPressure, atmosphereVelocity };
}

/**
 * Whether `vessel` is eligible to fly on-rails right now (PLAN.md §3.3's
 * off-rails triggers, inverted): engine off, above the atmosphere (or no
 * atmosphere), and not touching the ground. Checked every tick, independent
 * of the currently-selected warp level — see the module doc / orchestrator
 * report for why: gating the *transition* itself on warp, as a literal
 * reading of "warp <= 10x implies off-rails" would, makes `canSelectWarpLevel`'s
 * own `requires-rails` check unsatisfiable (it needs `railOrbit !== null`,
 * which off-rails-at-low-warp would never produce). Once eligible, the
 * vessel goes on-rails regardless of warp; a warp request above 10x is then
 * just a matter of asking.
 */
function offRailsEligible(vessel: Vessel, throttle: number): boolean {
  const body = vessel.soi;
  const altitude = v2.len(vessel.position) - body.radius;
  const grounded = altitude < 1;
  const inAtmosphere = body.atmosphere !== null && altitude < body.atmosphere.top;
  return throttle > 0 || inAtmosphere || grounded;
}

/** g-force from everything except gravity — an accelerometer reading (0 in free-fall) — the HUD's load-factor readout (DESIGN.md §3). */
const STANDARD_G = 9.80_665;

function gForceFromNonGravityAccel(velocityBefore: Vec2, velocityAfter: Vec2, gravity: Vec2, dt: number): number {
  if (dt <= 0) return 0;
  const totalAccel = v2.scale(v2.sub(velocityAfter, velocityBefore), 1 / dt);
  const nonGravity = v2.sub(totalAccel, gravity);
  return v2.len(nonGravity) / STANDARD_G;
}

/** Every engine-bearing part id in stages that haven't fired yet (index > `currentStage`) — used to pick which half of a stage separation keeps flying. */
function laterEngineIds(vessel: Vessel): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const stage of vessel.stages) {
    if (stage.index <= vessel.currentStage) continue;
    for (const id of stage.partIds) {
      const part = vessel.parts.find((p) => p.id === id);
      if (part?.def.engine != null) ids.add(id);
    }
  }
  return ids;
}

/**
 * Fires the current stage's separator(s), splitting the vessel via
 * `splitVessel` (PLAN.md §3.4: staging and structural breakage share the
 * same mechanism) and returning whichever resulting piece keeps flying
 * (the one carrying a later stage's engines — the spent piece is simply
 * dropped; see the orchestrator report on why it isn't kept as on-rails
 * debris in this integration pass). If the current stage has no separator
 * (e.g. a pure "ignite the next engine" stage with no physical split), just
 * advances `currentStage`.
 */
function fireStage(vessel: Vessel): Vessel {
  const stage = vessel.stages[vessel.currentStage];
  if (!stage) return vessel;

  const separatorIds = new Set(
    stage.partIds.filter((id) => vessel.parts.find((p) => p.id === id)?.def.category === 'separators')
  );
  if (separatorIds.size === 0) {
    vessel.currentStage = Math.min(vessel.currentStage + 1, vessel.stages.length - 1);
    return vessel;
  }

  const breakJointIds = vessel.joints
    .filter((j) => separatorIds.has(j.a) || separatorIds.has(j.b))
    .map((j) => ({ jointId: j.id, axialForce: Number.POSITIVE_INFINITY }));
  if (breakJointIds.length === 0) {
    vessel.currentStage = Math.min(vessel.currentStage + 1, vessel.stages.length - 1);
    return vessel;
  }

  const pieces = splitVessel(vessel, breakJointIds);
  if (pieces.length <= 1) {
    vessel.currentStage = Math.min(vessel.currentStage + 1, vessel.stages.length - 1);
    return vessel;
  }

  const wantEngines = laterEngineIds(vessel);
  const keep =
    pieces.find((p) => p.parts.some((part) => wantEngines.has(part.id))) ??
    pieces.reduce((best, p) => (p.id > best.id ? p : best));
  keep.currentStage = 0; // splitVessel already re-indexed this piece's own stages from 0
  return keep;
}

function toSnapshot(
  vessel: Vessel,
  env: FlightEnvironment,
  throttle: number,
  sas: boolean,
  gForce: number,
  justStaged: boolean
): VesselSnapshot {
  const body = vessel.soi;
  const altitude = v2.len(vessel.position) - body.radius;

  const activeEngines = (vessel.stages[vessel.currentStage]?.partIds ?? [])
    .map((id) => vessel.parts.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined && p.def.engine !== null);
  const thrustAtm = activeEngines.reduce((sum, p) => {
    const spec = p.def.engine!;
    return sum + (spec.thrustSl + (spec.thrustVac - spec.thrustSl) * (1 - env.ambientPressure));
  }, 0);
  const g = body.mu / (body.radius * body.radius);
  const twr = vessel.mass.total > 0 && g > 0 ? thrustAtm / (vessel.mass.total * g) : 0;

  const stageFuel = activeEngines.reduce(
    (acc, engine) => {
      const resourceId = engine.def.engine?.fuel ?? '';
      if (!resourceId) return acc;
      let capacity = 0;
      let remaining = 0;
      for (const part of vessel.parts) {
        const cap = part.def.resources.find((r) => r.id === resourceId);
        if (!cap) continue;
        capacity += cap.capacity;
        remaining += part.resources[resourceId] ?? 0;
      }
      return { capacity: acc.capacity + capacity, remaining: acc.remaining + remaining };
    },
    { capacity: 0, remaining: 0 }
  );
  const fuelFraction = stageFuel.capacity > 0 ? stageFuel.remaining / stageFuel.capacity : 1;

  let maxSpan = 0;
  for (const p of vessel.parts) maxSpan = Math.max(maxSpan, p.def.bounds.w, p.def.bounds.h);

  return {
    position: vessel.position,
    velocity: vessel.velocity,
    // Core `Vessel.rotation` is measured from the vessel's own local +Y (nose)
    // per DESIGN.md §4; the renderer/HUD's `VesselSnapshot.rotation` is a
    // world-frame `atan2(y,x)`-style heading (see `render/world-renderer.ts`'s
    // "nose along local +x at rotation 0") — the two are a constant π/2 apart.
    rotation: vessel.rotation + Math.PI / 2,
    altitude,
    throttle,
    ambientPressure: env.ambientPressure,
    gForce,
    sas,
    stageIndex: vessel.currentStage + 1,
    stageCount: vessel.stages.length,
    fuelFraction: Number.isFinite(fuelFraction) ? Math.max(0, Math.min(1, fuelFraction)) : 1,
    twr,
    justStaged,
    vesselSpanMeters: Math.max(maxSpan, 1),
  };
}

/**
 * Advances the flight scene's simulation-side state by exactly one fixed
 * tick, mutating `vessel` in place (matching `stepFlight`'s own in-place
 * contract). `simTime` is threaded explicitly (not stored on `state`) so the
 * caller — which also owns the shared `GameSession` — is the single source
 * of truth for "what time is it", shared with the map scene.
 *
 * @param vessel the actively-flown vessel (mutated)
 * @param state the previous tick's non-vessel state (shake, SAS target)
 * @param simTime simulation time at the start of this tick, s
 * @param dt fixed physics tick length, s (PLAN.md §3.2: `1/60`)
 * @param requestedWarpIndex index into `WARP_LEVELS` the player has asked for
 * @param control this tick's commanded input
 */
export function stepFlightSim(
  vessel: Vessel,
  state: FlightSimState,
  simTime: number,
  dt: number,
  requestedWarpIndex: number,
  control: ControlInput
): FlightStepResult {
  // The off-rails/on-rails transition happens first, *before* the warp gate
  // is checked — a vessel that becomes rails-eligible this very tick (engine
  // just cut, just cleared the atmosphere) must be able to warp immediately;
  // checking eligibility against last tick's (stale) `railOrbit` would make
  // `requires-rails` permanently unsatisfiable the instant it starts being
  // true (see the module doc's note on this).
  const wantsOffRails = offRailsEligible(vessel, control.throttle);

  if (wantsOffRails && vessel.railOrbit !== null) {
    const { r, v } = stateFromOrbit(vessel.railOrbit, simTime);
    vessel.position = r;
    vessel.velocity = v;
    vessel.railOrbit = null;
  }
  if (!wantsOffRails && vessel.railOrbit === null) {
    vessel.railOrbit = orbitFromState(vessel.position, vessel.velocity, vessel.soi.mu, simTime);
  }

  const requestedLevel = WARP_LEVELS[requestedWarpIndex] ?? 1;
  const decision = canSelectWarpLevel(requestedLevel, warpContextForVessel(vessel));
  const appliedWarpMultiplier = decision.granted
    ? decision.level
    : (WARP_LEVELS[Math.min(requestedWarpIndex, WARP_LEVELS.indexOf(MAX_ATMOSPHERIC_WARP))] ?? 1);
  const warpBlocked = !decision.granted;
  const warpBlockedReason = decision.reason;

  const sasTarget = control.sas ? (state.sasTarget ?? vessel.rotation) : null;
  const effectiveControl: ControlInput = sasTarget === null ? control : { ...control, sasTargetHeading: sasTarget };

  let justStaged = false;
  let gForce = 0;
  let nextSimTime = simTime;
  let activeVessel = vessel;

  if (activeVessel.railOrbit !== null) {
    nextSimTime = simTime + dt * appliedWarpMultiplier;
    const { r, v } = stateFromOrbit(activeVessel.railOrbit, nextSimTime);
    activeVessel.position = r;
    activeVessel.velocity = v;
    activeVessel.mass = computeMass(activeVessel);
  } else {
    // Off-rails: always warp <= MAX_ATMOSPHERIC_WARP here (canSelectWarpLevel
    // only grants more once on-rails), so this is at most a handful of real
    // physics sub-steps per rendered frame.
    const steps = Math.max(1, Math.round(appliedWarpMultiplier));
    for (let i = 0; i < steps; i++) {
      if (control.stage && i === 0) {
        activeVessel = fireStage(activeVessel);
        justStaged = true;
      }
      const env = computeEnvironment(activeVessel, nextSimTime);
      const velocityBefore = activeVessel.velocity;
      stepFlight(activeVessel, dt, env, effectiveControl);
      gForce = gForceFromNonGravityAccel(velocityBefore, activeVessel.velocity, env.gravity, dt);
      nextSimTime += dt;
    }
  }

  const env = computeEnvironment(activeVessel, nextSimTime);

  let shake = updateShake(state.shake, dt);
  if (justStaged) shake = kickShake(shake, STAGE_SEPARATION_SHAKE_PX);
  const snapshot = toSnapshot(activeVessel, env, control.throttle, control.sas, gForce, justStaged);
  const thrustKick = thrustShakeImpulsePerSecond(snapshot.twr, snapshot.throttle) * dt;
  if (thrustKick > 0) shake = kickShake(shake, thrustKick);

  return {
    state: { shake, sasTarget },
    snapshot,
    vessel: activeVessel,
    simTime: nextSimTime,
    appliedWarpMultiplier,
    warpBlocked,
    warpBlockedReason,
  };
}
