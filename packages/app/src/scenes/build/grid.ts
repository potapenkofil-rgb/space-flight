/**
 * Hangar grid + node-snapping math. PLAN.md §7, Agent C's zone: the capture radius
 * is defined in **screen pixels**, not metres — at a distant zoom level a
 * metres-based radius shrinks to nothing on screen and the cursor can never
 * catch a node. Everything here is pure geometry, no DOM, so it's unit-tested
 * headlessly.
 *
 * The hangar reuses the already-implemented floating-origin `Camera` from
 * `render/camera.ts` (Agent D's zone, but it's a stable, finished dependency —
 * PLAN.md §3.1) purely as a world↔screen mapping; the hangar's own world is
 * small (a rocket, not a planet) so the anchor never needs to rebase.
 */
import { v2, type Vec2 } from '@karman/core';
import { type Camera, worldToScreen } from '../../render/camera';
import type { AttachCandidate } from './state';

/** Grid line spacing, world metres. */
export const GRID_STEP_M = 1;

/** Camera zoom (screen px per world metre) that reproduces DESIGN.md §3's "26 px at base zoom" grid spacing, since `GRID_STEP_M` is 1 metre. */
export const BASE_PIXELS_PER_METER = 26;

/** How far (in **screen pixels**) the cursor may be from a node and still snap to it — PLAN.md §7 item 1. */
export const SNAP_RADIUS_PX = 18;

/** Rounds a world coordinate to the nearest grid line. */
export function snapToGrid(value: number, stepM = GRID_STEP_M): number {
  return Math.round(value / stepM) * stepM;
}

export function snapPointToGrid(p: Vec2, stepM = GRID_STEP_M): Vec2 {
  return { x: snapToGrid(p.x, stepM), y: snapToGrid(p.y, stepM) };
}

/**
 * Picks the `AttachCandidate` whose target node is closest to `cursorWorld`
 * **on screen** (converted through `camera`), among those within
 * `radiusPx`. Returns `null` when nothing is close enough — the held part
 * then just follows the free-floating grid-snapped cursor instead of
 * attaching to anything.
 */
export function pickNearestCandidate(
  candidates: readonly AttachCandidate[],
  cursorWorld: Vec2,
  camera: Camera,
  viewportWidthPx: number,
  viewportHeightPx: number,
  radiusPx = SNAP_RADIUS_PX
): AttachCandidate | null {
  const cursorScreen = worldToScreen(camera, cursorWorld, viewportWidthPx, viewportHeightPx);
  let best: AttachCandidate | null = null;
  let bestDistPx = radiusPx;
  for (const candidate of candidates) {
    const nodeScreen = worldToScreen(camera, candidate.worldPos, viewportWidthPx, viewportHeightPx);
    const distPx = v2.len(v2.sub(nodeScreen, cursorScreen));
    if (distPx <= bestDistPx) {
      bestDistPx = distPx;
      best = candidate;
    }
  }
  return best;
}
