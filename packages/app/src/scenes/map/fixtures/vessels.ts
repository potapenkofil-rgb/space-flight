/**
 * FIXTURE — two vessels-on-rails around Terra, standing in for a real
 * `Vessel` registry (Agent F's multi-vessel registry, PLAN.md §7 Agent F,
 * doesn't exist yet) so the map scene has something to switch focus
 * between (PLAN.md §7 Agent D: "switching focus... between vessels").
 * Orbits are precomputed constants (a "precomputed ellipse" per the
 * task brief), not derived from `orbitFromState` — no core call needed.
 */
import type { Orbit } from '@karman/core';
import { TERRA } from './bodies';

export interface MapVesselFixture {
  readonly id: number;
  readonly nameKey: string;
  readonly bodyId: string;
  readonly orbit: Orbit;
}

/** A stable 100 km circular parking orbit around Terra. */
export const CIRCULAR_100KM: MapVesselFixture = Object.freeze({
  id: 1,
  nameKey: 'MAP_VESSEL_STATION',
  bodyId: TERRA.id,
  orbit: Object.freeze({
    a: TERRA.radius + 100_000,
    e: 0,
    argPe: 0,
    m0: 0.6,
    epoch: 0,
    mu: TERRA.mu,
    dir: 1,
  }),
});

/** An eccentric transfer-style orbit (apoapsis reaching well out toward Luna's distance) for a second vessel. */
export const TRANSFER_ELLIPSE: MapVesselFixture = Object.freeze({
  id: 2,
  nameKey: 'MAP_VESSEL_PROBE',
  bodyId: TERRA.id,
  orbit: Object.freeze({
    a: 3_400_000,
    e: 0.68,
    argPe: Math.PI * 0.15,
    m0: 2.1,
    epoch: 0,
    mu: TERRA.mu,
    dir: 1,
  }),
});

export const MAP_VESSEL_FIXTURES: readonly MapVesselFixture[] = Object.freeze([
  CIRCULAR_100KM,
  TRANSFER_ELLIPSE,
]);

export function getMapVesselFixture(id: number): MapVesselFixture {
  const vessel = MAP_VESSEL_FIXTURES.find((v) => v.id === id);
  if (!vessel) throw new Error(`getMapVesselFixture: unknown vessel id ${id}`);
  return vessel;
}
