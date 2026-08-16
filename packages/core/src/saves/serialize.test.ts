import { describe, expect, it } from 'vitest';
import type { Orbit } from '../orbits/types';
import { createFakeVessel } from '../recording/testFixtures';
import { parseWorld, serializeWorld } from './serialize';
import { createFakeSystemLibrary } from './testFixtures';

const system = createFakeSystemLibrary();
const BODY_ID = system.root.id;

const ORBIT: Orbit = {
  a: 1_400_000,
  e: 0.02,
  argPe: 0.31415,
  m0: 1.2,
  epoch: 123.5,
  mu: system.root.mu,
  dir: 1,
};

describe('serializeWorld / parseWorld', () => {
  it('round-trips a world, including a vessel on a rail orbit, exactly', () => {
    const vessel = createFakeVessel(1, { soi: system.root, railOrbit: ORBIT });
    const world = { name: 'test-world', time: 42.5, activeVesselId: 1, vessels: [vessel] };

    const json = serializeWorld(world);
    const loaded = parseWorld(json, system);

    expect(loaded.name).toBe('test-world');
    expect(loaded.time).toBe(42.5);
    expect(loaded.activeVesselId).toBe(1);
    expect(loaded.vessels).toHaveLength(1);
    // The acceptance criterion (PLAN.md §7 Agent F): loading gives back the same orbit.
    expect(loaded.vessels[0]!.railOrbit).toEqual(ORBIT);
    expect(loaded.vessels[0]!.soi.id).toBe(BODY_ID);
    expect(loaded.vessels[0]!.position).toEqual(vessel.position);
    expect(loaded.vessels[0]!.velocity).toEqual(vessel.velocity);
  });

  it('produces pretty-printed, key-sorted, deterministic JSON', () => {
    const vessel = createFakeVessel(1, { soi: system.root });
    const world = { name: 'w', time: 0, activeVesselId: 1, vessels: [vessel] };

    const first = serializeWorld(world);
    const second = serializeWorld(world);
    expect(first).toBe(second); // byte-identical: no Map/object iteration-order dependency

    expect(first).toContain('\n  "activeVesselId"'); // 2-space indent
    const nameIndex = first.indexOf('"name"');
    const timeIndex = first.indexOf('"time"');
    const activeIndex = first.indexOf('"activeVesselId"');
    // Alphabetical key order at the top level: activeVesselId < name < time < vessels < version.
    expect(activeIndex).toBeLessThan(nameIndex);
    expect(nameIndex).toBeLessThan(timeIndex);
  });

  it('is independent of vessel array order (sorted by id on write)', () => {
    const v1 = createFakeVessel(5, { soi: system.root });
    const v2 = createFakeVessel(1, { soi: system.root });
    const a = serializeWorld({ name: 'w', time: 0, activeVesselId: 1, vessels: [v1, v2] });
    const b = serializeWorld({ name: 'w', time: 0, activeVesselId: 1, vessels: [v2, v1] });
    expect(a).toBe(b);
  });

  it('rejects a world containing a non-finite number', () => {
    const vessel = createFakeVessel(1, { soi: system.root, rotation: NaN });
    expect(() => serializeWorld({ name: 'w', time: 0, activeVesselId: 1, vessels: [vessel] })).toThrow(
      /non-finite/
    );
  });

  it('rejects malformed JSON with a clear error', () => {
    expect(() => parseWorld('{not json', system)).toThrow(/invalid JSON/);
  });

  it('rejects an unsupported save version', () => {
    const json = JSON.stringify({ version: 999, name: 'w', time: 0, activeVesselId: null, vessels: [] });
    expect(() => parseWorld(json, system)).toThrow(/unsupported save version/);
  });

  it('rejects a vessel referencing an unknown body', () => {
    const json = JSON.stringify({
      version: 1,
      name: 'w',
      time: 0,
      activeVesselId: null,
      vessels: [
        {
          id: 1,
          parts: [],
          joints: [],
          stages: [],
          currentStage: 0,
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          rotation: 0,
          angularVelocity: 0,
          soi: 'does-not-exist',
          railOrbit: null,
          mass: { total: 1, com: { x: 0, y: 0 }, inertia: 1 },
        },
      ],
    });
    expect(() => parseWorld(json, system)).toThrow(/unknown body/);
  });
});
