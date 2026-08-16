/**
 * Deterministic stand-ins for the not-yet-implemented physics this agent
 * depends on (Agent A's orbit mechanics, Agent B's `stepFlight`), used only
 * by `recording/`'s and `saves/`'s own tests. NOT exported from `index.ts` —
 * this is a test fixture, not part of the public API, and must never be
 * mistaken for the real integrator. See `engine.ts` for what the orchestrator
 * should wire in instead once Agents A/B land.
 *
 * `createFakeWorldStep` is a plain symplectic Euler point-mass integrator
 * under central gravity plus radial thrust — not PLAN.md §3.4's rigid-body
 * model, no structure/staging/atmosphere — good enough to prove the
 * recorder/replay machinery is deterministic and reversible, nothing more.
 *
 * `fakeCircularRailState` *is* real physics, not a fake: for a circular orbit
 * (`e === 0`) the analytic Kepler solution is just uniform circular motion,
 * no anomaly-equation solving required, so this is a legitimate (if narrow)
 * implementation of what `stateFromOrbit` will do for that special case.
 */
import { v2, type Vec2 } from '../math/vec2';
import type { Body, Orbit } from '../orbits/types';
import { makePartDef } from '../vessels/testFixtures';
import type { ControlInput } from '../flight/types';
import type { PartInstance, Vessel } from '../vessels/vessel';
import type { WorldStepFn } from './engine';

/** A fake central body — enough surface/atmosphere/SOI shape to exercise marker detection. */
export function createFakeBody(overrides: Partial<Body> = {}): Body {
  const body: Body = {
    id: 'fake-terra',
    mu: 9.81e12,
    radius: 1_000_000,
    soiRadius: 1e9,
    rotationPeriod: 3600,
    atmosphere: { rho0: 1.225, scaleHeight: 7000, top: 60_000 },
    parent: null,
    orbit: null,
    positionAt: () => ({ x: 0, y: 0 }),
    velocityAt: () => ({ x: 0, y: 0 }),
    ...overrides,
  };
  return body;
}

let nextPartId = 1;

export function createFakePart(overrides: Partial<PartInstance> = {}): PartInstance {
  return {
    id: nextPartId++,
    partId: 'fake_tank',
    def: makePartDef({ id: 'fake_tank', resources: [{ id: 'fuel', capacity: 1000 }] }),
    position: { x: 0, y: 0 },
    rotation: 0,
    resources: { fuel: 1000 },
    ...overrides,
  };
}

export function createFakeVessel(id: number, overrides: Partial<Vessel> = {}): Vessel {
  const part = createFakePart();
  const vessel: Vessel = {
    id,
    parts: [part],
    joints: [],
    stages: [{ index: 0, partIds: [part.id] }],
    currentStage: 0,
    position: { x: 0, y: 1_100_000 },
    velocity: { x: 1000, y: 0 },
    rotation: 0,
    angularVelocity: 0,
    soi: createFakeBody(),
    railOrbit: null,
    mass: { total: 1500, com: { x: 0, y: 0 }, inertia: 500 },
    ...overrides,
  };
  return vessel;
}

export const NEUTRAL_INPUT: ControlInput = {
  throttle: 0,
  rotate: 0,
  rcsTranslate: { x: 0, y: 0 },
  sas: false,
  stage: false,
};

const FAKE_THRUST_ACCEL = 30; // m/s^2 at full throttle, arbitrary but fixed
const FAKE_ROTATE_RATE = 1; // rad/s at rotate = ±1
const FAKE_FUEL_BURN_RATE = 5; // fuel units/s at full throttle

/**
 * A deterministic `WorldStepFn`: the active vessel free-falls under central
 * gravity from `soi.mu`, plus radial thrust from `throttle`/`rotation`;
 * everything else in `vessels` is left untouched (this fixture never has
 * more than one active/off-rails vessel in the tests that use it).
 */
export function createFakeWorldStep(): WorldStepFn {
  return (vessels, _t, dt, step) => {
    return vessels.map((v) => {
      if (v.id !== step.activeVesselId) return v;

      const r = v2.len(v.position);
      const gravity = r > 0 ? v2.scale(v2.norm(v.position), -v.soi.mu / (r * r)) : { x: 0, y: 0 };
      const thrustDir = v2.rot({ x: 0, y: 1 }, v.rotation);
      const thrustAccel = v2.scale(thrustDir, step.input.throttle * FAKE_THRUST_ACCEL);
      const accel = v2.add(gravity, thrustAccel);

      const velocity = v2.add(v.velocity, v2.scale(accel, dt));
      const position = v2.add(v.position, v2.scale(velocity, dt));
      const rotation = v.rotation + step.input.rotate * FAKE_ROTATE_RATE * dt;

      const fuelBurn = step.input.throttle * FAKE_FUEL_BURN_RATE * dt;
      const parts = v.parts.map((p) => ({
        ...p,
        resources: { ...p.resources, fuel: Math.max(0, (p.resources['fuel'] ?? 0) - fuelBurn) },
      }));

      return { ...v, position, velocity, rotation, parts };
    });
  };
}

/**
 * Real physics for the `e === 0` special case of `stateFromOrbit` — see this
 * file's header. Throws for `e !== 0`, since solving Kepler's equation for
 * an eccentric orbit is exactly the part this fixture deliberately doesn't
 * reimplement (that's `eccentricAnomaly`, Agent A's job).
 */
export function fakeCircularRailState(orbit: Orbit, t: number): { position: Vec2; velocity: Vec2 } {
  if (orbit.e !== 0) {
    throw new Error('fakeCircularRailState: only supports circular orbits (e=0)');
  }
  const n = Math.sqrt(orbit.mu / Math.pow(orbit.a, 3)); // mean motion, rad/s
  const angle = orbit.m0 + orbit.dir * n * (t - orbit.epoch);
  const position = v2.scale({ x: Math.cos(angle), y: Math.sin(angle) }, orbit.a);
  const speed = orbit.dir * n * orbit.a;
  const velocity = v2.scale({ x: -Math.sin(angle), y: Math.cos(angle) }, speed);
  return { position, velocity };
}
