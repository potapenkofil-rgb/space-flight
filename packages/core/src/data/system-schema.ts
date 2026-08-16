/**
 * Structural validation of a parsed `data/systems/*.json` payload (PLAN.md
 * §5.7/§6). Mirrors `part-schema.ts`: never throws, returns {@link Issue}s
 * with actionable codes instead. Produces plain data (`RawBody[]`), not
 * `Body`s — building the `positionAt`/`velocityAt` closures and computing
 * `soiRadius` (PLAN.md §5.1) is `system-loader.ts`'s job, since that's where
 * the parent chain gets resolved.
 */
import { issue, type Issue } from './errors';

/** One body's orbit around its `parent`, as given in the system file — everything `orbitFromState`/`stateFromOrbit` need except `mu` (filled in from the parent at load time). */
export interface RawOrbit {
  readonly a: number;
  readonly e: number;
  readonly argPe: number;
  readonly m0: number;
  readonly epoch: number;
  readonly dir: 1 | -1;
}

/** One body entry from a system file, before the parent chain is resolved. */
export interface RawBody {
  readonly id: string;
  readonly mu: number;
  readonly radius: number;
  readonly rotationPeriod: number;
  readonly atmosphere: { readonly rho0: number; readonly scaleHeight: number; readonly top: number } | null;
  /** `null` for the system's root body. */
  readonly parent: string | null;
  /** `null` iff `parent` is `null`. */
  readonly orbit: RawOrbit | null;
}

export interface RawSystem {
  readonly id: string;
  readonly bodies: readonly RawBody[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function readAtmosphere(
  issues: Issue[],
  origin: string,
  raw: unknown,
  path: string
): { rho0: number; scaleHeight: number; top: number } | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (
    !isRecord(raw) ||
    !isFiniteNumber(raw['rho0']) ||
    !isFiniteNumber(raw['scaleHeight']) ||
    !isFiniteNumber(raw['top']) ||
    raw['rho0'] < 0 ||
    raw['scaleHeight'] <= 0 ||
    raw['top'] < 0
  ) {
    issues.push(
      issue(
        'ERR_SYSTEM_INVALID_FIELD',
        origin,
        path,
        `${path} must be null or { rho0: number >= 0, scaleHeight: number > 0, top: number >= 0 }`
      )
    );
    return undefined;
  }
  return { rho0: raw['rho0'], scaleHeight: raw['scaleHeight'], top: raw['top'] };
}

function readOrbit(issues: Issue[], origin: string, raw: unknown, path: string): RawOrbit | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) {
    issues.push(issue('ERR_SYSTEM_INVALID_FIELD', origin, path, `${path} must be an object or null`));
    return undefined;
  }
  const { a, e, argPe, m0, epoch, dir } = raw;
  if (
    !isFiniteNumber(a) ||
    a <= 0 ||
    !isFiniteNumber(e) ||
    e < 0 ||
    !isFiniteNumber(argPe) ||
    !isFiniteNumber(m0) ||
    !isFiniteNumber(epoch) ||
    (dir !== 1 && dir !== -1)
  ) {
    issues.push(
      issue(
        'ERR_SYSTEM_INVALID_FIELD',
        origin,
        path,
        `${path} must be { a: number > 0, e: number >= 0, argPe, m0, epoch: number, dir: 1 | -1 }`
      )
    );
    return undefined;
  }
  return { a, e, argPe, m0, epoch, dir };
}

function readOneBody(issues: Issue[], origin: string, raw: unknown, index: number): RawBody | undefined {
  const path = `bodies[${index}]`;
  if (!isRecord(raw)) {
    issues.push(issue('ERR_SYSTEM_INVALID_BODY', origin, path, `${path} must be an object`));
    return undefined;
  }
  const id = raw['id'];
  const mu = raw['mu'];
  const radius = raw['radius'];
  const rotationPeriod = raw['rotationPeriod'];
  const parent = raw['parent'];

  let valid = true;
  if (!isNonEmptyString(id)) {
    issues.push(issue('ERR_SYSTEM_INVALID_BODY', origin, `${path}.id`, `${path}.id must be a non-empty string`));
    valid = false;
  }
  if (!isFiniteNumber(mu) || mu <= 0) {
    issues.push(issue('ERR_SYSTEM_INVALID_FIELD', origin, `${path}.mu`, `${path}.mu must be a number > 0`));
    valid = false;
  }
  if (!isFiniteNumber(radius) || radius <= 0) {
    issues.push(issue('ERR_SYSTEM_INVALID_FIELD', origin, `${path}.radius`, `${path}.radius must be a number > 0`));
    valid = false;
  }
  if (!isFiniteNumber(rotationPeriod) || rotationPeriod <= 0) {
    issues.push(
      issue(
        'ERR_SYSTEM_INVALID_FIELD',
        origin,
        `${path}.rotationPeriod`,
        `${path}.rotationPeriod must be a number > 0`
      )
    );
    valid = false;
  }
  if (parent !== null && !isNonEmptyString(parent)) {
    issues.push(
      issue('ERR_SYSTEM_INVALID_FIELD', origin, `${path}.parent`, `${path}.parent must be a string or null`)
    );
    valid = false;
  }

  const atmosphere = readAtmosphere(issues, origin, raw['atmosphere'], `${path}.atmosphere`);
  const orbit = readOrbit(issues, origin, raw['orbit'], `${path}.orbit`);

  if (!valid || atmosphere === undefined || orbit === undefined) return undefined;
  if ((parent === null) !== (orbit === null)) {
    issues.push(
      issue(
        'ERR_SYSTEM_INVALID_FIELD',
        origin,
        `${path}.orbit`,
        `${path}.orbit must be present iff ${path}.parent is non-null`
      )
    );
    return undefined;
  }

  return {
    id: id as string,
    mu: mu as number,
    radius: radius as number,
    rotationPeriod: rotationPeriod as number,
    atmosphere,
    parent: parent as string | null,
    orbit,
  };
}

/** Validates a parsed system-file payload. `origin` is e.g. `"data/systems/karman"`. */
export function validateSystemFields(raw: unknown, origin: string): { system: RawSystem } | { issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isRecord(raw)) {
    return { issues: [issue('ERR_SYSTEM_INVALID_JSON', origin, '', 'system file must contain a JSON object')] };
  }
  const id = raw['id'];
  if (!isNonEmptyString(id)) {
    issues.push(issue('ERR_SYSTEM_MISSING_FIELD', origin, 'id', 'id must be a non-empty string'));
  }
  const bodiesRaw = raw['bodies'];
  if (!Array.isArray(bodiesRaw) || bodiesRaw.length === 0) {
    issues.push(issue('ERR_SYSTEM_MISSING_FIELD', origin, 'bodies', 'bodies must be a non-empty array'));
    return { issues };
  }
  const bodies: RawBody[] = [];
  for (let i = 0; i < bodiesRaw.length; i++) {
    const body = readOneBody(issues, origin, bodiesRaw[i], i);
    if (body) bodies.push(body);
  }
  if (issues.length > 0) return { issues };
  return { system: { id: id as string, bodies } };
}
