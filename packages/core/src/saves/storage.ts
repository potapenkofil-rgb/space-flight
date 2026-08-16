/**
 * Storage abstraction for saves (PLAN.md §6.3): "paths go through the Tauri
 * FS API; in dev mode, `localStorage` behind the same interface, so the game
 * still runs in a browser for tests." `@karman/core` can't touch
 * `localStorage` itself (PLAN.md §2/§3.6 — zero DOM access, enforced by
 * `test/no-dom.test.ts`), so this module only owns the *interface* plus an
 * in-memory implementation for core's own tests. The `localStorage`-backed
 * adapter lives in `@karman/app` (`ui/replay/localWorldStorage.ts`) behind
 * this same `WorldStorage` shape; a Tauri filesystem-backed adapter is future
 * work for whoever wires `@tauri-apps/api/fs` into the app shell (outside
 * this agent's file zone — see this agent's report).
 */

/** A flat, synchronous key/value store keyed by save path (e.g. `"saves/worlds/my-flight/world.json"`). */
export interface WorldStorage {
  /** Reads the content at `path`, or `null` if nothing is stored there. */
  read(path: string): string | null;
  /** Writes `content` at `path`, overwriting anything already there. */
  write(path: string, content: string): void;
  /** Deletes whatever is at `path`. No-op if nothing was there. */
  remove(path: string): void;
  /** Lists every stored path starting with `prefix`, sorted ascending (PLAN.md §3.6: no unordered iteration). */
  list(prefix: string): readonly string[];
}

/** An in-memory `WorldStorage` — used by core's own tests, and as a safe default before a real backend is wired in. */
export function createInMemoryWorldStorage(): WorldStorage {
  const store = new Map<string, string>();
  return {
    read(path) {
      return store.get(path) ?? null;
    },
    write(path, content) {
      store.set(path, content);
    },
    remove(path) {
      store.delete(path);
    },
    list(prefix) {
      return Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
  };
}
