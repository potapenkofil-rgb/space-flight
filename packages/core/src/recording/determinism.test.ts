/**
 * The two acceptance tests PLAN.md §7 (Agent F) requires by name:
 *
 * - fly 10 minutes, rewind 5 minutes, continue — state matches the original
 *   to within 1e-9 in every field;
 * - rewinding across a 10-minute flight takes under 2 seconds.
 *
 * Both run against the deterministic fake step function in `testFixtures.ts`
 * (see this agent's report: the real integrator isn't implemented in this
 * worktree yet — PLAN.md §7 explicitly says to fake it here, not build it).
 */
import { describe, expect, it } from 'vitest';
import type { ControlInput } from '../flight/types';
import type { Vessel } from '../vessels/vessel';
import { createFlightRecorder } from './recorder';
import { createFakeVessel, createFakeWorldStep, NEUTRAL_INPUT } from './testFixtures';

const DT = 1 / 60;
const FLIGHT_SECONDS = 10 * 60;

/** A varying but fully deterministic control input, indexed only by tick — same tick always yields the same command. */
function inputForTick(tick: number): ControlInput {
  return {
    ...NEUTRAL_INPUT,
    throttle: 0.5 + 0.3 * Math.sin(tick * 0.011),
    rotate: 0.2 * Math.sin(tick * 0.0037),
  };
}

function assertClose(a: number, b: number, eps = 1e-9): void {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  expect(Math.abs(a - b) / scale).toBeLessThanOrEqual(eps);
}

function assertVesselsClose(a: Vessel, b: Vessel): void {
  assertClose(a.position.x, b.position.x);
  assertClose(a.position.y, b.position.y);
  assertClose(a.velocity.x, b.velocity.x);
  assertClose(a.velocity.y, b.velocity.y);
  assertClose(a.rotation, b.rotation);
  assertClose(a.angularVelocity, b.angularVelocity);
  expect(a.parts).toHaveLength(b.parts.length);
  for (let i = 0; i < a.parts.length; i += 1) {
    assertClose(a.parts[i]!.resources['fuel'] ?? 0, b.parts[i]!.resources['fuel'] ?? 0);
  }
}

describe('black box determinism (PLAN.md §7 Agent F)', () => {
  it('rewinding 5 minutes into a 10-minute flight and continuing matches the original final state to 1e-9', () => {
    const stepWorld = createFakeWorldStep();
    const recorder = createFlightRecorder(stepWorld, { dt: DT, snapshotIntervalSeconds: 30 });
    const totalTicks = Math.round(FLIGHT_SECONDS / DT);

    let vessels: readonly Vessel[] = [createFakeVessel(1)];
    for (let tick = 0; tick < totalTicks; tick += 1) {
      const t = tick * DT;
      recorder.tick(t, vessels.slice(), inputForTick(tick));
      vessels = stepWorld(vessels, t, DT, { activeVesselId: 1, input: inputForTick(tick) });
    }
    const expectedFinal = vessels[0]!;

    const session = recorder.openReplay();
    const rewindTime = FLIGHT_SECONDS - 5 * 60; // 5 minutes before the end
    let continued: readonly Vessel[] = session.seekTo(rewindTime);
    const rewoundTick = Math.round(rewindTime / DT);
    for (let tick = rewoundTick; tick < totalTicks; tick += 1) {
      const t = tick * DT;
      continued = stepWorld(continued, t, DT, { activeVesselId: 1, input: inputForTick(tick) });
    }

    assertVesselsClose(continued[0]!, expectedFinal);
  });

  it('seeking anywhere within a 10-minute flight takes under 2 seconds', () => {
    const stepWorld = createFakeWorldStep();
    const recorder = createFlightRecorder(stepWorld, { dt: DT, snapshotIntervalSeconds: 30 });
    const totalTicks = Math.round(FLIGHT_SECONDS / DT);

    let vessels: readonly Vessel[] = [createFakeVessel(1)];
    for (let tick = 0; tick < totalTicks; tick += 1) {
      const t = tick * DT;
      recorder.tick(t, vessels.slice(), inputForTick(tick));
      vessels = stepWorld(vessels, t, DT, { activeVesselId: 1, input: inputForTick(tick) });
    }
    const session = recorder.openReplay();

    // Worst case for "nearest snapshot to the left, replay forward" is seeking
    // just before the very last snapshot's next one — i.e. up to
    // ~snapshotIntervalSeconds of ticks to replay. Seeking to the very end is
    // exactly that worst case for a 10-minute flight with 30s snapshots.
    const start = Date.now();
    const result = session.seekTo(FLIGHT_SECONDS - DT);
    const elapsedMs = Date.now() - start;

    expect(result).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
