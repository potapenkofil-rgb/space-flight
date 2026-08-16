/** Propellant consumption and crossfeed (PLAN.md §5.3). */
import type { Vessel } from './vessel';

/**
 * Advances propellant consumption for one physics tick and returns the thrust
 * produced. Mass flow follows the Tsiolkovsky relation `ṁ = F / (Isp · g₀)`
 * with `g₀ = 9.80665` m/s² fixed (NOT local surface gravity — using local `g`
 * here is the classic bug that makes ΔV appear to improve on the Moon).
 * Propellant is drawn from tanks by walking up the part tree from each active
 * engine through `stack` nodes where `crossfeed` is `true`, in deterministic
 * `PartInstance.id` order (PLAN.md §5.3) — radial tanks feed only engines they
 * are explicitly attached to.
 *
 * Mutates `v.parts[*].resources` in place; does **not** update `v.mass` — call
 * `computeMass` afterwards to refresh the cache.
 *
 * @param v the vessel (current stage's engines are read from `v.stages[v.currentStage]`)
 * @param dt physics tick length, s (PLAN.md §3.2: always `1/60` in practice)
 * @param throttle commanded throttle, `0..1` (dimensionless fraction of max thrust)
 * @returns total thrust actually produced this tick, N (0 if starved of propellant)
 */
export function consumeFuel(v: Vessel, dt: number, throttle: number): number {
  void v;
  void dt;
  void throttle;
  throw new Error('not implemented: consumeFuel');
}
