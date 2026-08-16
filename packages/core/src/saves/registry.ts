/**
 * Multi-vessel registry (PLAN.md §3.3/§7 Agent F): several vessels can exist
 * on independent orbits at once; only the active one is off-rails and
 * numerically integrated, every other one is on-rails and advanced
 * analytically ("costs almost nothing" — PLAN.md §3.3). `advanceRails` is the
 * whole reason this is cheap under high time warp: it's `O(vessels)` calls to
 * a closed-form Kepler solve, independent of how large `t` jumps.
 */
import { stateFromOrbit } from '../orbits/kepler';
import type { Orbit } from '../orbits/types';
import type { Vec2 } from '../math/vec2';
import type { Vessel } from '../vessels/vessel';

/** Computes a vessel's position/velocity on its rail orbit at time `t`. Defaults to the real `stateFromOrbit` (PLAN.md §4) — override only for tests, before Agent A's implementation lands. */
export type RailStateFn = (orbit: Orbit, t: number) => { position: Vec2; velocity: Vec2 };

const defaultRailState: RailStateFn = (orbit, t) => {
  const { r, v } = stateFromOrbit(orbit, t);
  return { position: r, velocity: v };
};

export interface VesselRegistryOptions {
  readonly railState?: RailStateFn;
}

/** The live set of vessels in a world, with one designated as active/player-controlled. */
export interface VesselRegistry {
  /** Every vessel, in deterministic `Vessel.id` order (PLAN.md §3.6). */
  readonly vessels: readonly Vessel[];
  /** `Vessel.id` of the active vessel, or `null` if the registry is empty. */
  readonly activeVesselId: number | null;
  /** Looks up a vessel by id, or `undefined` if it's not in the registry. */
  get(id: number): Vessel | undefined;
  /** Makes `id` the active vessel. Throws if `id` isn't in the registry. */
  setActive(id: number): void;
  /** Adds a vessel to the registry (e.g. a newly launched one, or one half of a structural split). Throws on a duplicate id. */
  add(vessel: Vessel): void;
  /** Removes a vessel from the registry (e.g. after it's fully deorbited/destroyed). If it was active, `activeVesselId` becomes `null`. */
  remove(id: number): void;
  /**
   * Advances every **on-rails** vessel's `position`/`velocity` to time `t`
   * (mutating it in place, matching `stepFlight`'s in-place contract) via
   * `railState`. Vessels with `railOrbit === null` (off-rails — normally just
   * the active one) are left untouched; the caller advances those separately
   * via `stepFlight`. Cost is `O(vessels)` regardless of how far `t` has
   * jumped — this is what makes high time warp cheap (PLAN.md §3.3).
   */
  advanceRails(t: number): void;
}

function sortById(vessels: readonly Vessel[]): Vessel[] {
  return vessels.slice().sort((a, b) => a.id - b.id);
}

export function createVesselRegistry(
  initial: readonly Vessel[],
  options: VesselRegistryOptions = {}
): VesselRegistry {
  const railState = options.railState ?? defaultRailState;
  const byId = new Map<number, Vessel>();
  for (const v of initial) {
    if (byId.has(v.id)) throw new Error(`createVesselRegistry: duplicate vessel id ${v.id}`);
    byId.set(v.id, v);
  }
  let activeVesselId: number | null = initial.length > 0 ? sortById(initial)[0]!.id : null;

  return {
    get vessels() {
      return sortById(Array.from(byId.values()));
    },
    get activeVesselId() {
      return activeVesselId;
    },
    get(id) {
      return byId.get(id);
    },
    setActive(id) {
      if (!byId.has(id)) throw new Error(`VesselRegistry.setActive: unknown vessel id ${id}`);
      activeVesselId = id;
    },
    add(vessel) {
      if (byId.has(vessel.id)) throw new Error(`VesselRegistry.add: duplicate vessel id ${vessel.id}`);
      byId.set(vessel.id, vessel);
      if (activeVesselId === null) activeVesselId = vessel.id;
    },
    remove(id) {
      byId.delete(id);
      if (activeVesselId === id) activeVesselId = null;
    },
    advanceRails(t) {
      for (const id of Array.from(byId.keys()).sort((a, b) => a - b)) {
        const vessel = byId.get(id);
        if (!vessel || !vessel.railOrbit) continue;
        const { position, velocity } = railState(vessel.railOrbit, t);
        vessel.position = position;
        vessel.velocity = velocity;
      }
    },
  };
}
