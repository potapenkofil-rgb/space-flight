import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDeltaV,
  formatDistance,
  formatMass,
  formatNumber,
  formatSpeed,
  getUnitsLocale,
  setUnitsLocale,
  THIN_SPACE,
} from './units';

afterEach(() => {
  setUnitsLocale('ru');
});

describe('THIN_SPACE', () => {
  it('is the Unicode narrow no-break space U+202F', () => {
    expect(THIN_SPACE).toBe(' ');
    expect(THIN_SPACE.codePointAt(0)).toBe(0x202f);
  });
});

describe('formatNumber', () => {
  it('groups thousands with THIN_SPACE', () => {
    expect(formatNumber(1000)).toBe(`1${THIN_SPACE}000`);
    expect(formatNumber(1234567)).toBe(`1${THIN_SPACE}234${THIN_SPACE}567`);
    expect(formatNumber(999)).toBe('999');
  });
  it('uses a locale-specific decimal separator', () => {
    setUnitsLocale('ru');
    expect(formatNumber(1234.5, 1)).toBe(`1${THIN_SPACE}234,5`);
    setUnitsLocale('en');
    expect(formatNumber(1234.5, 1)).toBe(`1${THIN_SPACE}234.5`);
  });
  it('formats negative numbers with a minus sign', () => {
    expect(formatNumber(-1500)).toBe(`−1${THIN_SPACE}500`);
  });
  it('normalizes -0 to 0', () => {
    expect(formatNumber(-0)).toBe('0');
  });
  it('normalizes a small negative value that rounds to zero to 0, not −0', () => {
    // e.g. an altitude a few centimetres below the pad, rendered whole-metre —
    // this must not show as "−0 м" on the HUD altimeter.
    expect(formatNumber(-0.3)).toBe('0');
    expect(formatNumber(-0.004, 2)).toBe('0,00');
  });
  it('still shows the minus sign once the magnitude no longer rounds to zero', () => {
    expect(formatNumber(-0.6)).toBe('−1');
    expect(formatNumber(-1)).toBe('−1');
  });
  it('handles non-finite input', () => {
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatNumber(-Infinity)).toBe('−∞');
    expect(formatNumber(NaN)).toBe('NaN');
  });
});

describe('formatDistance', () => {
  it('uses metres below 1000m', () => {
    expect(formatDistance(50000 / 1000)).toBe(`50${THIN_SPACE}м`);
    expect(formatDistance(999)).toBe(`999${THIN_SPACE}м`);
  });
  it('switches to kilometres at 1000m and above, with 2 fractional digits', () => {
    expect(formatDistance(1000)).toBe(`1,00${THIN_SPACE}км`);
    expect(formatDistance(100000)).toBe(`100,00${THIN_SPACE}км`); // Karman altimeter mark
    expect(formatDistance(1_000_000)).toBe(`1${THIN_SPACE}000,00${THIN_SPACE}км`); // Terra radius
  });
  it('respects locale for the unit word and decimal separator', () => {
    setUnitsLocale('en');
    expect(formatDistance(500)).toBe(`500${THIN_SPACE}m`);
    expect(formatDistance(1500)).toBe(`1.50${THIN_SPACE}km`);
  });
});

describe('formatSpeed / formatDeltaV', () => {
  it('uses one fractional digit below 100 m/s', () => {
    expect(formatSpeed(7.25)).toBe(`7,3${THIN_SPACE}м/с`);
  });
  it('uses zero fractional digits at or above 100 m/s', () => {
    expect(formatSpeed(2986)).toBe(`2${THIN_SPACE}986${THIN_SPACE}м/с`); // 100km circular orbit
  });
  it('formatDeltaV matches formatSpeed', () => {
    expect(formatDeltaV(896)).toBe(formatSpeed(896)); // Terra -> Luna transfer
  });
});

describe('formatMass', () => {
  it('uses kilograms below 1000kg', () => {
    expect(formatMass(300)).toBe(`300${THIN_SPACE}кг`);
  });
  it('switches to tonnes at 1000kg and above', () => {
    expect(formatMass(2700)).toBe(`2,70${THIN_SPACE}т`);
  });
});

describe('getUnitsLocale / setUnitsLocale', () => {
  it('defaults to ru and round-trips', () => {
    expect(getUnitsLocale()).toBe('ru');
    setUnitsLocale('en');
    expect(getUnitsLocale()).toBe('en');
  });
});
