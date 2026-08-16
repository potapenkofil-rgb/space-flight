import { describe, expect, it } from 'vitest';
import { createFakeVessel } from '../recording/testFixtures';
import { createAutosaveTrigger } from './autosave';
import { createInMemoryWorldStorage } from './storage';
import { createFakeSystemLibrary } from './testFixtures';
import { loadWorld, worldSavePath } from './worldSaves';

const system = createFakeSystemLibrary();

function worldAt(time: number) {
  return { name: 'ignored', time, activeVesselId: 1, vessels: [createFakeVessel(1, { soi: system.root })] };
}

describe('createAutosaveTrigger (PLAN.md §7 Agent F)', () => {
  it('autosaves on the first tick and then every intervalSeconds after that', () => {
    const storage = createInMemoryWorldStorage();
    const trigger = createAutosaveTrigger({ storage, intervalSeconds: 120, slotName: 'autosave' });

    expect(trigger.onTick(0, worldAt(0))).toBe(true);
    expect(trigger.onTick(60, worldAt(60))).toBe(false);
    expect(trigger.onTick(119.9, worldAt(119.9))).toBe(false);
    expect(trigger.onTick(120, worldAt(120))).toBe(true);
    expect(trigger.onTick(121, worldAt(121))).toBe(false);
    expect(trigger.onTick(240, worldAt(240))).toBe(true);

    const saved = loadWorld(storage, 'autosave', system);
    expect(saved.time).toBe(240);
  });

  it('onBeforeSeparation saves unconditionally and resets the interval timer', () => {
    const storage = createInMemoryWorldStorage();
    const trigger = createAutosaveTrigger({ storage, intervalSeconds: 120, slotName: 'autosave' });

    trigger.onTick(0, worldAt(0));
    trigger.onBeforeSeparation(worldAt(30)); // well before the next scheduled tick-autosave
    expect(loadWorld(storage, 'autosave', system).time).toBe(30);

    // The timer restarts from the separation save, not the original tick(0) save.
    expect(trigger.onTick(100, worldAt(100))).toBe(false); // only 70s since the separation save
    expect(trigger.onTick(150, worldAt(150))).toBe(true); // 120s since the separation save
  });

  it('writes to a dedicated slot, distinct from named player saves', () => {
    const storage = createInMemoryWorldStorage();
    const trigger = createAutosaveTrigger({ storage, slotName: 'autosave' });
    trigger.onTick(0, { ...worldAt(0), name: 'players-own-save-name' });
    expect(storage.read(worldSavePath('autosave'))).not.toBeNull();
    expect(storage.read(worldSavePath('players-own-save-name'))).toBeNull();
  });
});
