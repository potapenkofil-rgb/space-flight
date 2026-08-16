/**
 * Canvas drawing for the hangar's centre workspace: the DESIGN.md §3 grid
 * ("26 px at base zoom, `HairlineSoft` lines, every fifth line `Hairline`"),
 * the assembled rocket (same `Path2D` vector as the catalog preview — DESIGN.md
 * §4, via `render/part-renderer.ts`), the held "ghost" part following the
 * cursor, and its symmetry preview. Pure rendering — reads a `BuildState`
 * snapshot, writes only to `ctx`.
 */
import type { PartLibrary } from '@karman/core';
import { getColor } from '../../ui/tokens';
import { type Camera, worldToScreen } from '../../render/camera';
import { drawPart } from '../../render/part-renderer';
import { nodeWorldPos, type BuildState, type PlacedPart } from './state';
import { GRID_STEP_M } from './grid';

const NODE_MARKER_RADIUS_PX = 3;

/** Draws the DESIGN.md §3 hangar grid, filling the whole canvas. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  ctx.fillStyle = getColor('ground');
  ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);

  const stepPx = GRID_STEP_M * camera.pixelsPerMeter;
  if (stepPx < 2) return; // zoomed out far enough that grid lines would just be noise

  const origin = worldToScreen(camera, { x: 0, y: 0 }, viewportWidthPx, viewportHeightPx);
  const startCol = Math.floor(-origin.x / stepPx);
  const endCol = Math.ceil((viewportWidthPx - origin.x) / stepPx);
  const startRow = Math.floor(-origin.y / stepPx);
  const endRow = Math.ceil((viewportHeightPx - origin.y) / stepPx);

  for (let col = startCol; col <= endCol; col++) {
    const x = origin.x + col * stepPx;
    ctx.strokeStyle = getColor(col % 5 === 0 ? 'hairline' : 'hairlineSoft');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewportHeightPx);
    ctx.stroke();
  }
  for (let row = startRow; row <= endRow; row++) {
    const y = origin.y + row * stepPx;
    ctx.strokeStyle = getColor(row % 5 === 0 ? 'hairline' : 'hairlineSoft');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewportWidthPx, y);
    ctx.stroke();
  }
}

/**
 * Draws one placed part at its world position, using the same `Path2D`
 * renderer as the catalog preview (`render/part-renderer.ts`, PLAN.md §3.7).
 * The part's own local origin is its bottom stack node (DESIGN.md §4), which
 * is exactly `PlacedPart.position` (see `state.ts`'s `toVessel` doc) — so it
 * maps straight onto `drawPart`'s `originPx` with no extra offset.
 */
export function drawPlacedPart(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  part: PlacedPart,
  library: PartLibrary,
  viewportWidthPx: number,
  viewportHeightPx: number,
  opacity = 1
): void {
  const def = library.get(part.partId);
  const originPx = worldToScreen(camera, part.position, viewportWidthPx, viewportHeightPx);

  ctx.save();
  ctx.globalAlpha = opacity;
  drawPart(ctx, def, {
    originPx,
    rotation: -part.rotation, // screen Y is flipped vs. world Y (PLAN.md §3.1), so world CCW rotation reads as screen CW
    pixelsPerMeter: camera.pixelsPerMeter,
  });
  ctx.restore();
}

export function drawAssembly(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  state: BuildState,
  library: PartLibrary,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  for (const part of state.parts) {
    drawPlacedPart(ctx, camera, part, library, viewportWidthPx, viewportHeightPx);
    if (state.selectedInstanceId === part.instanceId) {
      const def = library.get(part.partId);
      const center = worldToScreen(camera, part.position, viewportWidthPx, viewportHeightPx);
      const sizePx = Math.max(def.bounds.w, def.bounds.h) * camera.pixelsPerMeter;
      ctx.strokeStyle = getColor('orbit');
      ctx.lineWidth = 2;
      ctx.strokeRect(center.x - sizePx / 2 - 3, center.y - sizePx - 3, sizePx + 6, sizePx + 6);
    }
  }
}

/** Highlights every currently-open attach node as a small marker — visual aid for the snap radius (PLAN.md §7 item 1). */
export function drawOpenNodeMarkers(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  markers: readonly { worldPos: { x: number; y: number } }[],
  viewportWidthPx: number,
  viewportHeightPx: number,
  highlightIndex: number | null
): void {
  markers.forEach((m, i) => {
    const p = worldToScreen(camera, m.worldPos, viewportWidthPx, viewportHeightPx);
    ctx.fillStyle = getColor(i === highlightIndex ? 'burn' : 'muted');
    ctx.globalAlpha = i === highlightIndex ? 1 : 0.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === highlightIndex ? NODE_MARKER_RADIUS_PX + 2 : NODE_MARKER_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/** Draws a translucent "ghost" of the part currently held on the cursor, at `position`/`rotation` (already resolved by the snap logic in `BuildScene.ts`). */
export function drawGhostPart(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  partId: string,
  library: PartLibrary,
  position: { x: number; y: number },
  rotation: number,
  viewportWidthPx: number,
  viewportHeightPx: number
): void {
  const ghost: PlacedPart = {
    instanceId: -1,
    partId,
    position,
    rotation,
    resources: {},
    attachedTo: null,
    symmetryGroupId: null,
  };
  drawPlacedPart(ctx, camera, ghost, library, viewportWidthPx, viewportHeightPx, 0.5);
}

/** The world position of `part`'s node index used only for debugging/overlay purposes (re-exported for `BuildScene.ts` convenience). */
export { nodeWorldPos };
