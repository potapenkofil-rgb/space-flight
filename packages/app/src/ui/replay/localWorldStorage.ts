/**
 * The browser-`localStorage` half of PLAN.md §6.3's storage abstraction: "in
 * Tauri, the filesystem API; in dev mode, `localStorage` behind the same
 * interface, so the game still runs in a browser for tests." The interface
 * itself (`WorldStorage`) lives in `@karman/core`'s `saves/storage.ts`, which
 * can't touch `localStorage` directly (core is DOM-free, PLAN.md §2/§3.6) —
 * this adapter is that interface's browser implementation.
 *
 * A Tauri filesystem-backed adapter (`@tauri-apps/api/fs`) is intentionally
 * not included here — it needs a new dependency in `packages/app/package.json`,
 * which is outside this agent's file zone (`packages/app/src/ui/replay/**`
 * only). See this agent's report.
 */
import type { WorldStorage } from '@karman/core';

/** Prefixes every key so this adapter can share a browser's `localStorage` with unrelated app state without colliding. */
const KEY_PREFIX = 'karman:save:';

/** A `WorldStorage` backed by `window.localStorage`. Falls back to a no-op, in-memory-per-instance behaviour if `localStorage` throws (private browsing, storage disabled) rather than crashing the caller. */
export function createLocalWorldStorage(): WorldStorage {
  function key(path: string): string {
    return KEY_PREFIX + path;
  }

  return {
    read(path) {
      try {
        return localStorage.getItem(key(path));
      } catch {
        return null;
      }
    },
    write(path, content) {
      try {
        localStorage.setItem(key(path), content);
      } catch {
        // Storage unavailable/full — the caller (autosave/manual save) sees no
        // exception per the WorldStorage contract; a real user-facing warning
        // belongs in the UI layer that calls this, not here.
      }
    },
    remove(path) {
      try {
        localStorage.removeItem(key(path));
      } catch {
        // See write() above.
      }
    },
    list(prefix) {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const fullKey = localStorage.key(i);
          if (fullKey && fullKey.startsWith(KEY_PREFIX)) {
            const path = fullKey.slice(KEY_PREFIX.length);
            if (path.startsWith(prefix)) out.push(path);
          }
        }
      } catch {
        return [];
      }
      return out.sort();
    },
  };
}
