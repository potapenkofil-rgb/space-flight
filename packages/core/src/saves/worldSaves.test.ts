import { describe, expect, it } from 'vitest';
import type { Orbit } from '../orbits/types';
import { createFakeVessel } from '../recording/testFixtures';
import { createInMemoryWorldStorage } from './storage';
import { createFakeSystemLibrary } from './testFixtures';
import { deleteWorldSave, listWorldSaves, loadWorld, saveWorld, worldSavePath } from './worldSaves';

const system = createFakeSystemLibrary();

const ORBIT: Orbit = { a: 6_000_000, e: 0.02, argPe: 0, m0: 0, epoch: 0, mu: system.root.mu, dir: 1 };

describe('saveWorld / loadWorld (PLAN.md §6.3)', () => {
  it('reloading a saved world gives back the same orbit (acceptance criterion, PLAN.md §7 Agent F)', () => {
    const storage = createInMemoryWorldStorage();
    const vessel = createFakeVessel(1, { soi: system.root, railOrbit: ORBIT });
    const world = { name: 'my-flight', time: 500, activeVesselId: 1, vessels: [vessel] };

    saveWorld(storage, world);
    const loaded = loadWorld(storage, 'my-flight', system);

    expect(loaded.vessels[0]!.railOrbit).toEqual(ORBIT);
    expect(loaded.time).toBe(500);
  });

  it('writes to the exact path PLAN.md §6.3 specifies', () => {
    const storage = createInMemoryWorldStorage();
    const vessel = createFakeVessel(1, { soi: system.root });
    saveWorld(storage, { name: 'foo', time: 0, activeVesselId: 1, vessels: [vessel] });
    expect(storage.read(worldSavePath('foo'))).not.toBeNull();
    expect(worldSavePath('foo')).toBe('saves/worlds/foo/world.json');
  });

  it('throws loading a save that does not exist', () => {
    const storage = createInMemoryWorldStorage();
    expect(() => loadWorld(storage, 'nope', system)).toThrow(/no saved world/);
  });

  it('listWorldSaves lists every save name, sorted', () => {
    const storage = createInMemoryWorldStorage();
    const vessel = createFakeVessel(1, { soi: system.root });
    saveWorld(storage, { name: 'zeta', time: 0, activeVesselId: 1, vessels: [vessel] });
    saveWorld(storage, { name: 'alpha', time: 0, activeVesselId: 1, vessels: [vessel] });
    expect(listWorldSaves(storage)).toEqual(['alpha', 'zeta']);
  });

  it('deleteWorldSave removes a save', () => {
    const storage = createInMemoryWorldStorage();
    const vessel = createFakeVessel(1, { soi: system.root });
    saveWorld(storage, { name: 'gone', time: 0, activeVesselId: 1, vessels: [vessel] });
    deleteWorldSave(storage, 'gone');
    expect(listWorldSaves(storage)).toEqual([]);
  });
});
