/**
 * Ground contact (PLAN.md §3.5): spring-damper reaction plus friction at each
 * part's contact points, no third-party physics engine (determinism).
 *
 * **Contract note (Agent B):** `PartDef` (§4) has no explicit "contact point" /
 * "foot" geometry field — only `bounds` (footprint) and `maxLandingSpeed`
 * (meaningful only on legs). Contact points here are derived generally, for
 * *every* part, as the two bottom corners of its local AABB — per DESIGN.md
 * §4 a part's local origin `(0,0)` is its bottom node, so `y = 0` is already
 * "the bottom" of the part in its own local frame. This self-selects: a tall
 * body's own bottom corners sit far above the ground once legs are attached
 * beneath it (no penetration, no force), while the legs' corners — spread out
 * by their own `bounds.w` and wherever they were placed — are what actually
 * touches down. No per-category special-casing needed. See report.
 */
import { clamp, degToRad, safeAcos } from '../math/mathx';
import { v2, ZERO, type Vec2 } from '../math/vec2';
import type { Body } from '../orbits/types';
import type { Vessel } from '../vessels/vessel';

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

/** Every part's two local bottom-AABB corners, sorted by `partId` ascending. */
export function computeContactPoints(v: Vessel): ContactPoint[] {
  const points: ContactPoint[] = [];
  for (const part of [...v.parts].sort((a, b) => a.id - b.id)) {
    const halfW = part.def.bounds.w / 2;
    const left = v2.add(part.position, v2.rot({ x: -halfW, y: 0 }, part.rotation));
    const right = v2.add(part.position, v2.rot({ x: halfW, y: 0 }, part.rotation));
    points.push({ partId: part.id, localPos: left });
    points.push({ partId: part.id, localPos: right });
  }
  return points;
}

interface ActiveContact {
  readonly normal: Vec2;
  readonly depth: number;
  /** Offset from the vessel's world centre of mass to this point, m. */
  readonly r: Vec2;
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
      active.push({ normal, depth, r: v2.sub(world, comWorld) });
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
    const vn = v2.dot(pointVel, point.normal); // negative = still approaching the surface
    const fn = Math.max(0, k * point.depth - c * vn);

    const tangent = { x: -point.normal.y, y: point.normal.x };
    const vt = v2.dot(pointVel, tangent);
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
