/**
 * Turns a hangar `BuildState` into a real, flyable `Vessel` sitting on the
 * pad (PLAN.md §8 step 4: launch). The only place `scenes/build`'s
 * `toVessel` gets called with a *real* body/position, as opposed to the
 * hangar's own preview calls against an inert placeholder.
 */
import { computeMass, type Body, type PartLibrary, type Vessel } from '@karman/core';
import { toVessel, type BuildState } from '../scenes/build/state';

let nextVesselId = 1;

/**
 * A pad's inertial-frame velocity at world position `pos` on a body
 * rotating with period `rotationPeriod` (s): `v = ω × r`. A vessel "at rest
 * on the pad" is at rest *relative to the spinning ground*, not relative to
 * the inertial frame — every position/velocity in `Vessel` is inertial
 * (PLAN.md §5.1's gravity/contact math and `FlightEnvironment.atmosphereVelocity`,
 * which uses this exact formula, both assume it) — so a vessel launched with
 * `velocity: {0,0}` starts hundreds of m/s out of sync with the ground it's
 * standing on, which the ground-contact spring then fights every tick
 * (caught via the "resting vessel doesn't drift" regression test).
 */
function padVelocity(pos: { readonly x: number; readonly y: number }, rotationPeriod: number): { x: number; y: number } {
  const omega = rotationPeriod > 0 ? (2 * Math.PI) / rotationPeriod : 0;
  return { x: -omega * pos.y, y: omega * pos.x };
}

/**
 * Places the assembled vessel upright on `body`'s surface at the north pole
 * (world `(0, body.radius)`, rotation `0` — VesselSnapshot's convention:
 * "0 = pointing along +y, up off the pad"), at rest relative to the ground
 * (see {@link padVelocity}), off-rails (`railOrbit: null` — PLAN.md §3.3:
 * sitting on the ground is always off-rails).
 */
export function launchVessel(state: BuildState, library: PartLibrary, body: Body): Vessel {
  const vessel = toVessel(state, library, body, nextVesselId++);
  vessel.position = { x: 0, y: body.radius };
  vessel.velocity = padVelocity(vessel.position, body.rotationPeriod);
  vessel.rotation = 0;
  vessel.angularVelocity = 0;
  vessel.railOrbit = null;
  vessel.mass = computeMass(vessel);
  return vessel;
}
