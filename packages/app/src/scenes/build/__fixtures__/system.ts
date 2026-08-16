/**
 * FIXTURE — stand-in for Agent E's real `SystemLibrary` (`packages/core/src/data/**`
 * + `data/systems/karman.json`, PLAN.md §7, Agent E's zone). That loader doesn't exist
 * yet in this worktree, so the hangar (flight-plan ΔV math, checklist gravity
 * lookups) is coded against this local fixture instead of `throw`ing.
 *
 * Numbers match PLAN.md §5.7 exactly (Terra/Luna mu, radius, atmosphere) so the
 * derived figures — SOI radius, Luna's orbital period, circular-orbit speed —
 * reproduce the plan's own reference values (§5.7's checked figures) rather than
 * being copied from them, which is the whole point: swapping this fixture for
 * the real `SystemLibrary` later must not change any UI-visible number.
 *
 * ORCHESTRATOR TODO: replace the import of `FIXTURE_SYSTEM` (and the `Body`s it
 * exposes) with the real `SystemLibrary` from `@karman/core` + Agent E's loader
 * once `data/systems/karman.json` lands. Every consumer in this scene reaches
 * bodies only through the `SystemLibrary` contract (`root`, `get(id)`), so the
 * swap is a one-line import change in `BuildScene.ts` and `flightPlan.ts`.
 */
import { v2, type Body, type SystemLibrary, type Vec2 } from '@karman/core';

/** `R_soi = a · (μ_body / μ_parent)^0.4` — PLAN.md §5.1, applied to Luna around Terra. */
function soiRadius(semiMajorAxis: number, muBody: number, muParent: number): number {
  return semiMajorAxis * Math.pow(muBody / muParent, 0.4);
}

/** `T = 2π√(a³/μ)` — used only to give the Luna fixture a plausible rotation period. */
function keplerPeriod(semiMajorAxis: number, muParent: number): number {
  return 2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxis, 3) / muParent);
}

const TERRA_MU = 9.81e12;
const TERRA_RADIUS = 1_000_000;
const LUNA_MU = 1.44e11;
const LUNA_RADIUS = 300_000;
const LUNA_ORBIT_A = 6_000_000;
const LUNA_PERIOD = keplerPeriod(LUNA_ORBIT_A, TERRA_MU);

const ZERO: Vec2 = { x: 0, y: 0 };

export const FIXTURE_TERRA: Body = {
  id: 'terra',
  mu: TERRA_MU,
  radius: TERRA_RADIUS,
  soiRadius: Number.POSITIVE_INFINITY, // root body — no parent SOI to bound it
  rotationPeriod: 86_164,
  atmosphere: { rho0: 1.225, scaleHeight: 7_000, top: 60_000 },
  parent: null,
  orbit: null,
  positionAt: () => ZERO,
  velocityAt: () => ZERO,
};

export const FIXTURE_LUNA: Body = {
  id: 'luna',
  mu: LUNA_MU,
  radius: LUNA_RADIUS,
  soiRadius: soiRadius(LUNA_ORBIT_A, LUNA_MU, TERRA_MU),
  rotationPeriod: LUNA_PERIOD,
  atmosphere: null,
  parent: FIXTURE_TERRA,
  orbit: { a: LUNA_ORBIT_A, e: 0.02, argPe: 0, m0: 0, epoch: 0, mu: TERRA_MU, dir: 1 },
  positionAt: (t: number) => {
    const theta = (2 * Math.PI * t) / LUNA_PERIOD;
    return v2.add(FIXTURE_TERRA.positionAt(t), v2.scale({ x: Math.cos(theta), y: Math.sin(theta) }, LUNA_ORBIT_A));
  },
  velocityAt: (t: number) => {
    const omega = (2 * Math.PI) / LUNA_PERIOD;
    const theta = omega * t;
    const tangent = { x: -Math.sin(theta), y: Math.cos(theta) };
    return v2.add(FIXTURE_TERRA.velocityAt(t), v2.scale(tangent, LUNA_ORBIT_A * omega));
  },
};

const BODIES = new Map<string, Body>([
  [FIXTURE_TERRA.id, FIXTURE_TERRA],
  [FIXTURE_LUNA.id, FIXTURE_LUNA],
]);

export const FIXTURE_SYSTEM: SystemLibrary = {
  root: FIXTURE_TERRA,
  get(id: string): Body {
    const body = BODIES.get(id);
    if (!body) throw new Error(`FIXTURE_SYSTEM: unknown body "${id}"`);
    return body;
  },
};

/** Local surface gravity `g = μ/r²`, m/s² — used by checklist + flight-plan ascent-loss estimates. */
export function surfaceGravity(body: Body): number {
  return body.mu / (body.radius * body.radius);
}
