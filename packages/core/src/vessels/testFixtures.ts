/**
 * Shared, minimal builders for `@karman/core` vessel/flight tests (Agent B).
 * Not part of the public barrel (`vessels/index.ts`/`flight/index.ts` don't
 * re-export this file) — imported directly by `*.test.ts` files across
 * `vessels/` and `flight/`. Kept out of the DOM-guard's concern (it's a
 * `.ts` file so the guard still scans it, but it touches no DOM globals).
 */
import type { Body } from '../orbits/types';
import { ZERO, type Vec2 } from '../math/vec2';
import type { AttachNode, EngineSpec, PartArt, PartDef } from './parts';
import type { PartInstance, Vessel } from './vessel';

const EMPTY_ART: PartArt = {
  viewBox: { w: 64, h: 64 },
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>',
};

let nextInstanceId = 0;

/** Resets the auto-incrementing `PartInstance.id` counter used by {@link makePartInstance}. */
export function resetFixtureIds(): void {
  nextInstanceId = 0;
}

export function makePartDef(overrides: Partial<PartDef> & { id: string }): PartDef {
  return {
    name: { en: overrides.id, ru: overrides.id },
    description: { en: '', ru: '' },
    category: 'structural',
    dryMass: 100,
    resources: [],
    engine: null,
    dragArea: 0,
    nodeStrength: 1e9,
    maxLandingSpeed: 0,
    crossfeed: false,
    nodes: [] as AttachNode[],
    bounds: { w: 1, h: 1 },
    art: EMPTY_ART,
    ...overrides,
  };
}

export function makeEngineSpec(overrides: Partial<EngineSpec> = {}): EngineSpec {
  return {
    thrustVac: 100_000,
    thrustSl: 90_000,
    ispVac: 300,
    ispSl: 270,
    gimbal: 0,
    minThrottle: 0,
    fuel: 'fuel',
    ...overrides,
  };
}

export function makePartInstance(
  def: PartDef,
  overrides: Partial<Omit<PartInstance, 'def'>> = {}
): PartInstance {
  const id = overrides.id ?? nextInstanceId++;
  return {
    partId: def.id,
    def,
    position: ZERO,
    rotation: 0,
    resources: {},
    ...overrides,
    id,
  };
}

export function makeBody(overrides: Partial<Body> = {}): Body {
  return {
    id: 'testbody',
    mu: 9.81e12,
    radius: 1_000_000,
    soiRadius: 1e12,
    rotationPeriod: Number.POSITIVE_INFINITY,
    atmosphere: null,
    parent: null,
    orbit: null,
    positionAt: () => ZERO,
    velocityAt: () => ZERO,
    ...overrides,
  };
}

export function makeVessel(overrides: Partial<Vessel> = {}): Vessel {
  return {
    id: 1,
    parts: [],
    joints: [],
    stages: [],
    currentStage: 0,
    position: ZERO,
    velocity: ZERO,
    rotation: 0,
    angularVelocity: 0,
    soi: makeBody(),
    railOrbit: null,
    mass: { total: 0, com: ZERO, inertia: 0 },
    ...overrides,
  };
}

/** Gravitational acceleration at `position` for a body with parameter `mu` — `a = −μ·r̂/|r|²`, PLAN.md §5.1. */
export function gravityAt(position: Vec2, mu: number): Vec2 {
  const r2 = position.x * position.x + position.y * position.y;
  const r = Math.sqrt(r2);
  if (r === 0) return ZERO;
  const scale = -mu / (r2 * r);
  return { x: position.x * scale, y: position.y * scale };
}
