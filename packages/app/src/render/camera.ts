/**
 * The floating-origin camera, exactly per PLAN.md §3.1:
 * `screen = (world − camera.anchor) · pixelsPerMeter + viewportCenter`.
 * `anchor` only re-bases when the camera has drifted more than
 * `CAMERA_REBASE_DISTANCE_M` from it, so `world − anchor` — the number that
 * actually feeds the canvas transform — never carries the full ~1e6 m scale of
 * a planet's radius, which is what causes stroke/dash jitter (PLAN.md §3.1).
 *
 * Pure math only, no canvas/DOM access, so it's unit-testable headlessly.
 */
import { v2, type Vec2 } from '@karman/core';

/** Distance (m) the camera must drift from `anchor` before `rebaseCamera` snaps it. PLAN.md §3.1. */
export const CAMERA_REBASE_DISTANCE_M = 10_000;

export interface Camera {
  /** World-space rebase origin fed into the screen transform, m. */
  readonly anchor: Vec2;
  /** Screen pixels per world metre (zoom level). */
  readonly pixelsPerMeter: number;
}

/** Creates a camera anchored at `anchor` with the given zoom level. */
export function createCamera(anchor: Vec2, pixelsPerMeter: number): Camera {
  return { anchor, pixelsPerMeter };
}

/**
 * Moves the camera's rebase anchor to `focus` (world m) — but only once the
 * camera has drifted more than {@link CAMERA_REBASE_DISTANCE_M} metres from the
 * current anchor. Returns the same `camera` instance unchanged when no rebase
 * was needed, so callers can cheaply detect "did anything change" by reference
 * equality.
 */
export function rebaseCamera(camera: Camera, focus: Vec2): Camera {
  const drift = v2.len(v2.sub(focus, camera.anchor));
  if (drift <= CAMERA_REBASE_DISTANCE_M) return camera;
  return { anchor: focus, pixelsPerMeter: camera.pixelsPerMeter };
}

/**
 * Multiplies the zoom level by `factor` (e.g. `1.1` per wheel notch), clamped
 * to `[minPixelsPerMeter, maxPixelsPerMeter]`.
 */
export function zoomCamera(
  camera: Camera,
  factor: number,
  minPixelsPerMeter: number,
  maxPixelsPerMeter: number
): Camera {
  const next = Math.min(
    Math.max(camera.pixelsPerMeter * factor, minPixelsPerMeter),
    maxPixelsPerMeter
  );
  return { anchor: camera.anchor, pixelsPerMeter: next };
}

/**
 * Converts a world-space point (m) to a screen-space point (CSS px), per
 * PLAN.md §3.1. World Y is up; screen Y is down, so Y is flipped here.
 */
export function worldToScreen(
  camera: Camera,
  world: Vec2,
  viewportWidthPx: number,
  viewportHeightPx: number
): Vec2 {
  const local = v2.sub(world, camera.anchor);
  return {
    x: local.x * camera.pixelsPerMeter + viewportWidthPx / 2,
    y: -local.y * camera.pixelsPerMeter + viewportHeightPx / 2,
  };
}

/** Inverse of {@link worldToScreen}: converts a screen-space point (CSS px) back to world space (m). */
export function screenToWorld(
  camera: Camera,
  screen: Vec2,
  viewportWidthPx: number,
  viewportHeightPx: number
): Vec2 {
  const localX = (screen.x - viewportWidthPx / 2) / camera.pixelsPerMeter;
  const localY = -(screen.y - viewportHeightPx / 2) / camera.pixelsPerMeter;
  return v2.add(camera.anchor, { x: localX, y: localY });
}
