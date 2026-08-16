/**
 * Chart data for the black box (PLAN.md §7 Agent F): altitude, speed,
 * g-force and remaining-fuel-fraction over time, derived purely from a
 * `ReplaySession`. Lives in `@karman/core` (not the UI layer) so it's a plain
 * function of already-tested data and can be unit-tested headlessly —
 * `packages/app/src/ui/replay/charts.ts` only has to draw the numbers this
 * produces.
 */
import { v2 } from '../math/vec2';
import type { Vessel } from '../vessels/vessel';
import type { ReplaySession } from './types';

/** Standard gravity, m/s² — PLAN.md §5.3's `g₀`, used to express g-force as a dimensionless multiple of it. */
const G0 = 9.80665;

/** One sampled point of a flight's telemetry, for charting. */
export interface TelemetrySample {
  /** Simulation time of this sample, s. */
  readonly t: number;
  /** Altitude above `soi`'s surface, m (may be negative briefly on impact). */
  readonly altitude: number;
  /** Speed relative to `soi`'s centre, m/s. */
  readonly speed: number;
  /** Magnitude of acceleration since the previous sample, in multiples of `G0`. `0` for the first sample. */
  readonly gForce: number;
  /**
   * Remaining `"fuel"` resource across every part, as a fraction of the first
   * sample's total (`1` at the start of the series, `0` once exhausted).
   * `0` for a vessel that never carried any `"fuel"` resource.
   */
  readonly fuelFraction: number;
}

/** Sums the `"fuel"` resource (PLAN.md §6.1's primary propellant id) across every part of `v`. */
function totalFuel(v: Vessel): number {
  let total = 0;
  for (const part of v.parts) {
    total += part.resources['fuel'] ?? 0;
  }
  return total;
}

function findVessel(vessels: readonly Vessel[], vesselId: number): Vessel | undefined {
  return vessels.find((v) => v.id === vesselId);
}

/**
 * Samples `session` at `sampleCount` evenly-spaced points across its whole
 * recorded span and returns one `TelemetrySample` per point (for whichever
 * point still has `vesselId` alive; earlier/later points where the vessel
 * doesn't exist yet/anymore are skipped). `sampleCount` must be at least 2.
 */
export function computeTelemetrySeries(
  session: ReplaySession,
  vesselId: number,
  sampleCount: number
): TelemetrySample[] {
  if (sampleCount < 2) {
    throw new RangeError('computeTelemetrySeries: sampleCount must be at least 2');
  }
  const span = session.endTime - session.startTime;
  const out: TelemetrySample[] = [];
  let initialFuel: number | null = null;
  let prev: { t: number; velocity: { x: number; y: number } } | null = null;

  for (let i = 0; i < sampleCount; i += 1) {
    const t = session.startTime + (span * i) / (sampleCount - 1);
    const vessel = findVessel(session.seekTo(t), vesselId);
    if (!vessel) continue;

    if (initialFuel === null) initialFuel = totalFuel(vessel);
    const fuel = totalFuel(vessel);
    const fuelFraction = initialFuel > 0 ? fuel / initialFuel : 0;

    const altitude = v2.len(vessel.position) - vessel.soi.radius;
    const speed = v2.len(vessel.velocity);

    let gForce = 0;
    if (prev && t > prev.t) {
      const dv = v2.sub(vessel.velocity, prev.velocity);
      gForce = v2.len(dv) / (t - prev.t) / G0;
    }
    prev = { t, velocity: vessel.velocity };

    out.push({ t, altitude, speed, gForce, fuelFraction });
  }
  return out;
}
