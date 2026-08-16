/**
 * Regression coverage for the hangar's "top-down" build order — capsule
 * placed first as the assembly root, then a tank attached *below* it, then
 * an engine attached below that. This is the order `padRest.test.ts` already
 * uses (and the order a player naturally reaches for when starting "what
 * sits on top" first), but neither that file nor any e2e spec ever asserted
 * on the engine's *orientation* — every `tests/e2e/helpers.ts` builder and
 * `padRest.test.ts` itself only check that the vessel stays upright and on
 * the ground, which is true whichever way the engine is flipped.
 *
 * The bug this guards against: `scenes/build/state.ts`'s `bestOwnNode` used
 * to always pick a held part's most-downward-facing node, regardless of
 * which way the *target* node it was mating with actually pointed. Building
 * bottom-up that's harmless (it happens to be the right choice), but
 * attaching a part *below* an already-downward-facing open node forced a
 * needless 180° flip — invisible for a symmetric tank, catastrophic for an
 * engine, whose thrust direction (`fuel.ts`'s `baseDirection`, the part's own
 * local +Y rotated by its `rotation`, per PLAN.md §5.5) then points into the
 * ground instead of off the pad.
 */
import { describe, expect, it } from 'vitest';
import { computeContactPoints, v2, type ControlInput } from '@karman/core';
import { launchVessel } from '../../game/launch';
import { loadContent } from '../../data/content';
import { createEmptyState, placeRoot, findAttachCandidates, attachPart } from '../build/state';
import { INITIAL_FLIGHT_SIM_STATE, stepFlightSim } from './flightClock';

const FULL_THROTTLE: ControlInput = { throttle: 1, rotate: 0, rcsTranslate: { x: 0, y: 0 }, sas: false, stage: false };

/**
 * Builds the rocket nose-first: capsule as the assembly root, a tank
 * attached below it, then the engine attached below the tank — deliberately
 * the reverse order of `padRest.test.ts`'s own `padRocket()` (engine root,
 * built upward), which is exactly why that helper never caught this.
 */
function topDownRocket() {
  const content = loadContent();
  const library = content.library;
  let state = placeRoot(createEmptyState(), library, 'pod_command');
  for (const partId of ['tank_s1', 'engine_launch']) {
    const candidate = findAttachCandidates(state, library, partId)[0];
    if (!candidate) throw new Error(`nothing to attach ${partId} to`);
    state = attachPart(state, library, partId, candidate);
  }
  const terra = content.system.get('terra');
  return { vessel: launchVessel(state, library, terra), terra };
}

describe('a vessel built top-down (capsule -> tank -> engine)', () => {
  it('stacks engine below tank below capsule, in world Y, on the pad', () => {
    const { vessel } = topDownRocket();
    const byPart = (id: string) => {
      const part = vessel.parts.find((p) => p.partId === id);
      if (!part) throw new Error(`missing part ${id} in assembled vessel`);
      return part;
    };
    // On the pad the vessel starts upright (rotation 0), so a part's local
    // (x, y) *is* its world offset from the vessel's position — no rotation
    // to account for yet.
    const engineY = byPart('engine_launch').position.y;
    const tankY = byPart('tank_s1').position.y;
    const podY = byPart('pod_command').position.y;
    expect(engineY).toBeLessThan(tankY);
    expect(tankY).toBeLessThan(podY);
  });

  it('gives the engine the lowest ground-contact point of the whole vessel', () => {
    const { vessel } = topDownRocket();
    const points = computeContactPoints(vessel);
    expect(points.length).toBeGreaterThan(0);
    const lowest = points.reduce((min, p) => (p.localPos.y < min.localPos.y ? p : min));
    const engine = vessel.parts.find((p) => p.partId === 'engine_launch');
    if (!engine) throw new Error('expected an engine part');
    expect(lowest.partId).toBe(engine.id);
  });

  it("points the engine's thrust away from the planet's centre, not into the ground", () => {
    const { vessel } = topDownRocket();
    const engine = vessel.parts.find((p) => p.def.engine !== null);
    if (!engine) throw new Error('expected an engine part');
    // Same formula as `fuel.ts`'s `EngineBurn.baseDirection`: the engine's own
    // local +Y rotated by its part rotation, then by the vessel's rotation to
    // get a world-frame vector.
    const baseDirectionLocal = v2.rot({ x: 0, y: 1 }, engine.rotation);
    const thrustWorld = v2.rot(baseDirectionLocal, vessel.rotation);
    const outward = v2.norm(vessel.position);
    expect(v2.dot(thrustWorld, outward)).toBeGreaterThan(0.9);
  });

  it('climbs at full throttle instead of driving itself into the ground', () => {
    const { vessel, terra } = topDownRocket();
    let sim = INITIAL_FLIGHT_SIM_STATE;
    let simTime = 0;
    const startAltitude = v2.len(vessel.position) - terra.radius;

    // 5 s of full-throttle burn is well past liftoff for this vessel's TWR
    // and short enough to stay off-rails throughout.
    for (let tick = 0; tick < 300; tick += 1) {
      const result = stepFlightSim(vessel, sim, simTime, 1 / 60, 0, FULL_THROTTLE);
      sim = result.state;
      simTime = result.simTime;
    }

    const altitude = v2.len(vessel.position) - terra.radius;
    expect(altitude).toBeGreaterThan(startAltitude + 50);
  });
});
