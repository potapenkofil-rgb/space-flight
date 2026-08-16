/**
 * Structural load evaluation and breakage (PLAN.md §3.4/§5.6). A vessel is one
 * rigid body for flight purposes; joints are only consulted here, to decide
 * whether the vessel should split apart this tick.
 */
import { v2, ZERO, type Vec2 } from '../math/vec2';
import { computeMass, partMass } from './mass';
import type { JointLink, PartInstance, Vessel } from './vessel';

/**
 * The forces acting on a vessel this tick, as needed to evaluate joint loads.
 * Per PLAN.md §5.6: `F_axial = m_subtree · |a| + F_aero_subtree` for each joint,
 * where the subtree is whichever side of the joint is farther from the vessel's
 * root/thrust source.
 */
export interface Loads {
  /** Linear acceleration of the vessel's centre of mass this tick, m/s² (world frame). */
  readonly acceleration: Vec2;
  /** Angular acceleration this tick, rad/s² — contributes bending loads at joints away from the COM. */
  readonly angularAcceleration: number;
  /**
   * Aerodynamic force on each part this tick, N (world frame), keyed by
   * `PartInstance.id`. Parts with no aerodynamic force (or outside the
   * atmosphere) may be omitted; missing entries are treated as zero.
   */
  readonly aeroForceByPart: ReadonlyMap<number, Vec2>;
}

/** One joint that failed under load this tick. */
export interface JointBreak {
  /** `JointLink.id` of the joint that broke. */
  readonly jointId: number;
  /** The axial load that exceeded the joint's `strength`, N. */
  readonly axialForce: number;
}

/**
 * Splits the part graph (`parts` connected by `joints`, minus `removedJointIds`)
 * into its connected components. Pure graph utility, exported beyond the
 * frozen §4 surface (see report) so both `splitVessel` (below) and
 * `computeDeltaV` (crossfeed-aware staging) share one algorithm. Deterministic:
 * neighbours are always visited in ascending id order, and the returned
 * components are sorted by their own smallest id ascending.
 *
 * @returns each component as a list of `PartInstance.id`s, sorted ascending
 */
export function connectedComponents(
  parts: readonly PartInstance[],
  joints: readonly JointLink[],
  removedJointIds: ReadonlySet<number>
): number[][] {
  const ids = parts.map((p) => p.id).sort((a, b) => a - b);
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const list = adjacency.get(a);
    if (list) {
      list.push(b);
    } else {
      adjacency.set(a, [b]);
    }
  };
  for (const j of joints) {
    if (removedJointIds.has(j.id)) continue;
    link(j.a, j.b);
    link(j.b, j.a);
  }

  const visited = new Set<number>();
  const components: number[][] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    const comp: number[] = [];
    const queue = [id];
    visited.add(id);
    let head = 0;
    while (head < queue.length) {
      // Non-null: `head < queue.length` guarantees this index is populated.
      const current = queue[head] as number;
      head += 1;
      comp.push(current);
      const neighbours = (adjacency.get(current) ?? []).slice().sort((a, b) => a - b);
      for (const n of neighbours) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    comp.sort((a, b) => a - b);
    components.push(comp);
  }
  components.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  return components;
}

/**
 * Which part ids count as "the root/thrust source" for the purposes of
 * choosing which side of a broken joint is "the subtree" in §5.6's formula:
 * the active stage's engines when there are any (the thrust source the rest
 * of the rocket hangs off), else the single lowest-id part as a stable
 * fallback (e.g. while coasting with no stage armed). Not specified verbatim
 * by PLAN.md §5.6 beyond "root/thrust source" — this is Agent B's reading; see
 * report.
 */
function rootSeeds(v: Vessel): ReadonlySet<number> {
  const stage = v.stages[v.currentStage];
  if (stage) {
    const partById = new Map(v.parts.map((p) => [p.id, p] as const));
    const engineIds = stage.partIds.filter((id) => partById.get(id)?.def.engine != null);
    if (engineIds.length > 0) return new Set(engineIds);
  }
  if (v.parts.length === 0) return new Set();
  const minId = Math.min(...v.parts.map((p) => p.id));
  return new Set([minId]);
}

/**
 * Checks every joint in `v` against `loads` and reports which ones exceed their
 * `strength`. Pure — does not mutate `v`; pass the result to `splitVessel` to
 * actually separate the vessel.
 *
 * @param v the vessel to check
 * @param loads this tick's forces, as measured/estimated by the flight integrator
 * @returns joints whose axial load exceeds their strength, in deterministic
 *   `JointLink.id` order
 */
