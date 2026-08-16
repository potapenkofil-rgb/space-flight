import { describe, expect, it } from 'vitest';
import { computePlumeShape, DEFAULT_PLUME_STYLE } from './plume';

describe('computePlumeShape', () => {
  it('is invisible at zero throttle regardless of pressure', () => {
    expect(computePlumeShape(0, 1)).toEqual({ length: 0, width: 0, alpha: 0 });
    expect(computePlumeShape(0, 0)).toEqual({ length: 0, width: 0, alpha: 0 });
  });

  it('at full throttle, vacuum is shorter than sea level (PLAN.md §7 Agent D)', () => {
    const vac = computePlumeShape(1, 0);
    const sl = computePlumeShape(1, 1);
    expect(vac.length).toBeLessThan(sl.length);
  });

  it('at full throttle, vacuum is wider than sea level (PLAN.md §7 Agent D)', () => {
    const vac = computePlumeShape(1, 0);
    const sl = computePlumeShape(1, 1);
    expect(vac.width).toBeGreaterThan(sl.width);
  });

  it('length grows monotonically with throttle at a fixed pressure', () => {
    const half = computePlumeShape(0.5, 1);
    const full = computePlumeShape(1, 1);
    expect(full.length).toBeGreaterThan(half.length);
    expect(full.alpha).toBeGreaterThan(half.alpha);
  });

  it('clamps out-of-range throttle/pressure instead of producing nonsense', () => {
    const shape = computePlumeShape(2, -1);
    expect(shape).toEqual(computePlumeShape(1, 0));
  });

  it('matches the default style bounds exactly at the throttle=1 extremes', () => {
    const vac = computePlumeShape(1, 0);
    const sl = computePlumeShape(1, 1);
    expect(vac.length).toBeCloseTo(DEFAULT_PLUME_STYLE.lengthVac, 9);
    expect(sl.length).toBeCloseTo(DEFAULT_PLUME_STYLE.lengthSl, 9);
  });
});
