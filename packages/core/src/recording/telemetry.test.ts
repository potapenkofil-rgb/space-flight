import { describe, expect, it } from 'vitest';
import type { ReplaySession } from './types';
import { computeTelemetrySeries } from './telemetry';
import { createFakeBody, createFakeVessel } from './testFixtures';

const BODY = createFakeBody({ radius: 1_000_000 });

/** A `ReplaySession` stand-in whose `seekTo` is a closed-form function of `t` — no recorder/snapshot machinery needed to unit-test `computeTelemetrySeries` in isolation. */
function fakeSessionOf(fn: (t: number) => ReturnType<typeof createFakeVessel>): ReplaySession {
  return {
    snapshots: [],
    commands: [],
    markers: [],
    startTime: 0,
    endTime: 10,
    seekTo: (t) => [fn(Math.min(Math.max(t, 0), 10))],
  };
}

describe('computeTelemetrySeries', () => {
  it('reports altitude and speed from a straight climb at constant velocity', () => {
    const session = fakeSessionOf((t) =>
      createFakeVessel(1, {
        soi: BODY,
        position: { x: 0, y: BODY.radius + 100 * t },
        velocity: { x: 0, y: 100 },
      })
    );
    const series = computeTelemetrySeries(session, 1, 3); // t = 0, 5, 10

    expect(series).toHaveLength(3);
    expect(series[0]!.altitude).toBeCloseTo(0, 6);
    expect(series[1]!.altitude).toBeCloseTo(500, 6);
    expect(series[2]!.altitude).toBeCloseTo(1000, 6);
    for (const s of series) expect(s.speed).toBeCloseTo(100, 6);
  });

  it('reports gForce as 0 on the first sample and the acceleration magnitude after that', () => {
    const session = fakeSessionOf((t) =>
      createFakeVessel(1, {
        soi: BODY,
        position: { x: 0, y: BODY.radius },
        velocity: { x: 10 * t, y: 0 }, // constant acceleration of 10 m/s^2
      })
    );
    const series = computeTelemetrySeries(session, 1, 3); // t = 0, 5, 10; dv/dt = 10 m/s^2 between samples
    expect(series[0]!.gForce).toBe(0);
    expect(series[1]!.gForce).toBeCloseTo(10 / 9.80665, 6);
    expect(series[2]!.gForce).toBeCloseTo(10 / 9.80665, 6);
  });

  it('reports fuelFraction relative to the first sample and clamps at 0', () => {
    const session = fakeSessionOf((t) =>
      createFakeVessel(1, {
        soi: BODY,
        parts: [
          {
            id: 1,
            partId: 'tank',
            position: { x: 0, y: 0 },
            rotation: 0,
            resources: { fuel: Math.max(0, 1000 - 200 * t) },
          },
        ],
      })
    );
    const series = computeTelemetrySeries(session, 1, 6); // t = 0, 2, 4, 6, 8, 10
    expect(series[0]!.fuelFraction).toBeCloseTo(1, 6);
    expect(series[series.length - 1]!.fuelFraction).toBeCloseTo(0, 6);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]!.fuelFraction).toBeLessThanOrEqual(series[i - 1]!.fuelFraction + 1e-9);
    }
  });

  it('rejects sampleCount below 2', () => {
    const session = fakeSessionOf((t) => createFakeVessel(1, { soi: BODY, position: { x: 0, y: BODY.radius + t } }));
    expect(() => computeTelemetrySeries(session, 1, 1)).toThrow();
  });
});
