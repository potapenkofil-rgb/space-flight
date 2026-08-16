/**
 * FIXTURE — Terra/Luna body data, hand-copied from PLAN.md §5.7, standing in
 * for `@karman/core`'s `SystemLibrary` (Agent E's `data/systems/karman.json`
 * loader, which doesn't exist yet). Scoped to `scenes/map/**` and
 * `scenes/flight/**` only — once Agent E's loader lands, the orchestrator
 * swaps the one import site in `MapScene.ts`/`FlightScene.ts` for a real
 * `SystemLibrary` and this file goes away.
 *
 * Deliberately does *not* implement `Body.positionAt`/`velocityAt` via
 * `@karman/core`'s Kepler machinery (still `not implemented`) — Luna's
 * position here is a fixed placeholder point, good enough for the map demo's
 * SOI-boundary and body-switching visuals, not for a real transfer plot.
 */
import type { Atmosphere } from '@karman/core';
import type { Vec2 } from '@karman/core';

export interface MapBodyFixture {
  readonly id: string;
  readonly nameKey: string; // i18n key, resolved by the UI layer — never a hardcoded string here
  readonly mu: number;
  readonly radius: number;
  readonly soiRadius: number;
  readonly atmosphere: Atmosphere | null;
  /** Fixed world position, m — a placeholder until real ephemeris (Agent A) is wired in. */
  readonly position: Vec2;
  readonly parentId: string | null;
}

export const TERRA: MapBodyFixture = Object.freeze({
  id: 'terra',
  nameKey: 'MAP_BODY_TERRA',
  mu: 9.81e12,
  radius: 1_000_000,
  soiRadius: Number.POSITIVE_INFINITY, // root body: no parent to have a finite SOI against
  atmosphere: Object.freeze({ rho0: 1.225, scaleHeight: 7_000, top: 60_000 }) satisfies Atmosphere,
  position: Object.freeze({ x: 0, y: 0 }),
  parentId: null,
});

export const LUNA: MapBodyFixture = Object.freeze({
  id: 'luna',
  nameKey: 'MAP_BODY_LUNA',
  mu: 1.44e11,
  radius: 300_000,
  soiRadius: 1_108_000, // PLAN.md §5.7
  atmosphere: null,
  position: Object.freeze({ x: 6_000_000, y: 0 }), // a = 6,000,000 m per PLAN.md §5.7, placed on the +x axis
  parentId: 'terra',
});

export const MAP_BODY_FIXTURES: readonly MapBodyFixture[] = Object.freeze([TERRA, LUNA]);

export function getMapBodyFixture(id: string): MapBodyFixture {
  const body = MAP_BODY_FIXTURES.find((b) => b.id === id);
  if (!body) throw new Error(`getMapBodyFixture: unknown body id "${id}"`);
  return body;
}
