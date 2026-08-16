/**
 * The off-rails (numerical) flight integrator (PLAN.md §3.3/§3.4/§3.5). Advances
 * one vessel by exactly one fixed physics tick using symplectic (velocity) Verlet:
 * gravity, thrust, drag, torques and ground contact all apply here.
 */
import { angleDelta, clamp, clamp01 } from '../math/mathx';
import { v2, ZERO, type Vec2 } from '../math/vec2';
import { correctPenetration, resolveContact } from './contact';
import { computeMass } from '../vessels/mass';
import { burnEngines, findFuelSources, G0, type EngineBurn } from '../vessels/fuel';
import type { Vessel } from '../vessels/vessel';
import type { ControlInput, FlightEnvironment } from './types';

/** SAS PD-controller natural frequency, rad/s (PLAN.md §5.5 says "coefficients in data"; §4's frozen contract has no data field carrying them yet — fixed here, see report). */
const SAS_OMEGA = 3;
const SAS_ZETA = 1;

/**
 * Torque from the ship's stability-assist system this tick. With
 * `input.sasTargetHeading` set (Agent B's `ControlInput` extension, see
 * flight/types.ts), this is a proper critically-damped PD controller driving
 * `v.rotation` to that heading. Without it — no target ever supplied — the
 * error term is definitionally zero and the controller degrades to pure
 * angular-velocity damping ("kill rotation"), which is still a reasonable
 * reading of "stability assist" when no explicit target exists.
 */
function sasTorque(v: Vessel, input: ControlInput): number {
  if (!input.sas) return 0;
  const inertia = v.mass.inertia;
  if (inertia <= 0) return 0;
  const kp = inertia * SAS_OMEGA * SAS_OMEGA;
  const kd = 2 * SAS_ZETA * inertia * SAS_OMEGA;
  const error = input.sasTargetHeading !== undefined ? angleDelta(v.rotation, input.sasTargetHeading) : 0;
  return kp * error - kd * v.angularVelocity;
}

/**
 * Aerodynamic control-surface torque this tick (PLAN.md §5.5). `PartDef` has
 * no dedicated "control authority" field, so — like drag — each `category:
 * 'control'` part's own `dragArea` stands in for its aerodynamic effectiveness;
 * torque scales with dynamic pressure, that area, and the part's own moment
 * arm from the centre of mass. See report.
 */
function controlSurfaceTorque(
  v: Vessel,
  env: FlightEnvironment,
  rotateCmd: number,
  comWorld: Vec2,
  relSpeed: number
): number {
  if (env.airDensity <= 0 || relSpeed <= 0 || rotateCmd === 0) return 0;
  const q = 0.5 * env.airDensity * relSpeed * relSpeed;
  let torque = 0;
  for (const part of v.parts) {
    if (part.def.category !== 'control') continue;
    const posWorld = v2.add(v.position, v2.rot(part.position, v.rotation));
    const arm = v2.len(v2.sub(posWorld, comWorld));
    torque += rotateCmd * q * part.def.dragArea * arm;
  }
  return torque;
}

/**
 * RCS translation force and rotation torque this tick, and the propellant it
 * costs (PLAN.md §5.5). `PartDef`/`EngineSpec` carry no per-thruster nozzle
 * direction (only `EngineSpec.gimbal`, which is meaningless for a jet block),
 * so an exact per-thruster split between "pure translation" and "pure
 * rotation" isn't reconstructable from data — this treats every `category:
 * 'rcs'` part as a shared pool: capacity is its `thrustVac`/`ispVac` (assumed
 * pressure-insensitive, unlike a combustion main engine), split between the
 * commanded translation and rotation by their relative magnitudes, and
 * consumed via the same crossfeed rule as main engines. Mutates fuel levels
 * in place. Not covered by a required test; see report.
 */
