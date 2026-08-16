/**
 * The cross-scene game session (PLAN.md §7 stage 2 integration): the single
 * shared piece of state that lets the hangar hand a real, flyable `Vessel` to
 * the flight scene, and lets the flight and map scenes read/steer the *same*
 * vessel instead of each keeping their own disconnected fixture — this is
 * what makes "build in the hangar → launch → see it on the map" a real
 * pipeline instead of three separately-demoable scenes (PLAN.md §8 steps 2-6).
 *
 * Deliberately minimal: one active vessel, the loaded content, and
 * simulation time. A real multi-vessel registry (`@karman/core`'s
 * `saves/registry.ts`, Agent F's zone) is wired into the map scene's vessel
 * list (see `scenes/map/vesselSource.ts`); this module only tracks which one
 * is *currently being flown*.
 */
import { createVesselRegistry, type Vessel, type VesselRegistry } from '@karman/core';
import { loadContent, type ContentLoadResult } from '../data/content';

export interface GameSession {
  /** The loaded part/system content — loaded once, shared by every scene. */
  readonly content: ContentLoadResult;
  /** Every vessel that exists right now (the flown one plus anything left parked on rails). */
  readonly registry: VesselRegistry;
  /** Simulation time, s — advances only while the flight scene is stepping (PLAN.md §3.2). */
  simTime: number;
}

let session: GameSession | null = null;

/** Returns the process-wide session, creating it (and loading content) on first use. */
export function getSession(): GameSession {
  if (!session) {
    session = { content: loadContent(), registry: createVesselRegistry([]), simTime: 0 };
  }
  return session;
}

/** Replaces the actively-flown vessel — called once, right after launch from the hangar (PLAN.md §8 step 4). */
export function setActiveVessel(vessel: Vessel, simTime: number): void {
  const s = getSession();
  if (s.registry.get(vessel.id)) s.registry.remove(vessel.id);
  s.registry.add(vessel);
  s.registry.setActive(vessel.id);
  s.simTime = simTime;
}

/** The vessel currently being flown, or `null` before anything has launched. */
export function getActiveVessel(): Vessel | null {
  const s = getSession();
  const id = s.registry.activeVesselId;
  return id === null ? null : (s.registry.get(id) ?? null);
}

/** Test-only: resets the module-level session singleton so each test starts clean. */
export function resetSessionForTests(): void {
  session = null;
}
