/**
 * Ground contact (PLAN.md §3.5): spring-damper reaction plus friction at each
 * part's contact points, no third-party physics engine (determinism).
 *
 * **Contract note (Agent B):** `PartDef` (§4) has no explicit "contact point" /
 * "foot" geometry field — only `bounds` (footprint) and `maxLandingSpeed`
 * (meaningful only on legs). Contact points here are derived generally, for
 * *every* part, as the two lowest corners of its local (rotated) AABB — per
 * DESIGN.md §4 a part's local origin `(0,0)` is its bottom node and `+Y`
 * points toward the nose, so *unrotated* `y = 0` is "the bottom". But
 * `PartInstance.rotation` is **not** always `0`: the hangar's attach solver
 * (`bestOwnNode`/`computeAttachTransform` in `scenes/build/state.ts`) is free
 * to rotate a part 180° to make its node directions mate — every part in a
 * vessel assembled root-down-to-nose-first-then-extended-*downward* (as
 * opposed to the usual bottom-up order) ends up rotated by π. A part rotated
 * by π has its true bottom at local `y = -bounds.h`, not `y = 0` — using the
 * unrotated corner unconditionally (the previous version of this function)
 * silently picks the *wrong* corner pair for such a part: its now-highest
 * edge instead of its lowest. That misidentified "bottom" edge sits well
 * inside another part's span, so it reads as a deep, sourceless
 * ground-penetration the very first tick — the actual mechanism behind the
 * pad-toppling bug this file's report investigates, not a tuning problem.
 * Rotating the full corner set with the part's actual `rotation` and taking
 * the two lowest by local `y` fixes this for any rotation, not just 0/π, and
 * still self-selects exactly as before: a part whose true lowest edge sits
 * above the vessel's actual base never penetrates, so it contributes no
 * force. See report.
 */
import { clamp, degToRad, safeAcos } from '../math/mathx';
import { v2, ZERO, type Vec2 } from '../math/vec2';
import type { Body } from '../orbits/types';
import type { PartInstance, Vessel } from '../vessels/vessel';

/** One candidate ground-contact point, in the vessel's local frame. */
export interface ContactPoint {
  readonly partId: number;
  readonly localPos: Vec2;
}

/** This tick's aggregate contact response. */
export interface ContactResult {
  readonly force: Vec2;
  readonly torque: number;
  readonly penetrating: boolean;
  /** Deepest penetration among all active contact points this tick, m. */
  readonly maxPenetration: number;
}

/** Spring natural frequency target, rad/s — chosen so `ω₀·dt ≈ 0.5` at the mandated 1/60 s tick, well inside the stability margin of semi-implicit Euler. */
const STIFFNESS_OMEGA = 30;
/** Damping ratio; slightly above critical (1.0) for extra margin against the point-mass/rigid-body coupling this model approximates away. */
const DAMPING_RATIO = 1.6;
const FRICTION_COEFF = 0.6;
/** Fraction of any residual penetration corrected per tick by {@link correctPenetration} (Baumgarte-style position stabilization). */
const POSITION_CORRECTION_FRACTION = 0.2;
const PENETRATION_EPSILON = 1e-5;

/**
 * All four corners of a part's local AABB (`bounds.w × bounds.h`, spanning
 * local `y ∈ [0, bounds.h]` per DESIGN.md §4's "origin is the bottom node"
 * convention), rotated by the part's own `rotation` and translated by its
 * `position` — i.e. in the *vessel's* local frame, not the part's.
 */
function partCornersInVesselFrame(part: PartInstance): Vec2[] {
  const halfW = part.def.bounds.w / 2;
  const h = part.def.bounds.h;
  const local: Vec2[] = [
    { x: -halfW, y: 0 },
    { x: halfW, y: 0 },
    { x: -halfW, y: h },
    { x: halfW, y: h },
  ];
  return local.map((c) => v2.add(part.position, v2.rot(c, part.rotation)));
}

/**
 * A part's two lowest corners (by vessel-local `y`, ascending) — its true
 * bottom edge regardless of how the part ended up rotated. For the common
 * axis-aligned case (`rotation` a multiple of π) this is exactly the pair of
 * corners on the low side of the box; for an off-axis rotation (e.g. a
 * radially-mounted leg) it's the two corners closest to the ground, still a
 * reasonable two-point stance. See the module doc for why this must not
 * assume unrotated local `y = 0` is always "the bottom".
 */
