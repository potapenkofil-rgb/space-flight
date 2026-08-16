/**
 * Entry point: wires up the fixed-timestep main loop (PLAN.md §3.2), the
 * floating-origin demo scene (PLAN.md §3.1/§7 item 7) and the main menu
 * (PLAN.md §7 item 8, checked by `tests/e2e/smoke.spec.ts`).
 */
import './ui/tokens.css';
import { mountMenuScene } from './scenes/menu/MenuScene';
import { createGameLoop } from './engine/gameLoop';
import { createCamera, rebaseCamera, zoomCamera, type Camera } from './render/camera';
import { drawDemoScene } from './render/demoScene';
import { createStarfield } from './render/starfield';

const MIN_PIXELS_PER_METER = 1e-7;
const MAX_PIXELS_PER_METER = 2;
const STAR_FIELD_RADIUS_M = 4_000_000;

function getCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('world-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('main: #world-canvas is missing from index.html');
  }
  return canvas;
}

function getAppRoot(): HTMLElement {
  const root = document.getElementById('app-root');
  if (!(root instanceof HTMLElement)) {
    throw new Error('main: #app-root is missing from index.html');
  }
  return root;
}

function main(): void {
  const canvas = getCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('main: 2D canvas context unavailable');

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let widthPx = window.innerWidth;
  let heightPx = window.innerHeight;

  function resize(): void {
    widthPx = window.innerWidth;
    heightPx = window.innerHeight;
    canvas.width = Math.round(widthPx * dpr);
    canvas.height = Math.round(heightPx * dpr);
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const stars = createStarfield(600, STAR_FIELD_RADIUS_M);

  // Initial zoom: fit Terra comfortably inside the shorter viewport dimension.
  const initialPpm = Math.min(heightPx, widthPx) / (2 * 1_500_000);
  let camera: Camera = createCamera({ x: 0, y: 0 }, initialPpm);

  canvas.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      camera = zoomCamera(camera, factor, MIN_PIXELS_PER_METER, MAX_PIXELS_PER_METER);
    },
    { passive: false }
  );

  // Nothing orbits yet in the skeleton, but rebasing against a fixed focus
  // point every tick exercises the same code path the flight camera will use
  // once it follows a moving vessel (PLAN.md §3.1).
  const sceneFocus = { x: 0, y: 0 };

  const loop = createGameLoop(
    {
      step: (_dt) => {
        camera = rebaseCamera(camera, sceneFocus);
      },
      render: (_alpha) => {
        if (!ctx) return;
        drawDemoScene(ctx, camera, stars, widthPx, heightPx);
      },
    },
    { dt: 1 / 60, maxFrameSeconds: 0.25 }
  );

  let lastTimeMs: number | null = null;
  function frame(nowMs: number): void {
    if (lastTimeMs !== null) {
      loop.advance((nowMs - lastTimeMs) / 1000);
    } else {
      loop.advance(0);
    }
    lastTimeMs = nowMs;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  mountMenuScene(getAppRoot());
}

main();