export function evaluateStructure(v: Vessel, loads: Loads): JointBreak[] {
  const seeds = rootSeeds(v);
  const partById = new Map(v.parts.map((p) => [p.id, p] as const));
  const accel = v2.len(loads.acceleration);
  const breaks: JointBreak[] = [];

  for (const joint of [...v.joints].sort((a, b) => a.id - b.id)) {
    const comps = connectedComponents(v.parts, v.joints, new Set([joint.id]));
    if (comps.length < 2) continue; // not a bridge (redundant/looped joint) — no isolable subtree.
    const compA = comps.find((c) => c.includes(joint.a));
    const compB = comps.find((c) => c.includes(joint.b));
    if (!compA || !compB || compA === compB) continue;
    const rootComp = comps.find((c) => c.some((id) => seeds.has(id)));
    const subtree = rootComp === compA ? compB : rootComp === compB ? compA : undefined;
    if (!subtree) continue;

    let mass = 0;
    let aero: Vec2 = ZERO;
    for (const id of subtree) {
      const part = partById.get(id);
      if (!part) continue;
      mass += partMass(part);
      const f = loads.aeroForceByPart.get(id);
      if (f) aero = v2.add(aero, f);
    }

    const axialForce = mass * accel + v2.len(aero);
    if (axialForce > joint.strength) {
      breaks.push({ jointId: joint.id, axialForce });
    }
  }

  return breaks;
}

/**
 * Splits `v` at the given broken joints. Removing `breaks` from `v.joints`
 * generally disconnects the part graph into several connected components; each
 * component becomes its own `Vessel`, inheriting the original vessel's velocity
 * and angular velocity (conservation of momentum — PLAN.md §3.4). The same
 * function backs both structural failure (called with joints that broke under
 * load) and voluntary stage separation (called with the joint(s) the player's
 * separator just fired).
 *
 * Resulting vessels keep the original vessel's local frame (`position`,
 * `rotation`) unchanged — part-local positions were already relative to that
 * frame, so no coordinate transform is needed. `Stage`s are filtered down to
 * each component's own parts, re-indexed from `0`, and `currentStage` resets
 * to `0` (the next stage to fire for that piece). One resulting vessel keeps
 * `v.id` (the component containing the lowest-id part); the others get
 * `v.id * 1000 + componentIndex` — PLAN.md doesn't hand `splitVessel` an id
 * generator, so this is Agent B's deterministic scheme; see report.
 *
 * @param v the vessel to split
 * @param breaks the joints to remove (from `evaluateStructure`, or synthesized
 *   for a deliberate stage separation)
 * @returns the resulting vessels, in deterministic order (one per connected
 *   component of the remaining part graph); returns `[v]` unchanged if no
 *   component actually became disconnected
 */
export function splitVessel(v: Vessel, breaks: JointBreak[]): Vessel[] {
  if (breaks.length === 0) return [v];
  const removed = new Set(breaks.map((b) => b.jointId));
  const components = connectedComponents(v.parts, v.joints, removed);
  if (components.length <= 1) return [v];

  const partById = new Map(v.parts.map((p) => [p.id, p] as const));

  return components.map((ids, index) => {
    const idSet = new Set(ids);
    const parts = ids
      .map((id) => partById.get(id))
      .filter((p): p is PartInstance => p !== undefined)
      .sort((a, b) => a.id - b.id);
    const joints = v.joints
      .filter((j) => idSet.has(j.a) && idSet.has(j.b) && !removed.has(j.id))
      .sort((a, b) => a.id - b.id);
    const stages = v.stages
      .map((s) => ({ index: s.index, partIds: s.partIds.filter((id) => idSet.has(id)) }))
      .filter((s) => s.partIds.length > 0)
      .sort((a, b) => a.index - b.index)
      .map((s, i) => ({ index: i, partIds: s.partIds }));

    const next: Vessel = {
      id: index === 0 ? v.id : v.id * 1000 + index,
      parts,
      joints,
      stages,
      currentStage: 0,
      position: v.position,
      velocity: v.velocity,
      rotation: v.rotation,
      angularVelocity: v.angularVelocity,
      soi: v.soi,
      railOrbit: v.railOrbit,
      mass: { total: 0, com: ZERO, inertia: 0 },
    };
    next.mass = computeMass(next);
    return next;
  });
}
