/**
 * The maneuver node model (PLAN.md §7 Agent D): placed by clicking a point on
 * the current orbit, dragged along prograde/retrograde and radial in/out,
 * previews the resulting orbit. Pure data + pure functions — `MapScene.ts`
 * owns the DOM/canvas interaction (drag handling, hit-testing) and calls
 * into this module for the math.
 *
 * The actual state→orbit conversion is delegated through an injectable
 * `OrbitKernel` whose three methods are typed to match `@karman/core`'s
 * `orbitFromState`/`stateFromOrbit`/`timeToTrueAnomaly` exactly (PLAN.md §4),
 * defaulting to the real ones — kept injectable (rather than calling
 * `@karman/core` directly) purely so tests can swap in a different kernel if
 * ever needed, not because the real one is unavailable.
 */
import { orbitFromState, stateFromOrbit, timeToTrueAnomaly, v2, type Orbit, type Vec2 } from '@karman/core';

export interface OrbitKernel {
  orbitFromState(r: Vec2, v: Vec2, mu: number, t: number): Orbit;
  stateFromOrbit(o: Orbit, t: number): { r: Vec2; v: Vec2 };
  timeToTrueAnomaly(o: Orbit, nu: number, from: number): number;
}

/** `@karman/core`'s real Kepler mechanics (PLAN.md §4/§5.1), wrapped to the `OrbitKernel` shape. */
export const REAL_ORBIT_KERNEL: OrbitKernel = { orbitFromState, stateFromOrbit, timeToTrueAnomaly };

/**
 * Assumed constant acceleration used to estimate burn duration, m/s².
 * FIXTURE: a real figure needs the vessel's current thrust/mass (Agent
 * B/C), unavailable here — see the Agent D report for what to wire once a
 * real `Vessel` with `computeMass`/engine data is available.
 */
export const ASSUMED_BURN_ACCEL_MPS2 = 15;

export interface ManeuverNode {
  /** True anomaly (rad) on the *current* orbit where the node sits. */
  readonly trueAnomaly: number;
  /** Prograde (+) / retrograde (−) component, m/s. */
  readonly progradeDeltaV: number;
  /** Radial-out (+) / radial-in (−) component, m/s. */
  readonly radialDeltaV: number;
}

/** Places a fresh node at `trueAnomaly` with zero delta-v (before any dragging). */
export function createManeuverNode(trueAnomaly: number): ManeuverNode {
  return { trueAnomaly, progradeDeltaV: 0, radialDeltaV: 0 };
}

/** Returns a copy of `node` with its prograde/retrograde component set to `value` (m/s). */
export function withProgradeDeltaV(node: ManeuverNode, value: number): ManeuverNode {
  return { ...node, progradeDeltaV: value };
}

/** Returns a copy of `node` with its radial in/out component set to `value` (m/s). */
export function withRadialDeltaV(node: ManeuverNode, value: number): ManeuverNode {
  return { ...node, radialDeltaV: value };
}

export interface ManeuverPreview {
  /** Absolute simulation time the node fires at, s. */
  readonly nodeTime: number;
  /** Seconds from "now" until the node fires (PLAN.md §7 Agent D: "time to"). */
  readonly timeToNode: number;
  /** World position (relative to the focus body) the node sits at. */
  readonly worldPos: Vec2;
  /** Combined delta-v magnitude, m/s. */
  readonly deltaVMagnitude: number;
  /** Estimated burn duration at {@link ASSUMED_BURN_ACCEL_MPS2} (PLAN.md §7 Agent D: "burn duration"). */
  readonly burnDurationSeconds: number;
  /** The orbit the vessel would be on after the burn (PLAN.md §7 Agent D: "result"). */
  readonly resultOrbit: Orbit;
}

/**
 * Computes the full preview for `node` against `currentOrbit`: where/when it
 * fires, the resulting orbit, and the burn's delta-v/duration. Pure —
 * doesn't mutate `node` or `currentOrbit`.
 */
export function previewManeuver(
  currentOrbit: Orbit,
  node: ManeuverNode,
  nowTime: number,
  kernel: OrbitKernel = REAL_ORBIT_KERNEL
): ManeuverPreview {
  const nodeTime = kernel.timeToTrueAnomaly(currentOrbit, node.trueAnomaly, nowTime);
  const { r, v } = kernel.stateFromOrbit(currentOrbit, nodeTime);

  const progradeDir = v2.norm(v);
  const radialDir = v2.norm(r);
  const deltaV = v2.add(v2.scale(progradeDir, node.progradeDeltaV), v2.scale(radialDir, node.radialDeltaV));
  const newVelocity = v2.add(v, deltaV);

  const resultOrbit = kernel.orbitFromState(r, newVelocity, currentOrbit.mu, nodeTime);
  const deltaVMagnitude = v2.len(deltaV);

  return {
    nodeTime,
    timeToNode: Math.max(0, nodeTime - nowTime),
    worldPos: r,
    deltaVMagnitude,
    burnDurationSeconds: deltaVMagnitude / ASSUMED_BURN_ACCEL_MPS2,
    resultOrbit,
  };
}

/**
 * Finds the true anomaly of the point on `orbit` closest to `worldClick`
 * (relative to the focus), by sampling the same adaptive polyline the
 * renderer draws — so "click the line" and "what the line looks like" agree
 * pixel-for-pixel. Used to place a node from a map click.
 */
export function nearestTrueAnomaly(
  orbit: Orbit,
  worldClick: Vec2,
  sampleTrueAnomalies: readonly number[]
): number {
  let best = sampleTrueAnomalies[0] ?? 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const nu of sampleTrueAnomalies) {
    const r = (orbit.a * (1 - orbit.e * orbit.e)) / (1 + orbit.e * Math.cos(nu));
    const theta = orbit.argPe + nu;
    const point = { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    const dist = v2.len2(v2.sub(point, worldClick));
    if (dist < bestDist) {
      bestDist = dist;
      best = nu;
    }
  }
  return best;
}