function applyRcs(
  v: Vessel,
  dt: number,
  input: ControlInput,
  comWorld: Vec2
): { force: Vec2; torque: number } {
  const rcsParts = v.parts
    .filter((p) => p.def.category === 'rcs' && p.def.engine !== null)
    .sort((a, b) => a.id - b.id);
  if (rcsParts.length === 0) return { force: ZERO, torque: 0 };

  const rawLen = v2.len(input.rcsTranslate);
  const translateMag = clamp01(rawLen);
  const rotateMag = Math.abs(clamp(input.rotate, -1, 1));
  if (translateMag === 0 && rotateMag === 0) return { force: ZERO, torque: 0 };
  const translateDir = rawLen > 0 ? v2.scale(input.rcsTranslate, 1 / rawLen) : ZERO;

  let totalThrustCapacity = 0;
  let totalMdotCapacity = 0;
  let armSum = 0;
  for (const part of rcsParts) {
    const spec = part.def.engine;
    if (!spec) continue;
    totalThrustCapacity += spec.thrustVac;
    totalMdotCapacity += spec.ispVac > 0 ? spec.thrustVac / (spec.ispVac * G0) : 0;
    const posWorld = v2.add(v.position, v2.rot(part.position, v.rotation));
    armSum += v2.len(v2.sub(posWorld, comWorld));
  }
  if (totalThrustCapacity <= 0) return { force: ZERO, torque: 0 };
  const arm = armSum / rcsParts.length;

  const usedFraction = clamp01(translateMag + rotateMag);
  const desiredThrust = usedFraction * totalThrustCapacity;
  const fuelNeeded = usedFraction * totalMdotCapacity * dt;

  const reachable = rcsParts.map((part) => {
    const resourceId = part.def.engine?.fuel ?? '';
    return { resourceId, sources: findFuelSources(v.parts, v.joints, part, resourceId) };
  });
  let available = 0;
  const processed = new Set<string>();
  for (const { resourceId, sources } of reachable) {
    for (const s of sources) {
      const key = `${s.id}:${resourceId}`;
      if (processed.has(key)) continue;
      processed.add(key);
      available += s.resources[resourceId] ?? 0;
    }
  }

  const fuelUsed = Math.min(fuelNeeded, available);
  const scale = fuelNeeded > 0 ? fuelUsed / fuelNeeded : 0;
  let remaining = fuelUsed;
  processed.clear();
  for (const { resourceId, sources } of reachable) {
    for (const s of sources) {
      if (remaining <= 0) break;
      const key = `${s.id}:${resourceId}`;
      if (processed.has(key)) continue;
      processed.add(key);
      const have = s.resources[resourceId] ?? 0;
      if (have <= 0) continue;
      const take = Math.min(have, remaining);
      s.resources[resourceId] = have - take;
      remaining -= take;
    }
  }

  const actualThrust = desiredThrust * scale;
  const share = translateMag + rotateMag;
  const translateShare = share > 0 ? translateMag / share : 0;
  const rotateShare = share > 0 ? rotateMag / share : 0;

  const force = v2.scale(v2.rot(translateDir, v.rotation), actualThrust * translateShare);
  const torque = Math.sign(input.rotate) * actualThrust * rotateShare * arm;
  return { force, torque };
}

function thrustForceAndTorque(
  burns: readonly EngineBurn[],
  v: Vessel,
  rotateCmd: number,
  comWorld: Vec2
): { force: Vec2; torque: number } {
  let force = ZERO;
  let torque = 0;
  for (const burn of burns) {
    const deflection = rotateCmd * burn.gimbalMax;
    const dirLocal = v2.rot(burn.baseDirection, deflection);
    const dirWorld = v2.rot(dirLocal, v.rotation);
    const f = v2.scale(dirWorld, burn.thrust);
    force = v2.add(force, f);
    const posWorld = v2.add(v.position, v2.rot(burn.position, v.rotation));
    const r = v2.sub(posWorld, comWorld);
    torque += v2.cross(r, f);
  }
  return { force, torque };
}

