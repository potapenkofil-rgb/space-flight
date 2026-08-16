import { describe, expect, it } from 'vitest';
import { v2 } from '../math/vec2';
import { createBody } from './body';
import { period, stateFromOrbit } from './kepler';
import type { Orbit } from './types';

const TERRA_MU = 9.81e12;
const LUNA_MU = 1.44e11;

function makeTerra() {
  return createBody({
    id: 'terra',
    mu: TERRA_MU,
    radius: 1_000_000,
    rotationPeriod: 86164,
    atmosphere: { rho0: 1.225, scaleHeight: 7000, top: 60000 },
    parent: null,
    orbit: null,
  });
}

describe('createBody', () => {
  it('root body: positionAt/velocityAt are always zero', () => {
    const terra = makeTerra();
    expect(terra.positionAt(0)).toEqual({ x: 0, y: 0 });
    expect(terra.positionAt(123456)).toEqual({ x: 0, y: 0 });
    expect(terra.velocityAt(0)).toEqual({ x: 0, y: 0 });
  });

  it('root body gets an infinite SOI radius', () => {
    const terra = makeTerra();
    expect(terra.soiRadius).toBe(Infinity);
  });

  it('derives soiRadius via R_soi = a*(mu_body/mu_parent)^0.4 (PLAN.md §5.1)', () => {
    const terra = makeTerra();
    const lunaOrbit: Orbit = { a: 6_000_000, e: 0.02, argPe: 0, m0: 0, epoch: 0, mu: terra.mu, dir: 1 };
    const luna = createBody({
      id: 'luna',
      mu: LUNA_MU,
      radius: 300_000,
      rotationPeriod: period(lunaOrbit),
      atmosphere: null,
      parent: terra,
      orbit: lunaOrbit,
    });
    const expected = lunaOrbit.a * (LUNA_MU / TERRA_MU) ** 0.4;
    expect(luna.soiRadius).toBeCloseTo(expected, 3);
    // Matches the system-tuning figure from PLAN.md §5.7 (Luna SOI: 1,108,000 m).
    expect(luna.soiRadius).toBeGreaterThan(1_100_000);
    expect(luna.soiRadius).toBeLessThan(1_120_000);
  });

  it('non-root positionAt/velocityAt matches stateFromOrbit directly (single-level chain)', () => {
    const terra = makeTerra();
    const lunaOrbit: Orbit = { a: 6_000_000, e: 0.02, argPe: 0.4, m0: 1.1, epoch: 0, mu: terra.mu, dir: 1 };
    const luna = createBody({
      id: 'luna',
      mu: LUNA_MU,
      radius: 300_000,
      rotationPeriod: period(lunaOrbit),
      atmosphere: null,
      parent: terra,
      orbit: lunaOrbit,
    });

    for (const t of [0, 1000, 50_000, -20_000]) {
      const st = stateFromOrbit(lunaOrbit, t);
      expect(luna.positionAt(t)).toEqual(st.r);
      expect(luna.velocityAt(t)).toEqual(st.v);
    }
  });

  it('resolves a two-level parent chain by summing through the tree', () => {
    const terra = makeTerra();
    const lunaOrbit: Orbit = { a: 6_000_000, e: 0.02, argPe: 0, m0: 0, epoch: 0, mu: terra.mu, dir: 1 };
    const luna = createBody({
      id: 'luna',
      mu: LUNA_MU,
      radius: 300_000,
      rotationPeriod: period(lunaOrbit),
      atmosphere: null,
      parent: terra,
      orbit: lunaOrbit,
    });
    const stationOrbit: Orbit = { a: 10_000, e: 0, argPe: 0, m0: 0.7, epoch: 0, mu: luna.mu, dir: 1 };
    const station = createBody({
      id: 'lunar-station',
      mu: 1,
      radius: 1,
      rotationPeriod: period(stationOrbit),
      atmosphere: null,
      parent: luna,
      orbit: stationOrbit,
    });

    const t = 12345;
    const expected = v2.add(luna.positionAt(t), stateFromOrbit(stationOrbit, t).r);
    expect(station.positionAt(t)).toEqual(expected);
    // And terra->luna->station is consistent with terra being the zero origin.
    expect(luna.positionAt(t)).toEqual(stateFromOrbit(lunaOrbit, t).r);
  });

  it('throws if a root body is given an orbit, or a non-root body is missing one', () => {
    const terra = makeTerra();
    expect(() =>
      createBody({
        id: 'bad-root',
        mu: 1,
        radius: 1,
        rotationPeriod: 1,
        atmosphere: null,
        parent: null,
        orbit: { a: 1, e: 0, argPe: 0, m0: 0, epoch: 0, mu: 1, dir: 1 },
      })
    ).toThrow();
    expect(() =>
      createBody({
        id: 'bad-child',
        mu: 1,
        radius: 1,
        rotationPeriod: 1,
        atmosphere: null,
        parent: terra,
        orbit: null,
      })
    ).toThrow();
  });
});
