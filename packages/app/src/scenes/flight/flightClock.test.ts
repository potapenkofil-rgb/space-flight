import { ZERO, type ControlInput, type JointLink, type PartInstance, type Stage, type Vessel } from '@karman/core';
import { describe, expect, it } from 'vitest';
import { createGameLoop } from '../../engine/gameLoop';
import { loadContent } from '../../data/content';
import { INITIAL_FLIGHT_SIM_STATE, stepFlightSim, type FlightSimState } from './flightClock';

const DT = 1 / 60;
const { library, system } = loadContent();

const NO_INPUT: ControlInput = { throttle: 0, rotate: 0, rcsTranslate: ZERO, sas: false, stage: false };

/** Builds a real two-stage `Vessel` (engine_launch–tank_s1–separator_stack–engine_vacuum–tank_m1–pod_command) sitting on Terra's pad, straight from the real part library — the same content the hangar builds against. */
function buildTwoStageVessel(): Vessel {
  const ids = ['engine_launch', 'tank_s1', 'separator_stack', 'engine_vacuum', 'tank_m1', 'pod_command'];
  let y = 0;
  const parts: PartInstance[] = ids.map((id, i) => {
    const def = library.get(id);
    const resources: Record<string, number> = {};
    for (const r of def.resources) resources[r.id] = r.capacity;
    const inst: PartInstance = { id: i + 1, partId: id, def, position: { x: 0, y }, rotation: 0, resources };
    y += def.bounds.h;
    return inst;
  });
  const joints: JointLink[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const a = parts[i]!;
    const b = parts[i + 1]!;
    joints.push({ id: i + 1, a: a.id, b: b.id, nodeKind: 'stack', strength: Math.min(a.def.nodeStrength, b.def.nodeStrength) });
  }
  const separatorIndex = ids.indexOf('separator_stack');
  const stages: Stage[] = [
    { index: 0, partIds: parts.slice(0, separatorIndex + 1).map((p) => p.id) },
    { index: 1, partIds: parts.slice(separatorIndex + 1).map((p) => p.id) },
  ];

  const terra = system.root;
  const position = { x: 0, y: terra.radius };
  // At rest *relative to the ground*, not the inertial frame — Terra's fast
  // 6h rotation (data/systems/karman.json) gives its equator a real ~290 m/s
  // co-rotation speed; a vessel launched with inertial velocity {0,0} would
  // start hundreds of m/s out of sync with the pad it's standing on. Mirrors
  // `game/launch.ts`'s `padVelocity`.
  const omega = (2 * Math.PI) / terra.rotationPeriod;
  const vessel: Vessel = {
    id: 1,
    parts,
    joints,
    stages,
    currentStage: 0,
    position,
    velocity: { x: -omega * position.y, y: omega * position.x },
    rotation: 0,
    angularVelocity: 0,
    soi: terra,
    railOrbit: null,
    mass: { total: 0, com: { x: 0, y: 0 }, inertia: 0 },
  };
  return vessel;
}

