/**
 * Contact sheet for the 25-part v1 roster (PLAN.md §7 Agent E acceptance:
 * "Контактный лист всех деталей одним скриншотом в отчёте"). Draws every
 * `data/parts/*` part through a real Chromium `Path2D`/canvas pipeline (not
 * jsdom — `@karman/app`'s `render/part-renderer.ts` unit tests only cover the
 * DOM-parsing half, since jsdom has no `Path2D`; this is the actual visual
 * proof).
 *
 * This spec re-implements, in a small self-contained browser-side script, the
 * same three rules `render/part-renderer.ts` and DESIGN.md §4 define: SVG
 * role names substituted for the *dark*-theme hex palette (mirroring
 * `packages/app/src/ui/tokens.css`), the part's own local frame (Y-up SVG
 * units, origin at the bottom stack node) mapped onto its `bounds`, and a
 * screen-constant outline width. It intentionally does not import
 * `@karman/app` — this file lives outside Agent E's zone
 * (`packages/app/src/render/part-renderer.ts` only), so it stays a
 * standalone diagnostic fixture under `tests/e2e/`, alongside `smoke.spec.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(THIS_DIR, '..', '..');
const DATA_PARTS_DIR = join(REPO_ROOT, 'data', 'parts');

interface PartFixture {
  readonly id: string;
  readonly category: string;
  readonly boundsW: number;
  readonly boundsH: number;
  readonly svg: string;
}

function loadFixtures(): PartFixture[] {
  return readdirSync(DATA_PARTS_DIR)
    .sort()
    .map((id) => {
      const dir = join(DATA_PARTS_DIR, id);
      const json = JSON.parse(readFileSync(join(dir, 'part.json'), 'utf8')) as {
        category: string;
        bounds: { w: number; h: number };
      };
      return {
        id,
        category: json.category,
        boundsW: json.bounds.w,
        boundsH: json.bounds.h,
        svg: readFileSync(join(dir, 'part.svg'), 'utf8'),
      };
    });
}

test('contact sheet — all 25 parts render through Path2D (DESIGN.md §4)', async ({ page }) => {
  const parts = loadFixtures();
  expect(parts).toHaveLength(25);

  await page.goto(`file://${join(THIS_DIR, 'contact-sheet.html')}`);

  const cellCount = await page.evaluate((partsArg: PartFixture[]) => {
    // Dark-theme hex palette (DESIGN.md §1 / packages/app/src/ui/tokens.css) — mirrored here
    // because this fixture is a standalone page, not part of the app bundle.
    const ROLE_HEX: Record<string, string> = {
      Ground: '#070a11',
      Panel: '#0d131e',
      PanelAlt: '#121a28',
      Hairline: '#22304a',
      HairlineSoft: '#182337',
      Ink: '#dee6f1',
      InkMuted: '#a3b0c4',
      Muted: '#6d7c93',
      Burn: '#ff7a2f',
      BurnSoft: '#5a2e12',
      Orbit: '#8fb4d9',
      OrbitSoft: '#26405e',
      Nominal: '#5fcb8b',
      Warning: '#f2c14e',
      Critical: '#ff5a5a',
    };
    const CELL_PX = 140;
    const PADDING_PX = 16;

    function colorOf(role: string | null): string | null {
      if (role === null || role === 'none' || role === '') return null;
      return ROLE_HEX[role] ?? null;
    }

    function drawShape(ctx: CanvasRenderingContext2D, el: Element, scaleX: number): void {
      const tag = el.tagName.toLowerCase();
      let path: Path2D | null = null;
      switch (tag) {
        case 'path':
          path = new Path2D(el.getAttribute('d') ?? '');
          break;
        case 'rect': {
          path = new Path2D();
          const x = Number(el.getAttribute('x') ?? 0);
          const y = Number(el.getAttribute('y') ?? 0);
          const w = Number(el.getAttribute('width') ?? 0);
          const h = Number(el.getAttribute('height') ?? 0);
          const rx = Number(el.getAttribute('rx') ?? 0);
          if (rx > 0) path.roundRect(x, y, w, h, rx);
          else path.rect(x, y, w, h);
          break;
        }
        case 'circle': {
          path = new Path2D();
          path.arc(Number(el.getAttribute('cx') ?? 0), Number(el.getAttribute('cy') ?? 0), Number(el.getAttribute('r') ?? 0), 0, Math.PI * 2);
          break;
        }
        case 'line': {
          path = new Path2D();
          path.moveTo(Number(el.getAttribute('x1') ?? 0), Number(el.getAttribute('y1') ?? 0));
          path.lineTo(Number(el.getAttribute('x2') ?? 0), Number(el.getAttribute('y2') ?? 0));
          break;
        }
        case 'polygon': {
          path = new Path2D();
          const pts = (el.getAttribute('points') ?? '')
            .trim()
            .split(/\s+/)
            .map((pair) => pair.split(',').map(Number));
          pts.forEach((p, i) => {
            if (i === 0) path!.moveTo(p[0] ?? 0, p[1] ?? 0);
            else path!.lineTo(p[0] ?? 0, p[1] ?? 0);
          });
          path.closePath();
          break;
        }
        default:
          return; // unsupported element — ignored, matches part-renderer.ts
      }

      const fill = colorOf(el.getAttribute('fill'));
      const stroke = colorOf(el.getAttribute('stroke'));
      const strokeWidth = Number(el.getAttribute('stroke-width') ?? 2);
      const deviceScale = Math.abs(scaleX);

      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill(path);
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = deviceScale > 0 ? strokeWidth / deviceScale : strokeWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(path);
      }
    }

    const sheet = document.getElementById('sheet')!;
    for (const part of partsArg) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      const canvas = document.createElement('canvas');
      canvas.width = CELL_PX;
      canvas.height = CELL_PX;
      const ctx = canvas.getContext('2d')!;

      const doc = new DOMParser().parseFromString(part.svg, 'image/svg+xml');
      const svgEl = doc.documentElement;
      const viewBoxAttr = svgEl.getAttribute('viewBox') ?? '0 0 64 64';
      const vbParts = viewBoxAttr.trim().split(/\s+/).map(Number);
      const vbW = vbParts[2] ?? 64;
      const vbH = vbParts[3] ?? 64;

      // Fit the part's own aspect ratio (bounds.w x bounds.h, metres) inside the cell,
      // leaving padding — exactly the "one SVG, drawn at catalog scale" rule (DESIGN.md §4).
      const available = CELL_PX - PADDING_PX * 2;
      const aspect = part.boundsW / part.boundsH;
      let drawW = available;
      let drawH = available / aspect;
      if (drawH > available) {
        drawH = available;
        drawW = available * aspect;
      }
      const pixelsPerMeter = drawW / part.boundsW;

      // Anchored at `vbH` (the viewBox's *bottom* edge), not `0`: every real
      // `data/parts/**/part.svg` is authored the ordinary way (nose near
      // `y = 0`, base near `y = vbH` — see `render/part-renderer.ts`'s
      // `drawPart` doc for the concrete example and why an anchor at `0`
      // silently draws every part upside down).
      const scaleX = (part.boundsW / vbW) * pixelsPerMeter;
      const scaleY = (part.boundsH / vbH) * pixelsPerMeter;

      ctx.save();
      ctx.translate(CELL_PX / 2, CELL_PX / 2 + drawH / 2);
      ctx.scale(scaleX, scaleY);
      ctx.translate(-vbW / 2, -vbH);
      for (const child of Array.from(svgEl.children)) drawShape(ctx, child, scaleX);
      ctx.restore();

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = part.id;
      const category = document.createElement('div');
      category.className = 'category';
      category.textContent = part.category;

      cell.appendChild(canvas);
      cell.appendChild(label);
      cell.appendChild(category);
      sheet.appendChild(cell);
    }
    return sheet.children.length;
  }, parts);

  expect(cellCount).toBe(25);

  await page.screenshot({ path: join(THIS_DIR, 'screenshots', 'contact-sheet.png'), fullPage: true });
});
