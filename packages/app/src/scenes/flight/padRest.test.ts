/**
 * A vessel standing on the pad with the engine off must stay standing: the
 * rocket's long axis stays along the local vertical and its base stays on the
 * ground. This is the one thing a player sees before anything else happens,
 * and no other test covers it — the core's own resting test uses a stub
 * vessel, and the e2e specs assert on HUD numbers, not on attitude.
 */
import { describe, expect, it } from 'vitest';
import { v2 } from '@karman/core';
import { launchVessel } from '../../game/launch';
import { loadContent } from '../../data/content';
import { createEmptyState, placeRoot, findAttachCandidates, attachPart } from '../build/state';
import { INITIAL_FLIGHT_SIM_STATE, stepFlightSim } from './flightClock';
import type { ControlInput } from '@karman/core';

const IDLE: ControlInput = { throttle: 0, rotate: 0, rcsTranslate: { x: 0, y: 0 }, sas: false, stage: false };

function padRocket() {
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

describe('a vessel resting on the pad', () => {
  it('stays aligned with the local vertical for 10 s of idle simulation', () => {
    const { vessel } = padRocket();
    let sim = INITIAL_FLIGHT_SIM_STATE;

    for (let tick = 0; tick < 600; tick += 1) {
      sim = stepFlightSim(vessel, sim, tick / 60, 1 / 60, 0, IDLE).state;
    }

    // `Vessel.rotation` is measured from +y (see `fuel.ts`'s thrust base
    // direction); the local vertical at world position `p` is `p` normalised,
    // so the tilt is the angle between the vessel's own up and that vertical.
    const up = v2.rot({ x: 0, y: 1 }, vessel.rotation);
    const localVertical = v2.norm(vessel.position);
    const tiltDeg = (Math.acos(Math.min(1, v2.dot(up, localVertical))) * 180) / Math.PI;

    expect(tiltDeg).toBeLessThan(5);
  });

  it('does not sink into the ground or float off it', () => {
    const { vessel, terra } = padRocket();
    let sim = INITIAL_FLIGHT_SIM_STATE;

    for (let tick = 0; tick < 600; tick += 1) {
      sim = stepFlightSim(vessel, sim, tick / 60, 1 / 60, 0, IDLE).state;
    }

    const altitude = v2.len(vessel.position) - terra.radius;
    expect(altitude).toBeGreaterThan(-0.5);
    expect(altitude).toBeLessThan(2);
  });
});
