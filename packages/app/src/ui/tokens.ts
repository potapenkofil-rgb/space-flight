/**
 * Typed access to the design tokens defined in `tokens.css` (docs/DESIGN.md §1/§2).
 * `tokens.css` is the source of truth; this module only reads it via
 * `getComputedStyle` and caches the result, so canvas rendering and DOM CSS can
 * never disagree on a color. The cache is invalidated on every `setTheme` call.
 */

export type ThemeName = 'dark' | 'light';

export type ColorRole =
  | 'ground'
  | 'panel'
  | 'panelAlt'
  | 'hairline'
  | 'hairlineSoft'
  | 'ink'
  | 'inkMuted'
  | 'muted'
  | 'burn'
  | 'burnSoft'
  | 'orbit'
  | 'orbitSoft'
  | 'nominal'
  | 'warning'
  | 'critical'
  | 'skyHi'
  | 'skyLo';

export type FontRole = 'display' | 'body' | 'data';

/** Index into the DESIGN.md §2 size scale: `10·11·13·15·19·23·30·44` px at 1080p. */
export type FontSizeStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const COLOR_VAR: Record<ColorRole, string> = {
  ground: '--color-ground',
  panel: '--color-panel',
  panelAlt: '--color-panel-alt',
  hairline: '--color-hairline',
  hairlineSoft: '--color-hairline-soft',
  ink: '--color-ink',
  inkMuted: '--color-ink-muted',
  muted: '--color-muted',
  burn: '--color-burn',
  burnSoft: '--color-burn-soft',
  orbit: '--color-orbit',
  orbitSoft: '--color-orbit-soft',
  nominal: '--color-nominal',
  warning: '--color-warning',
  critical: '--color-critical',
  skyHi: '--color-sky-hi',
  skyLo: '--color-sky-lo',
};

const FONT_VAR: Record<FontRole, string> = {
  display: '--font-display',
  body: '--font-body',
  data: '--font-data',
};

const THEME_STORAGE_KEY = 'karman:theme';

let cache = new Map<string, string>();

function readVar(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cache.set(name, value);
  return value;
}

/** Clears the cached token values. Called automatically by `setTheme`; exposed for tests. */
export function resetTokenCache(): void {
  cache = new Map();
}

/** Reads a palette color for the current theme as a CSS color string (e.g. `#ff7a2f`). */
export function getColor(role: ColorRole): string {
  return readVar(COLOR_VAR[role]);
}

/** Reads a font-family stack (e.g. for `ctx.font` or a CSS `font-family`). */
export function getFont(role: FontRole): string {
  return readVar(FONT_VAR[role]);
}

/** Reads one step of the DESIGN.md §2 size scale, in CSS pixels. */
export function getFontSizePx(step: FontSizeStep): number {
  const raw = readVar(`--font-size-${step}`);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Sets the active theme, persists the choice, and invalidates the token cache. */
export function setTheme(theme: ThemeName): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (e.g. private browsing); theme still applies for this session.
  }
  resetTokenCache();
}

/** Returns the currently active theme, from `<html data-theme>`. Defaults to `'dark'`. */
export function getTheme(): ThemeName {
  return document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark';
}

/**
 * Returns the theme to start the app with: the user's previously saved choice,
 * or `'dark'` (DESIGN.md §1 default) if none was saved yet.
 */
export function getInitialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be unavailable; fall through to the default.
  }
  return 'dark';
}
