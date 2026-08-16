/**
 * Autosave policy (PLAN.md §7 Agent F): once every 2 minutes of simulation
 * time, and unconditionally right before every stage separation. This module
 * only owns the *decision* — the flight loop (Agent D's territory) calls
 * `onTick` every physics tick and `onBeforeSeparation` right before it fires
 * a separator/lets a structural break through, both with the current `World`
 * snapshot to save.
 */
import { saveWorld } from './worldSaves';
import type { WorldStorage } from './storage';
import type { World } from './types';

export interface AutosaveOptions {
  readonly storage: WorldStorage;
  /** How often to autosave on a timer, s of simulation time. PLAN.md §7 mandates 2 minutes; that's also the default. */
  readonly intervalSeconds?: number;
  /** Save slot name to write autosaves under. Kept distinct from a player's named saves by default. */
  readonly slotName?: string;
}

export interface AutosaveTrigger {
  /**
   * Call once per physics tick with the current simulation time and world.
   * Writes an autosave if `intervalSeconds` has elapsed since the last one
   * (including the very first call, so a session always has at least one
   * autosave once flight starts).
   *
   * @returns `true` if this call wrote an autosave
   */
  onTick(t: number, world: World): boolean;
  /** Call immediately before a stage separation is applied — writes an autosave unconditionally and resets the timer. */
  onBeforeSeparation(world: World): void;
}

const DEFAULT_INTERVAL_SECONDS = 120;
const DEFAULT_SLOT_NAME = 'autosave';

export function createAutosaveTrigger(options: AutosaveOptions): AutosaveTrigger {
  const { storage } = options;
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  const slotName = options.slotName ?? DEFAULT_SLOT_NAME;
  if (intervalSeconds <= 0) {
    throw new RangeError('createAutosaveTrigger: intervalSeconds must be positive');
  }

  let lastSaveTime: number | null = null;

  function write(t: number, world: World): void {
    saveWorld(storage, { ...world, name: slotName });
    lastSaveTime = t;
  }

  return {
    onTick(t, world) {
      if (lastSaveTime === null || t - lastSaveTime >= intervalSeconds) {
        write(t, world);
        return true;
      }
      return false;
    },
    onBeforeSeparation(world) {
      write(world.time, world);
    },
  };
}
