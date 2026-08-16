/**
 * Localization: `t(key)` plus language switching, no reload required
 * (DESIGN.md §6). Keys are `SCREAMING_SNAKE`, grouped by screen prefix
 * (`MENU_`, `COMMON_`, ...). Part names/descriptions are NOT looked up here —
 * they live inline in each part's own JSON (PLAN.md §6.1).
 */
import en from './en.json';
import ru from './ru.json';

export type Locale = 'ru' | 'en';

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Locale, Dictionary> = { ru, en };

const LOCALE_STORAGE_KEY = 'karman:locale';

type Listener = () => void;
const listeners = new Set<Listener>();

function getInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // Storage can be unavailable; fall through to the default.
  }
  return 'ru';
}

let currentLocale: Locale = getInitialLocale();

/** Returns the active UI language. */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Switches the active UI language, persists the choice, and notifies every
 * `onLocaleChange` subscriber synchronously so the UI can re-render — no page
 * reload involved (DESIGN.md §6).
 */
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable; the switch still applies for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * Looks up `key` in the active locale's dictionary. Falls back to returning
 * the key itself (and logging a warning) when the key is missing — this keeps
 * the UI visibly broken-but-functional for a missing translation instead of
 * throwing, which matters for mods that ship incomplete localization.
 */
export function t(key: string): string {
  const value = DICTIONARIES[currentLocale][key];
  if (value === undefined) {
    console.warn(`i18n: missing key "${key}" for locale "${currentLocale}"`);
    return key;
  }
  return value;
}

/** Subscribes to locale changes (e.g. to re-render a mounted scene). Returns an unsubscribe function. */
export function onLocaleChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
