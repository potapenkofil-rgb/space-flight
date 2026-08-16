import { describe, expect, it } from 'vitest';
import {
  localOrbitFromState,
  localStateFromOrbit,
  localTimeToTrueAnomaly,
} from './localOrbitMath';

const TERRA_MU = 9.81e12; // PLAN.md §5.7

describe('localOrbitFromState (map fixture)', () => {
  it('recovers a circular orbit exactly (e≈0, a≈r)', () => {
    const r = { x: 1_100_000, y: 0 };
    const speed = Math.sqrt(TERRA_MU / 1_100_000);
    const v = { x: 0, y: speed };
    const orbit = localOrbitFromState(r, v, TERRA_MU, 0);
    expect(orbit.a).toBeCloseTo(1_100_000, 0);
    expect(orbit.e).toBeCloseTo(0, 3);
  });

  it('round-trips state → orbit → state for an eccentric orbit', () => {
    const r = { x: 1_200_000, y: 300_000 };
    const v = { x: -500, y: 3200 };
    const t = 1234.5;
    const orbit = localOrbitFromState(r, v, TERRA_MU, t);
    const back = localStateFromOrbit(orbit, t);
    expect(back.r.x).toBeCloseTo(r.x, 1);
    expect(back.r.y).toBeCloseTo(r.y, 1);
    expect(back.v.x).toBeCloseTo(v.x, 2);
    expect(back.v.y).toBeCloseTo(v.y, 2);
  });

  it('propagates a circular orbit forward by a quarter period to the expected quadrature point', () => {
    const radius = 1_100_000;
    const speed = Math.sqrt(TERRA_MU / radius);
    const orbit = localOrbitFromState({ x: radius, y: 0 }, { x: 0, y: speed }, TERRA_MU, 0);
    const period = (2 * Math.PI * Math.sqrt(Math.pow(orbit.a, 3) / TERRA_MU));
    const quarter = localStateFromOrbit(orbit, period / 4);
    expect(Math.hypot(quarter.r.x, quarter.r.y)).toBeCloseTo(radius, -1);
    // A quarter-period counter-clockwise from (r,0) should land near (0, r).
    expect(quarter.r.x).toBeCloseTo(0, -2);
    expect(quarter.r.y).toBeCloseTo(radius, -1);
  });
});

describe('localTimeToTrueAnomaly (map fixture)', () => {
  it('is the inverse of localStateFromOrbit: the state at the returned time really is at nu', () => {
    const radius = 1_100_000;
    const speed = Math.sqrt(TERRA_MU / radius);
    const orbit = localOrbitFromState({ x: radius, y: 0 }, { x: 0, y: speed }, TERRA_MU, 0);
    const nu = 2.1;
    const t = localTimeToTrueAnomaly(orbit, nu, 0);
    const state = localStateFromOrbit(orbit, t);
    const actualNu = Math.atan2(state.r.y, state.r.x) - orbit.argPe;
    const wrapped = ((actualNu % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const targetWrapped = ((nu % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(wrapped).toBeCloseTo(targetWrapped, 3);
  });

  it('never returns a time before `from`', () => {
    const radius = 1_100_000;
    const speed = Math.sqrt(TERRA_MU / radius);
    const orbit = localOrbitFromState({ x: radius, y: 0 }, { x: 0, y: speed }, TERRA_MU, 0);
    const t = localTimeToTrueAnomaly(orbit, 0.1, 5_000);
    expect(t).toBeGreaterThanOrEqual(5_000);
  });
});
