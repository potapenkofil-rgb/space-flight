import { describe, expect, it } from 'vitest';
import { cloneVessel } from './clone';
import { createFakeVessel } from './testFixtures';

describe('cloneVessel', () => {
  it('produces an independent copy of mutable substructures', () => {
    const original = createFakeVessel(1);
    const clone = cloneVessel(original);

    // Mutate the original's part resources in place, as consumeFuel does.
    original.parts[0]!.resources['fuel'] = 0;
    original.parts.push({ id: 999, partId: 'x', position: { x: 0, y: 0 }, rotation: 0, resources: {} });
    original.joints.push({ id: 1, a: 1, b: 2, nodeKind: 'stack', strength: 1 });

    expect(clone.parts[0]!.resources['fuel']).toBe(1000);
    expect(clone.parts).toHaveLength(1);
    expect(clone.joints).toHaveLength(0);
  });

  it('shares immutable-by-convention references (position, mass, soi)', () => {
    const original = createFakeVessel(1);
    const clone = cloneVessel(original);

    expect(clone.position).toBe(original.position);
    expect(clone.mass).toBe(original.mass);
    expect(clone.soi).toBe(original.soi);
  });

  it('preserves id and scalar fields', () => {
    const original = createFakeVessel(7, { rotation: 1.5, currentStage: 2 });
    const clone = cloneVessel(original);
    expect(clone.id).toBe(7);
    expect(clone.rotation).toBe(1.5);
    expect(clone.currentStage).toBe(2);
  });
});
