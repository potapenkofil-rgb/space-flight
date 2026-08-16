/**
 * Turns a `PartDef.art.svg` string into drawable primitives, per PLAN.md §3.7
 * and DESIGN.md §4: parsed once via `DOMParser` (browser-only, which is why
 * this lives in `@karman/app` and not `@karman/core`), colors are role names
 * (`fill="Panel"`) substituted for the active theme's token at draw time (not
 * baked in), and stroke width is drawn in constant **screen** pixels so a part
 * never "thickens" on zoom.
 *
 * This is a local equivalent of the real `part-renderer.ts` Agent E's zone
 * (`packages/app/src/render/part-renderer.ts`) is expected to own — no
 * contract for it is pinned in PLAN.md §4, so this hangar-local version reads
 * exactly the same `PartArt` shape and can be swapped for the real one later
 * without touching any other file in this scene (see `catalog.ts`/
 * `workspaceRenderer.ts`, the only two call sites).
 */
import { getColor, type ColorRole } from '../../ui/tokens';
import type { PartArt } from '@karman/core';

const ROLE_NAMES = new Set<string>([
  'ground',
  'panel',
  'panelAlt',
  'hairline',
  'hairlineSoft',
  'ink',
  'inkMuted',
  'muted',
  'burn',
  'burnSoft',
  'orbit',
  'orbitSoft',
  'nominal',
  'warning',
  'critical',
]);

/** `fill="Panel"` -> `'panel'`, matching `ui/tokens.ts`'s `ColorRole` casing. `"none"` and unknown/missing values pass through untouched. */
function roleFromAttr(value: string | null): ColorRole | 'none' | null {
  if (!value || value === 'none') return value === 'none' ? 'none' : null;
  const camel = value.charAt(0).toLowerCase() + value.slice(1);
  return ROLE_NAMES.has(camel) ? (camel as ColorRole) : null;
}

export type ShapeKind = 'path' | 'rect' | 'circle' | 'line' | 'polygon';

export interface ParsedShape {
  readonly kind: ShapeKind;
  readonly fillRole: ColorRole | 'none' | null;
  readonly strokeRole: ColorRole | 'none' | null;
  /** Stroke width in `viewBox` units (DESIGN.md §4: 2 units in the 64x64 viewBox coordinate space). */
  readonly strokeWidthUnits: number;
  // Geometry, one of these populated depending on `kind`:
  readonly d?: string;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly cx?: number;
  readonly cy?: number;
  readonly r?: number;
  readonly x1?: number;
  readonly y1?: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly points?: string;
}

export interface ParsedPartArt {
  readonly viewBox: { readonly w: number; readonly h: number };
  readonly shapes: readonly ParsedShape[];
}

const NUM = (el: Element, attr: string, fallback = 0): number => {
  const raw = el.getAttribute(attr);
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** Parses `art.svg` into a flat list of `ParsedShape`s, in document order (paints back-to-front). Ignores anything outside the supported subset (PLAN.md §3.7: `path`, `rect`, `circle`, `line`, `polygon`). */
export function parsePartArt(art: PartArt): ParsedPartArt {
  const doc = new DOMParser().parseFromString(art.svg, 'image/svg+xml');
  const root = doc.documentElement;
  const shapes: ParsedShape[] = [];

  for (const el of Array.from(root.querySelectorAll('path, rect, circle, line, polygon'))) {
    const fillRole = roleFromAttr(el.getAttribute('fill'));
    const strokeRole = roleFromAttr(el.getAttribute('stroke'));
    const strokeWidthUnits = NUM(el, 'stroke-width', 0);
    const tag = el.tagName.toLowerCase();

    switch (tag) {
      case 'path':
        shapes.push({ kind: 'path', fillRole, strokeRole, strokeWidthUnits, d: el.getAttribute('d') ?? '' });
        break;
      case 'rect':
        shapes.push({
          kind: 'rect',
          fillRole,
          strokeRole,
          strokeWidthUnits,
          x: NUM(el, 'x'),
          y: NUM(el, 'y'),
          w: NUM(el, 'width'),
          h: NUM(el, 'height'),
        });
        break;
      case 'circle':
        shapes.push({
          kind: 'circle',
          fillRole,
          strokeRole,
          strokeWidthUnits,
          cx: NUM(el, 'cx'),
          cy: NUM(el, 'cy'),
          r: NUM(el, 'r'),
        });
        break;
      case 'line':
        shapes.push({
          kind: 'line',
          fillRole,
          strokeRole,
          strokeWidthUnits,
          x1: NUM(el, 'x1'),
          y1: NUM(el, 'y1'),
          x2: NUM(el, 'x2'),
          y2: NUM(el, 'y2'),
        });
        break;
      case 'polygon':
        shapes.push({ kind: 'polygon', fillRole, strokeRole, strokeWidthUnits, points: el.getAttribute('points') ?? '' });
        break;
      default:
        break;
    }
  }

  return { viewBox: art.viewBox, shapes };
}

function resolveColor(role: ColorRole | 'none' | null): string | null {
  if (role === null) return null;
  if (role === 'none') return null;
  return getColor(role);
}

function pathForShape(shape: ParsedShape): Path2D {
  const path = new Path2D();
  switch (shape.kind) {
    case 'path':
      return new Path2D(shape.d ?? '');
    case 'rect':
      path.rect(shape.x ?? 0, shape.y ?? 0, shape.w ?? 0, shape.h ?? 0);
      return path;
    case 'circle':
      path.arc(shape.cx ?? 0, shape.cy ?? 0, shape.r ?? 0, 0, Math.PI * 2);
      return path;
    case 'line':
      path.moveTo(shape.x1 ?? 0, shape.y1 ?? 0);
      path.lineTo(shape.x2 ?? 0, shape.y2 ?? 0);
      return path;
    case 'polygon': {
      const pts = (shape.points ?? '')
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number.parseFloat));
      pts.forEach(([x, y], i) => {
        if (x === undefined || y === undefined) return;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
      return path;
    }
  }
}

/**
 * Draws parsed art into `ctx`, mapping the part's `viewBox` square onto
 * `[originXPx, originYPx, sizePx, sizePx]` on screen. `strokeWidthPx` is the
 * on-screen stroke width for the DESIGN.md §4 "2 viewBox units" line — pass a
 * value already converted from world metres to screen pixels by the caller's
 * camera (PLAN.md §3.7: constant on-screen width regardless of zoom).
 */
export function drawParsedArt(
  ctx: CanvasRenderingContext2D,
  art: ParsedPartArt,
  originXPx: number,
  originYPx: number,
  sizePx: number,
  strokeWidthPx: number
): void {
  const scale = sizePx / Math.max(art.viewBox.w, art.viewBox.h);
  ctx.save();
  ctx.translate(originXPx, originYPx);
  ctx.scale(scale, scale);
  for (const shape of art.shapes) {
    const path = pathForShape(shape);
    const fill = resolveColor(shape.fillRole);
    const stroke = resolveColor(shape.strokeRole);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidthPx / scale; // undo our own ctx.scale so the *screen* width stays constant
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }
  }
  ctx.restore();
}