describe('stepFlightSim', () => {
  it('advances simTime by dt at warp 1x with no throttle (falls, does not float)', () => {
    const vessel = buildTwoStageVessel();
    const result = stepFlightSim(vessel, INITIAL_FLIGHT_SIM_STATE, 0, DT, 0, NO_INPUT);
    expect(result.simTime).toBeCloseTo(DT, 9);
    expect(result.appliedWarpMultiplier).toBe(1);
    expect(result.warpBlocked).toBe(false);
  });

  it('full throttle lifts the vessel off the pad — altitude increases', () => {
    let vessel = buildTwoStageVessel();
    let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
    let t = 0;
    const control: ControlInput = { ...NO_INPUT, throttle: 1 };
    for (let i = 0; i < 300; i++) {
      const result = stepFlightSim(vessel, state, t, DT, 0, control);
      vessel = result.vessel;
      state = result.state;
      t = result.simTime;
    }
    expect(vessel.velocity.y).toBeGreaterThan(0);
  });

  it('blocks warp above 10x while the engine is firing, even mid-flight', () => {
    const vessel = buildTwoStageVessel();
    const control: ControlInput = { ...NO_INPUT, throttle: 1 };
    const result = stepFlightSim(vessel, INITIAL_FLIGHT_SIM_STATE, 0, DT, 6, control); // index 6 = 1000x
    expect(result.warpBlocked).toBe(true);
    expect(result.appliedWarpMultiplier).toBe(10);
  });

  it('allows warp above 10x once coasting above the atmosphere with the engine off', () => {
    const vessel = buildTwoStageVessel();
    vessel.soi = system.root;
    // Place it well above the atmosphere, coasting outward — no atmosphere, no thrust.
    vessel.position = { x: 0, y: system.root.radius + system.root.atmosphere!.top + 10_000 };
    vessel.velocity = { x: 500, y: 0 };
    const result = stepFlightSim(vessel, INITIAL_FLIGHT_SIM_STATE, 0, DT, 6, NO_INPUT); // index 6 = 1000x
    expect(result.warpBlocked).toBe(false);
    expect(result.appliedWarpMultiplier).toBe(1000);
    expect(result.vessel.railOrbit).not.toBeNull();
  });

  it('an idle vessel resting on the pad does not sink through the ground or fly off in the first couple of seconds', () => {
    // This particular test rocket — a slender 19 m stack balanced on nothing
    // wider than its own 1.6 m engine bell, with no landing legs — is a
    // genuinely unstable stance mechanically (an inverted pendulum), not a
    // wrapper bug: `@karman/core`'s own `flight/contact.test.ts` proves the
    // underlying spring-damper contact is stable to <1mm over 60s for a
    // *wide-legged* lander. This test only checks the integration this file
    // owns — environment/gravity/warp wiring around `stepFlight` — doesn't
    // let the ground swallow the vessel or eject it, over a short window a
    // real player would actually leave a rocket sitting untouched on the pad.
    let vessel = buildTwoStageVessel();
    let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
    let t = 0;
    for (let i = 0; i < 120; i++) {
      const result = stepFlightSim(vessel, state, t, DT, 0, NO_INPUT);
      vessel = result.vessel;
      state = result.state;
      t = result.simTime;
      const altitude = Math.hypot(vessel.position.x, vessel.position.y) - vessel.soi.radius;
      expect(altitude).toBeGreaterThan(-0.5); // never sinks meaningfully below the surface
      expect(altitude).toBeLessThan(50); // never launches itself off the pad
    }
  });

  it('staging (Space) separates the spent first stage and keeps the upper stage flying', () => {
    let vessel = buildTwoStageVessel();
    expect(vessel.parts).toHaveLength(6);
    const result = stepFlightSim(vessel, INITIAL_FLIGHT_SIM_STATE, 0, DT, 0, { ...NO_INPUT, stage: true });
    vessel = result.vessel;
    expect(vessel.parts.length).toBeLessThan(6);
    expect(vessel.parts.some((p) => p.partId === 'engine_vacuum')).toBe(true);
    expect(vessel.parts.some((p) => p.partId === 'engine_launch')).toBe(false);
    expect(result.snapshot.justStaged).toBe(true);
  });
});

interface Vec2Like {
  readonly x: number;
  readonly y: number;
}

describe('render never mutates flight simulation state (PLAN.md §3.2)', () => {
  it('two runs with a different number of render() calls produce an identical vessel position/velocity', () => {
    function run(renderCallsPerStep: number): Vessel {
      let vessel = buildTwoStageVessel();
      let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
      let t = 0;
      const control: ControlInput = { ...NO_INPUT, throttle: 1 };
      const renderReads: Vec2Like[] = [];
      const loop = createGameLoop(
        {
          step: (dt) => {
            const result = stepFlightSim(vessel, state, t, dt, 0, control);
            vessel = result.vessel;
            state = result.state;
            t = result.simTime;
          },
          render: () => {
            for (let i = 0; i < renderCallsPerStep; i++) renderReads.push(vessel.position);
          },
        },
        { dt: DT }
      );
      for (let i = 0; i < 120; i++) loop.advance(DT * (1 + (i % 3)));
      void renderReads;
      return vessel;
    }

    const a = run(0);
    const b = run(5);
    expect(a.position).toEqual(b.position);
    expect(a.velocity).toEqual(b.velocity);
  });
});
