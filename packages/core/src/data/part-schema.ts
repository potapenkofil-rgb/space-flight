/**
 * Deep structural validation of a parsed `part.json` payload against `PartDef`
 * (PLAN.md §6.1). Never throws on malformed input — a broken part must not
 * crash the game (PLAN.md §6.2) — it instead returns a list of {@link Issue}s
 * with actionable codes like `ERR_PART_INVALID_NODE`.
 *
 * This module validates everything a `PartDef` needs *except* `art`: the
 * `part.svg` companion file is a separate loader concern (see
 * `part-loader.ts`), since only it knows whether the SVG file was even found.
 */
import type { Vec2 } from '../math/vec2';
import type {
  AttachNode,
  EngineSpec,
  LocalizedText,
  NodeKind,
  PartCategory,
  PartDef,
  ResourceCapacity,
} from '../vessels/parts';
import { issue, type Issue } from './errors';

/** Every `PartDef` field except `art`, which the loader attaches separately. */
export type PartFields = Omit<PartDef, 'art'>;

const PART_ID_RE = /^[a-z][a-z0-9_]*$/;
const CATEGORIES: readonly PartCategory[] = [
  'pod',
  'tanks',
  'engines',
  'boosters',
  'separators',
  'fairings',
  'parachutes',
  'legs',
  'rcs',
  'power',
  'docking',
  'adapters',
  'control',
  'structural',
  'lights',
];
const NODE_KINDS: readonly NodeKind[] = ['stack', 'radial', 'docking'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

class Validator {
  readonly issues: Issue[] = [];
  constructor(private readonly origin: string) {}

  fail(code: Issue['code'], path: string, message: string): void {
    this.issues.push(issue(code, this.origin, path, message));
  }

  ok(): boolean {
    return this.issues.length === 0;
  }
}

function readLocalizedText(v: Validator, raw: unknown, path: string): LocalizedText | null {
  if (!isRecord(raw)) {
    v.fail('ERR_PART_MISSING_FIELD', path, `"${path}" must be an object with "en"/"ru" strings`);
    return null;
  }
  const en = raw['en'];
  const ru = raw['ru'];
  if (!isNonEmptyString(en) || !isNonEmptyString(ru)) {
    v.fail('ERR_PART_MISSING_FIELD', path, `"${path}" must have non-empty "en" and "ru" strings`);
    return null;
  }
  return { en, ru };
}

function readResources(v: Validator, raw: unknown): ResourceCapacity[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    v.fail('ERR_PART_INVALID_RESOURCE', 'resources', '"resources" must be an array');
    return null;
  }
  const out: ResourceCapacity[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const path = `resources[${i}]`;
    if (!isRecord(entry) || !isNonEmptyString(entry['id']) || !isFiniteNumber(entry['capacity'])) {
      v.fail('ERR_PART_INVALID_RESOURCE', path, `${path} must be { id: string, capacity: number }`);
      continue;
    }
    if (entry['capacity'] < 0) {
      v.fail('ERR_PART_INVALID_RESOURCE', `${path}.capacity`, `${path}.capacity must be >= 0`);
      continue;
    }
    out.push({ id: entry['id'], capacity: entry['capacity'] });
  }
  return v.ok() ? out : null;
}

function readEngine(v: Validator, raw: unknown): EngineSpec | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) {
    v.fail('ERR_PART_INVALID_ENGINE', 'engine', '"engine" must be an object or null');
    return undefined;
  }
  const { thrustVac, thrustSl, ispVac, ispSl, gimbalDeg, minThrottle, fuel } = raw;
  const numericFields: Array<[string, unknown]> = [
    ['thrustVac', thrustVac],
    ['thrustSl', thrustSl],
    ['ispVac', ispVac],
    ['ispSl', ispSl],
    ['gimbalDeg', gimbalDeg],
    ['minThrottle', minThrottle],
  ];
  let valid = true;
  for (const [name, value] of numericFields) {
    if (!isFiniteNumber(value) || value < 0) {
      v.fail('ERR_PART_INVALID_ENGINE', `engine.${name}`, `engine.${name} must be a number >= 0`);
      valid = false;
    }
  }
  if (!isNonEmptyString(fuel)) {
    v.fail('ERR_PART_INVALID_ENGINE', 'engine.fuel', 'engine.fuel must be a non-empty string');
    valid = false;
  }
  if (!valid) return undefined;
  const throttle = minThrottle as number;
  if (throttle > 1) {
    v.fail('ERR_PART_INVALID_ENGINE', 'engine.minThrottle', 'engine.minThrottle must be <= 1');
    return undefined;
  }
  return {
    thrustVac: thrustVac as number,
    thrustSl: thrustSl as number,
    ispVac: ispVac as number,
    ispSl: ispSl as number,
    gimbal: ((gimbalDeg as number) * Math.PI) / 180,
    minThrottle: throttle,
    fuel: fuel as string,
  };
}

function readVec2(v: Validator, raw: unknown, path: string): Vec2 | null {
  if (!Array.isArray(raw) || raw.length !== 2 || !isFiniteNumber(raw[0]) || !isFiniteNumber(raw[1])) {
    v.fail('ERR_PART_INVALID_NODE', path, `${path} must be a 2-element array of finite numbers`);
    return null;
  }
  return { x: raw[0], y: raw[1] };
}

