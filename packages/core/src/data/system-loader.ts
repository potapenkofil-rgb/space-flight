/**
 * Builds a `Body` tree (PLAN.md §4) from a validated system file. Computes
 * each non-root body's `soiRadius` from its orbit via PLAN.md §5.1:
 * `R_soi = a · (μ_body/μ_parent)^0.4` — the data file only supplies `a`, `e`
 * and the other orbital elements, never `soiRadius` directly, so a modder
 * cannot accidentally desync the two.
 *
 * `positionAt`/`velocityAt` for a non-root body are defined in terms of
 * `stateFromOrbit` (PLAN.md §4, implemented by Agent A) composed with the
 * parent's own `positionAt`/`velocityAt` — this loader does not duplicate
 * that math.
 */
import { v2, type Vec2 } from '../math/vec2';
import { stateFromOrbit } from '../orbits/kepler';
import type { Body, Orbit } from '../orbits/types';
import { issue, type Issue } from './errors';
import { validateSystemFields, type RawBody } from './system-schema';

export interface LoadSystemResult {
  /** The root body, or `undefined` if loading failed (see `issues`). */
  readonly root: Body | undefined;
  /** Every body, keyed by id (including the root). Empty if loading failed. */
  readonly bodies: ReadonlyMap<string, Body>;
  readonly issues: readonly Issue[];
}

/** `R_soi = a · (μ_body/μ_parent)^0.4` (PLAN.md §5.1). */
function sphereOfInfluence(orbit: RawOrbitLike, muBody: number, muParent: number): number {
  return orbit.a * Math.pow(muBody / muParent, 0.4);
}

interface RawOrbitLike {
  readonly a: number;
}

function buildBody(raw: RawBody, parent: Body | null, orbit: Orbit | null, soiRadius: number): Body {
  const body: Body = {
    id: raw.id,
    mu: raw.mu,
    radius: raw.radius,
    soiRadius,
    rotationPeriod: raw.rotationPeriod,
    atmosphere: raw.atmosphere,
    parent,
    orbit,
    positionAt(t: number): Vec2 {
      if (parent === null || orbit === null) return { x: 0, y: 0 };
      return v2.add(parent.positionAt(t), stateFromOrbit(orbit, t).r);
    },
    velocityAt(t: number): Vec2 {
      if (parent === null || orbit === null) return { x: 0, y: 0 };
      return v2.add(parent.velocityAt(t), stateFromOrbit(orbit, t).v);
    },
  };
  return body;
}

/**
 * Parses and links a system file's raw JSON into a `Body` tree. `origin` is
 * a human-readable source identifier for issue messages.
 */
export function loadSystem(raw: unknown, origin: string): LoadSystemResult {
  const fieldsResult = validateSystemFields(raw, origin);
  if ('issues' in fieldsResult) return { root: undefined, bodies: new Map(), issues: fieldsResult.issues };

  const { bodies: rawBodies } = fieldsResult.system;
  const issues: Issue[] = [];

  const byId = new Map<string, RawBody>();
  for (const b of rawBodies) {
    if (byId.has(b.id)) {
      issues.push(issue('ERR_SYSTEM_DUPLICATE_BODY', origin, `bodies[id=${b.id}]`, `duplicate body id "${b.id}"`));
      continue;
    }
    byId.set(b.id, b);
  }

  const roots = [...byId.values()].filter((b) => b.parent === null);
  if (roots.length === 0) {
    issues.push(issue('ERR_SYSTEM_NO_ROOT', origin, 'bodies', 'system has no body with parent: null'));
  } else if (roots.length > 1) {
    issues.push(
      issue(
        'ERR_SYSTEM_MULTIPLE_ROOTS',
        origin,
        'bodies',
        `system has ${roots.length} bodies with parent: null, expected exactly one`
      )
    );
  }
  for (const b of byId.values()) {
    if (b.parent !== null && !byId.has(b.parent)) {
      issues.push(
        issue('ERR_SYSTEM_UNKNOWN_PARENT', origin, `bodies[id=${b.id}].parent`, `unknown parent body "${b.parent}"`)
      );
    }
  }
  if (issues.length > 0) return { root: undefined, bodies: new Map(), issues };

  const built = new Map<string, Body>();
  const visiting = new Set<string>();

  function resolve(id: string): Body | undefined {
    const existing = built.get(id);
    if (existing) return existing;
    if (visiting.has(id)) {
      issues.push(issue('ERR_SYSTEM_CYCLE', origin, `bodies[id=${id}]`, `parent cycle involving "${id}"`));
      return undefined;
    }
    visiting.add(id);
    const raw = byId.get(id);
    if (!raw) return undefined;
    if (raw.parent === null) {
      const body = buildBody(raw, null, null, Number.POSITIVE_INFINITY);
      built.set(id, body);
      visiting.delete(id);
      return body;
    }
    const parent = resolve(raw.parent);
    if (!parent || !raw.orbit) return undefined;
    const orbit: Orbit = {
      a: raw.orbit.a,
      e: raw.orbit.e,
      argPe: raw.orbit.argPe,
      m0: raw.orbit.m0,
      epoch: raw.orbit.epoch,
      mu: parent.mu,
      dir: raw.orbit.dir,
    };
    const soiRadius = sphereOfInfluence(raw.orbit, raw.mu, parent.mu);
    const body = buildBody(raw, parent, orbit, soiRadius);
    built.set(id, body);
    visiting.delete(id);
    return body;
  }

  for (const id of byId.keys()) resolve(id);

  if (issues.length > 0) return { root: undefined, bodies: new Map(), issues };

  const rootRaw = roots[0];
  const root = rootRaw ? built.get(rootRaw.id) : undefined;
  return { root, bodies: built, issues: [] };
}
