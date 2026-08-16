/**
 * The data bridge (PLAN.md §7 stage 2 / §6.2): the one place in `@karman/app`
 * that turns `data/parts/<id>/{part.json,part.svg}` and
 * `data/systems/karman.json` on disk into the real `PartLibrary`/`SystemLibrary`
 * the rest of the game codes against. `@karman/core`'s loader/validator
 * (`packages/core/src/data/**`) does the actual parsing and validation — this
 * module's only job is the browser-specific part core cannot do itself
 * (PLAN.md §2: zero DOM/runtime access in `core`): reading the files.
 *
 * Vite's `import.meta.glob(..., { eager: true, query: '?raw' })` inlines every
 * matched file's contents as a string at build time, so this needs no
 * `fetch`/`fs` at runtime and works identically in `pnpm dev`, `vite build`
 * and Playwright.
 *
 * Per PLAN.md §6.2, a broken part must never crash the game — validation
 * issues are collected into `ContentLoadResult.issues`, not thrown. A missing
 * *system*, however, is a fatal content error (there is no game without a
 * planet to launch from), so that one case does throw with a clear message.
 *
 * Mods (`mods/*`, PLAN.md §6.2's "each `mods/` folder in alphabetical order,
 * `id` collision overrides with a log entry") are NOT loaded here yet. Wiring
 * a second `import.meta.glob('../../../../mods/*∕parts/*∕part.json', ...)`
 * pass through the same `loadParts`/`compareLoadOrigin` merge is
 * straightforward — the loader already supports it (`compareLoadOrigin` ranks
 * every `data/` origin before every `mods/<name>/` origin) — but doing so
 * safely also wants a "mods with load errors" menu affordance (PLAN.md §6.2)
 * this integration pass didn't have time to build a home for. Left as a
 * follow-up; see the orchestrator report.
 */
import {
  compareLoadOrigin,
  createPartLibrary,
  createSystemLibrary,
  loadParts,
  loadSystem,
  type Body,
  type Issue,
  type PartLibrary,
  type PartOverride,
  type PartSourceFile,
  type SystemLibrary,
} from '@karman/core';

export interface ContentLoadResult {
  readonly library: PartLibrary;
  readonly system: SystemLibrary;
  /**
   * Every body in the system, flat (root plus every child), in ascending-id
   * order. `SystemLibrary` itself only exposes `root`/`get(id)` (PLAN.md §4)
   * — deliberately narrow — but the map's focus switcher and
   * `createTrajectoryPredictor` (its own doc: "needs the flat list of every
   * body in the system up front") both need to enumerate every body, so this
   * bridge keeps the flat list `loadSystem` already produces internally
   * instead of discarding it.
   */
  readonly bodies: readonly Body[];
  /** Every part validation problem, part or system (PLAN.md §6.2) — never fatal. */
  readonly issues: readonly Issue[];
  /** Every part `id` collision resolved while merging (empty until mods are wired — see module doc). */
  readonly overrides: readonly PartOverride[];
}

// `data/` lives four directories above this file (packages/app/src/data/content.ts
// -> packages/app/src -> packages/app -> packages -> repo root -> data/...).
// Vite's `import.meta.glob` transform requires the options to be an object
// literal written inline at the call site (not a shared constant), so the
// same `{ eager: true, query: '?raw', import: 'default' }` is repeated below.
const partJsonModules = import.meta.glob('../../../../data/parts/*/part.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const partSvgModules = import.meta.glob('../../../../data/parts/*/part.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const systemJsonModules = import.meta.glob('../../../../data/systems/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const PART_JSON_PATH_RE = /\/data\/parts\/([^/]+)\/part\.json$/;

function buildPartSources(): PartSourceFile[] {
  const sources: PartSourceFile[] = [];
  for (const [path, json] of Object.entries(partJsonModules)) {
    const match = PART_JSON_PATH_RE.exec(path);
    const folderId = match?.[1];
    if (!folderId) continue; // defensive: glob pattern already guarantees this shape
    const svgPath = path.slice(0, -'part.json'.length) + 'part.svg';
    const svg = svgPath in partSvgModules ? (partSvgModules[svgPath] ?? null) : null;
    sources.push({ origin: `data/parts/${folderId}`, folderId, json, svg });
  }
  // PLAN.md §6.2: `data/` loads first (alphabetically within it, for determinism —
  // §3.6 forbids relying on object/glob enumeration order).
  sources.sort((a, b) => compareLoadOrigin(a.origin, b.origin) || (a.folderId < b.folderId ? -1 : a.folderId > b.folderId ? 1 : 0));
  return sources;
}

let cached: ContentLoadResult | null = null;

/**
 * Loads and validates every part under `data/parts/` and the base system
 * under `data/systems/karman.json`, returning ready-to-use
 * `PartLibrary`/`SystemLibrary` instances. Computed once and cached — the
 * underlying files are baked into the JS bundle by Vite, so there is nothing
 * to invalidate at runtime.
 *
 * @throws if `data/systems/karman.json` itself is missing, unparsable, or
 *   fails validation — there is no sensible game state with no system loaded.
 */
export function loadContent(): ContentLoadResult {
  if (cached) return cached;

  const partsResult = loadParts(buildPartSources());
  const library = createPartLibrary(partsResult.parts);

  const systemEntries = Object.entries(systemJsonModules);
  const karmanEntry = systemEntries.find(([path]) => path.endsWith('/systems/karman.json'));
  const chosen = karmanEntry ?? systemEntries[0];
  if (!chosen) {
    throw new Error('data: no system file found under data/systems/*.json');
  }
  const [systemOrigin, systemJsonText] = chosen;

  let rawSystem: unknown;
  try {
    rawSystem = JSON.parse(systemJsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`data: ${systemOrigin} is not valid JSON: ${detail}`);
  }

  const systemResult = loadSystem(rawSystem, 'data/systems/karman.json');
  const issues: Issue[] = [...partsResult.issues, ...systemResult.issues];
  if (!systemResult.root) {
    const detail = systemResult.issues.map((i) => `${i.code}: ${i.message}`).join('; ');
    throw new Error(`data: failed to load data/systems/karman.json: ${detail}`);
  }

  const system = createSystemLibrary(systemResult.root, systemResult.bodies);
  const bodies: Body[] = [...systemResult.bodies.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  cached = { library, system, bodies, issues, overrides: partsResult.overrides };
  return cached;
}
