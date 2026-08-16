/**
 * Number and unit formatting for player-facing telemetry (HUD, map, hangar readouts).
 * Rules come from DESIGN.md §6: digit groups are separated by a non-breaking thin
 * space (U+202F, NOT a regular space or comma), and distance/mass auto-select
 * between metres/kilometres and kilograms/tonnes depending on magnitude.
 *
 * This module has zero DOM dependencies — it only manipulates strings and numbers —
 * so it can format telemetry inside `@karman/core` (e.g. for `ERR_*` messages or
 * black-box graphs) as well as in the UI layer.
 */

/** Non-breaking thin space (U+202F) — the digit-group separator mandated by DESIGN.md. */
export const THIN_SPACE = ' ';

/** The two supported UI languages. See DESIGN.md §6. */
export type UnitsLocale = 'ru' | 'en';

let locale: UnitsLocale = 'ru';

/**
 * Sets the locale used by every `format*` function below (decimal separator and
 * unit words). Switching locale takes effect immediately for subsequent calls —
 * there is no caching to invalidate here, unlike `ui/tokens.ts` in `@karman/app`.
 */
export function setUnitsLocale(next: UnitsLocale): void {
  locale = next;
}

/** Returns the locale currently used by `format*` functions. Defaults to `'ru'`. */
export function getUnitsLocale(): UnitsLocale {
  return locale;
}

function decimalSeparator(): string {
  return locale === 'ru' ? ',' : '.';
}

/** Groups the digits of a non-negative integer string into 3s, joined by {@link THIN_SPACE}. */
function groupDigits(digits: string): string {
  const groups: string[] = [];
  let i = digits.length;
  while (i > 3) {
    groups.unshift(digits.slice(i - 3, i));
    i -= 3;
  }
  groups.unshift(digits.slice(0, i));
  return groups.join(THIN_SPACE);
}

/**
 * Formats a plain number with digit-group separators ({@link THIN_SPACE} every 3
 * digits) and a fixed number of fractional digits (`fractionDigits`, default 0).
 * The decimal separator follows the current {@link UnitsLocale} (`,` for `ru`,
 * `.` for `en`). Does not append a unit — see `formatDistance`/`formatSpeed`/
 * `formatMass` for that. `-0` is normalized to `0`, and so is any negative value
 * that *rounds* to zero at the requested `fractionDigits` (e.g. `-0.2` at 0
 * fractional digits) — otherwise a vessel sitting a few centimetres into the
 * ground reads as an alarming "−0 м" on the altimeter instead of "0 м".
 */
export function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) {
    return value > 0 ? '∞' : Number.isNaN(value) ? 'NaN' : '−∞';
  }
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const roundsToZero = Number(fixed) === 0;
  const sign = value < 0 && !roundsToZero ? '−' : '';
  const [intPart, fracPart] = fixed.split('.') as [string, string | undefined];
  const grouped = groupDigits(intPart);
  return fracPart === undefined ? sign + grouped : sign + grouped + decimalSeparator() + fracPart;
}

/**
 * Formats a distance given in metres, auto-selecting metres or kilometres.
 * Below 1000 m: whole metres, unit `"м"`/`"m"`. At or above 1000 m: kilometres
 * with 2 fractional digits, unit `"км"`/`"km"`. `meters` must be finite; negative
 * distances are formatted with a leading minus sign.
 */
export function formatDistance(meters: number): string {
  const abs = Math.abs(meters);
  if (abs < 1000) {
    return `${formatNumber(meters, 0)}${THIN_SPACE}${locale === 'ru' ? 'м' : 'm'}`;
  }
  return `${formatNumber(meters / 1000, 2)}${THIN_SPACE}${locale === 'ru' ? 'км' : 'km'}`;
}

/**
 * Formats a speed given in metres per second. Unit is `"м/с"`/`"m/s"`.
 * Uses 1 fractional digit below 100 m/s (where precision matters, e.g. landing
 * speed against `maxLandingSpeed`) and 0 above it (orbital speeds, where a
 * fraction of a m/s is noise).
 */
export function formatSpeed(metersPerSecond: number): string {
  const digits = Math.abs(metersPerSecond) < 100 ? 1 : 0;
  return `${formatNumber(metersPerSecond, digits)}${THIN_SPACE}${locale === 'ru' ? 'м/с' : 'm/s'}`;
}

/**
 * Formats a mass given in kilograms, auto-selecting kilograms or tonnes.
 * Below 1000 kg: whole kilograms, unit `"кг"`/`"kg"`. At or above 1000 kg: tonnes
 * with 2 fractional digits, unit `"т"`/`"t"`.
 */
export function formatMass(kilograms: number): string {
  const abs = Math.abs(kilograms);
  if (abs < 1000) {
    return `${formatNumber(kilograms, 0)}${THIN_SPACE}${locale === 'ru' ? 'кг' : 'kg'}`;
  }
  return `${formatNumber(kilograms / 1000, 2)}${THIN_SPACE}${locale === 'ru' ? 'т' : 't'}`;
}

/**
 * Formats a ΔV value given in metres per second. Alias of {@link formatSpeed} —
 * ΔV shares the same unit and the same auto-precision rule — kept as a distinct
 * named export because "ΔV" is a distinct domain concept from "current speed" in
 * the hangar/flight-plan UI, and call sites should say what they mean.
 */
export function formatDeltaV(metersPerSecond: number): string {
  return formatSpeed(metersPerSecond);
}
