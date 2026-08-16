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

/**
 * A camera that continuously tracks a moving target (PLAN.md §7 Agent D:
 * "smooth following"), as opposed to {@link rebaseCamera}'s "only snap once
 * drift exceeds 10 000 m" strategy, which suits a mostly-static map/free
 * camera but would let a moving, accelerating rocket drift arbitrarily far
 * from the viewport center between rebases.
 *
 * Both `anchor` and `pixelsPerMeter` are exponentially smoothed toward the
 * target every call, so the flight scene's `render(alpha)` can call this once
 * per frame and get a camera that eases toward the vessel/zoom instead of
 * snapping — exactly the "no jump" property `rebaseCamera` gets from staying
 * put between snaps, but here achieved by tracking continuously instead.
 *
 * @param camera the current camera
 * @param targetAnchor world point (m) the camera should center on (usually the vessel's position)
 * @param targetPixelsPerMeter zoom level the camera should ease toward
 * @param dt real (unpaused) seconds since the last call
 * @param smoothingPerSecond how much of the remaining distance to close per
 *   second, dimensionless (higher = snappier; PLAN.md doesn't pin an exact
 *   value, `6` reaches ~95% of the way there in half a second)
 */
export function followCamera(
  camera: Camera,
  targetAnchor: Vec2,
  targetPixelsPerMeter: number,
  dt: number,
  smoothingPerSecond = 6
): Camera {
  const t = 1 - Math.exp(-smoothingPerSecond * Math.max(0, dt));
  return {
    anchor: {
      x: camera.anchor.x + (targetAnchor.x - camera.anchor.x) * t,
      y: camera.anchor.y + (targetAnchor.y - camera.anchor.y) * t,
    },
    pixelsPerMeter: camera.pixelsPerMeter + (targetPixelsPerMeter - camera.pixelsPerMeter) * t,
  };
}

/**
 * The flight camera's zoom range (PLAN.md §7 Agent D: from "close enough to
 * see the landing legs" to "far enough to see the whole body"), derived from
 * the vessel's own size and the current body's radius rather than
 * hardcoded, so it adapts to whichever rocket/body is actually being flown.
 *
 * @param vesselSpanMeters the vessel's largest dimension (so its landing legs
 *   are comfortably inside the viewport at max zoom-in)
 * @param bodyRadiusMeters radius of the body currently providing gravity
 * @param viewportShorterSidePx the shorter of the viewport's width/height, px
 */
export function flightZoomBounds(
  vesselSpanMeters: number,
  bodyRadiusMeters: number,
  viewportShorterSidePx: number
): { readonly min: number; readonly max: number } {
  const max = viewportShorterSidePx / (vesselSpanMeters * 4); // ~4x the vessel's span fills the shorter side
  const min = viewportShorterSidePx / (bodyRadiusMeters * 2.4); // the body's full disc fits with a little margin
  return { min: Math.min(min, max), max: Math.max(min, max) };
}
