/**
 * Scalar math helpers shared by the whole simulation: clamping, interpolation and
 * angle normalization. Every function is pure and unit-agnostic unless documented
 * otherwise (angles are always radians unless the name says `Deg`).
 */

/** Clamps `x` into `[min, max]`. All three share the same unit. */
export function clamp(x: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) > max (${max})`);
  }
  return Math.min(Math.max(x, min), max);
}

/** Clamps `x` into `[0, 1]`. Convenience wrapper around {@link clamp}. */
export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/**
 * Linear interpolation between `a` and `b`. `t` is unitless; `t=0` returns `a`,
 * `t=1` returns `b`. `t` is not clamped — values outside `[0,1]` extrapolate.
 * `a`, `b` and the result share the same unit.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Inverse of {@link lerp}: returns the unitless `t` such that
 * `lerp(a, b, t) === value` (up to floating point error). `a` and `b` must differ.
 */
export function invLerp(a: number, b: number, value: number): number {
  if (a === b) {
    throw new RangeError('invLerp: a and b must differ');
  }
  return (value - a) / (b - a);
}

/**
 * Clamped linear remap of `value` from range `[inMin, inMax]` to `[outMin, outMax]`.
 * Units: `value`/`inMin`/`inMax` share a unit, `outMin`/`outMax` share another
 * (possibly different) unit; the result is in the output unit.
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  const t = clamp01(invLerp(inMin, inMax, value));
  return lerp(outMin, outMax, t);
}

/** Converts degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Converts radians to degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Normalizes an angle in radians into `[-π, π)`. Used everywhere angles are
 * compared or subtracted (e.g. heading error for SAS) so that wrap-around at
 * ±π never produces a spurious near-2π error.
 */
export function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  // Reduce into [0, 2π) first with a Euclidean-style modulo (handles negative rad),
  // then shift the half that's ≥ π down by 2π to land in [-π, π).
  let a = rad % twoPi;
  if (a < 0) a += twoPi;
  if (a >= Math.PI) a -= twoPi;
  return a;
}

/**
 * `Math.acos` with its input clamped to `[-1, 1]` first. Floating point error in
 * dot-product-of-unit-vectors computations routinely produces values like
 * `1.0000000000000002`, which would otherwise make `Math.acos` return `NaN` and
 * silently poison downstream orbit/attitude math.
 */
export function safeAcos(x: number): number {
  return Math.acos(clamp(x, -1, 1));
}

/**
 * `Math.asin` with its input clamped to `[-1, 1]` first, for the same reason as
 * {@link safeAcos}.
 */
export function safeAsin(x: number): number {
  return Math.asin(clamp(x, -1, 1));
}

/**
 * Returns true when `a` and `b` are equal within `epsilon` absolute tolerance
 * (default `1e-9`). Units of `a`, `b` and `epsilon` must match.
 */
export function approxEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Shortest signed angular difference `b − a`, normalized into `[-π, π)`.
 * Positive means `b` is counter-clockwise from `a`. Radians in, radians out.
 */
export function angleDelta(a: number, b: number): number {
  return normalizeAngle(b - a);
}
