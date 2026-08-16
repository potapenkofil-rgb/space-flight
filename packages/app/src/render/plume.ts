/**
 * Engine plume geometry — the one animation this game's HUD/world actually
 * needs (PLAN.md §7 Agent D, DESIGN.md §3: "animation... the plume growing
 * with throttle"): length and opacity follow throttle, and length/width
 * follow ambient pressure, per the plan's explicit rule — wider and shorter
 * in vacuum — this is the game's stated art-direction choice, not a claim
 * about real nozzle underexpansion.
 *
 * Pure geometry/opacity math, no canvas calls — `world-renderer.ts` turns
 * this into an actual `Path2D`/gradient. Kept separate so the shape math is
 * unit-testable without a canvas context.
 */

/** Per-engine visual tuning. Lengths/widths in metres (screen-space scale is applied by the caller). */
export interface PlumeStyle {
  /** Plume length at sea level (ambientPressure = 1), m. */
  readonly lengthSl: number;
  /** Plume length in vacuum (ambientPressure = 0), m — shorter than `lengthSl` per the rule above. */
  readonly lengthVac: number;
  /** Plume base width at sea level, m — narrower than `widthVac`. */
  readonly widthSl: number;
  /** Plume base width in vacuum, m — wider than `widthSl`. */
  readonly widthVac: number;
}

/** Reasonable default plume proportions, relative to nozzle exit width `1`. Callers scale by the actual part. */
export const DEFAULT_PLUME_STYLE: PlumeStyle = Object.freeze({
  lengthSl: 6,
  lengthVac: 4,
  widthSl: 1.4,
  widthVac: 2.4,
});

export interface PlumeShape {
  /** Plume length, m. `0` when the engine produces no visible exhaust (zero throttle). */
  readonly length: number;
  /** Plume base width, m. */
  readonly width: number;
  /** Opacity, `0..1`. */
  readonly alpha: number;
}

/**
 * Computes the plume's current length/width/opacity from throttle and
 * ambient pressure. `throttle` and `ambientPressure` are both `0..1`
 * (dimensionless); `ambientPressure` follows PLAN.md §5.2's convention
 * (`0` = vacuum, `1` = sea level).
 */
export function computePlumeShape(
  throttle: number,
  ambientPressure: number,
  style: PlumeStyle = DEFAULT_PLUME_STYLE
): PlumeShape {
  const t = clamp01(throttle);
  const p = clamp01(ambientPressure);
  if (t <= 0) return { length: 0, width: 0, alpha: 0 };

  const length = lerp(style.lengthVac, style.lengthSl, p) * t;
  const width = lerp(style.widthVac, style.widthSl, p) * (0.6 + 0.4 * t); // a bit narrower at low throttle too
  // Full throttle at sea level reads fully opaque; vacuum plumes are visually thinner/softer.
  const alpha = t * lerp(0.55, 0.95, p);
  return { length, width, alpha };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