function readNodes(v: Validator, raw: unknown): AttachNode[] | null {
  if (!Array.isArray(raw)) {
    v.fail('ERR_PART_INVALID_NODE', 'nodes', '"nodes" must be an array');
    return null;
  }
  const out: AttachNode[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const path = `nodes[${i}]`;
    if (!isRecord(entry)) {
      v.fail('ERR_PART_INVALID_NODE', path, `${path} must be an object`);
      continue;
    }
    const pos = readVec2(v, entry['pos'], `${path}.pos`);
    const dir = readVec2(v, entry['dir'], `${path}.dir`);
    const size = entry['size'];
    const kind = entry['kind'];
    if (pos === null || dir === null) continue;
    if (dir.x === 0 && dir.y === 0) {
      v.fail('ERR_PART_INVALID_NODE', `${path}.dir`, `${path}.dir must not be the zero vector`);
      continue;
    }
    if (!isFiniteNumber(size) || size <= 0) {
      v.fail('ERR_PART_INVALID_NODE', `${path}.size`, `${path}.size must be a number > 0`);
      continue;
    }
    if (typeof kind !== 'string' || !NODE_KINDS.includes(kind as NodeKind)) {
      v.fail(
        'ERR_PART_INVALID_NODE',
        `${path}.kind`,
        `${path}.kind must be one of ${NODE_KINDS.join(', ')}`
      );
      continue;
    }
    const len = Math.hypot(dir.x, dir.y);
    out.push({ pos, dir: { x: dir.x / len, y: dir.y / len }, size, kind: kind as NodeKind });
  }
  return v.ok() ? out : null;
}

/**
 * Validates a parsed `part.json` payload. `origin` is a human-readable source
 * identifier for error messages (e.g. `"data/parts/tank_s1"`); `expectedId`,
 * when given, is the folder name the file was loaded from — `id` must match
 * it exactly, catching copy-pasted part folders that forgot to rename `id`.
 */
export function validatePartFields(
  raw: unknown,
  origin: string,
  expectedId?: string
): { fields: PartFields } | { issues: Issue[] } {
  const v = new Validator(origin);

  if (!isRecord(raw)) {
    v.fail('ERR_PART_INVALID_JSON', '', 'part.json must contain a JSON object');
    return { issues: v.issues };
  }

  const id = raw['id'];
  if (!isNonEmptyString(id) || !PART_ID_RE.test(id)) {
    v.fail('ERR_PART_INVALID_ID', 'id', 'id must be a lowercase snake_case identifier');
  } else if (expectedId !== undefined && id !== expectedId) {
    v.fail(
      'ERR_PART_INVALID_ID',
      'id',
      `id "${id}" does not match its folder "${expectedId}"`
    );
  }

  const name = readLocalizedText(v, raw['name'], 'name');
  const description = readLocalizedText(v, raw['description'], 'description');

  const category = raw['category'];
  if (typeof category !== 'string' || !CATEGORIES.includes(category as PartCategory)) {
    v.fail('ERR_PART_INVALID_CATEGORY', 'category', `category must be one of ${CATEGORIES.join(', ')}`);
  }

  const dryMass = raw['dryMass'];
  if (!isFiniteNumber(dryMass) || dryMass <= 0) {
    v.fail('ERR_PART_INVALID_FIELD', 'dryMass', 'dryMass must be a number > 0');
  }

  const resources = readResources(v, raw['resources']);
  const engine = readEngine(v, raw['engine']);

  const dragArea = raw['dragArea'];
  if (!isFiniteNumber(dragArea) || dragArea < 0) {
    v.fail('ERR_PART_INVALID_FIELD', 'dragArea', 'dragArea must be a number >= 0');
  }

  const nodeStrength = raw['nodeStrength'];
  if (!isFiniteNumber(nodeStrength) || nodeStrength <= 0) {
    v.fail('ERR_PART_INVALID_FIELD', 'nodeStrength', 'nodeStrength must be a number > 0');
  }

  const maxLandingSpeed = raw['maxLandingSpeed'] ?? 0;
  if (!isFiniteNumber(maxLandingSpeed) || maxLandingSpeed < 0) {
    v.fail('ERR_PART_INVALID_FIELD', 'maxLandingSpeed', 'maxLandingSpeed must be a number >= 0');
  }

  const crossfeed = raw['crossfeed'];
  if (typeof crossfeed !== 'boolean') {
    v.fail('ERR_PART_INVALID_FIELD', 'crossfeed', 'crossfeed must be a boolean');
  }

  const nodes = readNodes(v, raw['nodes']);

  const boundsRaw = raw['bounds'];
  let bounds: { w: number; h: number } | null = null;
  if (
    !isRecord(boundsRaw) ||
    !isFiniteNumber(boundsRaw['w']) ||
    !isFiniteNumber(boundsRaw['h']) ||
    boundsRaw['w'] <= 0 ||
    boundsRaw['h'] <= 0
  ) {
    v.fail('ERR_PART_INVALID_FIELD', 'bounds', 'bounds must be { w: number > 0, h: number > 0 }');
  } else {
    bounds = { w: boundsRaw['w'], h: boundsRaw['h'] };
  }

  if (
    !v.ok() ||
    name === null ||
    description === null ||
    resources === null ||
    engine === undefined ||
    nodes === null ||
    bounds === null
  ) {
    return { issues: v.issues };
  }

  return {
    fields: {
      id: id as string,
      name,
      description,
      category: category as PartCategory,
      dryMass: dryMass as number,
      resources,
      engine,
      dragArea: dragArea as number,
      nodeStrength: nodeStrength as number,
      maxLandingSpeed: maxLandingSpeed as number,
      crossfeed: crossfeed as boolean,
      nodes,
      bounds,
    },
  };
}
