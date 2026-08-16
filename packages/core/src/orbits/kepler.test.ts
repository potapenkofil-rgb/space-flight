import { describe, expect, it } from 'vitest';
import { v2 } from '../math/vec2';
import {
  apoapsis,
  eccentricAnomaly,
  orbitFromState,
  periapsis,
  period,
  solveKeplerEquation,
  stateFromOrbit,
  timeToTrueAnomaly,
} from './kepler';

/**
 * Deterministic seeded PRNG (mulberry32). PLAN.md §3.6/§7 forbid `Math.random`
 * without an explicit seed anywhere in `@karman/core`, tests included — this
 * keeps the 500-state round-trip test reproducible.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandomState {
  readonly r: { x: number; y: number };
  readonly v: { x: number; y: number };
  readonly mu: number;
  readonly t: number;
}

/**
 * Generates a pseudo-random Cartesian state around a body, spanning circular,
 * elliptical and hyperbolic regimes (`vFactor` ranges from well below to well
 * above escape velocity `sqrt(2)·v_circular`), plus both orbital directions.
 */
function randomState(rand: () => number): RandomState {
  const mu = 1e11 + rand() * 9.9e12; // 1e11 .. 1e13 m^3/s^2
  const r = 7e5 + rand() * 4.93e7; // 7e5 .. 5e7 m
  const phiR = rand() * Math.PI * 2;
  const rVec = { x: r * Math.cos(phiR), y: r * Math.sin(phiR) };

  const vCircular = Math.sqrt(mu / r);
  const vFactor = 0.1 + rand() * 2.4; // 0.1 .. 2.5 (escape is ~1.414x circular)
  const vMag = vCircular * vFactor;

  const ccw = rand() < 0.5;
  const gammaDeg = -70 + rand() * 140; // flight-path angle off pure-tangential, deg
  const gamma = (gammaDeg * Math.PI) / 180;
  const vAngle = phiR + (ccw ? 1 : -1) * (Math.PI / 2) + gamma;
  const vVec = { x: vMag * Math.cos(vAngle), y: vMag * Math.sin(vAngle) };

  const t = (rand() - 0.5) * 2e6;

  return { r: rVec, v: vVec, mu, t };
}

function relError(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const scale = Math.max(v2.len(a), 1e-9);
  return v2.len(v2.sub(a, b)) / scale;
}

describe('orbitFromState / stateFromOrbit round trip', () => {
  it('is exact at the epoch for a hand-picked circular orbit', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 0 };
    const v = { x: 0, y: Math.sqrt(mu / 1_100_000) };
    const o = orbitFromState(r, v, mu, 0);
    expect(o.e).toBeCloseTo(0, 9);
    const back = stateFromOrbit(o, 0);
    expect(relError(back.r, r)).toBeLessThan(1e-9);
    expect(relError(back.v, v)).toBeLessThan(1e-9);
  });

  it('round-trips 500 deterministic pseudo-random states (elliptical and hyperbolic) to 1e-9 relative error', () => {
    const rand = mulberry32(0xc0ffee);
    let hyperbolicCount = 0;
    let ellipticalCount = 0;

    for (let i = 0; i < 500; i++) {
      const { r, v, mu, t } = randomState(rand);
      const o = orbitFromState(r, v, mu, t);
      if (o.e > 1) hyperbolicCount++;
      else ellipticalCount++;

      const back = stateFromOrbit(o, t);
      const rErr = relError(back.r, r);
      const vErr = relError(back.v, v);
      expect(rErr, `state #${i}: r round-trip error, e=${o.e}`).toBeLessThan(1e-9);
      expect(vErr, `state #${i}: v round-trip error, e=${o.e}`).toBeLessThan(1e-9);

      // And round-tripping the *orbit itself* at a different time should be
      // self-consistent: re-deriving from the propagated state must reproduce
      // the same shape (a, e) to the same tolerance.
      const laterT = t + 1000;
      const st2 = stateFromOrbit(o, laterT);
      const o2 = orbitFromState(st2.r, st2.v, mu, laterT);
      expect(Math.abs(o2.e - o.e), `state #${i}: e drift after propagation`).toBeLessThan(1e-9 + 1e-9 * o.e);
      if (Number.isFinite(o.a)) {
        expect(Math.abs(o2.a - o.a) / Math.abs(o.a), `state #${i}: a drift after propagation`).toBeLessThan(1e-8);
      }
    }

    // Sanity: the random generator actually exercised both regimes.
    expect(hyperbolicCount).toBeGreaterThan(50);
    expect(ellipticalCount).toBeGreaterThan(50);
  });
});

describe('period', () => {
  it('matches 2*pi*sqrt(a^3/mu) for an elliptical orbit', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 0 };
    const v = { x: 0, y: 3200 }; // above circular, below escape -> ellipse
    const o = orbitFromState(r, v, mu, 0);
    expect(o.e).toBeLessThan(1);
    const expected = 2 * Math.PI * Math.sqrt(o.a ** 3 / mu);
    expect(period(o)).toBeCloseTo(expected, 6);
  });

  it('is NaN for a parabolic/hyperbolic orbit', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 0 };
    const v = { x: 0, y: 6000 }; // well above escape -> hyperbola
    const o = orbitFromState(r, v, mu, 0);
    expect(o.e).toBeGreaterThan(1);
    expect(period(o)).toBeNaN();
  });

  it('returns the vessel to the same state after exactly one period', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 200_000 };
    const v = { x: -300, y: 3100 };
    const o = orbitFromState(r, v, mu, 0);
    const p = period(o);
    const back = stateFromOrbit(o, p);
    expect(relError(back.r, r)).toBeLessThan(1e-8);
    expect(relError(back.v, v)).toBeLessThan(1e-8);
  });
});

