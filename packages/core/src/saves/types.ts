/**
 * World save format (PLAN.md §6.3): "time, all vessels, their orbits and
 * states". A `World` is the whole in-progress game session — everything a
 * save/load round trip has to reproduce, including which vessels are
 * off-rails (mid-flight) vs on-rails (parked, PLAN.md §3.3).
 */
import type { Vessel } from '../vessels/vessel';

/** The full state of a game session at one instant, ready to serialize (PLAN.md §6.3) or hold in memory as the live vessel registry. */
export interface World {
  /** Save slot name — also the `saves/worlds/<name>/` directory name. */
  readonly name: string;
  /** Simulation time, s, since this world's epoch. */
  readonly time: number;
  /** Every vessel in the world, in deterministic `Vessel.id` order (PLAN.md §3.6). */
  readonly vessels: readonly Vessel[];
  /** `Vessel.id` of the currently player-controlled vessel, or `null` if none (e.g. a fresh save with nothing launched yet). */
  readonly activeVesselId: number | null;
}
