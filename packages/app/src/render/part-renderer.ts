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
  /**
   * Vertical extent actually covered by ink, in viewBox units, outer edge of
   * the stroke included. This — not `viewBox` — is what maps onto the part's
   * `bounds.h`, because an artist frames a drawing inside the canvas with
   * whatever margin looks right in an editor, while `bounds.h` is the
   * physical distance between the part's two stack nodes. Mapping the raw
   * viewBox instead turns every margin into a visible gap in an assembled
   * rocket: `pod_command`'s ink covers 53% of its canvas, so nearly half its
   * height rendered as empty space between it and the tank below.
   */
  readonly contentY: { readonly min: number; readonly max: number };
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
    return {
      viewBox: { w: 64, h: 64 },
      contentY: { min: 0, max: 64 },
      shapes: [],
      warnings: ['part.svg failed to parse as XML'],
    };
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

  return { viewBox, contentY: contentYExtent(shapes, viewBox.h), shapes, warnings };
}

/**
 * Vertical extent of a shape's own geometry, before stroke. Path extents are
 * taken from every coordinate pair in the `d` string: the art subset is
 * `M`/`L`/`Q`/`Z` only (see this module's header), and a quadratic curve
 * never leaves the hull of its control points, so the pairs bound the curve.
 */
function shapeYExtent(g: ShapeGeometry): { min: number; max: number } | null {
  switch (g.kind) {
    case 'rect':
      return { min: g.y, max: g.y + g.h };
    case 'circle':
      return { min: g.cy - g.r, max: g.cy + g.r };
    case 'line':
      return { min: Math.min(g.y1, g.y2), max: Math.max(g.y1, g.y2) };
    case 'polygon': {
      if (g.points.length === 0) return null;
      const ys = g.points.map((p) => p.y);
      return { min: Math.min(...ys), max: Math.max(...ys) };
    }
    case 'path': {
      const numbers = g.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number.parseFloat) ?? [];
      const ys: number[] = [];
      for (let i = 1; i < numbers.length; i += 2) {
        const y = numbers[i];
        if (y !== undefined && Number.isFinite(y)) ys.push(y);
      }
      if (ys.length === 0) return null;
      return { min: Math.min(...ys), max: Math.max(...ys) };
    }
  }
}

function contentYExtent(shapes: readonly ParsedShape[], viewBoxHeight: number): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const shape of shapes) {
    const extent = shapeYExtent(shape.geometry);
    if (extent === null) continue;
    // Half the stroke sits outside the geometry on each side; that ink is
    // part of what the eye reads as the part's edge, so it counts.
    const overhang = shape.strokeRole !== null ? shape.strokeWidth / 2 : 0;
    min = Math.min(min, extent.min - overhang);
    max = Math.max(max, extent.max + overhang);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= 0) {
    return { min: 0, max: viewBoxHeight };
  }
  return { min, max };
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
 * Draws one part instance. `PartDrawTransform.originPx` is the screen
 * position of the part's *local* origin — its bottom stack node (DESIGN.md
 * §4) — but every actual `part.svg` in `data/parts/**` is authored the
 * ordinary way an SVG editor encourages: nose near `viewBox`'s `y = 0` (the
 * top of the drawing, e.g. `pod_command`'s nose arc pokes to `y ≈ -4`) and
 * base near `y = viewBox.h` (the bottom of the drawing, e.g. `engine_launch`'s
 * nozzle exit sits at `y = 62` of 64). So the origin has to anchor to
 * `viewBox.h`, not `0` — anchoring at `0` (as an earlier version of this
 * function did, with no offsetting Y-translate) plants whatever the artist
 * drew *at the top of the image* — the nose — exactly at the bottom
 * attach-node position instead, silently rendering every part upside down
 * (nose at the join, base floating above it). `x ∈ [0, viewBox.w]` is
 * centered on the part's own centerline. This maps that local frame onto
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
  const contentHeight = art.contentY.max - art.contentY.min;
  const scaleX = (part.bounds.w / art.viewBox.w) * transform.pixelsPerMeter;
  // Y maps the inked extent — not the whole canvas — onto `bounds.h`, so
  // stacked parts meet flush however the artist framed the drawing.
  const scaleY = (part.bounds.h / contentHeight) * transform.pixelsPerMeter;
  const deviceScale = Math.abs(scaleX);

  ctx.save();
  ctx.translate(transform.originPx.x, transform.originPx.y);
  ctx.rotate(transform.rotation);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-art.viewBox.w / 2, -art.contentY.max);

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
