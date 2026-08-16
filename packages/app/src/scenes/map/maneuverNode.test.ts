import { describe, expect, it } from 'vitest';
import type { Orbit } from '@karman/core';
import {
  createManeuverNode,
  nearestTrueAnomaly,
  previewManeuver,
  withProgradeDeltaV,
  withRadialDeltaV,
} from './maneuverNode';
import { apoapsisRadius, periapsisRadius, sampleOrbitPoints } from '../../render/orbitGeometry';

const TERRA_MU = 9.81e12;

const CIRCULAR_100KM: Orbit = {
  a: 1_100_000,
  e: 0,
  argPe: 0,
  m0: 0,
  epoch: 0,
  mu: TERRA_MU,
  dir: 1,
};

describe('maneuver node', () => {
  it('createManeuverNode starts with zero delta-v', () => {
    const node = createManeuverNode(1.2);
    expect(node.progradeDeltaV).toBe(0);
    expect(node.radialDeltaV).toBe(0);
    expect(node.trueAnomaly).toBe(1.2);
  });

  it('a zero-delta-v node previews the same orbit shape it started from', () => {
    const node = createManeuverNode(0.5);
    const preview = previewManeuver(CIRCULAR_100KM, node, 0);
    expect(preview.resultOrbit.a).toBeCloseTo(CIRCULAR_100KM.a, 0);
    expect(preview.resultOrbit.e).toBeCloseTo(0, 3);
    expect(preview.deltaVMagnitude).toBeCloseTo(0, 6);
  });

  it('a prograde burn at periapsis of a circular orbit raises the apoapsis', () => {
    const node = withProgradeDeltaV(createManeuverNode(0), 200); // +200 m/s prograde
    const preview = previewManeuver(CIRCULAR_100KM, node, 0);
    expect(apoapsisRadius(preview.resultOrbit)).toBeGreaterThan(CIRCULAR_100KM.a * 1.01);
    expect(periapsisRadius(preview.resultOrbit)).toBeCloseTo(CIRCULAR_100KM.a, -2);
  });

  it('a retrograde burn lowers the periapsis below the starting circular radius', () => {
    const node = withProgradeDeltaV(createManeuverNode(0), -200);
    const preview = previewManeuver(CIRCULAR_100KM, node, 0);
    expect(periapsisRadius(preview.resultOrbit)).toBeLessThan(CIRCULAR_100KM.a * 0.99);
  });

  it('a pure radial burn does not change speed enough to be zero, and changes the orbit shape', () => {
    const node = withRadialDeltaV(createManeuverNode(0.8), 150);
    const preview = previewManeuver(CIRCULAR_100KM, node, 0);
    expect(preview.deltaVMagnitude).toBeCloseTo(150, 3);
    expect(preview.resultOrbit.e).toBeGreaterThan(0.001);
  });

  it('combining prograde and radial adds vectorially, not linearly', () => {
    const node = withRadialDeltaV(withProgradeDeltaV(createManeuverNode(0), 100), 100);
    const preview = previewManeuver(CIRCULAR_100KM, node, 0);
    expect(preview.deltaVMagnitude).toBeCloseTo(Math.sqrt(100 * 100 + 100 * 100), 3);
  });

  it('burn duration scales linearly with delta-v magnitude', () => {
    const small = previewManeuver(CIRCULAR_100KM, withProgradeDeltaV(createManeuverNode(0), 30), 0);
    const big = previewManeuver(CIRCULAR_100KM, withProgradeDeltaV(createManeuverNode(0), 300), 0);
    expect(big.burnDurationSeconds).toBeCloseTo(small.burnDurationSeconds * 10, 6);
  });

  it('timeToNode is never negative', () => {
    const node = createManeuverNode(4);
    const preview = previewManeuver(CIRCULAR_100KM, node, 100);
    expect(preview.timeToNode).toBeGreaterThanOrEqual(0);
  });

  it('nearestTrueAnomaly finds the sampled point closest to a click near periapsis', () => {
    const eccentric: Orbit = { ...CIRCULAR_100KM, a: 2_000_000, e: 0.5 };
    const samples = sampleOrbitPoints(eccentric, 1e-4).map((p) => Math.atan2(p.y, p.x) - eccentric.argPe);
    const periapsisPoint = { x: eccentric.a * (1 - eccentric.e), y: 0 };
    const nu = nearestTrueAnomaly(eccentric, periapsisPoint, samples);
    expect(Math.abs(nu)).toBeLessThan(0.2);
  });
});
