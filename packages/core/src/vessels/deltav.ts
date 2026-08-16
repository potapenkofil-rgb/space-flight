/** Stage delta-v, per PLAN.md §5.4: `ΔV = Isp · g₀ · ln(m_start / m_end)`. */
import type { Vessel } from './vessel';

/** Delta-v budget for a single stage, computed at both vacuum and a given ambient pressure. */
export interface StageDeltaV {
  /** `Stage.index` this figure is for. */
  readonly stageIndex: number;
  /** Delta-v in vacuum, m/s. */
  readonly deltaVVac: number;
  /** Delta-v at the `ambientPressure` passed to `computeDeltaV`, m/s. */
  readonly deltaVAtm: number;
  /** Vessel mass at stage ignition (this stage plus everything above it, full resources), kg. */
  readonly startMass: number;
  /** Vessel mass at stage burnout (propellant for this stage exhausted), kg. */
  readonly endMass: number;
  /** Burn time at full throttle and the given `ambientPressure`, s. */
  readonly burnTime: number;
}

/**
 * Computes `ΔV = Isp · g₀ · ln(m_start / m_end)` for every stage of `v`, both in
 * vacuum and at `ambientPressure`, accounting for crossfeed (fuel drawn from
 * stages above the firing stage counts against this stage's `endMass` only once
 * actually spent — see PLAN.md §5.3/§5.4). Pure — does not mutate `v`.
 *
 * @param v the vessel (uses `v.stages`, `v.parts`, current resource levels)
 * @param ambientPressure ambient pressure as a fraction of sea-level pressure,
 *   `0` (vacuum) to `1` (sea level), used to interpolate thrust/Isp per PLAN.md §5.2
 * @returns one `StageDeltaV` per stage, ordered by `stageIndex` ascending
 */
export function computeDeltaV(v: Vessel, ambientPressure: number): StageDeltaV[] {
  void v;
  void ambientPressure;
  throw new Error('not implemented: computeDeltaV');
}
