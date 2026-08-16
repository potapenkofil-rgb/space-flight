import { describe, expect, it } from 'vitest';
import type { Orbit } from '../orbits/types';
import { createFakeBody, createFakeVessel, fakeCircularRailState } from '../recording/testFixtures';
import { createVesselRegistry } from './registry';

const DT = 1 / 60;
const BODY = createFakeBody();

const ORBIT_A: Orbit = { a: 1_400_000, e: 0, argPe: 0, m0: 0, epoch: 0, mu: BODY.mu, dir: 1 };
const ORBIT_B: Orbit = { a: 2_000_000, e: 0, argPe: 0, m0: Math.PI, epoch: 0, mu: BODY.mu, dir: -1 };

function parkedVessel(id: number, orbit: Orbit) {
  return createFakeVessel(id, { soi: BODY, railOrbit: orbit, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } });
}

describe('createVesselRegistry (PLAN.md §3.3/§7 Agent F)', () => {
  it('two vessels on different orbits survive a x10 000 warp: correct, and cheap', () => {
    const v1 = parkedVessel(1, ORBIT_A);
    const v2 = parkedVessel(2, ORBIT_B);
    const registry = createVesselRegistry([v1, v2], { railState: fakeCircularRailState });

    const warpFactor = 10_000;
    const t = DT * warpFactor; // one "tick" of warp x10 000, taken as a single analytic jump

    const start = Date.now();
    registry.advanceRails(t);
    const elapsedMs = Date.now() - start;

    // O(vessels), independent of the warp factor — this is the whole point of on-rails.
    expect(elapsedMs).toBeLessThan(50);

    const expectedA = fakeCircularRailState(ORBIT_A, t);
    const expectedB = fakeCircularRailState(ORBIT_B, t);
    expect(registry.get(1)!.position).toEqual(expectedA.position);
    expect(registry.get(1)!.velocity).toEqual(expectedA.velocity);
    expect(registry.get(2)!.position).toEqual(expectedB.position);
    expect(registry.get(2)!.velocity).toEqual(expectedB.velocity);
    expect(registry.get(1)!.position).not.toEqual(registry.get(2)!.position);
  });

  it('repeated large warps never drift — each call is a pure function of t, not accumulated integration', () => {
    const v1 = parkedVessel(1, ORBIT_A);
    const registry = createVesselRegistry([v1], { railState: fakeCircularRailState });

    for (const warpFactor of [10_000, 100_000, 1_000_000]) {
      const t = DT * warpFactor;
      registry.advanceRails(t);
      expect(registry.get(1)!.position).toEqual(fakeCircularRailState(ORBIT_A, t).position);
    }
  });

  it('leaves off-rails vessels (railOrbit === null) untouched', () => {
    const flying = createFakeVessel(3, { soi: BODY, railOrbit: null, position: { x: 5, y: 6 }, velocity: { x: 7, y: 8 } });
    const registry = createVesselRegistry([flying], { railState: fakeCircularRailState });
    registry.advanceRails(1000);
    expect(registry.get(3)!.position).toEqual({ x: 5, y: 6 });
    expect(registry.get(3)!.velocity).toEqual({ x: 7, y: 8 });
  });

  it('vessels are listed in deterministic id order regardless of insertion order', () => {
    const registry = createVesselRegistry([parkedVessel(5, ORBIT_A), parkedVessel(1, ORBIT_A), parkedVessel(3, ORBIT_A)]);
    expect(registry.vessels.map((v) => v.id)).toEqual([1, 3, 5]);
  });

  it('the first vessel added becomes active by default; setActive switches it', () => {
    const registry = createVesselRegistry([parkedVessel(2, ORBIT_A)]);
    expect(registry.activeVesselId).toBe(2);
    registry.add(parkedVessel(9, ORBIT_B));
    expect(registry.activeVesselId).toBe(2); // adding doesn't steal focus once something is active
    registry.setActive(9);
    expect(registry.activeVesselId).toBe(9);
  });

  it('setActive throws for an unknown id', () => {
    const registry = createVesselRegistry([parkedVessel(1, ORBIT_A)]);
    expect(() => registry.setActive(999)).toThrow(/unknown vessel/);
  });

  it('add throws on a duplicate id', () => {
    const registry = createVesselRegistry([parkedVessel(1, ORBIT_A)]);
    expect(() => registry.add(parkedVessel(1, ORBIT_B))).toThrow(/duplicate/);
  });

  it('remove clears activeVesselId when the active vessel is removed', () => {
    const registry = createVesselRegistry([parkedVessel(1, ORBIT_A)]);
    registry.remove(1);
    expect(registry.activeVesselId).toBeNull();
    expect(registry.vessels).toHaveLength(0);
  });
});
