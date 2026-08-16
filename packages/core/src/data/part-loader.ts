/**
 * Combines `part.json` + `part.svg` text into validated `PartDef`s and merges
 * `data/` with `mods/*` per PLAN.md §6.2: `data/` loads first, then each
 * `mods/` folder in alphabetical order; an `id` collision overrides the
 * earlier part and is logged as a {@link PartOverride}, never silently. A
 * broken part (bad JSON, failed validation, missing/malformed SVG) is
 * skipped — collected in `issues` — and never stops the rest of the load
 * (PLAN.md §6.2: a broken part must never crash the game).
 *
 * This module does no filesystem/network I/O itself (PLAN.md §2: `@karman/core`
 * has zero DOM/runtime access) — callers (Vite's `import.meta.glob` in
 * `@karman/app`, or `node:fs` in tests) are responsible for producing the raw
 * `PartSourceFile[]` this loader consumes, already in load order.
 */
import type { PartDef } from '../vessels/parts';
import { issue, type Issue } from './errors';
import { validatePartFields } from './part-schema';
import { extractViewBox } from './svg-meta';

/** One `part.json` + `part.svg` pair as read from disk, not yet parsed or validated. */
export interface PartSourceFile {
  /** Human-readable source, e.g. `"data/parts/tank_s1"` or `"mods/example/parts/strut_truss"`. Used in issue/override logs. */
  readonly origin: string;
  /** The folder name the files were read from, e.g. `"tank_s1"` — `part.json`'s `id` must match this. */
  readonly folderId: string;
  /** Raw `part.json` text (not yet `JSON.parse`d). */
  readonly json: string;
  /** Raw `part.svg` text, or `null` if the file was missing. */
  readonly svg: string | null;
}

/** A validation/parse problem for one `PartSourceFile`, with the part skipped as a result. */
export type PartLoadIssue = Issue;

/** Logged when a later source's part `id` replaced an earlier one (PLAN.md §6.2). */
export interface PartOverride {
  readonly id: string;
  readonly previousOrigin: string;
  readonly newOrigin: string;
}

export interface LoadPartsResult {
  /** Successfully loaded parts after merging, in deterministic ascending-`id` order. */
  readonly parts: readonly PartDef[];
  /** Every part that failed to load, and why. Does not include successfully-overridden parts. */
  readonly issues: readonly PartLoadIssue[];
  /** Every `id` collision, in the order it was resolved. */
  readonly overrides: readonly PartOverride[];
}

const REQUIRED_VIEW_BOX = { w: 64, h: 64 };

function loadOne(source: PartSourceFile): { part: PartDef } | { issues: Issue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(source.json);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { issues: [issue('ERR_PART_INVALID_JSON', source.origin, '', `part.json is not valid JSON: ${detail}`)] };
  }

  const fieldsResult = validatePartFields(raw, source.origin, source.folderId);
  if ('issues' in fieldsResult) return fieldsResult;

  if (source.svg === null) {
    return { issues: [issue('ERR_PART_MISSING_SVG', source.origin, '', 'part.svg is missing')] };
  }
  const viewBox = extractViewBox(source.svg);
  if (viewBox === null) {
    return {
      issues: [issue('ERR_PART_INVALID_SVG', source.origin, '', 'part.svg has no valid <svg viewBox="...">')],
    };
  }
  if (viewBox.minX !== 0 || viewBox.minY !== 0 || viewBox.w !== REQUIRED_VIEW_BOX.w || viewBox.h !== REQUIRED_VIEW_BOX.h) {
    return {
      issues: [
        issue(
          'ERR_PART_INVALID_SVG',
          source.origin,
          '',
          `part.svg viewBox must be "0 0 64 64", found "${viewBox.minX} ${viewBox.minY} ${viewBox.w} ${viewBox.h}"`
        ),
      ],
    };
  }

  return {
    part: {
      ...fieldsResult.fields,
      art: { viewBox: { w: viewBox.w, h: viewBox.h }, svg: source.svg },
    },
  };
}

/**
 * Loads and merges every `PartSourceFile`, in the order given (the caller is
 * responsible for ordering `data/` before `mods/*` alphabetically, per
 * PLAN.md §6.2 — see {@link compareLoadOrigin}).
 */
export function loadParts(sources: readonly PartSourceFile[]): LoadPartsResult {
  const issues: PartLoadIssue[] = [];
  const overrides: PartOverride[] = [];
  const byId = new Map<string, { part: PartDef; origin: string }>();

  for (const source of sources) {
    const result = loadOne(source);
    if ('issues' in result) {
      issues.push(...result.issues);
      continue;
    }
    const existing = byId.get(result.part.id);
    if (existing !== undefined) {
      overrides.push({ id: result.part.id, previousOrigin: existing.origin, newOrigin: source.origin });
    }
    byId.set(result.part.id, { part: result.part, origin: source.origin });
  }

  const parts = [...byId.values()].map((entry) => entry.part).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { parts, issues, overrides };
}

/**
 * Orders two source origins per PLAN.md §6.2: every `"data/..."` origin
 * sorts before every `"mods/..."` origin; among `"mods/<name>/..."` origins,
 * `<name>` is compared alphabetically. Origins that match neither shape sort
 * after everything (defensive default, should not occur for real content).
 * Exposed for the app-level file lister to order `PartSourceFile[]` before
 * calling {@link loadParts}; `loadParts` itself trusts the given order.
 */
export function compareLoadOrigin(a: string, b: string): number {
  const rank = (origin: string): [number, string] => {
    if (origin.startsWith('data/')) return [0, ''];
    const modMatch = /^mods\/([^/]+)\//.exec(origin);
    if (modMatch) return [1, modMatch[1] as string];
    return [2, origin];
  };
  const [rankA, keyA] = rank(a);
  const [rankB, keyB] = rank(b);
  if (rankA !== rankB) return rankA - rankB;
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}
