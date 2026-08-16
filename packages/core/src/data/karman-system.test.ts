/**
 * Integration guard across three independently developed areas: the shipped
 * planet data, the loader that turns it into `Body` objects, and the orbital
 * math that derives sphere-of-influence radii and orbital periods from it.
 *
 * The reference values come from PLAN.md §5.7, where they are not decoration:
 * part masses, thrust and Isp are balanced against them, and the in-hangar
 * flight planner quotes them to the player. If the data drifts, a rocket that
 * used to reach orbit silently stops reaching it — this test makes that drift
 * fail loudly instead.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSystem } from './system-loader';

const HERE = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PATH = resolve(HERE, '../../../../data/systems/karman.json');

function loadKarman(): ReturnType<typeof loadSystem> {
  return loadSystem(JSON.parse(readFileSync(SYSTEM_PATH, 'utf8')) as unknown, SYSTEM_PATH);
}

function body(id: string) {
  const found = loadKarman().bodies.get(id);
  if (!found) throw new Error(`shipped system is missing body "${id}"`);
  return found;
}

describe('shipped karman system', () => {
  it('loads without a single validation issue', () => {
    const { issues } = loadKarman();
    expect(issues).toEqual([]);
  });

  it('matches the surface gravity PLAN.md §5.7 balances the parts against', () => {
    const terra = body('terra');
    const luna = body('luna');

    expect(terra.radius).toBe(1_000_000);
    expect(terra.mu / terra.radius ** 2).toBeCloseTo(9.81, 2);
    expect(luna.radius).toBe(300_000);
    expect(luna.mu / luna.radius ** 2).toBeCloseTo(1.6, 2);
  });

  it("derives Luna's sphere of influence to the documented 1 108 km", () => {
    // Not hardcoded in the data: the loader computes it from a·(mu/muParent)^0.4.
    expect(body('luna').soiRadius).toBeCloseTo(1_108_000, -4);
  });

  it('keeps a 100 km circular orbit at the 2 986 m/s the flight planner quotes', () => {
    const terra = body('terra');
    const speed = Math.sqrt(terra.mu / (terra.radius + 100_000));
    expect(speed).toBeCloseTo(2986, 0);
  });

  it("keeps Luna's period near the 8.2 h that makes transfer windows playable", () => {
    const terra = body('terra');
    const luna = body('luna');
    expect(luna.orbit).not.toBeNull();

    const periodHours = (2 * Math.PI * Math.sqrt(luna.orbit!.a ** 3 / terra.mu)) / 3600;
    expect(periodHours).toBeCloseTo(8.2, 1);
  });
});
