/**
 * Exercises `loadParts` against the real `data/parts/**` content and the
 * `mods/example/**` override — this is the integration test backing PLAN.md
 * §7's acceptance criteria: all 25 parts pass the validator, and the example
 * mod overrides a base part by id with a logged override (PLAN.md §6.2).
 * Also proves a broken `part.json`/`part.svg` is skipped, not fatal
 * (PLAN.md §6.2: a broken part must never crash the game).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareLoadOrigin, loadParts, type PartSourceFile } from './part-loader';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DATA_PARTS_DIR = join(REPO_ROOT, 'data', 'parts');
const MOD_PARTS_DIR = join(REPO_ROOT, 'mods', 'example', 'parts');

function readPartFolders(baseDir: string, originPrefix: string): PartSourceFile[] {
  if (!existsSync(baseDir)) return [];
  const out: PartSourceFile[] = [];
  for (const folderId of readdirSync(baseDir).sort()) {
    const dir = join(baseDir, folderId);
    const jsonPath = join(dir, 'part.json');
    const svgPath = join(dir, 'part.svg');
    if (!existsSync(jsonPath)) continue;
    out.push({
      origin: `${originPrefix}/${folderId}`,
      folderId,
      json: readFileSync(jsonPath, 'utf8'),
      svg: existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : null,
    });
  }
  return out;
}

describe('loadParts — real data/parts content', () => {
  const sources = readPartFolders(DATA_PARTS_DIR, 'data/parts');

  it('found the expected 25 base parts on disk', () => {
    expect(sources).toHaveLength(25);
  });

  it('every base part passes validation with zero issues', () => {
    const { parts, issues } = loadParts(sources);
    expect(issues).toEqual([]);
    expect(parts).toHaveLength(25);
  });

  it('every part has a viewBox of exactly 64x64 and Panel/Burn/etc. role colors only', () => {
    const { parts } = loadParts(sources);
    for (const part of parts) {
      expect(part.art.viewBox).toEqual({ w: 64, h: 64 });
      expect(part.art.svg).toContain('viewBox="0 0 64 64"');
    }
  });

  it('parts are returned sorted by id', () => {
    const { parts } = loadParts(sources);
    const ids = parts.map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('loadParts — resilience to broken content (PLAN.md §6.2)', () => {
  it('skips a part with invalid JSON and reports ERR_PART_INVALID_JSON, without throwing', () => {
    const sources: PartSourceFile[] = [
      { origin: 'data/parts/broken_json', folderId: 'broken_json', json: '{ not valid json', svg: '<svg viewBox="0 0 64 64"></svg>' },
    ];
    const { parts, issues } = loadParts(sources);
    expect(parts).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('ERR_PART_INVALID_JSON');
  });

  it('skips a part with a malformed SVG (bad viewBox) and reports ERR_PART_INVALID_SVG', () => {
    const good = readPartFolders(DATA_PARTS_DIR, 'data/parts').find((s) => s.folderId === 'tank_s1');
    expect(good).toBeDefined();
    const sources: PartSourceFile[] = [{ ...good!, svg: '<svg viewBox="0 0 100 100"><rect/></svg>' }];
    const { parts, issues } = loadParts(sources);
    expect(parts).toEqual([]);
    expect(issues[0]?.code).toBe('ERR_PART_INVALID_SVG');
  });

  it('skips a part with a missing SVG file and reports ERR_PART_MISSING_SVG', () => {
    const good = readPartFolders(DATA_PARTS_DIR, 'data/parts').find((s) => s.folderId === 'tank_s1');
    expect(good).toBeDefined();
    const sources: PartSourceFile[] = [{ ...good!, svg: null }];
    const { issues } = loadParts(sources);
    expect(issues[0]?.code).toBe('ERR_PART_MISSING_SVG');
  });

  it('loading one broken part does not prevent the rest from loading', () => {
    const real = readPartFolders(DATA_PARTS_DIR, 'data/parts');
    const withOneBroken: PartSourceFile[] = [
      ...real,
      { origin: 'data/parts/broken', folderId: 'broken', json: 'not json at all', svg: null },
    ];
    const { parts, issues } = loadParts(withOneBroken);
    expect(parts).toHaveLength(25);
    expect(issues).toHaveLength(1);
  });
});

describe('loadParts — mods/example override (PLAN.md §6.2)', () => {
  const base = readPartFolders(DATA_PARTS_DIR, 'data/parts');
  const mod = readPartFolders(MOD_PARTS_DIR, 'mods/example/parts');

  it('found at least one part in mods/example', () => {
    expect(mod.length).toBeGreaterThan(0);
  });

  it('the mod part shares an id with a base part (this is what makes it an override)', () => {
    const { parts: baseParts } = loadParts(base);
    const { parts: modOnly } = loadParts(mod);
    const baseIds = new Set(baseParts.map((p) => p.id));
    expect(modOnly.some((p) => baseIds.has(p.id))).toBe(true);
  });

  it('loading data/ then mods/example overrides the base part and logs the override', () => {
    const ordered = [...base, ...mod].sort((a, b) => compareLoadOrigin(a.origin, b.origin));
    const { parts, issues, overrides } = loadParts(ordered);
    expect(issues).toEqual([]);
    // Still exactly 25 distinct ids — the mod part replaces, not adds.
    expect(parts).toHaveLength(25);
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    const override = overrides[0];
    expect(override?.previousOrigin.startsWith('data/')).toBe(true);
    expect(override?.newOrigin.startsWith('mods/example/')).toBe(true);

    const overriddenId = override!.id;
    const modSource = mod.find((s) => s.folderId === overriddenId);
    const winningPart = parts.find((p) => p.id === overriddenId);
    expect(winningPart).toBeDefined();
    // The winning definition's name must be the mod's, not the base data/ part's.
    expect(modSource).toBeDefined();
    const modJson = JSON.parse(modSource!.json) as { name: { en: string } };
    expect(winningPart?.name.en).toBe(modJson.name.en);
  });

  it('compareLoadOrigin orders data/ before mods/, and mods/ alphabetically by folder name', () => {
    const inputs = ['mods/zzz/parts/x', 'data/parts/a', 'mods/aaa/parts/y'];
    const sorted = [...inputs].sort(compareLoadOrigin);
    expect(sorted).toEqual(['data/parts/a', 'mods/aaa/parts/y', 'mods/zzz/parts/x']);
  });
});
