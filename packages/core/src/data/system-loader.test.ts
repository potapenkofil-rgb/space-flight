/**
 * `data/systems/karman.json` must match PLAN.md §5.7's numbers exactly — this
 * is what every part's balance is tuned against — plus the loader's error
 * handling for malformed system files (PLAN.md §6.2's "battle-tested loader"
 * requirement extends to bodies, not just parts). Also loads
 * `mods/example/systems/example.json` to prove a modder-authored system file
 * round-trips through the same loader (PLAN.md §7: mods/example ships one
 * part and one body as living documentation for modders).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSystem } from './system-loader';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('loadSystem — data/systems/karman.json (PLAN.md §5.7)', () => {
  const raw = readJson(join(REPO_ROOT, 'data', 'systems', 'karman.json'));
  const result = loadSystem(raw, 'data/systems/karman');

  it('loads with zero issues', () => {
    expect(result.issues).toEqual([]);
    expect(result.root).toBeDefined();
  });

  it('Terra is the root with the exact §5.7 numbers', () => {
    const terra = result.root!;
    expect(terra.id).toBe('terra');
    expect(terra.parent).toBeNull();
    expect(terra.radius).toBe(1_000_000);
    expect(terra.mu).toBeCloseTo(9.81e12, -1);
    expect(terra.soiRadius).toBe(Number.POSITIVE_INFINITY);
    expect(terra.atmosphere).toEqual({ rho0: 1.225, scaleHeight: 7000, top: 60000 });
    // g0 at the surface: mu / r^2 should be ~9.81 m/s^2 (PLAN.md §5.7's "g0 surface" column).
    expect(terra.mu / terra.radius ** 2).toBeCloseTo(9.81, 2);
  });

  it('Luna orbits Terra with the exact §5.7 numbers', () => {
    const luna = result.bodies.get('luna');
    expect(luna).toBeDefined();
    expect(luna?.parent?.id).toBe('terra');
    expect(luna?.radius).toBe(300_000);
    expect(luna?.mu).toBeCloseTo(1.44e11, -1);
    expect(luna?.orbit?.a).toBe(6_000_000);
    expect(luna?.orbit?.e).toBe(0.02);
    expect(luna?.atmosphere).toBeNull();
  });

  it('Luna SOI is ≈1,108,000 m (§5.7), computed from a·(μ_luna/μ_terra)^0.4, not hardcoded', () => {
    const luna = result.bodies.get('luna')!;
    expect(luna.soiRadius).toBeGreaterThan(1_100_000);
    expect(luna.soiRadius).toBeLessThan(1_117_000);
  });

  it('Luna orbital period is ≈8.2 h (§5.7): 2π√(a³/μ_terra)', () => {
    const luna = result.bodies.get('luna')!;
    const period = 2 * Math.PI * Math.sqrt(luna.orbit!.a ** 3 / luna.orbit!.mu);
    expect(period / 3600).toBeCloseTo(8.2, 1);
  });
});

describe('loadSystem — mods/example/systems/example.json (living documentation)', () => {
  it('the example mod system loads cleanly through the same loader', () => {
    const raw = readJson(join(REPO_ROOT, 'mods', 'example', 'systems', 'example.json'));
    const result = loadSystem(raw, 'mods/example/systems/example');
    expect(result.issues).toEqual([]);
    expect(result.root?.id).toBe('example_body');
  });
});

describe('loadSystem — malformed input never throws (PLAN.md §6.2)', () => {
  it('rejects a non-object payload', () => {
    const result = loadSystem('nope', 'test');
    expect(result.root).toBeUndefined();
    expect(result.issues[0]?.code).toBe('ERR_SYSTEM_INVALID_JSON');
  });

  it('reports ERR_SYSTEM_UNKNOWN_PARENT for a dangling parent reference', () => {
    const raw = {
      id: 'broken',
      bodies: [{ id: 'a', mu: 1, radius: 1, rotationPeriod: 1, atmosphere: null, parent: 'ghost', orbit: { a: 1, e: 0, argPe: 0, m0: 0, epoch: 0, dir: 1 } }],
    };
    const result = loadSystem(raw, 'test');
    expect(result.issues.some((i) => i.code === 'ERR_SYSTEM_UNKNOWN_PARENT')).toBe(true);
  });

  it('reports ERR_SYSTEM_NO_ROOT when every body has a parent', () => {
    const raw = {
      id: 'broken',
      bodies: [
        { id: 'a', mu: 1, radius: 1, rotationPeriod: 1, atmosphere: null, parent: 'b', orbit: { a: 1, e: 0, argPe: 0, m0: 0, epoch: 0, dir: 1 } },
        { id: 'b', mu: 1, radius: 1, rotationPeriod: 1, atmosphere: null, parent: 'a', orbit: { a: 1, e: 0, argPe: 0, m0: 0, epoch: 0, dir: 1 } },
      ],
    };
    const result = loadSystem(raw, 'test');
    expect(result.issues.some((i) => i.code === 'ERR_SYSTEM_NO_ROOT')).toBe(true);
  });

  it('reports ERR_SYSTEM_MULTIPLE_ROOTS when two bodies have no parent', () => {
    const raw = {
      id: 'broken',
      bodies: [
        { id: 'a', mu: 1, radius: 1, rotationPeriod: 1, atmosphere: null, parent: null, orbit: null },
        { id: 'b', mu: 1, radius: 1, rotationPeriod: 1, atmosphere: null, parent: null, orbit: null },
      ],
    };
    const result = loadSystem(raw, 'test');
    expect(result.issues.some((i) => i.code === 'ERR_SYSTEM_MULTIPLE_ROOTS')).toBe(true);
  });

  it('reports ERR_SYSTEM_DUPLICATE_BODY for two bodies sharing an id', () => {
    const raw = {
      id: 'broken',
      bodies: [
        { id: 'a', mu: 1, radius: 1, rotationPeriod: 1, atmosphere: null, parent: null, orbit: null },
        { id: 'a', mu: 2, radius: 2, rotationPeriod: 2, atmosphere: null, parent: null, orbit: null },
      ],
    };
    const result = loadSystem(raw, 'test');
    expect(result.issues.some((i) => i.code === 'ERR_SYSTEM_DUPLICATE_BODY')).toBe(true);
  });
});
