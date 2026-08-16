/**
 * Parses a part's raw SVG source (PLAN.md §3.7, DESIGN.md §4) into cached
 * `Path2D` shapes and draws them. `@karman/core` only stores the raw SVG
 * string and metadata (`PartArt`) — `DOMParser` and `Path2D` only exist in the
 * browser, so all of that lives here, in `@karman/app`.
 *
 * Two things are cached, separately, keyed by object identity so a mod's
 * `part.svg` gets its own cache entry independent of the base part it
 * overrides:
 * - {@link getParsedArt} — pure geometry + role-name parsing (`SVGElement` →
 *   plain descriptors). No `Path2D`/canvas involved, so this half is
 *   unit-testable under jsdom (which has `DOMParser` but not `Path2D`).
 * - the actual `Path2D` objects, built lazily the first time a shape is
 *   drawn (browser-only — see {@link drawPart}).
 *
 * Supported SVG subset (PLAN.md §3.7): `path`, `rect`, `circle`, `line`,
 * `polygon`. Anything else (including `<g>`) is skipped with a console
 * warning, once per parse, never a thrown error — an odd shape in a mod's
 * SVG must not break the part, matching the JSON validator's philosophy
 * (PLAN.md §6.2).
 */
import type { Vec2 } from '@karman/core';
import type { PartDef } from '@karman/core';
import { getColor, type ColorRole } from '../ui/tokens';

/** DESIGN.md §1 role names as they appear in `fill="..."`/`stroke="..."` attributes — exact capitalization. */
const ROLE_NAME_TO_COLOR_ROLE: Record<string, ColorRole> = {
  Ground: 'ground',
  Panel: 'panel',
  PanelAlt: 'panelAlt',
  Hairline: 'hairline',
  HairlineSoft: 'hairlineSoft',
  Ink: 'ink',
  InkMuted: 'inkMuted',
  Muted: 'muted',
  Burn: 'burn',
  BurnSoft: 'burnSoft',
  Orbit: 'orbit',
  OrbitSoft: 'orbitSoft',
  Nominal: 'nominal',
  Warning: 'warning',
  Critical: 'critical',
};

/** DESIGN.md §4: outline stroke width when a shape doesn't specify one explicitly. */
const DEFAULT_STROKE_WIDTH = 2;

export type ShapeGeometry =
  | { readonly kind: 'path'; readonly d: string }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly rx: number }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly kind: 'polygon'; readonly points: readonly Vec2[] };

/** One parsed, not-yet-rasterized shape from a part's SVG, geometry plus DESIGN.md §4 role-name styling. */
export interface ParsedShape {
  readonly geometry: ShapeGeometry;
  /** `null` means "no fill" (`fill="none"` or absent). */
  readonly fillRole: ColorRole | null;
  /** `null` means "no stroke". */
  readonly strokeRole: ColorRole | null;
  /** Stroke width in the SVG's own viewBox units (before any part/camera scaling) — DESIGN.md §4 mandates `2`. */
  readonly strokeWidth: number;
}

export interface ParsedPartArt {
  readonly viewBox: { readonly w: number; readonly h: number };
  readonly shapes: readonly ParsedShape[];
  /** One entry per unsupported element/attribute encountered, for the "mods with errors" log (PLAN.md §6.2). */
  readonly warnings: readonly string[];
}

function parseColorRole(raw: string | null, warnings: string[], context: string): ColorRole | null {
  if (raw === null || raw === '' || raw === 'none' || raw === 'transparent') return null;
  const role = ROLE_NAME_TO_COLOR_ROLE[raw];
  if (role === undefined) {
    warnings.push(`${context}: unknown color role "${raw}", ignoring`);
    return null;
  }
  return role;
}

function parseNumberAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parsePoints(raw: string | null): Vec2[] {
  if (raw === null) return [];
  const out: Vec2[] = [];
  for (const pair of raw.trim().split(/\s+/)) {
    const [xStr, yStr] = pair.split(',');
    const x = Number.parseFloat(xStr ?? '');
    const y = Number.parseFloat(yStr ?? '');
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

function parseElement(el: Element, warnings: string[]): ParsedShape | null {
  const tag = el.tagName.toLowerCase();
  let geometry: ShapeGeometry | null = null;

  switch (tag) {
    case 'path': {
      const d = el.getAttribute('d');
      if (d === null || d.trim() === '') {
        warnings.push('<path> missing "d" attribute, skipping');
        return null;
      }
      geometry = { kind: 'path', d };
      break;
    }
    case 'rect': {
      geometry = {
        kind: 'rect',
        x: parseNumberAttr(el, 'x'),
        y: parseNumberAttr(el, 'y'),
        w: parseNumberAttr(el, 'width'),
        h: parseNumberAttr(el, 'height'),
        rx: parseNumberAttr(el, 'rx'),
      };
      break;
    }
    case 'circle': {
      geometry = { kind: 'circle', cx: parseNumberAttr(el, 'cx'), cy: parseNumberAttr(el, 'cy'), r: parseNumberAttr(el, 'r') };
      break;
    }
    case 'line': {
      geometry = {
        kind: 'line',
        x1: parseNumberAttr(el, 'x1'),
        y1: parseNumberAttr(el, 'y1'),
        x2: parseNumberAttr(el, 'x2'),
        y2: parseNumberAttr(el, 'y2'),
      };
      break;
    }
    case 'polygon': {
      const points = parsePoints(el.getAttribute('points'));
      if (points.length < 3) {
        warnings.push('<polygon> has fewer than 3 points, skipping');
        return null;
      }
      geometry = { kind: 'polygon', points };
      break;
    }
    default: {
      warnings.push(`unsupported element <${tag}>, ignoring (PLAN.md §3.7 supported subset: path/rect/circle/line/polygon)`);
      return null;
    }
  }

  const fillRole = parseColorRole(el.getAttribute('fill'), warnings, `<${tag}>`);
  const strokeRole = parseColorRole(el.getAttribute('stroke'), warnings, `<${tag}>`);
  const strokeWidth = strokeRole === null ? 0 : parseNumberAttr(el, 'stroke-width', DEFAULT_STROKE_WIDTH);

  return { geometry, fillRole, strokeRole, strokeWidth };
}

/**
 * Parses raw SVG source into shape descriptors (PLAN.md §3.7). Pure — no
 * `Path2D`, no canvas — so it runs the same under jsdom (tests) and a real
 * browser. Never throws: a malformed document parses to zero shapes plus a
 * warning, per PLAN.md §6.2's "a broken part must not crash the game".
 */
export function parsePartArt(svgSource: string): ParsedPartArt {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const root = doc.documentElement;

  if (root === null || root.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror') !== null) {
    return { viewBox: { w: 64, h: 64 }, shapes: [], warnings: ['part.svg failed to parse as XML'] };
  }

  const viewBoxAttr = root.getAttribute('viewBox');
  const parts = viewBoxAttr?.trim().split(/\s+/).map(Number.parseFloat) ?? [];
  const w = parts[2];
  const h = parts[3];
  const viewBox = w !== undefined && h !== undefined && Number.isFinite(w) && Number.isFinite(h) ? { w, h } : { w: 64, h: 64 };

  const shapes: ParsedShape[] = [];
  for (const child of Array.from(root.children)) {
    const shape = parseElement(child, warnings);
    if (shape) shapes.push(shape);
  }

  return { viewBox, shapes, warnings };
}

const parseCache = new WeakMap<object, ParsedPartArt>();

/** Parses (or returns the cached parse of) `part.art`. Cache key is `part.art` object identity, so a mod override gets its own entry. */
export function getParsedArt(part: PartDef): ParsedPartArt {
  const cached = parseCache.get(part.art);
  if (cached) return cached;
  const parsed = parsePartArt(part.art.svg);
  if (parsed.warnings.length > 0) {
    console.warn(`part-renderer: "${part.id}" — ${parsed.warnings.join('; ')}`);
  }
  parseCache.set(part.art, parsed);
  return parsed;
}

const path2DCache = new WeakMap<ParsedShape, Path2D>();

/** Builds (or returns the cached) `Path2D` for one shape. Browser-only — `Path2D` does not exist under jsdom. */
function getPath2D(shape: ParsedShape): Path2D {
  const cached = path2DCache.get(shape);
  if (cached) return cached;

  const g = shape.geometry;
  let path: Path2D;
  switch (g.kind) {
    case 'path':
      path = new Path2D(g.d);
      break;
    case 'rect':
      path = new Path2D();
      if (g.rx > 0) path.roundRect(g.x, g.y, g.w, g.h, g.rx);
      else path.rect(g.x, g.y, g.w, g.h);
      break;
    case 'circle':
      path = new Path2D();
      path.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
      break;
    case 'line':
      path = new Path2D();
      path.moveTo(g.x1, g.y1);
      path.lineTo(g.x2, g.y2);
      break;
    case 'polygon':
      path = new Path2D();
      path.moveTo(g.points[0]?.x ?? 0, g.points[0]?.y ?? 0);
      for (const p of g.points.slice(1)) path.lineTo(p.x, p.y);
      path.closePath();
      break;
  }
  path2DCache.set(shape, path);
  return path;
}

/**
 * Where and how large to draw one part instance, already resolved to screen
 * space by the caller (hangar/flight world renderer, or the contact sheet).
 * Kept independent of `Camera` (`render/camera.ts`) so this module has no
 * opinion about *which* camera/scene it's being called from.
 */
export interface PartDrawTransform {
  /** Screen position (CSS px) of the part's local origin — its bottom stack node (PLAN.md §6.1). */
  readonly originPx: Vec2;
  /** Rotation, radians, standard `ctx.rotate()` convention (clockwise-positive, since screen Y is down). */
  readonly rotation: number;
  /** World zoom, screen px per metre. */
  readonly pixelsPerMeter: number;
}

/**
 * Draws one part instance. The part's SVG is authored Y-up with the origin
 * at the bottom node and `x ∈ [0, viewBox.w]` centered on the part's own
 * centerline (DESIGN.md §4) — this maps that local frame onto
 * `part.bounds` (metres) and then onto `transform` (screen px), so a 64×64
 * viewBox always fills exactly `bounds.w × bounds.h` metres regardless of
 * how the art was drawn.
 *
 * Stroke width is compensated so every shape renders at a *constant* number
 * of screen pixels regardless of zoom or the part's own size (DESIGN.md §4:
 * a part must not visually thicken as the camera zooms, mirroring the map's
 * constant-px orbit lines, DESIGN.md §5) — PLAN.md §3.7's `lineWidth = base /
 * pixelsPerMeter` generalized to also divide out the part's own
 * viewBox→metres scale.
 */
export function drawPart(ctx: CanvasRenderingContext2D, part: PartDef, transform: PartDrawTransform): void {
  const art = getParsedArt(part);
  const scaleX = (part.bounds.w / art.viewBox.w) * transform.pixelsPerMeter;
  const scaleY = -(part.bounds.h / art.viewBox.h) * transform.pixelsPerMeter;
  const deviceScale = Math.abs(scaleX);

  ctx.save();
  ctx.translate(transform.originPx.x, transform.originPx.y);
  ctx.rotate(transform.rotation);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-art.viewBox.w / 2, 0);

  for (const shape of art.shapes) {
    const path = getPath2D(shape);
    if (shape.fillRole !== null) {
      ctx.fillStyle = getColor(shape.fillRole);
      ctx.fill(path);
    }
    if (shape.strokeRole !== null) {
      ctx.strokeStyle = getColor(shape.strokeRole);
      ctx.lineWidth = deviceScale > 0 ? shape.strokeWidth / deviceScale : shape.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(path);
    }
  }

  ctx.restore();
}
