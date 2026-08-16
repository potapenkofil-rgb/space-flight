import { describe, expect, it } from 'vitest';
import { FIXTURE_LUNA, FIXTURE_SYSTEM, FIXTURE_TERRA } from './__fixtures__/system';
import {
  circularOrbitSpeed,
  computeStepDeltaV,
  estimateAscentLosses,
  evaluateFlightPlan,
  hohmannTransfer,
  visViva,
  type FlightStepDef,
} from './flightPlan';

const getBody = (id: string) => FIXTURE_SYSTEM.get(id);

describe('circularOrbitSpeed / visViva against PLAN.md §5.7 reference figures', () => {
  it('circular orbit at 100 km above Terra ≈ 2986 m/s', () => {
    const v = circularOrbitSpeed(FIXTURE_TERRA.mu, FIXTURE_TERRA.radius + 100_000);
    expect(v).toBeCloseTo(2_986, 0);
  });

  it('visViva reduces to circularOrbitSpeed on a circular orbit (a === r)', () => {
    const r = FIXTURE_TERRA.radius + 250_000;
    expect(visViva(FIXTURE_TERRA.mu, r, r)).toBeCloseTo(circularOrbitSpeed(FIXTURE_TERRA.mu, r), 6);
  });
});

describe('hohmannTransfer', () => {
  it('Terra 100 km orbit -> Luna orbital radius departure burn ≈ 896 m/s (PLAN.md §5.7)', () => {
    const r1 = FIXTURE_TERRA.radius + 100_000;
    const r2 = FIXTURE_LUNA.orbit?.a ?? 0;
    const transfer = hohmannTransfer(FIXTURE_TERRA.mu, r1, r2);
    expect(transfer.dv1).toBeCloseTo(896, 0);
  });

  it('a transfer to the same radius costs nothing', () => {
    const r = FIXTURE_TERRA.radius + 500_000;
    const transfer = hohmannTransfer(FIXTURE_TERRA.mu, r, r);
    expect(transfer.total).toBeCloseTo(0, 6);
  });
});

describe('SOI radius derived from the fixture matches PLAN.md §5.7', () => {
  it("Luna's SOI ≈ 1 108 000 m", () => {
    expect(FIXTURE_LUNA.soiRadius).toBeCloseTo(1_108_000, -4);
  });
  it("Luna's orbital period ≈ 8.2 h", () => {
    expect(FIXTURE_LUNA.rotationPeriod / 3600).toBeCloseTo(8.2, 1);
  });
});

describe('estimateAscentLosses', () => {
  it('scales with the launch body\'s own surface gravity, not a fixed constant', () => {
    const terraLoss = estimateAscentLosses(FIXTURE_TERRA);
    const lunaLoss = estimateAscentLosses(FIXTURE_LUNA);
    expect(terraLoss).toBeGreaterThan(lunaLoss); // Terra's gravity/atmosphere both cost more
    expect(terraLoss).toBeCloseTo(814, -1); // reproduces PLAN.md §5.7's own "100 km orbit ≈ 3800 m/s with losses" margin
  });
});

describe('computeStepDeltaV', () => {
  it('an "orbit 100 km" step at Terra reproduces PLAN.md §5.7\'s ≈3800 m/s figure', () => {
    const step: FlightStepDef = { kind: 'orbit', bodyId: 'terra', altitudeM: 100_000 };
    expect(computeStepDeltaV(step, getBody)).toBeCloseTo(3_800, -1);
  });

  it('a "transfer" step to Luna reproduces PLAN.md §5.7\'s ≈896 m/s figure', () => {
    const step: FlightStepDef = { kind: 'transfer', bodyId: 'terra', altitudeM: 100_000, toBodyId: 'luna' };
    expect(computeStepDeltaV(step, getBody)).toBeCloseTo(896, 0);
  });

  it('rejects a transfer whose target does not orbit the departure body', () => {
    const step: FlightStepDef = { kind: 'transfer', bodyId: 'luna', altitudeM: 50_000, toBodyId: 'terra' };
    expect(() => computeStepDeltaV(step, getBody)).toThrow();
  });
});

describe('evaluateFlightPlan', () => {
  const plan: FlightStepDef[] = [
    { kind: 'orbit', bodyId: 'terra', altitudeM: 100_000 },
    { kind: 'transfer', bodyId: 'terra', altitudeM: 100_000, toBodyId: 'luna' },
  ];

  it('reports "sufficient" when the ship has enough ΔV', () => {
    const verdict = evaluateFlightPlan(plan, getBody, 5_000);
    expect(verdict.sufficient).toBe(true);
    expect(verdict.totalRequired).toBeCloseTo(3_800 + 896, -1);
  });

  it('reports "insufficient" when it does not, with a negative margin', () => {
    const verdict = evaluateFlightPlan(plan, getBody, 4_000);
    expect(verdict.sufficient).toBe(false);
    expect(verdict.margin).toBeLessThan(0);
  });
});
