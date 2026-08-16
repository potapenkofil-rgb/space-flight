/**
 * Concrete, read-only implementations of the `PartLibrary`/`SystemLibrary`
 * contracts (PLAN.md §4) over already-loaded content. Kept separate from
 * `part-loader.ts`/`system-loader.ts` so those stay pure "raw text in,
 * validated data + issues out" functions, easy to unit test without needing
 * a `Map`-wrapping object.
 */
import type { Body } from '../orbits/types';
import type { PartDef } from '../vessels/parts';
import type { PartLibrary, SystemLibrary } from './types';

/** Builds a {@link PartLibrary} over an already-loaded, already-merged part list (e.g. `loadParts(...).parts`). */
export function createPartLibrary(parts: readonly PartDef[]): PartLibrary {
  const byId = new Map(parts.map((p) => [p.id, p] as const));
  return {
    get(id: string): PartDef {
      const part = byId.get(id);
      if (!part) throw new Error(`PartLibrary: unknown part id "${id}"`);
      return part;
    },
    all(): readonly PartDef[] {
      return parts;
    },
  };
}

/** Builds a {@link SystemLibrary} over an already-loaded body tree (e.g. `loadSystem(...)`'s `root`/`bodies`). */
export function createSystemLibrary(root: Body, bodies: ReadonlyMap<string, Body>): SystemLibrary {
  return {
    root,
    get(id: string): Body {
      const body = bodies.get(id);
      if (!body) throw new Error(`SystemLibrary: unknown body id "${id}"`);
      return body;
    },
  };
}
