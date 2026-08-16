import { describe, expect, it } from 'vitest';
import {
  apoapsisRadius,
  periapsisRadius,
  pointAtTrueAnomaly,
  radiusAtTrueAnomaly,
  sampleOrbitPoints,
  type OrbitShape,
} from './orbitGeometry';

describe('conic geometry', () => {
  it('apoapsis/periapsis match a·(1±e)', () => {
    const orbit: OrbitShape = { a: 1_100_000, e: 0.1, argPe: 0 };
    expect(apoapsisRadius(orbit)).toBeCloseTo(1_210_000, 6);
    expect(periapsisRadius(orbit)).toBeCloseTo(990_000, 6);
  });

  it('a circle (e=0) has constant radius at every true anomaly', () => {
    const orbit: OrbitShape = { a: 700_000, e: 0, argPe: 0 };
    for (const nu of [0, 1, 2, 3, 4, 5, 6]) {
      expect(radiusAtTrueAnomaly(orbit, nu)).toBeCloseTo(700_000, 6);
    }
  });

  it('periapsis is at nu=0, apoapsis at nu=pi, for an ellipse', () => {
    const orbit: OrbitShape = { a: 1_000_000, e: 0.3, argPe: 0 };
    expect(radiusAtTrueAnomaly(orbit, 0)).toBeCloseTo(periapsisRadius(orbit), 6);
    expect(radiusAtTrueAnomaly(orbit, Math.PI)).toBeCloseTo(apoapsisRadius(orbit), 6);
  });

  it('pointAtTrueAnomaly length equals radiusAtTrueAnomaly', () => {
    const orbit: OrbitShape = { a: 1_000_000, e: 0.4, argPe: 0.7 };
    for (const nu of [0, 0.5, 1.5, 3.1, 4.4]) {
      const p = pointAtTrueAnomaly(orbit, nu);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(radiusAtTrueAnomaly(orbit, nu), 6);
    }
  });
});

describe('sampleOrbitPoints — adaptive sampling', () => {
  it('produces a closed loop covering roughly one full revolution', () => {
    const orbit: OrbitShape = { a: 1_100_000, e: 0.02, argPe: 0 };
    const points = sampleOrbitPoints(orbit, 1e-4);
    expect(points.length).toBeGreaterThan(8);
    // last point should be close (in angle) to wrapping back to the first
    const first = Math.atan2(points[0]!.y, points[0]!.x);
    const last = Math.atan2(points[points.length - 1]!.y, points[points.length - 1]!.x);
    expect(Math.abs(first - last)).toBeLessThan(1); // both near the same angle, having gone almost 2π
  });

  it('samples denser near periapsis than near apoapsis for an eccentric orbit', () => {
    const orbit: OrbitShape = { a: 2_000_000, e: 0.6, argPe: 0 };
    const points = sampleOrbitPoints(orbit, 5e-4);
    const angles = points.map((p) => Math.atan2(p.y, p.x));

    // Count points landing within a fixed-size angular window around periapsis (nu=0) vs apoapsis (nu=pi).
    const nearPe = angles.filter((a) => Math.abs(a) < 0.3).length;
    const nearApo = angles.filter((a) => Math.abs(Math.abs(a) - Math.PI) < 0.3).length;
    expect(nearPe).toBeGreaterThan(nearApo);
  });

  it('a near-circular orbit needs far fewer points than a very eccentric one at the same zoom', () => {
    const circular: OrbitShape = { a: 1_000_000, e: 0.01, argPe: 0 };
    const eccentric: OrbitShape = { a: 1_000_000, e: 0.9, argPe: 0 };
    const ppm = 2e-4;
    const circularPoints = sampleOrbitPoints(circular, ppm);
    const eccentricPoints = sampleOrbitPoints(eccentric, ppm);
    expect(eccentricPoints.length).toBeGreaterThan(circularPoints.length);
  });

  it('a finer target error produces more points', () => {
    const orbit: OrbitShape = { a: 1_000_000, e: 0.3, argPe: 0 };
    const coarse = sampleOrbitPoints(orbit, 1e-4, { targetErrorPx: 2 });
    const fine = sampleOrbitPoints(orbit, 1e-4, { targetErrorPx: 0.1 });
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it('never exceeds maxPoints even for a degenerate near-parabolic orbit', () => {
    const orbit: OrbitShape = { a: 1_000_000, e: 0.999999, argPe: 0 };
    const points = sampleOrbitPoints(orbit, 10, { maxPoints: 500 });
    expect(points.length).toBeLessThanOrEqual(500);
  });
});
