import { describe, expect, it } from 'vitest';
import { v2 } from '../math/vec2';
import { connectedComponents, evaluateStructure, splitVessel } from './structure';
import {
  makeEngineSpec,
  makePartDef,
  makePartInstance,
  makeVessel,
  resetFixtureIds,
} from './testFixtures';
import type { JointLink } from './vessel';

function stackJoint(id: number, a: number, b: number, strength = 1e9): JointLink {
  return { id, a, b, nodeKind: 'stack', strength };
}

const blockDef = makePartDef({ id: 'block', dryMass: 100 });

describe('connectedComponents', () => {
  it('is unaffected by input array order', () => {
    resetFixtureIds();
    const a = makePartInstance(blockDef);
    const b = makePartInstance(blockDef);
    const c = makePartInstance(blockDef);
    const joints = [stackJoint(0, a.id, b.id)];

    const forward = connectedComponents([a, b, c], joints, new Set());
    const shuffled = connectedComponents([c, b, a], joints, new Set());
    expect(forward).toEqual(shuffled);
  });
});

describe('splitVessel', () => {
  it('breaking one joint in a 3-part chain yields exactly two vessels with correct masses', () => {
    resetFixtureIds();
    const a = makePartInstance(makePartDef({ id: 'a', dryMass: 100 }), { position: { x: 0, y: 0 } });
    const b = makePartInstance(makePartDef({ id: 'b', dryMass: 200 }), { position: { x: 0, y: 1 } });
    const c = makePartInstance(makePartDef({ id: 'c', dryMass: 300 }), { position: { x: 0, y: 2 } });

    const jointAB = stackJoint(0, a.id, b.id);
    const jointBC = stackJoint(1, b.id, c.id);
    const v = makeVessel({
      id: 42,
      parts: [a, b, c],
      joints: [jointAB, jointBC],
      stages: [{ index: 0, partIds: [] }],
      velocity: { x: 10, y: 5 },
      angularVelocity: 0.2,
    });

    const result = splitVessel(v, [{ jointId: jointAB.id, axialForce: 1e10 }]);
    expect(result).toHaveLength(2);

    const masses = result.map((r) => r.mass.total).sort((x, y) => x - y);
    expect(masses).toEqual([100, 500]); // {a} alone, {b,c} together

    // Both children inherit the parent's velocity and angular velocity (momentum conservation).
    for (const child of result) {
      expect(child.velocity).toEqual(v.velocity);
      expect(child.angularVelocity).toBe(v.angularVelocity);
    }
  });

  it('stage separation conserves total linear momentum', () => {
    resetFixtureIds();
    const boosterDef = makePartDef({ id: 'booster', dryMass: 1000 });
    const payloadDef = makePartDef({ id: 'payload', dryMass: 400 });
    const booster = makePartInstance(boosterDef, { position: { x: 0, y: 0 } });
    const payload = makePartInstance(payloadDef, { position: { x: 0, y: 1 } });
    const joint = stackJoint(0, booster.id, payload.id);

    const v = makeVessel({
      parts: [booster, payload],
      joints: [joint],
      velocity: { x: 120, y: -30 },
      angularVelocity: 0.05,
    });
    const totalMassBefore = booster.def.dryMass + payload.def.dryMass;
    const momentumBefore = v2.scale(v.velocity, totalMassBefore);

    const children = splitVessel(v, [{ jointId: joint.id, axialForce: 0 }]);
    expect(children).toHaveLength(2);

    let momentumAfter = { x: 0, y: 0 };
    let massAfter = 0;
    for (const child of children) {
      momentumAfter = v2.add(momentumAfter, v2.scale(child.velocity, child.mass.total));
      massAfter += child.mass.total;
    }

    expect(massAfter).toBeCloseTo(totalMassBefore, 9);
    expect(momentumAfter.x).toBeCloseTo(momentumBefore.x, 6);
    expect(momentumAfter.y).toBeCloseTo(momentumBefore.y, 6);
  });

  it('returns [v] unchanged when breaks is empty', () => {
    resetFixtureIds();
    const a = makePartInstance(blockDef);
    const v = makeVessel({ parts: [a] });
    expect(splitVessel(v, [])).toEqual([v]);
  });

  it('returns [v] unchanged when the removed joint is not a bridge (a cycle survives)', () => {
    resetFixtureIds();
    const a = makePartInstance(blockDef);
    const b = makePartInstance(blockDef);
    const j0 = stackJoint(0, a.id, b.id);
    const j1 = stackJoint(1, a.id, b.id); // redundant second link — a cycle
    const v = makeVessel({ parts: [a, b], joints: [j0, j1] });

    const result = splitVessel(v, [{ jointId: j0.id, axialForce: 0 }]);
    expect(result).toEqual([v]);
  });
});

describe('evaluateStructure', () => {
  it('breaks a joint whose subtree load exceeds its strength, and not one that stays under', () => {
    resetFixtureIds();
    const engineDef = makePartDef({
      id: 'engine',
      dryMass: 50,
      engine: makeEngineSpec({ thrustVac: 500_000 }),
    });
    const weakDef = makePartDef({ id: 'weak_tank', dryMass: 900, nodeStrength: 1000 }); // breaks
    const strongDef = makePartDef({ id: 'strong_pod', dryMass: 100, nodeStrength: 1e9 }); // survives

    const engine = makePartInstance(engineDef, { position: { x: 0, y: 0 } });
    const weak = makePartInstance(weakDef, { position: { x: 0, y: 1 } });
    const strong = makePartInstance(strongDef, { position: { x: 0, y: 2 } });

    const weakJoint: JointLink = { id: 0, a: engine.id, b: weak.id, nodeKind: 'stack', strength: 1000 };
    const strongJoint: JointLink = {
      id: 1,
      a: weak.id,
      b: strong.id,
      nodeKind: 'stack',
      strength: 1e9,
    };

    const v = makeVessel({
      parts: [engine, weak, strong],
      joints: [weakJoint, strongJoint],
      stages: [{ index: 0, partIds: [engine.id] }],
    });

    // 10 m/s^2 upward acceleration; the weak joint's subtree (weak+strong, 1000 kg)
    // sees 10,000 N > its 1000 N strength. The strong joint's subtree (strong
    // alone, 100 kg) sees 1000 N, right at (not over) its 1e9 N strength.
    const breaks = evaluateStructure(v, {
      acceleration: { x: 0, y: 10 },
      angularAcceleration: 0,
      aeroForceByPart: new Map(),
    });

    expect(breaks).toHaveLength(1);
    expect(breaks[0]?.jointId).toBe(weakJoint.id);
  });
});
