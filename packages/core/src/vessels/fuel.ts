/** Propellant consumption and crossfeed (PLAN.md §5.3). */
import { clamp01, lerp } from '../math/mathx';
import { v2, type Vec2 } from '../math/vec2';
import type { JointLink, PartInstance, Vessel } from './vessel';

/** Tsiolkovsky's constant, m/s² — fixed, NEVER the local surface gravity (PLAN.md §5.3). */
export const G0 = 9.80665;

/**
 * One engine's contribution to this tick's burn — exported alongside
 * {@link consumeFuel} (an extra, non-frozen export; see report) because the
 * frozen `consumeFuel(v, dt, throttle): number` signature only returns a
 * scalar total, but `stepFlight` needs each engine's position/orientation to
 * compute gimbal torque and the thrust force vector (PLAN.md §5.5).
 */
export interface EngineBurn {
  /** `PartInstance.id` of the firing engine. */
  readonly partId: number;
  /** Engine position in the vessel's local frame, m. */
  readonly position: Vec2;
  /**
   * Unit thrust direction in the vessel's local frame, *before* gimbal
   * deflection — the part's own local +Y (nose-ward) rotated by its
   * `rotation`. `stepFlight` applies gimbal/vessel rotation on top.
   */
  readonly baseDirection: Vec2;
  /** Actual thrust produced this tick, N (may be less than commanded if starved of propellant). */
  readonly thrust: number;
  /** Maximum gimbal deflection this engine supports, rad. */
  readonly gimbalMax: number;
}

function byOtherEndAscending(joints: readonly JointLink[], from: number): JointLink[] {
  return [...joints].sort((a, b) => otherEnd(a, from) - otherEnd(b, from));
}

function otherEnd(joint: JointLink, from: number): number {
  return joint.a === from ? joint.b : joint.a;
}

function hasResource(part: PartInstance, resourceId: string): boolean {
  return part.def.resources.some((r) => r.id === resourceId);
}

/** Builds an id → incident-joints adjacency map. Iteration of the map itself is never relied upon. */
function buildAdjacency(joints: readonly JointLink[]): Map<number, JointLink[]> {
  const adjacency = new Map<number, JointLink[]>();
  for (const j of joints) {
    for (const end of [j.a, j.b]) {
      const list = adjacency.get(end);
      if (list) {
        list.push(j);
      } else {
        adjacency.set(end, [j]);
      }
    }
  }
  return adjacency;
}

/**
 * Finds every part reachable from `engine` that carries `resourceId`,
 * following PLAN.md §5.3's crossfeed rule: `stack` joints are followed onward
 * only while the part being passed *through* has `crossfeed: true` (the
 * engine's own first hop is always allowed); `radial` joints are only
 * considered when they connect directly to the engine itself (a radial tank
 * feeds only the engine(s) explicitly bolted to it, never further down a
 * chain); `docking` joints never crossfeed. Pure — does not read or mutate
 * resource amounts, only the part graph. Deterministic: neighbours of a node
 * are always visited in ascending `PartInstance.id` order.
 *
 * Exported (beyond the frozen `consumeFuel` signature) so `computeDeltaV` can
 * reuse the exact same reachability rule on its own working copy of resource
 * levels — see report.
 */
export function findFuelSources(
  parts: readonly PartInstance[],
  joints: readonly JointLink[],
  engine: PartInstance,
  resourceId: string
): PartInstance[] {
  const byId = new Map(parts.map((p) => [p.id, p] as const));
  const adjacency = buildAdjacency(joints);
  const visited = new Set<number>([engine.id]);
  const queue: number[] = [engine.id];
  const collected: PartInstance[] = [];

  if (hasResource(engine, resourceId)) collected.push(engine);

  let head = 0;
  while (head < queue.length) {
    // Non-null: `head < queue.length` guarantees this index is populated.
    const currentId = queue[head] as number;
    head += 1;
    const current = byId.get(currentId);
    if (!current) continue;
    const isStart = currentId === engine.id;
    const canPassThrough = isStart || current.def.crossfeed;
    const edges = byOtherEndAscending(adjacency.get(currentId) ?? [], currentId);
    for (const edge of edges) {
      const otherId = otherEnd(edge, currentId);
      if (visited.has(otherId)) continue;
      if (edge.nodeKind === 'stack') {
        if (!canPassThrough) continue;
      } else if (edge.nodeKind === 'radial') {
        if (!isStart) continue;
      } else {
        continue; // 'docking': never auto-crossfeeds.
      }
      visited.add(otherId);
      queue.push(otherId);
      const otherPart = byId.get(otherId);
      if (otherPart && hasResource(otherPart, resourceId)) collected.push(otherPart);
    }
  }

  return collected.sort((a, b) => a.id - b.id);
}

