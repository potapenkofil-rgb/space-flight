/**
 * The flight scene's world view: ground/sky, the body, and the vessel with
 * its engine plume (PLAN.md §7 Agent D). Renders a placeholder vessel shape
 * — `part-renderer.ts` (Agent E, PLAN.md §3.7: parses `part.svg` into
 * `Path2D`) isn't available yet, so this draws a simple capsule silhouette
 * in the same "thin chartplotter line" spirit as DESIGN.md §4 dictates for
 * real part art, clearly isolated in `drawPlaceholderVessel` so swapping in
 * the real per-part renderer later is a one-function change.
 *
 * Like every render module, this only reads its arguments and draws — it
 * never mutates vessel/world state (PLAN.md §3.2).
 */
import type { Vec2 } from '@karman/core';
import { getColor } from '../ui/tokens';
import { type Camera, worldToScreen } from './camera';
import { computePlumeShape, type PlumeStyle } from './plume';

export interface WorldRendererOptions {
  readonly bodyCenter: Vec2;
  readonly bodyRadiusMeters: number;
  readonly hasAtmosphere: boolean;
  readonly vesselPosition: Vec2;
  readonly vesselRotation: number;
  readonly vesselSpanMeters: number;
  readonly throttle: number;
  readonly ambientPressure: number;
  readonly plumeStyle?: PlumeStyle;
  /** Extra screen-space offset applied to everything (camera shake, PLAN.md §7 Agent D). */
  readonly shakeOffsetPx?: Vec2;
}

/** Fills the canvas with the space/ground backdrop. */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  ctx.fillStyle = getColor('ground');
  ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
}

/** Draws the body (planet/moon) as a filled disc with a thin atmosphere ring, in world space through `camera`. */
export function drawBody(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  center: Vec2,
  radiusMeters: number,
  hasAtmosphere: boolean,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  const p = worldToScreen(camera, center, viewportWidthPx, viewportHeightPx);
  const radiusPx = radiusMeters * camera.pixelsPerMeter;

  ctx.save();
  ctx.fillStyle = getColor('orbitSoft');
  ctx.beginPath();
  ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();

  if (hasAtmosphere) {
    ctx.strokeStyle = getColor('orbit');
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draws a simple capsule-shaped placeholder in place of real part art
 * (see module doc). Thin `InkMuted` outline, `Panel` fill, `Burn` nozzle —
 * matching DESIGN.md §4's rules even though it isn't real per-part SVG.
 */
function drawPlaceholderVessel(
  ctx: CanvasRenderingContext2D,
  screenPos: Vec2,
  rotation: number,
  screenSpanPx: number
): void {
  const halfLength = screenSpanPx / 2;
  const halfWidth = screenSpanPx / 5;

  ctx.save();
  ctx.translate(screenPos.x, screenPos.y);
  // `rotation` is a world heading in the standard math convention (0 = +x
  // "east", CCW-positive, same convention `Math.atan2(vy, vx)` returns). The
  // capsule/plume shapes below are drawn nose-first along local +x at
  // rotation 0. Negating maps CCW-in-world to CW-on-canvas — exactly
  // compensating for `worldToScreen`'s Y-flip — with no extra offset needed.
  ctx.rotate(-rotation);

  ctx.beginPath();
  ctx.moveTo(halfLength, 0);
  ctx.quadraticCurveTo(halfLength * 0.6, halfWidth, 0, halfWidth);
  ctx.lineTo(-halfLength * 0.7, halfWidth);
  ctx.lineTo(-halfLength * 0.7, -halfWidth);
  ctx.lineTo(0, -halfWidth);
  ctx.quadraticCurveTo(halfLength * 0.6, -halfWidth, halfLength, 0);
  ctx.closePath();

  ctx.fillStyle = getColor('panel');
  ctx.fill();
  ctx.strokeStyle = getColor('inkMuted');
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Nozzle: the one part of the placeholder that's allowed to be Burn (DESIGN.md §4).
  ctx.beginPath();
  ctx.moveTo(-halfLength * 0.7, halfWidth * 0.7);
  ctx.lineTo(-halfLength * 0.95, halfWidth * 0.4);
  ctx.lineTo(-halfLength * 0.95, -halfWidth * 0.4);
  ctx.lineTo(-halfLength * 0.7, -halfWidth * 0.7);
  ctx.closePath();
  ctx.fillStyle = getColor('burn');
  ctx.fill();

  ctx.restore();
}

/** Draws the engine plume trailing behind the vessel, sized/tinted from throttle and ambient pressure (PLAN.md §7 Agent D). */
function drawPlume(
  ctx: CanvasRenderingContext2D,
  screenPos: Vec2,
  rotation: number,
  screenSpanPx: number,
  throttle: number,
  ambientPressure: number,
  pixelsPerMeter: number,
  style?: PlumeStyle
): void {
  const shape = computePlumeShape(throttle, ambientPressure, style);
  if (shape.length <= 0 || shape.alpha <= 0) return;

  const halfLength = screenSpanPx / 2;
  const nozzleOffsetPx = halfLength * 0.95;
  const lengthPx = shape.length * pixelsPerMeter;
  const widthPx = Math.max(shape.width * pixelsPerMeter, 1);

  ctx.save();
  ctx.translate(screenPos.x, screenPos.y);
  ctx.rotate(-rotation); // see drawPlaceholderVessel's comment on this convention
  ctx.translate(-nozzleOffsetPx, 0);

  const gradient = ctx.createLinearGradient(0, 0, -lengthPx, 0);
  gradient.addColorStop(0, getColor('burn'));
  gradient.addColorStop(1, getColor('burnSoft'));
  ctx.globalAlpha = shape.alpha;
  ctx.fillStyle = gradient;

  ctx.beginPath();
  ctx.moveTo(0, widthPx / 2);
  ctx.lineTo(-lengthPx, 0);
  ctx.lineTo(0, -widthPx / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draws the full flight-scene world: background, body, plume, vessel — in that back-to-front order. */
export function drawFlightWorld(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  options: WorldRendererOptions,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  drawBackground(ctx, viewportWidthPx, viewportHeightPx);

  const shake = options.shakeOffsetPx ?? { x: 0, y: 0 };
  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawBody(
    ctx,
    camera,
    options.bodyCenter,
    options.bodyRadiusMeters,
    options.hasAtmosphere,
    viewportWidthPx,
    viewportHeightPx
  );

  const vesselScreen = worldToScreen(camera, options.vesselPosition, viewportWidthPx, viewportHeightPx);
  const screenSpanPx = Math.max(options.vesselSpanMeters * camera.pixelsPerMeter, 10);

  drawPlume(
    ctx,
    vesselScreen,
    options.vesselRotation,
    screenSpanPx,
    options.throttle,
    options.ambientPressure,
    camera.pixelsPerMeter,
    options.plumeStyle
  );
  drawPlaceholderVessel(ctx, vesselScreen, options.vesselRotation, screenSpanPx);

  ctx.restore();
}
