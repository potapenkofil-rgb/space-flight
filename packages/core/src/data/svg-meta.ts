/**
 * Minimal, DOM-free SVG metadata extraction (PLAN.md §3.7: core stores only
 * the raw string and metadata). This is deliberately NOT a real XML parser —
 * `DOMParser` only exists in the browser, so full shape parsing lives in
 * `@karman/app`'s `render/part-renderer.ts`. All the part loader needs here is
 * the `viewBox` size (PLAN.md §6.1 requires exactly `0 0 64 64`) and a cheap
 * sanity check that the text actually looks like an SVG document, so a
 * non-SVG or truncated file is rejected with a clear error instead of being
 * silently accepted and failing later during rendering.
 */

const VIEW_BOX_RE = /viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/;
const SVG_ROOT_RE = /<svg[\s>]/;

export interface SvgViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Extracts the root `<svg viewBox="...">` size, or `null` if the text doesn't
 * look like an SVG document or has no (or a malformed) `viewBox` attribute.
 */
export function extractViewBox(svgSource: string): SvgViewBox | null {
  if (!SVG_ROOT_RE.test(svgSource)) return null;
  const match = VIEW_BOX_RE.exec(svgSource);
  if (!match) return null;
  const [minXStr, minYStr, wStr, hStr] = match.slice(1) as [string, string, string, string];
  const minX = Number.parseFloat(minXStr);
  const minY = Number.parseFloat(minYStr);
  const w = Number.parseFloat(wStr);
  const h = Number.parseFloat(hStr);
  if (![minX, minY, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { minX, minY, w, h };
}