function findPart(v: Vessel, id: number): PartInstance | undefined {
  return v.parts.find((p) => p.id === id);
}

/**
 * Runs one tick of propellant consumption for every engine in the vessel's
 * current stage, mutating `v.parts[*].resources` in place, and returns a
 * per-engine breakdown. This is the actual implementation behind
 * {@link consumeFuel}; see {@link EngineBurn} for why it is exported
 * separately.
 */
export function burnEngines(
  v: Vessel,
  dt: number,
  throttle: number,
  ambientPressure = 0
): EngineBurn[] {
  const stage = v.stages[v.currentStage];
  if (!stage || throttle <= 0) return [];

  const engines = stage.partIds
    .map((id) => findPart(v, id))
    .filter((p): p is PartInstance => p !== undefined && p.def.engine !== null)
    .sort((a, b) => a.id - b.id);

  const pressureFraction = clamp01(ambientPressure);
  const t = 1 - pressureFraction; // PLAN.md §5.2: F = lerp(F_sl, F_vac, 1 − p/p0)

  const results: EngineBurn[] = [];
  for (const engine of engines) {
    const spec = engine.def.engine;
    if (!spec) continue; // narrows for TS; filter above already guarantees this.

    const effectiveThrottle = Math.max(throttle, spec.minThrottle);
    const thrustFull = lerp(spec.thrustSl, spec.thrustVac, t);
    const ispFull = lerp(spec.ispSl, spec.ispVac, t);
    const thrustTarget = effectiveThrottle * thrustFull;
    const mdotTarget = ispFull > 0 ? thrustTarget / (ispFull * G0) : 0;
    const fuelNeeded = mdotTarget * dt;

    const sources = findFuelSources(v.parts, v.joints, engine, spec.fuel);
    let available = 0;
    for (const s of sources) available += s.resources[spec.fuel] ?? 0;

    const fuelUsed = Math.min(fuelNeeded, available);
    let remaining = fuelUsed;
    for (const s of sources) {
      if (remaining <= 0) break;
      const have = s.resources[spec.fuel] ?? 0;
      const take = Math.min(have, remaining);
      if (take > 0) {
        s.resources[spec.fuel] = have - take;
        remaining -= take;
      }
    }

    const actualThrust = fuelNeeded > 0 ? thrustTarget * (fuelUsed / fuelNeeded) : 0;

    results.push({
      partId: engine.id,
      position: engine.position,
      baseDirection: v2.rot({ x: 0, y: 1 }, engine.rotation),
      thrust: actualThrust,
      gimbalMax: spec.gimbal,
    });
  }

  return results;
}

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
 * **Contract extension (Agent B):** adds an optional trailing `ambientPressure`
 * parameter, defaulting to `0` (vacuum). The frozen §4 signature is
 * `(v, dt, throttle) => number`, with no way to interpolate thrust/Isp by
 * pressure per PLAN.md §5.2 — an optional parameter is backward compatible
 * (any caller invoking the 3-arg form gets vacuum performance) while letting
 * `stepFlight`, which does have `FlightEnvironment.ambientPressure`, pass it
 * through. See report.
 *
 * @param v the vessel (current stage's engines are read from `v.stages[v.currentStage]`)
 * @param dt physics tick length, s (PLAN.md §3.2: always `1/60` in practice)
 * @param throttle commanded throttle, `0..1` (dimensionless fraction of max thrust)
 * @param ambientPressure ambient pressure as a fraction of sea-level pressure, `0..1`
 * @returns total thrust actually produced this tick, N (0 if starved of propellant)
 */
export function consumeFuel(
  v: Vessel,
  dt: number,
  throttle: number,
  ambientPressure = 0
): number {
  return burnEngines(v, dt, throttle, ambientPressure).reduce((sum, e) => sum + e.thrust, 0);
}
