/**
 * The flight scene's own read-only view of "what's flying right now" — a
 * narrow projection of the fields the HUD/camera/plume actually need, not
 * `@karman/core`'s full `Vessel` (which needs `computeMass`, engine specs
 * from a `PartLibrary`, etc. — Agent B/C/E territory, and `computeMass`
 * itself still throws `not implemented`).
 *
 * In real wiring (once other agents' branches land), the orchestrator
 * derives a `VesselSnapshot` from a real `Vessel` + `FlightEnvironment` each
 * tick; for now `fixtures/ascent.ts` produces one directly from simulation
 * time. Either way, `FlightScene.ts`/`ui/flight/FlightHud.ts` only ever see
 * this shape, so swapping the source is a one-line change at the call site.
 */
import type { Vec2 } from '@karman/core';

export interface VesselSnapshot {
  /** Position relative to the current body's centre, m. */
  readonly position: Vec2;
  /** Velocity relative to the current body's centre, m/s. */
  readonly velocity: Vec2;
  /** Vessel orientation, rad (0 = pointing along +y, "up" off the pad). */
  readonly rotation: number;
  /** Height above the surface directly below, m. */
  readonly altitude: number;
  /** Commanded throttle, `0..1`. */
  readonly throttle: number;
  /** Ambient pressure fraction, `0` (vacuum) to `1` (sea level) — PLAN.md §5.2. */
  readonly ambientPressure: number;
  /** Current load factor, g (1 = standing still at the body's surface gravity). */
  readonly gForce: number;
  /** SAS enabled. */
  readonly sas: boolean;
  /** 1-based index of the stage about to fire, and how many stages remain including it. */
  readonly stageIndex: number;
  readonly stageCount: number;
  /** Remaining propellant in the active stage, `0..1`. */
  readonly fuelFraction: number;
  /** Thrust-to-weight ratio this tick (0 with the engine off). */
  readonly twr: number;
  /** True exactly on the tick a stage separated (drives the camera shake + a HUD flash), edge-triggered like `ControlInput.stage`. */
  readonly justStaged: boolean;
  /** Vessel's largest dimension, m — used to size the flight camera's max zoom (PLAN.md §7 Agent D). */
  readonly vesselSpanMeters: number;
}

/** The body the flight scene is currently flying at — the render-facing subset of `@karman/core`'s `Body`. */
export interface FlightBodyView {
  readonly radius: number;
  readonly atmosphereTopMeters: number | null;
  readonly hasAtmosphere: boolean;
}
