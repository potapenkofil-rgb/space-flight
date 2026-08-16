/**
 * World (de)serialization to the format PLAN.md §6.3 mandates: "everything in
 * readable, pretty-printed JSON — a broken orbit should be readable and
 * fixable by eye." Two things follow from that:
 *
 * - object keys are sorted alphabetically on write, so the same world always
 *   produces byte-identical JSON (no dependency on `Object`/`Map` insertion
 *   order — PLAN.md §3.6) and diffs/hand-edits are predictable;
 * - `Vessel.soi` (a `Body`, which carries functions and can't round-trip
 *   through JSON) is stored as just `Body.id` and re-resolved through a
 *   `SystemLibrary` on load, exactly like `PartInstance.partId` already
 *   resolves through a `PartLibrary` elsewhere in the codebase.
 */
import type { Orbit } from '../orbits/types';
import type { SystemLibrary } from '../data/types';
import type { JointLink, MassProperties, PartInstance, Stage, Vessel } from '../vessels/vessel';

const CURRENT_VERSION = 1;

/** `PartInstance` with no changes — already plain, JSON-safe data. */
export type SerializedPartInstance = PartInstance;

/** `Vessel` with `soi` replaced by `Body.id` (a `Body` itself can't survive a JSON round trip — it carries `positionAt`/`velocityAt` functions). */
export interface SerializedVessel {
  readonly id: number;
  readonly parts: readonly SerializedPartInstance[];
  readonly joints: readonly JointLink[];
  readonly stages: readonly Stage[];
  readonly currentStage: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly velocity: { readonly x: number; readonly y: number };
  readonly rotation: number;
  readonly angularVelocity: number;
  /** `Body.id` of the SOI this vessel occupies — resolved back to a real `Body` via `SystemLibrary` on load. */
  readonly soi: string;
  readonly railOrbit: Orbit | null;
  readonly mass: MassProperties;
}

/** On-disk shape of `saves/worlds/<name>/world.json` (PLAN.md §6.3). */
export interface SerializedWorld {
  readonly version: 1;
  readonly name: string;
  readonly time: number;
  readonly activeVesselId: number | null;
  readonly vessels: readonly SerializedVessel[];
}

export function toSerializedVessel(v: Vessel): SerializedVessel {
  return {
    id: v.id,
    parts: v.parts,
    joints: v.joints,
    stages: v.stages,
    currentStage: v.currentStage,
    position: v.position,
    velocity: v.velocity,
    rotation: v.rotation,
    angularVelocity: v.angularVelocity,
    soi: v.soi.id,
    railOrbit: v.railOrbit,
    mass: v.mass,
  };
}

export function fromSerializedVessel(sv: SerializedVessel, system: SystemLibrary): Vessel {
  return {
    id: sv.id,
    parts: sv.parts.map((p) => ({ ...p, resources: { ...p.resources } })),
    joints: sv.joints.slice(),
    stages: sv.stages.map((s) => ({ index: s.index, partIds: s.partIds.slice() })),
    currentStage: sv.currentStage,
    position: sv.position,
    velocity: sv.velocity,
    rotation: sv.rotation,
    angularVelocity: sv.angularVelocity,
    soi: system.get(sv.soi),
    railOrbit: sv.railOrbit,
    mass: sv.mass,
  };
}

function assertFiniteDeep(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`serializeWorld: non-finite number at ${path} (${String(value)})`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteDeep(item, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertFiniteDeep(item, `${path}.${key}`);
  }
}

/** Returns a structurally-identical copy of `value` with every object's keys sorted alphabetically (arrays keep their order). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, item] of sortedEntries) out[key] = sortKeysDeep(item);
    return out;
  }
  return value;
}

/**
 * Serializes `world` to readable, pretty-printed, key-sorted JSON (PLAN.md
 * §6.3). Throws if `world` contains a non-finite number (`NaN`/`Infinity`)
 * anywhere — `JSON.stringify` would otherwise silently turn those into
 * `null`, corrupting the save without any error.
 */
export function serializeWorld(world: {
  readonly name: string;
  readonly time: number;
  readonly activeVesselId: number | null;
  readonly vessels: readonly Vessel[];
}): string {
  const payload: SerializedWorld = {
    version: CURRENT_VERSION,
    name: world.name,
    time: world.time,
    activeVesselId: world.activeVesselId,
    vessels: world.vessels
      .slice()
      .sort((a, b) => a.id - b.id)
      .map(toSerializedVessel),
  };
  assertFiniteDeep(payload, 'world');
  return `${JSON.stringify(sortKeysDeep(payload), null, 2)}\n`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec2(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    isFiniteNumber((value as { x?: unknown }).x) &&
    isFiniteNumber((value as { y?: unknown }).y)
  );
}

/** Validates the parsed JSON has the shape of a `SerializedWorld`, throwing a descriptive error otherwise. Deliberately permissive about part/joint/stage internals (those are Agent E/B's data shapes) — it checks the world-level envelope this module owns. */
function validateSerializedWorld(raw: unknown): SerializedWorld {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('parseWorld: expected a JSON object at the top level');
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== CURRENT_VERSION) {
    throw new Error(`parseWorld: unsupported save version "${String(obj['version'])}" (expected ${CURRENT_VERSION})`);
  }
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    throw new Error('parseWorld: "name" must be a non-empty string');
  }
  if (!isFiniteNumber(obj['time'])) {
    throw new Error('parseWorld: "time" must be a finite number');
  }
  if (obj['activeVesselId'] !== null && !isFiniteNumber(obj['activeVesselId'])) {
    throw new Error('parseWorld: "activeVesselId" must be a number or null');
  }
  if (!Array.isArray(obj['vessels'])) {
    throw new Error('parseWorld: "vessels" must be an array');
  }
  obj['vessels'].forEach((v, i) => {
    if (typeof v !== 'object' || v === null) {
      throw new Error(`parseWorld: vessels[${i}] must be an object`);
    }
    const vessel = v as Record<string, unknown>;
    if (!isFiniteNumber(vessel['id'])) throw new Error(`parseWorld: vessels[${i}].id must be a number`);
    if (typeof vessel['soi'] !== 'string' || vessel['soi'].length === 0) {
      throw new Error(`parseWorld: vessels[${i}].soi must be a non-empty body id string`);
    }
    if (!isVec2(vessel['position'])) throw new Error(`parseWorld: vessels[${i}].position must be {x, y}`);
    if (!isVec2(vessel['velocity'])) throw new Error(`parseWorld: vessels[${i}].velocity must be {x, y}`);
    if (!Array.isArray(vessel['parts'])) throw new Error(`parseWorld: vessels[${i}].parts must be an array`);
  });

  return raw as SerializedWorld;
}

/**
 * Parses `json` (as written by {@link serializeWorld}) back into a `World`
 * (fields matching `saves/types.ts`'s `World`). `system` resolves each
 * vessel's `soi` body id back into a real `Body`.
 */
export function parseWorld(
  json: string,
  system: SystemLibrary
): { name: string; time: number; activeVesselId: number | null; vessels: Vessel[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`parseWorld: invalid JSON (${(error as Error).message})`);
  }
  const payload = validateSerializedWorld(raw);
  const vessels = payload.vessels
    .map((sv) => fromSerializedVessel(sv, system))
    .sort((a, b) => a.id - b.id);
  return {
    name: payload.name,
    time: payload.time,
    activeVesselId: payload.activeVesselId,
    vessels,
  };
}
