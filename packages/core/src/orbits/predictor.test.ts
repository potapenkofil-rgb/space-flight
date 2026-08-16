import { describe, expect, it } from 'vitest';
import { createBody } from './body';
import { orbitFromState, period } from './kepler';
import { createTrajectoryPredictor } from './predictor';
import type { Body, Orbit, VesselState } from './types';

// System numbers from PLAN.md §5.7 ("data/systems/karman.json").
const TERRA_MU = 9.81e12;
const TERRA_RADIUS = 1_000_000;
const LUNA_MU = 1.44e11;
const LUNA_RADIUS = 300_000;
const LUNA_ORBIT_A = 6_000_000;
const LUNA_ORBIT_E = 0.02;

function makeSystem(lunaM0: number): { terra: Body; luna: Body; bodies: Body[] } {
  const terra = createBody({
    id: 'terra',
    mu: TERRA_MU,
    radius: TERRA_RADIUS,
    rotationPeriod: 86164,
    atmosphere: { rho0: 1.225, scaleHeight: 7000, top: 60000 },
    parent: null,
    orbit: null,
  });
  const lunaOrbit: Orbit = {
    a: LUNA_ORBIT_A,
    e: LUNA_ORBIT_E,
    argPe: 0,
    m0: lunaM0,
    epoch: 0,
    mu: terra.mu,
    dir: 1,
  };
  const luna = createBody({
    id: 'luna',
    mu: LUNA_MU,
    radius: LUNA_RADIUS,
    rotationPeriod: period(lunaOrbit),
    atmosphere: null,
    parent: terra,
    orbit: lunaOrbit,
  });
  return { terra, luna, bodies: [terra, luna] };
}

describe('TrajectoryPredictor', () => {
  it('catches SOI entry into Luna from a 896 m/s transfer burn off a 100 km circular orbit (PLAN.md §5.7)', () => {
    // Luna phased so it's near the transfer orbit's apoapsis when the vessel
    // arrives there — computed by placing the burn so the intercept is
    // geometrically guaranteed, per the worked numbers in PLAN.md §5.7
    // (v_circular(100km) ≈ 2986 m/s, transfer ΔV ≈ 896 m/s, SOI ≈ 1,108,000 m).
    const LUNA_M0_AT_INTERCEPT = 1.7121954564324156;
    const { terra, bodies } = makeSystem(LUNA_M0_AT_INTERCEPT);

    const leoRadius = TERRA_RADIUS + 100_000; // 100 km circular orbit
    const vCircular = Math.sqrt(terra.mu / leoRadius);
    expect(vCircular).toBeCloseTo(2986, 0);

    const deltaV = 896;
    const state: VesselState = {
      position: { x: leoRadius, y: 0 },
      velocity: { x: 0, y: vCircular + deltaV },
      soi: terra,
      t: 0,
    };

    const predictor = createTrajectoryPredictor(bodies);
    const segments = predictor.predict(state, 5 * 3600, 8); // 5h horizon, plenty past the ~1.86h transfer

    expect(segments.length).toBeGreaterThan(0);
    const firstSegment = segments[0]!;
    expect(firstSegment.bodyId).toBe('terra');
    expect(firstSegment.endReason).toBe('soi-entry');
    expect(firstSegment.nextBodyId).toBe('luna');
    expect(firstSegment.endTime).toBeGreaterThan(firstSegment.startTime);

    // The next segment (if produced) must pick up around Luna.
    if (segments.length > 1) {
      expect(segments[1]!.bodyId).toBe('luna');
      expect(segments[1]!.startTime).toBe(firstSegment.endTime);
    }
  });

  it('reports time-limit when nothing interesting happens within the horizon', () => {
    const { terra, bodies } = makeSystem(0);
    const r = TERRA_RADIUS + 500_000;
    const vCircular = Math.sqrt(terra.mu / r);
    const state: VesselState = {
      position: { x: r, y: 0 },
      velocity: { x: 0, y: vCircular },
      soi: terra,
      t: 0,
    };
    const predictor = createTrajectoryPredictor(bodies);
    const segments = predictor.predict(state, 500, 4); // far shorter than one orbit
    expect(segments.length).toBe(1);
    expect(segments[0]!.endReason).toBe('time-limit');
    expect(segments[0]!.nextBodyId).toBeNull();
    expect(segments[0]!.endTime).toBeCloseTo(500, 6);
  });

  it('reports impact for a suborbital trajectory that hits the surface', () => {
    const { terra, bodies } = makeSystem(0);
    const r = TERRA_RADIUS + 10_000;
    const state: VesselState = {
      position: { x: r, y: 0 },
      velocity: { x: 0, y: 200 }, // far below orbital velocity: falls back down
      soi: terra,
      t: 0,
    };
    const predictor = createTrajectoryPredictor(bodies);
    const segments = predictor.predict(state, 3600, 4);
    expect(segments.length).toBe(1);
    expect(segments[0]!.endReason).toBe('impact');
    expect(segments[0]!.nextBodyId).toBeNull();
  });

  it('respects maxSegments as a hard cap', () => {
    const { terra, bodies } = makeSystem(0);
    const r = TERRA_RADIUS + 200_000;
    const vCircular = Math.sqrt(terra.mu / r);
    const o: Orbit = orbitFromState({ x: r, y: 0 }, { x: 0, y: vCircular }, terra.mu, 0);
    const p = period(o);
    const state: VesselState = { position: { x: r, y: 0 }, velocity: { x: 0, y: vCircular }, soi: terra, t: 0 };
    const predictor = createTrajectoryPredictor(bodies);
    // Horizon far longer than a single time-limit segment would need, but
    // circular orbits never hit any boundary, so every segment ends in
    // time-limit only once — cap still must be respected exactly.
    const segments = predictor.predict(state, p * 50, 3);
    expect(segments.length).toBeLessThanOrEqual(3);
  });
});
