import { describe, expect, it } from 'vitest';
import { computeMass } from '../vessels/mass';
import {
  gravityAt,
  makeBody,
  makeEngineSpec,
  makePartDef,
  makePartInstance,
  makeVessel,
  resetFixtureIds,
} from '../vessels/testFixtures';
import type { JointLink } from '../vessels/vessel';
import { stepFlight } from './integrator';
import type { ControlInput, FlightEnvironment } from './types';

function stackJoint(id: number, a: number, b: number): JointLink {
  return { id, a, b, nodeKind: 'stack', strength: 1e9 };
}

describe('stepFlight', () => {
  it('never increases altitude when thrust-to-weight ratio is below 1', () => {
    resetFixtureIds();
    const body = makeBody({ radius: 1_000_000, mu: 9.81e12 });
    const g = body.mu / (body.radius * body.radius); // ~9.81 m/s^2 near the surface

    const tankDef = makePartDef({
      id: 'tank',
      dryMass: 2000,
      resources: [{ id: 'fuel', capacity: 100_000 }],
      crossfeed: true,
    });
    // Weight = (2000+50)*g ≈ 20 100 N; thrust well under that => TWR < 1.
    const engineDef = makePartDef({
      id: 'engine',
      dryMass: 50,
      engine: makeEngineSpec({ thrustVac: 10_000, thrustSl: 10_000, ispVac: 300, ispSl: 300 }),
    });

    const tank = makePartInstance(tankDef, { position: { x: 0, y: 1 }, resources: { fuel: 100_000 } });
    const engine = makePartInstance(engineDef, { position: { x: 0, y: 0 } });

    const startAltitude = 10_000; // m — well clear of the ground, isolates gravity+thrust.
    const v = makeVessel({
      parts: [tank, engine],
      joints: [stackJoint(0, tank.id, engine.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
      position: { x: 0, y: body.radius + startAltitude },
      velocity: { x: 0, y: 0 },
      soi: body,
    });
    v.mass = computeMass(v);

    const totalMass = v.mass.total;
    const thrust = engineDef.engine?.thrustVac ?? 0;
    expect(thrust / (totalMass * g)).toBeLessThan(1); // sanity: TWR < 1 by construction

    const input: ControlInput = {
      throttle: 1,
      rotate: 0,
      rcsTranslate: { x: 0, y: 0 },
      sas: false,
      stage: false,
    };
    const dt = 1 / 60;

    let previousAltitude = startAltitude;
    for (let i = 0; i < 300; i++) {
      // 5 s
      const env: FlightEnvironment = {
        t: i * dt,
        body,
        gravity: gravityAt(v.position, body.mu),
        airDensity: 0,
        ambientPressure: 0,
        atmosphereVelocity: { x: 0, y: 0 },
      };
      stepFlight(v, dt, env, input);
      const altitude = Math.hypot(v.position.x, v.position.y) - body.radius;
      // Net acceleration is downward the whole time (thrust < weight), so
      // altitude must never exceed the previous tick's — it only ever falls.
      expect(altitude).toBeLessThanOrEqual(previousAltitude + 1e-9);
      previousAltitude = altitude;
    }
    expect(previousAltitude).toBeLessThan(startAltitude); // it actually descended
  });
});
