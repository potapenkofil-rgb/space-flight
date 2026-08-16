import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  approxEqual,
  clamp,
  clamp01,
  degToRad,
  invLerp,
  lerp,
  normalizeAngle,
  radToDeg,
  remap,
  safeAcos,
  safeAsin,
} from './mathx';

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it('throws when min > max', () => {
    expect(() => clamp(1, 10, 0)).toThrow();
  });
  it('clamp01', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});

describe('lerp / invLerp / remap', () => {
  it('lerp basics', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20); // extrapolates
  });
  it('invLerp is the inverse of lerp', () => {
    expect(invLerp(0, 10, 5)).toBe(0.5);
    expect(invLerp(10, 0, 2.5)).toBe(0.75);
  });
  it('invLerp throws when a === b', () => {
    expect(() => invLerp(5, 5, 5)).toThrow();
  });
  it('remap clamps to the output range', () => {
    expect(remap(50, 0, 100, 0, 1)).toBeCloseTo(0.5, 12);
    expect(remap(-50, 0, 100, 0, 1)).toBe(0);
    expect(remap(150, 0, 100, 0, 1)).toBe(1);
  });
});

describe('deg/rad conversion', () => {
  it('round-trips', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12);
    expect(radToDeg(degToRad(57))).toBeCloseTo(57, 9);
  });
});

describe('normalizeAngle', () => {
  it('is a no-op inside [-pi, pi)', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 12);
    expect(normalizeAngle(1)).toBeCloseTo(1, 12);
    expect(normalizeAngle(-1)).toBeCloseTo(-1, 12);
  });
  it('wraps values above pi down', () => {
    expect(normalizeAngle(Math.PI)).toBeCloseTo(-Math.PI, 9);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
    expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 9);
  });
  it('wraps values below -pi up', () => {
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
    expect(normalizeAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI * 0.5, 9);
  });
  it('result is always within [-pi, pi)', () => {
    for (let deg = -3600; deg <= 3600; deg += 17) {
      const a = normalizeAngle(degToRad(deg));
      expect(a).toBeGreaterThanOrEqual(-Math.PI);
      expect(a).toBeLessThan(Math.PI);
    }
  });
});

describe('angleDelta', () => {
  it('shortest signed difference, wrapping correctly', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
    // going from just past +pi to just past -pi should be a tiny positive step,
    // not a near-2pi step the long way around.
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 9);
  });
});

describe('safeAcos / safeAsin', () => {
  it('matches Math.acos/asin inside domain', () => {
    expect(safeAcos(0)).toBeCloseTo(Math.PI / 2, 12);
    expect(safeAsin(0)).toBeCloseTo(0, 12);
  });
  it('clamps slightly-out-of-domain values instead of returning NaN', () => {
    expect(safeAcos(1.0000000000000002)).toBeCloseTo(0, 6);
    expect(safeAcos(-1.0000000000000002)).toBeCloseTo(Math.PI, 6);
    expect(safeAsin(1.0000000000000002)).toBeCloseTo(Math.PI / 2, 6);
    expect(Number.isNaN(safeAcos(1.0000000000000002))).toBe(false);
  });
});

describe('approxEqual', () => {
  it('true within tolerance, false outside', () => {
    expect(approxEqual(1, 1 + 1e-12)).toBe(true);
    expect(approxEqual(1, 1.1, 1e-9)).toBe(false);
    expect(approxEqual(1, 1.1, 0.2)).toBe(true);
  });
});