function partBottomCorners(part: PartInstance): ContactPoint[] {
  const corners = [...partCornersInVesselFrame(part)].sort((a, b) => a.y - b.y);
  return corners.slice(0, 2).map((localPos) => ({ partId: part.id, localPos }));
}

/** Every part's two lowest local corners, sorted by `partId` ascending. */
export function computeContactPoints(v: Vessel): ContactPoint[] {
  const points: ContactPoint[] = [];
  for (const part of [...v.parts].sort((a, b) => a.id - b.id)) {
    points.push(...partBottomCorners(part));
  }
  return points;
}

/**
 * Inertial-frame velocity of the ground itself at `worldPoint` (which, per
 * `Vessel.position`'s contract, is already relative to `body`'s own centre)
 * for a body spinning once every `body.rotationPeriod` seconds: `v = ω × r`.
 * The same formula `launchVessel`/`FlightEnvironment.atmosphereVelocity` use
 * for "the pad" / "the air" — the ground is no different, and skipping this
 * is the second half of the pad-toppling bug this file's report covers: a
 * vessel resting on a rotating body (Terra: ~291 m/s at the equator) is
 * launched *at* that speed (`launchVessel`'s `padVelocity`), so its contact
 * points are never actually "sliding" — but comparing their raw inertial
 * velocity against zero, as this function's callers used to, makes the
 * friction model see ~291 m/s of phantom slip and fight it at full clamped
 * force, forever, which torques the vessel over within a couple of seconds.
 */
function groundVelocity(worldPoint: Vec2, body: Body): Vec2 {
  const omega = body.rotationPeriod > 0 ? (2 * Math.PI) / body.rotationPeriod : 0;
  return { x: -omega * worldPoint.y, y: omega * worldPoint.x };
}

interface ActiveContact {
  readonly normal: Vec2;
  readonly depth: number;
  /** Offset from the vessel's world centre of mass to this point, m. */
  readonly r: Vec2;
  /** Inertial-frame velocity of the ground at this point, m/s (see {@link groundVelocity}). */
  readonly groundVel: Vec2;
}

function findActiveContacts(v: Vessel, body: Body): ActiveContact[] {
  const comWorld = v2.add(v.position, v2.rot(v.mass.com, v.rotation));
  const active: ActiveContact[] = [];
  for (const p of computeContactPoints(v)) {
    const world = v2.add(v.position, v2.rot(p.localPos, v.rotation));
    const dist = v2.len(world);
    const depth = body.radius - dist;
    if (depth > 0) {
      const normal = dist > 0 ? v2.scale(world, 1 / dist) : { x: 0, y: 1 };
      active.push({ normal, depth, r: v2.sub(world, comWorld), groundVel: groundVelocity(world, body) });
    }
  }
  return active;
}

/**
 * Computes this tick's ground-contact force and torque from `v`'s *current*
 * (pre-integration) state, using an implicit-leaning critically/over-damped
 * spring-damper per active contact point plus clamped Coulomb friction (no
 * force is ever pulled toward the ground, and friction never reverses the
 * tangential velocity it's opposing — both are the standard tricks that keep
 * a fixed-step penalty contact model from jittering). Pure — does not mutate
 * `v`; the caller (`stepFlight`) folds the result into this tick's net
 * force/torque like any other force.
 */
