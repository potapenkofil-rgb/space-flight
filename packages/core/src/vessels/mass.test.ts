import { describe, expect, it } from 'vitest';
import { computeMass } from './mass';
import { makePartDef, makePartInstance, makeVessel, resetFixtureIds } from './testFixtures';

describe('computeMass', () => {
  it('returns zero mass properties for an empty vessel', () => {
    const v = makeVessel({ parts: [] });
    expect(computeMass(v)).toEqual({ total: 0, com: { x: 0, y: 0 }, inertia: 0 });
  });

  it('sums dry mass and every resource held (1 unit = 1 kg)', () => {
    resetFixtureIds();
    const tankDef = makePartDef({
      id: 'tank',
      dryMass: 300,
      resources: [{ id: 'fuel', capacity: 2700 }],
      bounds: { w: 1, h: 2 },
    });
    const part = makePartInstance(tankDef, { resources: { fuel: 1200 } });
    const v = makeVessel({ parts: [part] });

    const mass = computeMass(v);
    expect(mass.total).toBeCloseTo(300 + 1200, 9);
  });

  it('weights the centre of mass by each part\'s own mass', () => {
    resetFixtureIds();
    // Two identical-mass parts stacked: part A's own centroid at local (0, 0.5)
    // (bounds.h/2 above its bottom-node origin at position (0,0)); part B's
    // centroid at (0, 2 + 0.5) (its origin sits at vessel-local y=2).
    const def = makePartDef({ id: 'block', dryMass: 100, bounds: { w: 1, h: 1 } });
    const a = makePartInstance(def, { position: { x: 0, y: 0 }, rotation: 0 });
    const b = makePartInstance(def, { position: { x: 0, y: 2 }, rotation: 0 });
    const v = makeVessel({ parts: [a, b] });

    const mass = computeMass(v);
    expect(mass.total).toBeCloseTo(200, 9);
    // Equal masses -> COM is the midpoint of the two centroids: (0.5 + 2.5)/2 = 1.5
    expect(mass.com.x).toBeCloseTo(0, 9);
    expect(mass.com.y).toBeCloseTo(1.5, 9);
  });

  it('is invariant to iteration order of v.parts (deterministic id-sorted traversal)', () => {
    resetFixtureIds();
    const def = makePartDef({ id: 'block', dryMass: 50, bounds: { w: 1, h: 1 } });
    const a = makePartInstance(def, { position: { x: -1, y: 0 } });
    const b = makePartInstance(def, { position: { x: 1, y: 0 } });
    const c = makePartInstance(def, { position: { x: 0, y: 3 } });

    const forward = computeMass(makeVessel({ parts: [a, b, c] }));
    const shuffled = computeMass(makeVessel({ parts: [c, a, b] }));

    expect(forward.total).toBeCloseTo(shuffled.total, 12);
    expect(forward.com.x).toBeCloseTo(shuffled.com.x, 12);
    expect(forward.com.y).toBeCloseTo(shuffled.com.y, 12);
    expect(forward.inertia).toBeCloseTo(shuffled.inertia, 9);
  });
});
