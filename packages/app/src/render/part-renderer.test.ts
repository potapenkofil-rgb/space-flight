/**
 * `parsePartArt`/`getParsedArt` are pure (no `Path2D`, no canvas), so they run
 * fine under jsdom, which has `DOMParser` but — unlike a real browser — no
 * `Path2D`/`CanvasRenderingContext2D` (PLAN.md §3.7 note: parsing lives in
 * `@karman/app` precisely because it needs `DOMParser`). `drawPart` itself is
 * exercised visually by the Playwright contact sheet
 * (`tests/e2e/contact-sheet.spec.ts`), not here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getParsedArt, parsePartArt } from './part-renderer';
import type { PartDef } from '@karman/core';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DATA_PARTS_DIR = join(REPO_ROOT, 'data', 'parts');

const ALLOWED_ROLES = new Set([
  'Ground',
  'Panel',
  'PanelAlt',
  'Hairline',
  'HairlineSoft',
  'Ink',
  'InkMuted',
  'Muted',
  'Burn',
  'BurnSoft',
  'Orbit',
  'OrbitSoft',
  'Nominal',
  'Warning',
  'Critical',
]);

describe('parsePartArt — every real data/parts/*/part.svg (self-check)', () => {
  const dirs = existsSync(DATA_PARTS_DIR) ? readdirSync(DATA_PARTS_DIR).sort() : [];

  it('found the 25 base part SVGs on disk', () => {
    expect(dirs).toHaveLength(25);
  });

  for (const id of dirs) {
    it(`${id}: parses with zero warnings, viewBox 64x64, only allowed elements/roles, stroke-width 2 outlines`, () => {
      const svg = readFileSync(join(DATA_PARTS_DIR, id, 'part.svg'), 'utf8');
      const art = parsePartArt(svg);
      expect(art.warnings).toEqual([]);
      expect(art.viewBox).toEqual({ w: 64, h: 64 });
      expect(art.shapes.length).toBeGreaterThan(0);
      for (const shape of art.shapes) {
        // DESIGN.md §4: the main outline stroke width is 2 viewBox units.
        if (shape.strokeRole !== null && shape.fillRole !== null) {
          expect(shape.strokeWidth).toBe(2);
        }
      }
    });
  }

  it('DESIGN.md §4: Burn is used sparingly — no part fills more than a few shapes with it', () => {
    for (const id of dirs) {
      const svg = readFileSync(join(DATA_PARTS_DIR, id, 'part.svg'), 'utf8');
      const art = parsePartArt(svg);
      const burnFills = art.shapes.filter((s) => s.fillRole === 'burn' || s.strokeRole === 'burn').length;
      expect(burnFills, `${id} uses Burn on ${burnFills} shapes`).toBeLessThanOrEqual(6);
    }
  });

  it('every color role attribute used across the roster is a real DESIGN.md §1 role name', () => {
    const roleAttrRe = /(?:fill|stroke)="([^"]+)"/g;
    for (const id of dirs) {
      const svg = readFileSync(join(DATA_PARTS_DIR, id, 'part.svg'), 'utf8');
      for (const match of svg.matchAll(roleAttrRe)) {
        const value = match[1] as string;
        if (value === 'none') continue;
        expect(ALLOWED_ROLES.has(value), `${id}: unexpected role name "${value}"`).toBe(true);
      }
    }
  });
});

describe('parsePartArt — supported shape subset (PLAN.md §3.7)', () => {
  it('parses <path>, <rect>, <circle>, <line>, <polygon>', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <path d="M0 0 L10 10" fill="none" stroke="InkMuted" stroke-width="2"/>
      <rect x="1" y="2" width="3" height="4" fill="Panel"/>
      <circle cx="5" cy="6" r="7" fill="Burn"/>
      <line x1="0" y1="0" x2="1" y2="1" stroke="HairlineSoft"/>
      <polygon points="0,0 1,0 1,1" fill="Panel" stroke="InkMuted" stroke-width="2"/>
    </svg>`;
    const art = parsePartArt(svg);
    expect(art.warnings).toEqual([]);
    expect(art.shapes.map((s) => s.geometry.kind)).toEqual(['path', 'rect', 'circle', 'line', 'polygon']);
  });

  it('ignores unsupported elements (e.g. <g>) with a warning, and does not throw', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <g><rect x="0" y="0" width="1" height="1" fill="Panel"/></g>
      <circle cx="1" cy="1" r="1" fill="Panel"/>
    </svg>`;
    const art = parsePartArt(svg);
    expect(art.shapes).toHaveLength(1); // only the top-level <circle>; the <g> and its children are skipped
    expect(art.warnings.some((w) => w.includes('<g>'))).toBe(true);
  });

  it('an unknown color role is dropped (treated as no fill/stroke) with a warning, not thrown', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect x="0" y="0" width="1" height="1" fill="Chartreuse"/>
    </svg>`;
    const art = parsePartArt(svg);
    expect(art.shapes[0]?.fillRole).toBeNull();
    expect(art.warnings.some((w) => w.includes('Chartreuse'))).toBe(true);
  });

  it('a polygon with fewer than 3 points is skipped with a warning', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <polygon points="0,0 1,1" fill="Panel"/>
    </svg>`;
    const art = parsePartArt(svg);
    expect(art.shapes).toEqual([]);
    expect(art.warnings.length).toBeGreaterThan(0);
  });
});

describe('parsePartArt — malformed input never throws (PLAN.md §6.2 philosophy applied to art)', () => {
  it('completely non-SVG text parses to zero shapes plus a warning', () => {
    expect(() => parsePartArt('not xml at all <<<')).not.toThrow();
    const art = parsePartArt('this is not svg');
    expect(art.shapes).toEqual([]);
    expect(art.warnings.length).toBeGreaterThan(0);
  });

  it('missing viewBox falls back to a default instead of throwing', () => {
    const art = parsePartArt('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="Panel"/></svg>');
    expect(art.viewBox).toEqual({ w: 64, h: 64 });
  });
});

describe('getParsedArt — caching', () => {
  function fakePart(svg: string): PartDef {
    return {
      id: 'fake',
      name: { en: 'Fake', ru: 'test-ru-name' },
      description: { en: '', ru: '' },
      category: 'structural',
      dryMass: 1,
      resources: [],
      engine: null,
      dragArea: 0,
      nodeStrength: 1,
      maxLandingSpeed: 0,
      crossfeed: false,
      nodes: [],
      bounds: { w: 1, h: 1 },
      art: { viewBox: { w: 64, h: 64 }, svg },
    };
  }

  it('returns the same parsed object on repeated calls for the same part.art', () => {
    const part = fakePart('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="Panel"/></svg>');
    expect(getParsedArt(part)).toBe(getParsedArt(part));
  });

  it('does not share cache entries between two distinct parts, even with identical SVG text', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="Panel"/></svg>';
    const a = fakePart(svg);
    const b = fakePart(svg);
    expect(getParsedArt(a)).not.toBe(getParsedArt(b));
  });
});
