import { describe, expect, it } from 'vitest';
import { v2 } from '../math/vec2';
import { computeMass } from '../vessels/mass';
import {
  gravityAt,
  makeBody,
  makePartDef,
  makePartInstance,
  makeVessel,
  resetFixtureIds,
} from '../vessels/testFixtures';
import { stepFlight } from './integrator';
import type { ControlInput, FlightEnvironment } from './types';

const NO_INPUT: ControlInput = {
  throttle: 0,
  rotate: 0,
  rcsTranslate: { x: 0, y: 0 },
  sas: false,
  stage: false,
};

function buildLander() {
  resetFixtureIds();
  const tankDef = makePartDef({ id: 'tank', dryMass: 800, bounds: { w: 1.5, h: 3 } });
  const legDef = makePartDef({
    id: 'leg',
    dryMass: 40,
    bounds: { w: 0.4, h: 1 },
    maxLandingSpeed: 5,
  });

  const tank = makePartInstance(tankDef, { position: { x: 0, y: 0 } });
  const legLeft = makePartInstance(legDef, { position: { x: -1, y: -1 } });
  const legRight = makePartInstance(legDef, { position: { x: 1, y: -1 } });
  const legFront = makePartInstance(legDef, { position: { x: 0, y: -1 } });

  return { tank, legLeft, legRight, legFront };
}

describe('ground contact stability', () => {
  it('a vessel resting on the ground with engines off does not sink or jitter over 60s (<1mm drift)', () => {
    const { tank, legLeft, legRight, legFront } = buildLander();
    const body = makeBody({ radius: 1_000_000, atmosphere: null });

    // Legs' local "foot" points sit at vessel-local y = -1 - 0 = -1 (their own
    // bottom-node origin). Placing the vessel origin exactly `1 m` above the
    // nominal surface point puts those feet right at the surface.
    const v = makeVessel({
      parts: [tank, legLeft, legRight, legFront],
      joints: [],
      stages: [{ index: 0, partIds: [] }],
      position: { x: 0, y: body.radius + 1 },
      velocity: { x: 0, y: 0 },
      rotation: 0,
      angularVelocity: 0,
      soi: body,
    });
    v.mass = computeMass(v);

    const dt = 1 / 60;
    const env = (): FlightEnvironment => ({
      t: 0,
      body,
      gravity: gravityAt(v.position, body.mu),
      airDensity: 0,
      ambientPressure: 0,
      atmosphereVelocity: { x: 0, y: 0 },
    });

    // Let the initial spring compression settle for 1s before measuring drift.
    for (let i = 0; i < 60; i++) stepFlight(v, dt, env(), NO_INPUT);
    const settled = v.position;

    let maxDrift = 0;
    for (let i = 0; i < 3540; i++) {
      stepFlight(v, dt, env(), NO_INPUT);
      const drift = v2.len(v2.sub(v.position, settled));
      if (drift > maxDrift) maxDrift = drift;
    }

    expect(maxDrift).toBeLessThan(0.001); // < 1 mm over the remaining 59 s
    // Also not sinking systematically: final position close to the settled one.
    const finalDrift = v2.len(v2.sub(v.position, settled));
    expect(finalDrift).toBeLessThan(0.001);
  });
});
