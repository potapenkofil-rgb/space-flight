/**
 * Turns a hangar `BuildState` into a real, flyable `Vessel` sitting on the
 * pad (PLAN.md §8 step 4: launch). The only place `scenes/build`'s
 * `toVessel` gets called with a *real* body/position, as opposed to the
 * hangar's own preview calls against an inert placeholder.
 */
import { computeContactPoints, computeMass, type Body, type PartLibrary, type Vessel } from '@karman/core';
import { toVessel, type BuildState } from '../scenes/build/state';

let nextVesselId = 1;

/**
 * Shifts every part's local `y` up by `-lowestY` so the vessel's local
 * origin `(0, 0)` becomes its true lowest contact point, in place.
 * `Vessel.position` is the world placement of that local origin — the rest
 * of the sim (HUD altitude, the pad-rest regression test, `evaluateLanding`)
 * all read `Vessel.position` as "where the vessel is touching down", which
 * only holds when the origin actually *is* the base.
 *
 * The hangar's local origin is simply wherever the assembly root ended up,
 * which is only "the bottom of the rocket" when the player happened to build
 * bottom-up. Building nose-first and extending *downward* (pod, then a tank
 * below it, then an engine below that — an equally natural order the hangar
 * allows) leaves the root at the *top* of the stack instead, several metres
 * above the vessel's actual base (`packages/core/src/flight/contact.ts`'s
 * per-part corners already handle each part's own possible 180° attach-flip
 * correctly; this is the vessel-wide analogue of that same mistake). Placing
 * the vessel at `(0, body.radius)` unconditionally without this re-anchor,
 * as the previous version of `launchVessel` did, buried that lower structure
 * metres into the ground the instant the root wasn't also the base — a
 * massive, sourceless initial penetration that the ground-contact spring
 * then answers with a violent, asymmetric kick. Pure translation: total
 * mass, inertia (about the vessel's own centre of mass) and every relative
 * geometry (thrust arm, drag, joints) are unaffected — only which point the
 * coordinate system calls `(0, 0)`. See report.
 */
function reanchorToBase(vessel: Vessel): void {
  let lowestY = 0;
  for (const point of computeContactPoints(vessel)) {
    if (point.localPos.y < lowestY) lowestY = point.localPos.y;
  }
  if (lowestY === 0) return;
  for (const part of vessel.parts) {
    part.position = { x: part.position.x, y: part.position.y - lowestY };
  }
}

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
 * sitting on the ground is always off-rails). Re-anchors the vessel's local
 * origin to its true base first (see {@link reanchorToBase}) so `(0,
 * body.radius)` actually means "base on the pad", regardless of which part
 * the hangar happened to use as the assembly root.
 */
export function launchVessel(state: BuildState, library: PartLibrary, body: Body): Vessel {
  const vessel = toVessel(state, library, body, nextVesselId++);
  vessel.rotation = 0;
  reanchorToBase(vessel);
  vessel.mass = computeMass(vessel);
  vessel.position = { x: 0, y: body.radius };
  vessel.velocity = padVelocity(vessel.position, body.rotationPeriod);
  vessel.angularVelocity = 0;
  vessel.railOrbit = null;
  return vessel;
}