describe('circular orbit stays circular through 1000 revolutions on rails', () => {
  it('semi-major axis drifts by less than 1e-6 relative after 1000 re-derivations', () => {
    const mu = 9.81e12;
    const r0 = { x: 1_100_000, y: 0 };
    const v0 = { x: 0, y: Math.sqrt(mu / 1_100_000) };
    let o = orbitFromState(r0, v0, mu, 0);
    const a0 = o.a;
    const p = period(o);

    for (let k = 1; k <= 1000; k++) {
      const t = k * p;
      const st = stateFromOrbit(o, t);
      // Simulate a fresh on-rails/off-rails round trip at each revolution.
      o = orbitFromState(st.r, st.v, mu, t);
    }

    const relDrift = Math.abs(o.a - a0) / a0;
    expect(relDrift).toBeLessThan(1e-6);
    expect(o.e).toBeLessThan(1e-6);
  });

  it('radius stays within 1e-6 relative of the initial radius sampled directly from the fixed orbit', () => {
    const mu = 9.81e12;
    const r0 = { x: 1_100_000, y: 0 };
    const v0 = { x: 0, y: Math.sqrt(mu / 1_100_000) };
    const o = orbitFromState(r0, v0, mu, 0);
    const p = period(o);
    const r0Len = v2.len(r0);

    for (let k = 1; k <= 1000; k++) {
      const st = stateFromOrbit(o, k * p);
      const rLen = v2.len(st.r);
      expect(Math.abs(rLen - r0Len) / r0Len).toBeLessThan(1e-6);
    }
  });
});

describe('Kepler equation solver', () => {
  it('converges in fewer than 20 iterations at e=0.999 across a spread of mean anomalies', () => {
    const meanAnomalies = [
      0, 1e-6, 1e-3, 0.01, 0.05, 0.1, 0.3, 0.5, 0.8, 1, 1.5, 2, 2.5, 3, Math.PI, 4, 5, 6, 10, -3, -1,
    ];
    for (const M of meanAnomalies) {
      const { anomaly, iterations } = solveKeplerEquation(M, 0.999);
      expect(iterations, `M=${M}`).toBeLessThan(20);
      // And the solution must actually satisfy Kepler's equation.
      const residual = Math.abs(anomaly - 0.999 * Math.sin(anomaly) - M);
      expect(residual, `M=${M}`).toBeLessThan(1e-9);
    }
  });

  it('agrees with eccentricAnomaly() for the ellipse regime', () => {
    const E = eccentricAnomaly(1.2, 0.5);
    expect(E - 0.5 * Math.sin(E)).toBeCloseTo(1.2, 9);
  });

  it('solves the hyperbolic Kepler equation to high precision', () => {
    const M = 5;
    const e = 2.3;
    const { anomaly, iterations } = solveKeplerEquation(M, e);
    expect(iterations).toBeLessThan(30);
    const residual = Math.abs(e * Math.sinh(anomaly) - anomaly - M);
    expect(residual).toBeLessThan(1e-9);
  });
});

describe('apoapsis / periapsis', () => {
  it('for a circular orbit both equal the radius', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 0 };
    const v = { x: 0, y: Math.sqrt(mu / 1_100_000) };
    const o = orbitFromState(r, v, mu, 0);
    expect(apoapsis(o)).toBeCloseTo(1_100_000, 0);
    expect(periapsis(o)).toBeCloseTo(1_100_000, 0);
  });

  it('apoapsis is +Infinity for a hyperbolic orbit, periapsis stays finite', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 0 };
    const v = { x: 0, y: 6000 };
    const o = orbitFromState(r, v, mu, 0);
    expect(apoapsis(o)).toBe(Infinity);
    expect(Number.isFinite(periapsis(o))).toBe(true);
    expect(periapsis(o)).toBeGreaterThan(0);
  });
});

describe('timeToTrueAnomaly', () => {
  it('finds the next periapsis passage of a circular-ish orbit at one full period out', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 200_000 };
    const v = { x: -300, y: 3100 };
    const o = orbitFromState(r, v, mu, 0);
    const tPeri = timeToTrueAnomaly(o, 0, 0.001);
    const st = stateFromOrbit(o, tPeri);
    expect(v2.len(st.r)).toBeCloseTo(periapsis(o), 0);
  });

  it('wraps forward to the next occurrence for an elliptical orbit', () => {
    const mu = 9.81e12;
    const r = { x: 1_100_000, y: 0 };
    const v = { x: 0, y: 3200 };
    const o = orbitFromState(r, v, mu, 0);
    const p = period(o);
    const t1 = timeToTrueAnomaly(o, Math.PI / 2, 0);
    const t2 = timeToTrueAnomaly(o, Math.PI / 2, t1 + 1);
    expect(t2).toBeGreaterThan(t1);
    expect(t2 - t1).toBeCloseTo(p, 3);
  });
});
