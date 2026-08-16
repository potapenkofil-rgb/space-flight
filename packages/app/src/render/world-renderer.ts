/**
 * The flight scene's world view: ground/sky, the body, and the vessel with
 * its engine plume (PLAN.md §7 Agent D). Draws the real assembled vessel —
 * one `drawPart` call per `PartInstance`, the same `Path2D` vector the
 * hangar uses (PLAN.md §3.7) — when `options.vesselParts` is given; falls
 * back to a placeholder capsule silhouette (`drawPlaceholderVessel`) when it
 * isn't, so any caller without a full part list (a future non-vessel demo,
 * a test) still gets something reasonable on screen.
 *
 * Like every render module, this only reads its arguments and draws — it
 * never mutates vessel/world state (PLAN.md §3.2).
 */
import type { PartDef, Vec2 } from '@karman/core';
import { v2 } from '@karman/core';
import { drawPart } from './part-renderer';
import { getColor } from '../ui/tokens';
import { type Camera, worldToScreen } from './camera';
import { computePlumeShape, type PlumeStyle } from './plume';

/** One part to draw, already resolved to the vessel's own local frame (metres, radians) — `PartInstance`'s shape, kept minimal so this module doesn't need to import `Vessel`. */
export interface VesselPartView {
  readonly def: PartDef;
  readonly position: Vec2;
  readonly rotation: number;
}

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
  /** The real assembled vessel to draw, part by part. Falls back to a placeholder capsule when omitted/empty. */
  readonly vesselParts?: readonly VesselPartView[];
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
  // DESIGN.md §5: radial gradient sky-hi → sky-lo — the same treatment as the map's planet disc.
  const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(radiusPx, 1));
  gradient.addColorStop(0, getColor('skyHi'));
  gradient.addColorStop(1, getColor('skyLo'));
  ctx.fillStyle = gradient;
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

/**
 * Draws the real assembled vessel, one `drawPart` call per part — same
 * vector as the hangar (DESIGN.md §4). `vesselScreen`/`rotation` place the
 * vessel's own origin/heading on screen; each part's `originPx` is then
 * derived from its vessel-local `position`/`rotation` composed on top,
 * mirroring `scenes/build/workspaceRenderer.ts`'s `drawPlacedPart` (screen Y
 * is flipped vs. world Y, PLAN.md §3.1, hence every rotation is negated).
 */
function drawVesselParts(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  vesselWorldPosition: Vec2,
  vesselWorldRotationRad: number,
  parts: readonly VesselPartView[],
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  for (const part of parts) {
    const worldPos = v2.add(vesselWorldPosition, v2.rot(part.position, vesselWorldRotationRad));
    const worldRotation = vesselWorldRotationRad + part.rotation;
    const originPx = worldToScreen(camera, worldPos, viewportWidthPx, viewportHeightPx);
    drawPart(ctx, part.def, { originPx, rotation: -worldRotation, pixelsPerMeter: camera.pixelsPerMeter });
  }
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

  if (options.vesselParts && options.vesselParts.length > 0) {
    // `options.vesselRotation` is the atan2-style world heading used by the
    // plume/placeholder (see `drawPlaceholderVessel`'s doc); `@karman/core`'s
    // own `Vessel.rotation` (what each part's local position/rotation is
    // relative to) is a constant π/2 away from it — see
    // `scenes/flight/flightClock.ts`'s `toSnapshot` for the forward
    // conversion this undoes.
    const coreRotation = options.vesselRotation - Math.PI / 2;
    drawVesselParts(ctx, camera, options.vesselPosition, coreRotation, options.vesselParts, viewportWidthPx, viewportHeightPx);
  } else {
    drawPlaceholderVessel(ctx, vesselScreen, options.vesselRotation, screenSpanPx);
  }

  ctx.restore();
}
