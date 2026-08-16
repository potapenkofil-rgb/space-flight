import { describe, expect, it, vi } from 'vitest';
import type { Body, PartDef, ReplayMarker, ReplaySession, Vessel } from '@karman/core';
import { mountReplayPanel } from './replayPanel';

const BODY: Body = {
  id: 'fake-terra',
  mu: 9.81e12,
  radius: 1_000_000,
  soiRadius: 1e9,
  rotationPeriod: 3600,
  atmosphere: null,
  parent: null,
  orbit: null,
  positionAt: () => ({ x: 0, y: 0 }),
  velocityAt: () => ({ x: 0, y: 0 }),
};

/** Minimal `PartDef` for the panel's charts — only `resources` is read here. */
const FAKE_TANK: PartDef = {
  id: 'fake_tank',
  name: { en: 'Fake Tank', ru: 'Fake Tank' },
  description: { en: '', ru: '' },
  category: 'tanks',
  dryMass: 300,
  resources: [{ id: 'fuel', capacity: 500 }],
  engine: null,
  dragArea: 1,
  nodeStrength: 1e6,
  maxLandingSpeed: 0,
  crossfeed: true,
  nodes: [],
  bounds: { w: 1, h: 1 },
  art: { viewBox: { w: 64, h: 64 }, svg: '<svg viewBox="0 0 64 64"></svg>' },
};

function fakeVessel(id: number, altitudeAboveRadius = 100_000): Vessel {
  return {
    id,
    parts: [{ id: 1, partId: 'fake_tank', def: FAKE_TANK, position: { x: 0, y: 0 }, rotation: 0, resources: { fuel: 500 } }],
    joints: [],
    stages: [{ index: 0, partIds: [1] }],
    currentStage: 0,
    position: { x: 0, y: BODY.radius + altitudeAboveRadius },
    velocity: { x: 100, y: 0 },
    rotation: 0,
    angularVelocity: 0,
    soi: BODY,
    railOrbit: null,
    mass: { total: 1000, com: { x: 0, y: 0 }, inertia: 100 },
  };
}

const MARKERS: ReplayMarker[] = [
  { t: 0, kind: 'launch', vesselId: 1 },
  { t: 50, kind: 'stage-separation', vesselId: 1 },
  { t: 100, kind: 'landing', vesselId: 1 },
];

function fakeSession(): ReplaySession {
  return {
    snapshots: [{ t: 0, vessels: [fakeVessel(1)] }],
    commands: [],
    markers: MARKERS,
    startTime: 0,
    endTime: 100,
    seekTo: (t) => [fakeVessel(1, 100_000 - t * 500)],
  };
}

function fireTrackEvent(track: Element, type: string, clientX: number, pointerId = 1): void {
  const event = new Event(type) as Event & { clientX: number; pointerId: number };
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  track.dispatchEvent(event);
}

describe('mountReplayPanel', () => {
  it('renders the panel, a marker per recorded event, and one canvas per chart', () => {
    const root = document.createElement('div');
    const panel = mountReplayPanel(root, {
      session: fakeSession(),
      vesselId: 1,
      formatTime: (t) => `${t.toFixed(1)}s`,
      t: (key) => key,
    });

    expect(root.querySelector('[data-testid="replay-panel"]')).not.toBeNull();
    expect(root.querySelectorAll('.replay-timeline-marker')).toHaveLength(3);
    expect(root.querySelectorAll('.replay-chart canvas')).toHaveLength(4);
    expect(root.querySelector('[data-testid="replay-marker-stage-separation"]')).not.toBeNull();

    panel.unmount();
    expect(root.querySelector('[data-testid="replay-panel"]')).toBeNull();
  });

  it('seeking the timeline calls onSeek with the reconstructed vessels', () => {
    const root = document.createElement('div');
    const onSeek = vi.fn();
    mountReplayPanel(root, {
      session: fakeSession(),
      vesselId: 1,
      formatTime: (t) => `${t}`,
      t: (key) => key,
      onSeek,
    });

    const track = root.querySelector('[data-testid="replay-timeline-track"]') as HTMLElement;
    track.getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireTrackEvent(track, 'pointerdown', 100); // 50% across a [0,100] span => t=50
    expect(onSeek).toHaveBeenCalledTimes(1);
    const [seekedTime, vessels] = onSeek.mock.calls[0]!;
    expect(seekedTime).toBeCloseTo(50, 6);
    expect(vessels).toHaveLength(1);
  });

  it('"start from here" reports the currently scrubbed time', () => {
    const root = document.createElement('div');
    const onStartFromHere = vi.fn();
    mountReplayPanel(root, {
      session: fakeSession(),
      vesselId: 1,
      formatTime: (t) => `${t}`,
      t: (key) => key,
      onStartFromHere,
    });

    const track = root.querySelector('[data-testid="replay-timeline-track"]') as HTMLElement;
    track.getBoundingClientRect = () =>
      ({ left: 0, right: 100, width: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireTrackEvent(track, 'pointerdown', 25); // 25% across => t=25

    const button = root.querySelector('[data-testid="replay-start-from-here"]') as HTMLButtonElement;
    button.click();

    expect(onStartFromHere).toHaveBeenCalledTimes(1);
    const [startTime] = onStartFromHere.mock.calls[0]!;
    expect(startTime).toBeCloseTo(25, 6);
  });

  it('uses t() for every player-visible label', () => {
    const root = document.createElement('div');
    const seen: string[] = [];
    mountReplayPanel(root, {
      session: fakeSession(),
      vesselId: 1,
      formatTime: (t) => `${t}`,
      t: (key) => {
        seen.push(key);
        return `[${key}]`;
      },
    });
    expect(seen).toContain('REPLAY_TIMELINE');
    expect(seen).toContain('REPLAY_START_FROM_HERE');
    expect(seen).toContain('REPLAY_CHART_ALTITUDE');
    expect(root.textContent).toContain('[REPLAY_TIMELINE]');
  });
});
