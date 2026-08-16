/**
 * Blueprint save/load (PLAN.md §6.3: a blueprint is `saves/blueprints/<name>.json`
 * — parts, joints, stages — with a `localStorage` fallback carrying the same
 * interface in dev mode, so the game still runs in a plain browser for tests).
 * This scene runs
 * entirely in the browser (Tauri's FS-backed save path is Agent F's zone,
 * `packages/app/src/ui/replay/**`/`packages/core/src/saves/**`), so blueprints
 * are stored in `localStorage` under the same human-readable-JSON contract —
 * swapping the storage backend later only touches `saveBlueprint`/`loadBlueprint`/`listBlueprints`.
 */
import type { BuildState, PlacedPart, StageBucket, SymmetryCount, SymmetryGroup } from './state';

const STORAGE_PREFIX = 'karman:blueprint:';
const INDEX_KEY = 'karman:blueprints';
export const BLUEPRINT_FORMAT_VERSION = 1;

export interface BlueprintDocument {
  readonly formatVersion: number;
  readonly name: string;
  readonly savedAt: string; // ISO 8601
  readonly parts: readonly PlacedPart[];
  readonly joints: BuildState['joints'];
  readonly symmetryGroups: readonly SymmetryGroup[];
  readonly stages: readonly StageBucket[];
  readonly symmetryMode: SymmetryCount;
  readonly nextInstanceId: number;
  readonly nextJointId: number;
  readonly nextStageOrdinal: number;
}

export function serializeBlueprint(state: BuildState, name: string, now = () => new Date()): BlueprintDocument {
  return {
    formatVersion: BLUEPRINT_FORMAT_VERSION,
    name,
    savedAt: now().toISOString(),
    parts: state.parts,
    joints: state.joints,
    symmetryGroups: state.symmetryGroups,
    stages: state.stages,
    symmetryMode: state.symmetryMode,
    nextInstanceId: state.nextInstanceId,
    nextJointId: state.nextJointId,
    nextStageOrdinal: state.nextStageOrdinal,
  };
}

export function deserializeBlueprint(doc: BlueprintDocument): BuildState {
  if (doc.formatVersion !== BLUEPRINT_FORMAT_VERSION) {
    throw new Error(`deserializeBlueprint: unsupported format version ${doc.formatVersion}`);
  }
  return {
    parts: doc.parts.map((p) => ({ ...p, position: { ...p.position }, resources: { ...p.resources } })),
    joints: [...doc.joints],
    symmetryGroups: doc.symmetryGroups.map((g) => ({ ...g, memberInstanceIds: [...g.memberInstanceIds] })),
    stages: doc.stages.map((s) => ({ ...s, partIds: [...s.partIds] })),
    symmetryMode: doc.symmetryMode,
    selectedInstanceId: null,
    nextInstanceId: doc.nextInstanceId,
    nextJointId: doc.nextJointId,
    nextStageOrdinal: doc.nextStageOrdinal,
  };
}

function storageKey(name: string): string {
  return `${STORAGE_PREFIX}${name}`;
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(names: readonly string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(names));
}

/** Saves `state` under `name`, pretty-printed (PLAN.md §6.3: human-readable, formatted JSON), overwriting any existing blueprint of the same name. */
export function saveBlueprint(state: BuildState, name: string): void {
  const doc = serializeBlueprint(state, name);
  localStorage.setItem(storageKey(name), JSON.stringify(doc, null, 2));
  const names = readIndex();
  if (!names.includes(name)) writeIndex([...names, name].sort((a, b) => a.localeCompare(b)));
}

/** Loads a previously saved blueprint by name. Returns `null` if it doesn't exist or fails to parse. */
export function loadBlueprint(name: string): BuildState | null {
  try {
    const raw = localStorage.getItem(storageKey(name));
    if (!raw) return null;
    const doc = JSON.parse(raw) as BlueprintDocument;
    return deserializeBlueprint(doc);
  } catch {
    return null;
  }
}

/** Every saved blueprint's name, alphabetically. */
export function listBlueprints(): readonly string[] {
  return readIndex();
}

export function deleteBlueprint(name: string): void {
  localStorage.removeItem(storageKey(name));
  writeIndex(readIndex().filter((n) => n !== name));
}
