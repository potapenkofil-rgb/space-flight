import { describe, expect, it } from 'vitest';
import type { Orbit } from '@karman/core';
import { classifyOrbit } from './MapScene';

/**
 * Regression test (PLAN.md §8 fix): a vessel resting on the pad, or on a
 * trajectory that dips into the body, must not be drawn/labelled as a
 * stable orbit — DESIGN.md has no room for a negative-altitude periapsis
 * number, it's meaningless to the player. Caught from a screenshot
 * (`map.png`), not by any prior automated test.
 */
const TERRA_MU = 9.81e12;
const TERRA_RADIUS = 1_000_000;

function orbitFor(a: number, e: number): Orbit {
  return { a, e, argPe: 0, m0: 0, epoch: 0, mu: TERRA_MU, dir: 1 };
}

describe('classifyOrbit', () => {
  it('a healthy 100 km circular orbit is stable', () => {
    const orbit = orbitFor(TERRA_RADIUS + 100_000, 0);
    expect(classifyOrbit(orbit, TERRA_RADIUS, 100_000)).toBe('stable');
  });

  it('a vessel resting on the pad (near-surface altitude, periapsis at/below the surface) is "grounded"', () => {
    // Matches game/launch.ts's pad state: a nearly-degenerate ellipse whose
    // periapsis is deep inside the body.
    const orbit = orbitFor(500_000, 0.99);
    expect(classifyOrbit(orbit, TERRA_RADIUS, 0)).toBe('grounded');
  });

  it('an airborne trajectory already committed to impact is "suborbital", not "grounded"', () => {
    const orbit = orbitFor(500_000, 0.99);
    expect(classifyOrbit(orbit, TERRA_RADIUS, 20_000)).toBe('suborbital');
  });

  it('a periapsis exactly at the surface is not stable (boundary is exclusive)', () => {
    const orbit = orbitFor(TERRA_RADIUS, 0);
    expect(classifyOrbit(orbit, TERRA_RADIUS, 0)).not.toBe('stable');
  });
});
