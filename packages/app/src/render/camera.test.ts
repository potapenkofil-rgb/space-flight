import { describe, expect, it } from 'vitest';
import {
  CAMERA_REBASE_DISTANCE_M,
  createCamera,
  rebaseCamera,
  screenToWorld,
  worldToScreen,
  zoomCamera,
} from './camera';

describe('camera floating origin', () => {
  it('worldToScreen places the anchor at the viewport center', () => {
    const cam = createCamera({ x: 1_000_000, y: 500_000 }, 2);
    const p = worldToScreen(cam, cam.anchor, 800, 600);
    expect(p.x).toBeCloseTo(400, 9);
    expect(p.y).toBeCloseTo(300, 9);
  });

  it('worldToScreen / screenToWorld round-trip', () => {
    const cam = createCamera({ x: 1_060_000, y: -20_000 }, 0.05);
    const world = { x: 1_061_234, y: -19_500 };
    const screen = worldToScreen(cam, world, 1280, 720);
    const back = screenToWorld(cam, screen, 1280, 720);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('world Y-up maps to screen Y-down', () => {
    const cam = createCamera({ x: 0, y: 0 }, 1);
    const up = worldToScreen(cam, { x: 0, y: 10 }, 200, 200);
    expect(up.y).toBeLessThan(100); // moving up in world space moves up (smaller y) on screen
  });

  it('rebaseCamera does nothing within the rebase distance', () => {
    const cam = createCamera({ x: 0, y: 0 }, 1);
    const next = rebaseCamera(cam, { x: CAMERA_REBASE_DISTANCE_M - 1, y: 0 });
    expect(next).toBe(cam); // same reference: no rebase happened
  });

  it('rebaseCamera snaps the anchor once the drift exceeds the threshold', () => {
    const cam = createCamera({ x: 0, y: 0 }, 1);
    const focus = { x: CAMERA_REBASE_DISTANCE_M + 1, y: 0 };
    const next = rebaseCamera(cam, focus);
    expect(next).not.toBe(cam);
    expect(next.anchor).toEqual(focus);
    expect(next.pixelsPerMeter).toBe(cam.pixelsPerMeter);
  });

  it('after a rebase, coordinates near the new anchor stay numerically small', () => {
    // This is the entire point of §3.1: (world - anchor) must never carry the
    // planet-scale (~1e6 m) magnitude into the screen transform.
    const cam = createCamera({ x: 0, y: 0 }, 1);
    const focus = { x: 1_050_000, y: 0 };
    const rebased = rebaseCamera(cam, focus);
    const nearby = { x: 1_050_050, y: 30 };
    const local = { x: nearby.x - rebased.anchor.x, y: nearby.y - rebased.anchor.y };
    expect(Math.abs(local.x)).toBeLessThan(CAMERA_REBASE_DISTANCE_M);
    expect(Math.abs(local.y)).toBeLessThan(CAMERA_REBASE_DISTANCE_M);
  });

  it('zoomCamera multiplies and clamps pixelsPerMeter', () => {
    const cam = createCamera({ x: 0, y: 0 }, 1);
    expect(zoomCamera(cam, 2, 0.001, 100).pixelsPerMeter).toBe(2);
    expect(zoomCamera(cam, 1000, 0.001, 100).pixelsPerMeter).toBe(100);
    expect(zoomCamera(cam, 0.0001, 0.001, 100).pixelsPerMeter).toBe(0.001);
  });
});
