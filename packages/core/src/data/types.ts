/**
 * Read-only accessors over loaded game content. Loading/validation/merging of
 * `data/` and `mods/*` (PLAN.md §6.2) is Agent E's implementation; these
 * interfaces are the contract the rest of the game codes against.
 */
import type { Body } from '../orbits/types';
import type { PartDef } from '../vessels/parts';

/** Read-only access to every loaded `PartDef`, keyed by id, after `data/` + mods have been merged. */
export interface PartLibrary {
  /** Looks up a part by id. Throws if `id` is not a known part. */
  get(id: string): PartDef;
  /** All loaded parts, in a stable deterministic order (PLAN.md §3.6). */
  all(): readonly PartDef[];
}

/** Read-only access to the loaded celestial system (PLAN.md §5.7, `data/systems/*.json`). */
export interface SystemLibrary {
  /** The root body of the system (e.g. Terra — has no parent). */
  readonly root: Body;
  /** Looks up a body by id (e.g. `"luna"`). Throws if `id` is not a known body. */
  get(id: string): Body;
}
