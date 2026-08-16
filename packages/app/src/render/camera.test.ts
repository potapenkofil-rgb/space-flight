import { describe, expect, it } from 'vitest';
import {
  CAMERA_REBASE_DISTANCE_M,
  createCamera,
  flightZoomBounds,
  followCamera,
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

describe('followCamera', () => {
  it('eases the anchor toward the target without ever overshooting', () => {
    const cam = createCamera({ x: 0, y: 0 }, 1);
    const next = followCamera(cam, { x: 100, y: 0 }, 1, 1 / 60);
    expect(next.anchor.x).toBeGreaterThan(0);
    expect(next.anchor.x).toBeLessThan(100);
  });

  it('converges to the target after many small steps', () => {
    let cam = createCamera({ x: 0, y: 0 }, 1);
    for (let i = 0; i < 600; i++) {
      cam = followCamera(cam, { x: 500, y: -200 }, 4, 1 / 60);
    }
    expect(cam.anchor.x).toBeCloseTo(500, 3);
    expect(cam.anchor.y).toBeCloseTo(-200, 3);
    expect(cam.pixelsPerMeter).toBeCloseTo(4, 6);
  });

  it('dt=0 leaves the camera unchanged', () => {
    const cam = createCamera({ x: 10, y: 20 }, 2);
    const next = followCamera(cam, { x: 999, y: 999 }, 9, 0);
    expect(next.anchor).toEqual(cam.anchor);
    expect(next.pixelsPerMeter).toBe(cam.pixelsPerMeter);
  });
});

describe('flightZoomBounds', () => {
  it('min zoom shows the whole body, max zoom shows the vessel', () => {
    const { min, max } = flightZoomBounds(30, 1_000_000, 900);
    expect(min).toBeLessThan(max);
    // Zoomed all the way out, the body's diameter must fit inside the shorter viewport side.
    expect(2 * 1_000_000 * min).toBeLessThanOrEqual(900 + 1e-6);
    // Zoomed all the way in, a few vessel-spans must fit inside the shorter viewport side.
    expect(30 * max).toBeGreaterThan(30);
  });
});
