/** Stage delta-v, per PLAN.md §5.4: `ΔV = Isp · g₀ · ln(m_start / m_end)`. */
import { clamp01, lerp } from '../math/mathx';
import { findFuelSources, G0 } from './fuel';
import { connectedComponents } from './structure';
import type { PartInstance, Vessel } from './vessel';

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

function sumResources(res: Record<string, number> | undefined): number {
  if (!res) return 0;
  let total = 0;
  for (const key of Object.keys(res).sort()) total += res[key] ?? 0;
  return total;
}

/** Combined thrust/mass-flow of a set of engines, all throttled together at full, at one pressure. */
function combinedPerformance(
  engines: readonly PartInstance[],
  pressure: number
): { exhaustVelocity: number; thrust: number; mdot: number } {
  const t = 1 - clamp01(pressure);
  let thrust = 0;
  let mdot = 0;
  for (const e of engines) {
    const spec = e.def.engine;
    if (!spec) continue;
    const thrustAt = lerp(spec.thrustSl, spec.thrustVac, t);
    const ispAt = lerp(spec.ispSl, spec.ispVac, t);
    thrust += thrustAt;
    mdot += ispAt > 0 ? thrustAt / (ispAt * G0) : 0;
  }
  // Thrust-weighted combined exhaust velocity (Isp·g₀); reduces to a single
  // engine's own Isp·g₀ exactly when there is only one engine.
  const exhaustVelocity = mdot > 0 ? thrust / mdot : 0;
  return { exhaustVelocity, thrust, mdot };
}

/**
 * Computes `ΔV = Isp · g₀ · ln(m_start / m_end)` for every stage of `v`, both in
 * vacuum and at `ambientPressure`, accounting for crossfeed (fuel drawn from
 * stages above the firing stage counts against this stage's `endMass` only once
 * actually spent — see PLAN.md §5.3/§5.4). Pure — does not mutate `v`.
 *
 * Simulates ignition-to-separation for every stage in ascending `Stage.index`
 * order against a private working copy of `v`'s *current* resource levels
 * (matching this function's own contract, not necessarily full tanks — a
 * mid-flight caller gets "ΔV remaining"; a hangar caller with full tanks gets
 * the usual pre-flight budget). At each stage: mass reachable by that stage's
 * engines (PLAN.md §5.3 crossfeed rule, shared with `consumeFuel` via
 * {@link findFuelSources}) is drained to zero — "this stage's ΔV" is defined
 * as burning everything it can reach before separating. Stage separation
 * itself is inferred the same way `splitVessel` would: a stage's
 * `category: 'separators'` part(s) breaking their own incident joints:
 * whichever resulting component doesn't carry on to a later stage's engines
 * is dropped from subsequent stages' starting mass. PLAN.md's `Stage.partIds`
 * lists only *activating* parts (engines/separators), not full stage
 * membership, so this reconstruction — rather than a direct field — is
 * necessary; see report.
 *
 * @param v the vessel (uses `v.stages`, `v.parts`, current resource levels)
 * @param ambientPressure ambient pressure as a fraction of sea-level pressure,
 *   `0` (vacuum) to `1` (sea level), used to interpolate thrust/Isp per PLAN.md §5.2
 * @returns one `StageDeltaV` per stage, ordered by `stageIndex` ascending
 */
export function computeDeltaV(v: Vessel, ambientPressure: number): StageDeltaV[] {
  const partById = new Map(v.parts.map((p) => [p.id, p] as const));
  const working = new Map<number, Record<string, number>>();
  for (const p of v.parts) working.set(p.id, { ...p.resources });

  const remaining = new Set(v.parts.map((p) => p.id));
  const sortedStages = [...v.stages].sort((a, b) => a.index - b.index);
  const results: StageDeltaV[] = [];

  for (const stage of sortedStages) {
    const remainingParts = v.parts.filter((p) => remaining.has(p.id));
    const remainingJoints = v.joints.filter((j) => remaining.has(j.a) && remaining.has(j.b));

    const startMass = remainingParts.reduce(
      (sum, p) => sum + p.def.dryMass + sumResources(working.get(p.id)),
      0
    );

    const engines = stage.partIds
      .filter((id) => remaining.has(id))
      .map((id) => partById.get(id))
      .filter((p): p is PartInstance => p !== undefined && p.def.engine !== null)
      .sort((a, b) => a.id - b.id);

    // Drain every tank reachable (crossfeed) by this stage's engines, for the
    // specific resource each engine burns. A tank reachable by more than one
    // engine (or reachable for the same resource twice) is only drained once.
    const processed = new Set<string>();
    let fuelConsumed = 0;
    for (const engine of engines) {
      const resourceId = engine.def.engine?.fuel ?? '';
      if (!resourceId) continue;
      const sources = findFuelSources(remainingParts, remainingJoints, engine, resourceId);
      for (const s of sources) {
        const key = `${s.id}:${resourceId}`;
        if (processed.has(key)) continue;
        processed.add(key);
        const res = working.get(s.id);
        if (!res) continue;
        const amount = res[resourceId] ?? 0;
        fuelConsumed += amount;
        res[resourceId] = 0;
      }
    }

    const endMass = Math.max(startMass - fuelConsumed, Number.EPSILON);
    const vac = combinedPerformance(engines, 0);
    const atm = combinedPerformance(engines, ambientPressure);
    const canBurn = fuelConsumed > 0 && endMass > 0 && startMass > endMass;

    results.push({
      stageIndex: stage.index,
      deltaVVac: canBurn ? vac.exhaustVelocity * Math.log(startMass / endMass) : 0,
      deltaVAtm: canBurn ? atm.exhaustVelocity * Math.log(startMass / endMass) : 0,
      startMass,
      endMass,
      burnTime: atm.mdot > 0 ? fuelConsumed / atm.mdot : 0,
    });

    // Figure out what separates once this stage burns out, so the next
    // stage's startMass excludes it.
    const separatorIds = new Set(
      stage.partIds.filter(
        (id) => remaining.has(id) && partById.get(id)?.def.category === 'separators'
      )
    );
    if (separatorIds.size > 0) {
      const breakJointIds = new Set(
        remainingJoints
          .filter((j) => separatorIds.has(j.a) || separatorIds.has(j.b))
          .map((j) => j.id)
      );
      if (breakJointIds.size > 0) {
        const comps = connectedComponents(remainingParts, remainingJoints, breakJointIds);
        if (comps.length > 1) {
          const laterEngineIds = new Set<number>();
          for (const s of sortedStages) {
            if (s.index <= stage.index) continue;
            for (const id of s.partIds) {
              if (partById.get(id)?.def.engine != null) laterEngineIds.add(id);
            }
          }
          let keep = comps.find((c) => c.some((id) => laterEngineIds.has(id)));
          if (!keep) {
            keep = comps.reduce((best, c) =>
              Math.max(...c) > Math.max(...best) ? c : best
            );
          }
          for (const comp of comps) {
            if (comp === keep) continue;
            for (const id of comp) remaining.delete(id);
          }
        }
      }
    }
  }

  return results;
}