/**
 * Advances `v` by exactly `dt` seconds of simulation time in place: integrates
 * gravity + thrust + drag + torque with symplectic Verlet, applies ground
 * contact response (PLAN.md §3.5) if any contact point has penetrated the
 * surface, consumes propellant (via `consumeFuel`) and refreshes `v.mass`.
 * Does **not** decide on/off-rails transitions or structural breakage — callers
 * run `evaluateStructure`/`splitVessel` separately using this tick's loads.
 *
 * **Implementation note (Agent B):** every force this tick (gravity, thrust,
 * drag, RCS, control surfaces, SAS, ground contact) is evaluated once from the
 * state at the *start* of the tick and integrated with semi-implicit
 * (symplectic) Euler — `v ← v + a·dt`, then `x ← x + v·dt` using the *new*
 * velocity — rather than literal two-substep velocity Verlet. Velocity Verlet's
 * usual benefit (better energy conservation for a pure conservative force) does
 * not carry over cleanly to velocity-dependent, non-conservative forces
 * (drag, thrust, contact) without either recomputing them mid-step or
 * approximating them as constant across the tick — which collapses to the same
 * thing as semi-implicit Euler anyway. This is the same integrator most
 * real-time engines mean by "symplectic"/"Verlet" in practice; see report.
 * `input.stage` is intentionally not read here — PLAN.md §3.4 says stage
 * separation goes through `splitVessel`, which returns new `Vessel`s that a
 * `void`-returning, single-vessel `stepFlight` cannot produce, so firing a
 * separator is the caller's job (see report).
 *
 * @param v the vessel to advance (mutated in place: position, velocity,
 *   rotation, angularVelocity, part resources, mass)
 * @param dt fixed physics tick length, s — PLAN.md §3.2 mandates exactly `1/60`
 *   in practice, but this function must accept any positive `dt` so it stays
 *   unit-testable without depending on the app's timing loop
 * @param env ambient gravity/atmosphere for this tick (see `FlightEnvironment`)
 * @param input this tick's player/autopilot commands
 */
export function stepFlight(
  v: Vessel,
  dt: number,
  env: FlightEnvironment,
  input: ControlInput
): void {
  const burns = burnEngines(v, dt, input.throttle, env.ambientPressure);
  v.mass = computeMass(v);

  const mass = v.mass.total;
  if (mass <= 0 || dt <= 0) return;

  const comWorld = v2.add(v.position, v2.rot(v.mass.com, v.rotation));
  const rotateCmd = clamp(input.rotate, -1, 1);

  let force = v2.scale(env.gravity, mass);
  let torque = 0;

  const thrust = thrustForceAndTorque(burns, v, rotateCmd, comWorld);
  force = v2.add(force, thrust.force);
  torque += thrust.torque;

  const relVel = v2.sub(v.velocity, env.atmosphereVelocity);
  const relSpeed = v2.len(relVel);
  if (relSpeed > 0 && env.airDensity > 0) {
    let totalDragArea = 0;
    for (const p of v.parts) totalDragArea += p.def.dragArea;
    const dragMag = 0.5 * env.airDensity * relSpeed * relSpeed * totalDragArea;
    force = v2.add(force, v2.scale(relVel, -dragMag / relSpeed));
  }

  torque += controlSurfaceTorque(v, env, rotateCmd, comWorld, relSpeed);

  const rcs = applyRcs(v, dt, input, comWorld);
  force = v2.add(force, rcs.force);
  torque += rcs.torque;

  torque += sasTorque(v, input);

  const contact = resolveContact(v, env.body);
  force = v2.add(force, contact.force);
  torque += contact.torque;

  const accel = v2.scale(force, 1 / mass);
  const angularAccel = v.mass.inertia > 0 ? torque / v.mass.inertia : 0;

  v.velocity = v2.add(v.velocity, v2.scale(accel, dt));
  v.angularVelocity += angularAccel * dt;

  v.position = v2.add(v.position, v2.scale(v.velocity, dt));
  v.rotation += v.angularVelocity * dt;

  if (contact.penetrating) {
    correctPenetration(v, env.body);
  }

  void input.stage; // see TSDoc: staging is the caller's responsibility, not stepFlight's.
}
