/**
 * Pure conic-section geometry for drawing an orbit on the map (DESIGN.md §5).
 *
 * Deliberately narrow: this module only knows the *shape* of an ellipse
 * (`a`, `e`, `argPe`) — it never converts a state vector to/from an orbit
 * (that is `@karman/core`'s `orbitFromState`/`stateFromOrbit`) and never
 * advances anomaly with time (that needs Kepler's equation,
 * `eccentricAnomaly`) — see `scenes/map/maneuverNode.ts`'s `OrbitKernel` for
 * where that math actually lives. Apoapsis/periapsis radius *are* included
 * here even though `@karman/core` also exports `apoapsis`/`periapsis` —
 * they're a fixed two-term formula (`a·(1±e)`), not a solver, so a local copy
 * for rendering carries no risk of drifting from the real one.
 */
import type { Vec2 } from '@karman/core';

/** The subset of `@karman/core`'s `Orbit` needed to draw its shape: semi-major axis, eccentricity, argument of periapsis. */
export interface OrbitShape {
  readonly a: number;
  readonly e: number;
  readonly argPe: number;
}

/** Radius from the focus at true anomaly `nu` (rad), for an ellipse (`0 ≤ e < 1`). */
export function radiusAtTrueAnomaly(orbit: OrbitShape, nu: number): number {
  const e = orbit.e;
  return (orbit.a * (1 - e * e)) / (1 + e * Math.cos(nu));
}

/** Position relative to the focus (the body's centre) at true anomaly `nu` (rad), in the orbital plane. */
export function pointAtTrueAnomaly(orbit: OrbitShape, nu: number): Vec2 {
  const r = radiusAtTrueAnomaly(orbit, nu);
  const theta = orbit.argPe + nu;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

/** Apoapsis distance from the focus, m — `a·(1+e)`. */
export function apoapsisRadius(orbit: OrbitShape): number {
  return orbit.a * (1 + orbit.e);
}

/** Periapsis distance from the focus, m — `a·(1-e)`. */
export function periapsisRadius(orbit: OrbitShape): number {
  return orbit.a * (1 - orbit.e);
}

const TWO_PI = Math.PI * 2;

export interface AdaptiveSampleOptions {
  /** Target chord-sagitta error, screen px (DESIGN.md §5: "≤ 0.5 px at the current zoom level"). */
  readonly targetErrorPx?: number;
  /** Hard cap on point count, so a degenerate orbit can't hang the renderer. */
  readonly maxPoints?: number;
  /** Smallest allowed step, rad — prevents a division-near-zero from producing an unbounded point count. */
  readonly minStepRad?: number;
  /** Largest allowed step, rad — keeps even a perfect circle visually round. */
  readonly maxStepRad?: number;
}

const DEFAULT_SAMPLE_OPTIONS: Required<AdaptiveSampleOptions> = {
  targetErrorPx: 0.5,
  maxPoints: 2000,
  minStepRad: 0.0015,
  maxStepRad: 0.35,
};

/**
 * Samples one full revolution of `orbit` into a polyline, adaptively —
 * finer angular steps near periapsis, coarser near apoapsis — per DESIGN.md
 * §5: "adaptive sampling step — denser near periapsis, sparser near
 * apoapsis, target error ≤ 0.5 px". Points are in the orbit-local plane
 * (relative to the focus); the caller (`orbit-renderer.ts`) offsets by the
 * body's world position and runs them through `worldToScreen`.
 *
 * Note this asymmetry is a *readability* choice, not a curvature-error one:
 * an ellipse's actual geometric curvature is equal at both apses (they're
 * antipodal vertices of the same axis) and lowest at the co-vertices in
 * between, so a pure minimal-chord-error sampler would *not* naturally
 * favour periapsis over apoapsis. The bias toward periapsis exists because
 * that is the part of the orbit passing close to the body — where the
 * player is reading altitude against the surface/atmosphere and a coarse
 * polyline would visibly cut the corner — while the apoapsis arc is far
 * from anything and a handful of long, nearly-straight segments there is
 * visually indistinguishable from the true curve.
 *
 * Implementation: the angular step is scaled by the local radius `r(ν)`
 * relative to the semi-major axis `a` (used as the length reference instead
 * of periapsis radius itself, so a very tight periapsis on a large orbit
 * doesn't blow the step up right where density matters most) — small step
 * where `r` is small (periapsis), large step where `r` is large (apoapsis),
 * calibrated so the base step (at `r = a`) corresponds to the requested
 * `targetErrorPx` via the circular-arc sagitta formula `s ≈ a·Δν²/8`.
 */
export function sampleOrbitPoints(
  orbit: OrbitShape,
  pixelsPerMeter: number,
  options: AdaptiveSampleOptions = {}
): Vec2[] {
  const opts = { ...DEFAULT_SAMPLE_OPTIONS, ...options };
  const e = Math.min(Math.max(orbit.e, 0), 0.999999); // ellipses only — see module doc
  const shape: OrbitShape = { a: orbit.a, e, argPe: orbit.argPe };
  const targetErrorM = opts.targetErrorPx / Math.max(pixelsPerMeter, 1e-12);
  const a = Math.max(shape.a, 1);
  const baseStep = Math.sqrt((8 * targetErrorM) / a);

  const points: Vec2[] = [];
  let nu = 0;
  let guard = 0;
  while (nu < TWO_PI && guard < opts.maxPoints) {
    points.push(pointAtTrueAnomaly(shape, nu));
    const r = Math.max(radiusAtTrueAnomaly(shape, nu), 1);
    const step = baseStep * (r / a);
    nu += Math.min(Math.max(step, opts.minStepRad), opts.maxStepRad);
    guard += 1;
  }
  return points;
}
