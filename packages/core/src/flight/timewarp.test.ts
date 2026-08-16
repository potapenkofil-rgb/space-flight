import { describe, expect, it } from 'vitest';
import { createBody } from '../orbits/body';
import type { Vessel } from '../vessels/vessel';
import {
  MAX_ATMOSPHERIC_WARP,
  WARP_LEVELS,
  canSelectWarpLevel,
  isWarpLevelValid,
  requestWarpLevel,
  stepWarpLevel,
  warpContextForVessel,
  type WarpContext,
} from './timewarp';

const terra = createBody({
  id: 'terra',
  mu: 9.81e12,
  radius: 1_000_000,
  rotationPeriod: 86164,
  atmosphere: { rho0: 1.225, scaleHeight: 7000, top: 60000 },
  parent: null,
  orbit: null,
});

function makeVessel(overrides: Partial<Vessel>): Vessel {
  return {
    id: 1,
    parts: [],
    joints: [],
    stages: [],
    currentStage: 0,
    position: { x: 1_100_000, y: 0 },
    velocity: { x: 0, y: 2986 },
    rotation: 0,
    angularVelocity: 0,
    soi: terra,
    railOrbit: null,
    mass: { total: 1000, com: { x: 0, y: 0 }, inertia: 1 },
    ...overrides,
  };
}

describe('WARP_LEVELS', () => {
  it('is exactly the ladder from PLAN.md §7', () => {
    expect(WARP_LEVELS).toEqual([1, 2, 5, 10, 50, 100, 1000, 10000, 100000]);
  });

  it('isWarpLevelValid accepts only the fixed ladder', () => {
    for (const level of WARP_LEVELS) expect(isWarpLevelValid(level)).toBe(true);
    for (const bad of [0, 3, 7, 15, 999999, -1]) expect(isWarpLevelValid(bad)).toBe(false);
  });
});

describe('canSelectWarpLevel', () => {
  const onRailsVacuum: WarpContext = { onRails: true, altitude: 500_000, atmosphereTop: 60_000 };
  const offRailsVacuum: WarpContext = { onRails: false, altitude: 500_000, atmosphereTop: 60_000 };
  const onRailsAtmosphere: WarpContext = { onRails: true, altitude: 10_000, atmosphereTop: 60_000 };
  const noAtmosphereBody: WarpContext = { onRails: true, altitude: 10, atmosphereTop: null };

  it('rejects a level that is not on the ladder', () => {
    const d = canSelectWarpLevel(42, onRailsVacuum);
    expect(d.granted).toBe(false);
    expect(d.reason).toBe('invalid-level');
  });

  it('always allows warp <= 10x regardless of rails/atmosphere', () => {
    for (const level of [1, 2, 5, MAX_ATMOSPHERIC_WARP]) {
      expect(canSelectWarpLevel(level, offRailsVacuum).granted).toBe(true);
      expect(canSelectWarpLevel(level, onRailsAtmosphere).granted).toBe(true);
    }
  });

  it('rejects >10x when off-rails, with reason requires-rails', () => {
    const d = canSelectWarpLevel(50, offRailsVacuum);
    expect(d.granted).toBe(false);
    expect(d.reason).toBe('requires-rails');
  });

  it('rejects >10x inside the atmosphere even on-rails, with reason requires-vacuum', () => {
    const d = canSelectWarpLevel(100, onRailsAtmosphere);
    expect(d.granted).toBe(false);
    expect(d.reason).toBe('requires-vacuum');
  });

  it('grants >10x on-rails and outside the atmosphere', () => {
    const d = canSelectWarpLevel(100000, onRailsVacuum);
    expect(d.granted).toBe(true);
    expect(d.reason).toBeNull();
  });

  it('a body with no atmosphere never blocks high warp on atmosphere grounds', () => {
    const ctx: WarpContext = { onRails: true, altitude: 10, atmosphereTop: null };
    expect(canSelectWarpLevel(1000, ctx).granted).toBe(true);
    expect(canSelectWarpLevel(1000, noAtmosphereBody).granted).toBe(true);
  });
});

describe('requestWarpLevel', () => {
  it('never returns silently on refusal: reason is always populated', () => {
    const ctx: WarpContext = { onRails: false, altitude: 1000, atmosphereTop: 60_000 };
    const d = requestWarpLevel(10, 1000, ctx);
    expect(d.granted).toBe(false);
    expect(d.reason).not.toBeNull();
    expect(d.level).toBe(10); // falls back to the still-valid current level
  });

  it('falls back to 1x if even the current level is no longer valid', () => {
    const ctx: WarpContext = { onRails: false, altitude: 1000, atmosphereTop: 60_000 };
    const d = requestWarpLevel(1000, 100000, ctx); // both invalid off-rails
    expect(d.granted).toBe(false);
    expect(d.level).toBe(1);
  });

  it('grants the requested level when allowed', () => {
    const ctx: WarpContext = { onRails: true, altitude: 500_000, atmosphereTop: 60_000 };
    const d = requestWarpLevel(1, 10000, ctx);
    expect(d.granted).toBe(true);
    expect(d.level).toBe(10000);
    expect(d.reason).toBeNull();
  });
});

describe('stepWarpLevel', () => {
  it('steps up and down the ladder', () => {
    expect(stepWarpLevel(1, 1)).toBe(2);
    expect(stepWarpLevel(2, 1)).toBe(5);
    expect(stepWarpLevel(100000, 1)).toBe(100000); // clamped at the top
    expect(stepWarpLevel(1, -1)).toBe(1); // clamped at the bottom
    expect(stepWarpLevel(100, -1)).toBe(50);
  });

  it('recovers gracefully from an unknown current level', () => {
    expect(stepWarpLevel(42, 1)).toBe(WARP_LEVELS[0]);
  });
});

describe('warpContextForVessel', () => {
  it('derives onRails from railOrbit and altitude from |position| - body.radius', () => {
    const v = makeVessel({ position: { x: 1_100_000, y: 0 }, railOrbit: null });
    const ctx = warpContextForVessel(v);
    expect(ctx.onRails).toBe(false);
    expect(ctx.altitude).toBeCloseTo(100_000, 6);
    expect(ctx.atmosphereTop).toBe(60_000);
  });

  it('reports onRails=true when railOrbit is set', () => {
    const v = makeVessel({
      railOrbit: { a: 1_100_000, e: 0, argPe: 0, m0: 0, epoch: 0, mu: terra.mu, dir: 1 },
    });
    expect(warpContextForVessel(v).onRails).toBe(true);
  });
});
