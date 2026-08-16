import { describe, expect, it } from 'vitest';
import { computeDeltaV } from './deltav';
import { G0 } from './fuel';
import {
  makeEngineSpec,
  makePartDef,
  makePartInstance,
  makeVessel,
  resetFixtureIds,
} from './testFixtures';
import type { JointLink } from './vessel';

function stackJoint(id: number, a: number, b: number): JointLink {
  return { id, a, b, nodeKind: 'stack', strength: 1e9 };
}

describe('computeDeltaV', () => {
  it('matches manual Tsiolkovsky (ΔV = Isp·g0·ln(m0/m1)) for a single-stage rocket within 0.1%', () => {
    resetFixtureIds();
    const capsuleDef = makePartDef({ id: 'capsule', dryMass: 500 });
    const tankDef = makePartDef({
      id: 'tank',
      dryMass: 300,
      resources: [{ id: 'fuel', capacity: 2700 }],
      crossfeed: true,
    });
    const engineDef = makePartDef({
      id: 'engine',
      dryMass: 200,
      engine: makeEngineSpec({ thrustVac: 200_000, thrustSl: 180_000, ispVac: 300, ispSl: 270 }),
    });

    const capsule = makePartInstance(capsuleDef, { position: { x: 0, y: 4 } });
    const tank = makePartInstance(tankDef, { position: { x: 0, y: 1 }, resources: { fuel: 2700 } });
    const engine = makePartInstance(engineDef, { position: { x: 0, y: 0 } });

    const v = makeVessel({
      parts: [capsule, tank, engine],
      joints: [stackJoint(0, capsule.id, tank.id), stackJoint(1, tank.id, engine.id)],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    const m0 = 500 + 300 + 2700 + 200;
    const m1 = 500 + 300 + 200;
    const manualDeltaVVac = 300 * G0 * Math.log(m0 / m1);

    // deltaVVac is always vacuum, regardless of the requested ambientPressure.
    const [stageAtVac] = computeDeltaV(v, 0);
    expect(stageAtVac).toBeDefined();
    expect(stageAtVac?.startMass).toBeCloseTo(m0, 6);
    expect(stageAtVac?.endMass).toBeCloseTo(m1, 6);
    const relError = Math.abs((stageAtVac?.deltaVVac ?? 0) - manualDeltaVVac) / manualDeltaVVac;
    expect(relError).toBeLessThan(0.001); // within 0.1%

    // deltaVAtm at ambientPressure=1 (sea level) must use sea-level Isp — different from vacuum.
    const [stageAtSl] = computeDeltaV(v, 1);
    const manualDeltaVAtm = 270 * G0 * Math.log(m0 / m1);
    const relErrorAtm = Math.abs((stageAtSl?.deltaVAtm ?? 0) - manualDeltaVAtm) / manualDeltaVAtm;
    expect(relErrorAtm).toBeLessThan(0.001);
  });

  it('two-stage rocket: stage 0 excludes stage-1 dry mass once separated', () => {
    resetFixtureIds();
    const tankDef = makePartDef({
      id: 'tank',
      dryMass: 100,
      resources: [{ id: 'fuel', capacity: 1000 }],
      crossfeed: true,
    });
    const engineDef = makePartDef({
      id: 'engine',
      dryMass: 50,
      engine: makeEngineSpec({ thrustVac: 100_000, thrustSl: 100_000, ispVac: 300, ispSl: 300 }),
    });
    const separatorDef = makePartDef({ id: 'sep', dryMass: 10, category: 'separators' });

    // Stage 0 (bottom, fires first): engine0 + tank0, topped by a separator.
    const engine0 = makePartInstance(engineDef, { position: { x: 0, y: 0 } });
    const tank0 = makePartInstance(tankDef, { position: { x: 0, y: 1 }, resources: { fuel: 1000 } });
    const sep = makePartInstance(separatorDef, { position: { x: 0, y: 2 } });
    // Stage 1 (top): engine1 + tank1.
    const tank1 = makePartInstance(tankDef, { position: { x: 0, y: 3 }, resources: { fuel: 1000 } });
    const engine1 = makePartInstance(engineDef, { position: { x: 0, y: 4 } });

    const v = makeVessel({
      parts: [engine0, tank0, sep, tank1, engine1],
      joints: [
        stackJoint(0, engine0.id, tank0.id),
        stackJoint(1, tank0.id, sep.id),
        stackJoint(2, sep.id, tank1.id),
        stackJoint(3, tank1.id, engine1.id),
      ],
      stages: [
        { index: 0, partIds: [engine0.id, sep.id] },
        { index: 1, partIds: [engine1.id] },
      ],
    });

    const [stage0, stage1] = computeDeltaV(v, 0);
    expect(stage0).toBeDefined();
    expect(stage1).toBeDefined();

    // Stage 0 ignites with the whole rocket attached.
    const wholeMass = (100 + 1000) * 2 + 50 * 2 + 10;
    expect(stage0?.startMass).toBeCloseTo(wholeMass, 6);

    // Stage 1 ignites after stage 0 (engine0 + tank0, now empty, + the separator) drops away.
    const stage1Start = 100 + 1000 + 50; // tank1 (full) + engine1
    expect(stage1?.startMass).toBeCloseTo(stage1Start, 6);
  });
});
