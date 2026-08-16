import { describe, expect, it } from 'vitest';
import type { Vessel } from '../vessels/vessel';
import { createFlightRecorder, startFromReplay } from './recorder';
import { createFakeVessel, createFakeWorldStep, NEUTRAL_INPUT } from './testFixtures';
import type { ControlInput } from '../flight/types';

const DT = 1 / 60;

function runFlight(seconds: number, throttle = 0.3): { recorder: ReturnType<typeof createFlightRecorder> } {
  const stepWorld = createFakeWorldStep();
  const recorder = createFlightRecorder(stepWorld, { dt: DT, snapshotIntervalSeconds: 30 });
  let vessels: readonly Vessel[] = [createFakeVessel(1)];
  const ticks = Math.round(seconds / DT);
  const input: ControlInput = { ...NEUTRAL_INPUT, throttle };
  for (let tick = 0; tick < ticks; tick += 1) {
    const t = tick * DT;
    recorder.tick(t, vessels.slice(), input);
    vessels = stepWorld(vessels, t, DT, { activeVesselId: vessels[0]!.id, input });
  }
  return { recorder };
}

describe('createFlightRecorder', () => {
  it('throws from openReplay before any tick was recorded', () => {
    const recorder = createFlightRecorder(createFakeWorldStep());
    expect(() => recorder.openReplay()).toThrow();
  });

  it('takes a snapshot on the very first tick and roughly every snapshotIntervalSeconds after that', () => {
    const { recorder } = runFlight(95); // should snapshot at t=0, 30, 60, 90
    const session = recorder.openReplay();
    expect(session.snapshots.length).toBe(4);
    expect(session.snapshots[0]!.t).toBe(0);
    expect(session.snapshots[1]!.t).toBeCloseTo(30, 6);
    expect(session.snapshots[2]!.t).toBeCloseTo(60, 6);
    expect(session.snapshots[3]!.t).toBeCloseTo(90, 6);
  });

  it('records one command per tick, in tick order', () => {
    const { recorder } = runFlight(1); // 60 ticks
    const session = recorder.openReplay();
    expect(session.commands).toHaveLength(60);
    expect(session.commands[0]!.tick).toBe(0);
    expect(session.commands[59]!.tick).toBe(59);
    expect(session.commands.every((c) => c.vesselId === 1)).toBe(true);
  });

  it('records a launch marker on the first tick', () => {
    const { recorder } = runFlight(1);
    const session = recorder.openReplay();
    expect(session.markers[0]).toMatchObject({ t: 0, kind: 'launch', vesselId: 1 });
  });

  it('startTime/endTime bracket the recorded span', () => {
    const { recorder } = runFlight(2); // 120 ticks: t = 0 .. 119/60
    const session = recorder.openReplay();
    expect(session.startTime).toBe(0);
    expect(session.endTime).toBeCloseTo(119 / 60, 9);
  });

  it('seekTo clamps outside the recorded span', () => {
    const { recorder } = runFlight(1);
    const session = recorder.openReplay();
    const before = session.seekTo(-100);
    const atStart = session.seekTo(session.startTime);
    expect(before).toEqual(atStart);

    const after = session.seekTo(1e9);
    const atEnd = session.seekTo(session.endTime);
    expect(after).toEqual(atEnd);
  });
});

describe('startFromReplay', () => {
  it('reconstructs state at the branch point and hands back a fresh recorder', () => {
    const { recorder } = runFlight(60);
    const session = recorder.openReplay();
    const stepWorld = createFakeWorldStep();

    const { vessels, recorder: branch } = startFromReplay(session, 20, stepWorld);
    expect(vessels).toHaveLength(1);
    expect(vessels[0]!.id).toBe(1);

    // The branch is a brand new recorder: nothing recorded until its own tick() is called.
    expect(() => branch.openReplay()).toThrow();
    branch.tick(20, vessels.slice(), { ...NEUTRAL_INPUT, throttle: 0 });
    const branchSession = branch.openReplay();
    expect(branchSession.startTime).toBe(20);
    expect(branchSession.snapshots[0]!.vessels[0]!.position).toEqual(vessels[0]!.position);
  });
});