export function resolveContact(v: Vessel, body: Body): ContactResult {
  const mass = v.mass.total;
  if (mass <= 0) return { force: ZERO, torque: 0, penetrating: false, maxPenetration: 0 };

  const active = findActiveContacts(v, body);
  if (active.length === 0) return { force: ZERO, torque: 0, penetrating: false, maxPenetration: 0 };

  const effMass = mass / active.length;
  const k = effMass * STIFFNESS_OMEGA * STIFFNESS_OMEGA;
  const c = 2 * DAMPING_RATIO * effMass * STIFFNESS_OMEGA;

  let force = ZERO;
  let torque = 0;
  let maxPenetration = 0;

  for (const point of active) {
    maxPenetration = Math.max(maxPenetration, point.depth);
    const rot90 = { x: -point.r.y, y: point.r.x };
    const pointVel = v2.add(v.velocity, v2.scale(rot90, v.angularVelocity));
    // Relative to the ground *at this point*, not the inertial frame (see
    // `groundVelocity`'s doc) — ω×r is purely tangential (⊥ the radial
    // normal), so this only ever changes `vt`, never `vn`, but computing both
    // from the same relative velocity keeps the two consistent.
    const relVel = v2.sub(pointVel, point.groundVel);
    const vn = v2.dot(relVel, point.normal); // negative = still approaching the surface
    const fn = Math.max(0, k * point.depth - c * vn);

    const tangent = { x: -point.normal.y, y: point.normal.x };
    const vt = v2.dot(relVel, tangent);
    const maxFriction = FRICTION_COEFF * fn;
    // Clamp friction to what would exactly zero the tangential velocity this
    // instant (using the effective per-point mass) — prevents overshoot/jitter.
    const desired = -vt * effMass;
    const ft = clamp(desired, -maxFriction, maxFriction);

    const pointForce = v2.add(v2.scale(point.normal, fn), v2.scale(tangent, ft));
    force = v2.add(force, pointForce);
    torque += v2.cross(point.r, pointForce);
  }

  return { force, torque, penetrating: true, maxPenetration };
}

/**
 * Direct position stabilization pass: nudges `v.position` out along the
 * (depth-weighted average) contact normal by a fraction of any residual
 * penetration left after the tick's velocity-based spring-damper response.
 * This is what keeps a resting vessel from creeping into the ground over
 * thousands of ticks even if the spring alone leaves a tiny residual — a
 * standard augmentation ("Baumgarte stabilization") to penalty-based contact.
 * Mutates `v.position` in place; no-op if nothing is penetrating beyond a
 * tiny epsilon.
 */
export function correctPenetration(v: Vessel, body: Body): void {
  let total = ZERO;
  let count = 0;
  for (const p of computeContactPoints(v)) {
    const world = v2.add(v.position, v2.rot(p.localPos, v.rotation));
    const dist = v2.len(world);
    const depth = body.radius - dist;
    if (depth > PENETRATION_EPSILON) {
      const normal = dist > 0 ? v2.scale(world, 1 / dist) : { x: 0, y: 1 };
      total = v2.add(total, v2.scale(normal, depth));
      count += 1;
    }
  }
  if (count === 0) return;
  v.position = v2.add(v.position, v2.scale(total, POSITION_CORRECTION_FRACTION / count));
}

/** Maximum tilt from local vertical for a landing to count, rad (PLAN.md §3.5: 15°). */
const MAX_LANDING_TILT = degToRad(15);

/** Result of checking a vessel currently in contact against the landing criteria of PLAN.md §3.5. */
export interface LandingCheck {
  readonly touchingGround: boolean;
  /** Vertical (radial) descent speed, m/s (positive = still descending). */
  readonly verticalSpeed: number;
  readonly speedLimit: number;
  readonly withinSpeedLimit: boolean;
  /** Tilt of the vessel's local "up" from the local vertical, rad. */
  readonly tilt: number;
  readonly withinTiltLimit: boolean;
  readonly successful: boolean;
}

/**
 * Checks a vessel currently touching down against PLAN.md §3.5's landing
 * criteria: vertical speed under the landing legs' `maxLandingSpeed`, tilt
 * under 15°. Exported beyond the frozen §4 surface — PLAN.md §3.5 requires
 * this check to exist, but names no function for it; see report.
 */
export function evaluateLanding(v: Vessel, body: Body): LandingCheck {
  const touchingGround = findActiveContacts(v, body).length > 0;

  const legSpeeds = v.parts.filter((p) => p.def.maxLandingSpeed > 0).map((p) => p.def.maxLandingSpeed);
  const speedLimit = legSpeeds.length > 0 ? Math.min(...legSpeeds) : 0;

  const radial = v2.norm(v.position);
  const verticalSpeed = -v2.dot(v.velocity, radial);
  const withinSpeedLimit = verticalSpeed <= speedLimit;

  const localUp = v2.rot({ x: 0, y: 1 }, v.rotation);
  const tilt = safeAcos(v2.dot(localUp, radial));
  const withinTiltLimit = tilt <= MAX_LANDING_TILT;

  return {
    touchingGround,
    verticalSpeed,
    speedLimit,
    withinSpeedLimit,
    tilt,
    withinTiltLimit,
    successful: touchingGround && withinSpeedLimit && withinTiltLimit,
  };
}
