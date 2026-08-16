/** High-level save/load over a `WorldStorage`, at the path PLAN.md §6.3 mandates: `saves/worlds/<name>/world.json`. */
import type { SystemLibrary } from '../data/types';
import { parseWorld, serializeWorld } from './serialize';
import type { WorldStorage } from './storage';
import type { World } from './types';

/** The save path for a world slot named `name` (PLAN.md §6.3). */
export function worldSavePath(name: string): string {
  return `saves/worlds/${name}/world.json`;
}

/** Writes `world` to `storage` at its canonical path, overwriting any existing save with the same name. */
export function saveWorld(storage: WorldStorage, world: World): void {
  storage.write(worldSavePath(world.name), serializeWorld(world));
}

/** Loads the world previously saved as `name`. Throws if no such save exists, or if it's malformed. */
export function loadWorld(storage: WorldStorage, name: string, system: SystemLibrary): World {
  const json = storage.read(worldSavePath(name));
  if (json === null) {
    throw new Error(`loadWorld: no saved world named "${name}"`);
  }
  const parsed = parseWorld(json, system);
  return parsed;
}

/** Lists every saved world's name, sorted ascending (PLAN.md §3.6: deterministic order). */
export function listWorldSaves(storage: WorldStorage): readonly string[] {
  const prefix = 'saves/worlds/';
  const suffix = '/world.json';
  return storage
    .list(prefix)
    .filter((path) => path.endsWith(suffix))
    .map((path) => path.slice(prefix.length, path.length - suffix.length))
    .sort();
}

/** Deletes the world previously saved as `name`. No-op if it didn't exist. */
export function deleteWorldSave(storage: WorldStorage, name: string): void {
  storage.remove(worldSavePath(name));
}
