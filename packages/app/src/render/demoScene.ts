/**
 * The empty-scene visual proof required by PLAN.md §7 item 7: a planet (Terra,
 * radius 1,000,000 m per PLAN.md §5.7) and a star field, drawn through the
 * floating-origin `Camera` so the mechanism in `render/camera.ts` is actually
 * exercised, not just unit-tested. This is deliberately minimal — Agent D
 * (`packages/app/src/scenes/flight/**`, `render/**`) owns the real world
 * renderer, HUD and part art.
 *
 * `data/systems/karman.json` (the authoritative body data, Agent E's zone)
 * doesn't exist yet at skeleton time, so Terra's radius is a local constant
 * here, not loaded through `@karman/core`'s `SystemLibrary`.
 */
import { getColor } from '../ui/tokens';
import { type Camera, worldToScreen } from './camera';
import type { Star } from './starfield';

/** Terra's surface radius, m — matches PLAN.md §5.7. Duplicated here only until Agent E's system loader lands. */
export const TERRA_RADIUS_M = 1_000_000;

export function drawDemoScene(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  stars: readonly Star[],
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  ctx.fillStyle = getColor('ground');
  ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);

  // Stars: fixed screen radius regardless of zoom (they're meant to be infinitely far away).
  ctx.fillStyle = getColor('ink');
  for (const star of stars) {
    const p = worldToScreen(camera, star.position, viewportWidthPx, viewportHeightPx);
    if (p.x < -4 || p.x > viewportWidthPx + 4 || p.y < -4 || p.y > viewportHeightPx + 4) continue;
    ctx.globalAlpha = star.brightness;
    ctx.beginPath();
    ctx.arc(p.x, p.y, star.radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Terra: a simple filled circle at the world origin, radius in world metres
  // converted through the camera — this is what actually proves the
  // floating-origin transform (PLAN.md §3.1) is wired correctly end to end.
  const center = worldToScreen(camera, { x: 0, y: 0 }, viewportWidthPx, viewportHeightPx);
  const radiusPx = TERRA_RADIUS_M * camera.pixelsPerMeter;

  // DESIGN.md §5: radial gradient sky-hi → sky-lo, same treatment as the map/flight planet discs.
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(radiusPx, 1));
  gradient.addColorStop(0, getColor('skyHi'));
  gradient.addColorStop(1, getColor('skyLo'));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = getColor('orbit');
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
