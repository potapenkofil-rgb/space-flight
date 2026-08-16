/**
 * Rebindable key map for the flight scene (PLAN.md §7 Agent D): `Z` full
 * throttle, `X` cutoff, `Shift`/`Ctrl` smooth throttle up/down, `Space` stage,
 * `A`/`D` rotate, `T` SAS, `,`/`.` warp down/up. Bindings are
 * `KeyboardEvent.code` values (layout-independent), persisted so a rebind
 * survives a reload.
 */

/** One rebindable control action. */
export type InputAction =
  | 'throttleFull'
  | 'throttleCutoff'
  | 'throttleUp'
  | 'throttleDown'
  | 'stage'
  | 'rotateLeft'
  | 'rotateRight'
  | 'toggleSas'
  | 'warpDown'
  | 'warpUp';

/** A key map: each action bound to one or more `KeyboardEvent.code`s (any bound key triggers the action). */
export type Keymap = Readonly<Record<InputAction, readonly string[]>>;

/** The default bindings, exactly per PLAN.md §7 Agent D. */
export const DEFAULT_KEYMAP: Keymap = Object.freeze({
  throttleFull: ['KeyZ'],
  throttleCutoff: ['KeyX'],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['ControlLeft', 'ControlRight'],
  stage: ['Space'],
  rotateLeft: ['KeyA'],
  rotateRight: ['KeyD'],
  toggleSas: ['KeyT'],
  warpDown: ['Comma'],
  warpUp: ['Period'],
});

const STORAGE_KEY = 'karman:keymap';

function cloneKeymap(map: Keymap): Record<InputAction, string[]> {
  const out = {} as Record<InputAction, string[]>;
  for (const action of Object.keys(map) as InputAction[]) {
    out[action] = [...map[action]];
  }
  return out;
}

/** Loads the persisted key map, falling back to {@link DEFAULT_KEYMAP} for anything missing or unavailable. */
export function loadKeymap(): Keymap {
  const merged = cloneKeymap(DEFAULT_KEYMAP);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Record<InputAction, string[]>>;
      for (const action of Object.keys(merged) as InputAction[]) {
        const bound = saved[action];
        if (Array.isArray(bound) && bound.every((code) => typeof code === 'string')) {
          merged[action] = bound;
        }
      }
    }
  } catch {
    // Storage unavailable or corrupt: fall back silently to defaults.
  }
  return merged;
}

/** Persists `map` so it survives a reload. */
export function saveKeymap(map: Keymap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable (e.g. private browsing); binding still applies for this session.
  }
}

/** Returns a copy of `map` with `action` rebound to exactly `[code]`, replacing any previous binding. */
export function rebind(map: Keymap, action: InputAction, code: string): Keymap {
  return Object.freeze({ ...map, [action]: [code] });
}

/** True if `code` (a `KeyboardEvent.code`) is bound to `action` in `map`. */
export function isBound(map: Keymap, action: InputAction, code: string): boolean {
  return map[action].includes(code);
}

/** Finds every action `code` is currently bound to (usually zero or one, but rebinding can create overlaps). */
export function actionsForCode(map: Keymap, code: string): InputAction[] {
  return (Object.keys(map) as InputAction[]).filter((action) => isBound(map, action, code));
}
