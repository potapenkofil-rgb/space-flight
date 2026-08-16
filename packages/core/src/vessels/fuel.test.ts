import { describe, expect, it } from 'vitest';
import { G0, burnEngines, consumeFuel } from './fuel';
import {
  makeEngineSpec,
  makePartDef,
  makePartInstance,
  makeVessel,
  resetFixtureIds,
} from './testFixtures';
import type { JointLink } from './vessel';

const tankDef = makePartDef({
  id: 'tank',
  dryMass: 100,
  resources: [{ id: 'fuel', capacity: 10_000 }],
  crossfeed: true,
});
const blockedTankDef = makePartDef({
  id: 'tank_blocked',
  dryMass: 100,
  resources: [{ id: 'fuel', capacity: 10_000 }],
  crossfeed: false,
});
const engineDef = makePartDef({
  id: 'engine',
  dryMass: 50,
  engine: makeEngineSpec({ thrustVac: 100_000, ispVac: 250, minThrottle: 0 }),
});

function stackJoint(id: number, a: number, b: number): JointLink {
  return { id, a, b, nodeKind: 'stack', strength: 1e9 };
}
function radialJoint(id: number, a: number, b: number): JointLink {
  return { id, a, b, nodeKind: 'radial', strength: 1e9 };
}

describe('consumeFuel / burnEngines', () => {
  it('never uses local gravity — only the fixed g0 constant enters the mass-flow formula', () => {
    // The Moon-ΔV bug: if local g leaked into ṁ = F/(Isp·g), a lower g would
    // shrink ṁ and burn less propellant per Newton — this asserts the module's
    // own constant is exactly Tsiolkovsky's g0, independent of any body.
    expect(G0).toBeCloseTo(9.80665, 10);
  });

  it('draws fuel from a directly-attached tank at the Tsiolkovsky mass-flow rate', () => {
    resetFixtureIds();
    const engine = makePartInstance(engineDef, { position: { x: 0, y: 0 } });
    const tank = makePartInstance(tankDef, { position: { x: 0, y: 1 }, resources: { fuel: 500 } });
    const v = makeVessel({
      parts: [engine, tank],
      joints: [stackJoint(0, engine.id, tank.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    const dt = 1 / 60;
    const thrust = consumeFuel(v, dt, 1, 0); // vacuum
    expect(thrust).toBeCloseTo(100_000, 6);

    const expectedMdot = 100_000 / (250 * G0);
    const expectedBurned = expectedMdot * dt;
    expect(tank.resources.fuel).toBeCloseTo(500 - expectedBurned, 9);
  });

  it('pulls fuel up through a chain of crossfeed-enabled stack tanks', () => {
    resetFixtureIds();
    const engine = makePartInstance(engineDef, { position: { x: 0, y: 0 } });
    const near = makePartInstance(tankDef, {
      position: { x: 0, y: 1 },
      resources: { fuel: 1 }, // almost empty — must reach past it
    });
    const far = makePartInstance(tankDef, { position: { x: 0, y: 2 }, resources: { fuel: 1000 } });
    const v = makeVessel({
      parts: [engine, near, far],
      joints: [stackJoint(0, engine.id, near.id), stackJoint(1, near.id, far.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    const dt = 1;
    const thrust = consumeFuel(v, dt, 1, 0);
    expect(thrust).toBeCloseTo(100_000, 6); // fully supplied via crossfeed, no starvation
    expect(far.resources.fuel).toBeLessThan(1000); // the far tank was actually drawn from
  });

  it('does not cross a non-crossfeed tank to reach fuel further up the stack', () => {
    resetFixtureIds();
    const engine = makePartInstance(engineDef, { position: { x: 0, y: 0 } });
    const blocker = makePartInstance(blockedTankDef, {
      position: { x: 0, y: 1 },
      resources: { fuel: 5 },
    });
    const far = makePartInstance(tankDef, { position: { x: 0, y: 2 }, resources: { fuel: 10_000 } });
    const v = makeVessel({
      parts: [engine, blocker, far],
      joints: [stackJoint(0, engine.id, blocker.id), stackJoint(1, blocker.id, far.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    const dt = 10; // long enough to fully drain the 5 kg the blocker itself holds
    const burns = burnEngines(v, dt, 1, 0);
    expect(far.resources.fuel).toBeCloseTo(10_000, 9); // untouched — blocked by the non-crossfeed tank
    expect(blocker.resources.fuel).toBeCloseTo(0, 6); // the blocker's own fuel is still usable
    expect(burns[0]?.thrust ?? 0).toBeLessThan(100_000); // starved once the blocker ran dry
  });

  it('feeds a radial tank only to the engine it is directly bolted to', () => {
    resetFixtureIds();
    const engineA = makePartInstance(engineDef, { position: { x: -1, y: 0 } });
    const engineB = makePartInstance(engineDef, { position: { x: 1, y: 0 } });
    const radialTank = makePartInstance(tankDef, {
      position: { x: -1, y: 1 },
      resources: { fuel: 10_000 },
    });
    const v = makeVessel({
      parts: [engineA, engineB, radialTank],
      joints: [radialJoint(0, engineA.id, radialTank.id)],
      stages: [{ index: 0, partIds: [engineA.id, engineB.id] }],
    });

    const burns = burnEngines(v, 1, 1, 0);
    const burnA = burns.find((b) => b.partId === engineA.id);
    const burnB = burns.find((b) => b.partId === engineB.id);
    expect(burnA?.thrust ?? 0).toBeCloseTo(100_000, 6); // fed by its radial tank
    expect(burnB?.thrust ?? 0).toBe(0); // no path to any fuel at all
  });

  it('scales thrust down proportionally when starved of propellant', () => {
    resetFixtureIds();
    const engine = makePartInstance(engineDef);
    const tank = makePartInstance(tankDef, { position: { x: 0, y: 1 }, resources: { fuel: 1 } });
    const v = makeVessel({
      parts: [engine, tank],
      joints: [stackJoint(0, engine.id, tank.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    const dt = 1;
    const thrust = consumeFuel(v, dt, 1, 0);
    const expectedMdot = 100_000 / (250 * G0);
    const expectedFullBurn = expectedMdot * dt;
    const expectedFraction = 1 / expectedFullBurn;
    expect(thrust).toBeCloseTo(100_000 * expectedFraction, 6);
    expect(tank.resources.fuel).toBeCloseTo(0, 9);
  });

  it('clamps a nonzero throttle command up to the engine\'s minThrottle', () => {
    resetFixtureIds();
    const throttled = makePartDef({
      id: 'engine_min',
      dryMass: 50,
      engine: makeEngineSpec({ thrustVac: 100_000, ispVac: 250, minThrottle: 0.2 }),
    });
    const engine = makePartInstance(throttled);
    const tank = makePartInstance(tankDef, { position: { x: 0, y: 1 }, resources: { fuel: 10_000 } });
    const v = makeVessel({
      parts: [engine, tank],
      joints: [stackJoint(0, engine.id, tank.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    const thrust = consumeFuel(v, 1 / 60, 0.05, 0); // commanded well below minThrottle
    expect(thrust).toBeCloseTo(100_000 * 0.2, 6);
  });

  it('produces zero thrust and burns no fuel at zero throttle', () => {
    resetFixtureIds();
    const engine = makePartInstance(engineDef);
    const tank = makePartInstance(tankDef, { position: { x: 0, y: 1 }, resources: { fuel: 500 } });
    const v = makeVessel({
      parts: [engine, tank],
      joints: [stackJoint(0, engine.id, tank.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    expect(consumeFuel(v, 1 / 60, 0, 0)).toBe(0);
    expect(tank.resources.fuel).toBe(500);
  });
});
