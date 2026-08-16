/**
 * Real system/vessel data for the map scene (PLAN.md §7 stage-2 integration,
 * replacing `fixtures/bodies.ts`/`fixtures/vessels.ts`): every body from the
 * loaded `SystemLibrary` content and every vessel from the shared session's
 * `VesselRegistry` (`packages/core/src/saves/registry.ts`), with each
 * vessel's current display orbit — its real `railOrbit` when on-rails, or
 * the *osculating* orbit derived from its instantaneous state via
 * `orbitFromState` when it's still off-rails (PLAN.md §3.3: off-rails
 * vessels have no `railOrbit`, but a Keplerian "current orbit" is still a
 * well-defined, useful thing to show on the map).
 */
import { orbitFromState, type Body, type Orbit, type Vessel } from '@karman/core';
import { getSession } from '../../game/session';

export interface MapBodyView {
  readonly id: string;
  /** i18n key for display (PLAN.md §6.1: bodies carry no name field of their own, unlike parts) — falls back to the raw id for anything outside the base system (e.g. a modded body), which is the one gap this leaves for mods; see the orchestrator report. */
  readonly nameKey: string;
  readonly body: Body;
  readonly parentId: string | null;
}

const BODY_NAME_KEY: Readonly<Record<string, string>> = {
  terra: 'MAP_BODY_TERRA',
  luna: 'MAP_BODY_LUNA',
};

/** Every body in the loaded system, for the focus switcher and the trajectory predictor. */
export function listMapBodies(): readonly MapBodyView[] {
  return getSession().content.bodies.map((body) => ({
    id: body.id,
    nameKey: BODY_NAME_KEY[body.id] ?? body.id,
    body,
    parentId: body.parent?.id ?? null,
  }));
}

export interface MapVesselView {
  readonly id: number;
  readonly vessel: Vessel;
  readonly bodyId: string;
  readonly orbit: Orbit;
}

/** Every vessel currently in the registry, each with its display orbit at `simTime` (see module doc). */
export function listMapVessels(simTime: number): readonly MapVesselView[] {
  return getSession().registry.vessels.map((vessel) => ({
    id: vessel.id,
    vessel,
    bodyId: vessel.soi.id,
    orbit: vessel.railOrbit ?? orbitFromState(vessel.position, vessel.velocity, vessel.soi.mu, simTime),
  }));
}
