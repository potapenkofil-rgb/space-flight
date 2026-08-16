/**
 * Entry point: the fixed-timestep main loop (PLAN.md §3.2), the
 * floating-origin ambient scene (PLAN.md §3.1) behind the menu/hangar, and
 * the real scene router — Menu → Hangar → Flight ⇄ Map (PLAN.md §8), `M`
 * toggles flight/map, `Esc` returns to menu.
 *
 * Replaces the temporary integration seams every scene grew while its own
 * agent worked in isolation: the `?scene=build` query hack, and the
 * standalone `flight.html`/`map.html` pages with `window.location.href`
 * navigation between them (see `vite.config.ts`'s history for the
 * multi-page build this superseded). One `index.html`, one router, real
 * navigation between all four scenes.
 */
import './ui/tokens.css';
import { mountMenuScene } from './scenes/menu/MenuScene';
import { mountBuildScene } from './scenes/build/BuildScene';
import { mountFlightScene } from './scenes/flight/FlightScene';
import { mountMapScene } from './scenes/map/MapScene';
import { createGameLoop } from './engine/gameLoop';
import { launchVessel } from './game/launch';
import { getSession, setActiveVessel } from './game/session';
import { createCamera, rebaseCamera, zoomCamera, type Camera } from './render/camera';
import { drawDemoScene } from './render/demoScene';
import { createStarfield } from './render/starfield';
import { getInitialTheme } from './ui/tokens';

const MIN_PIXELS_PER_METER = 1e-7;
const MAX_PIXELS_PER_METER = 2;
const STAR_FIELD_RADIUS_M = 4_000_000;

type SceneName = 'menu' | 'build' | 'flight' | 'map';

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

/** Parses the router's target scene from `location.hash` (`#/build`, `#/flight`, `#/map`; anything else — including empty — is the menu). */
function parseScene(): SceneName {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash === 'build' || hash === 'flight' || hash === 'map') return hash;
  return 'menu';
}

/**
 * The empty-scene visual (PLAN.md §7 item 7: a planet and a star field)
 * shown behind the menu and the hangar — both of which sit on top of
 * `#world-canvas` as a DOM overlay rather than taking it over the way
 * flight/map do. Returns an unmount function.
 */
function mountAmbientWorld(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');

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
  const initialPpm = Math.min(heightPx, widthPx) / (2 * 1_500_000);
  let camera: Camera = createCamera({ x: 0, y: 0 }, initialPpm);

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    camera = zoomCamera(camera, factor, MIN_PIXELS_PER_METER, MAX_PIXELS_PER_METER);
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });

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
  let rafId = 0;
  function frame(nowMs: number): void {
    if (lastTimeMs !== null) loop.advance((nowMs - lastTimeMs) / 1000);
    else loop.advance(0);
    lastTimeMs = nowMs;
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return () => {
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('wheel', onWheel);
    cancelAnimationFrame(rafId);
  };
}

function main(): void {
  const canvas = getCanvas();
  const appRoot = getAppRoot();
  document.documentElement.dataset['theme'] = getInitialTheme();

  let unmountScene: (() => void) | null = null;
  let unmountAmbient: (() => void) | null = null;

  function navigate(scene: SceneName): void {
    const target = scene === 'menu' ? '' : `/${scene}`;
    if (window.location.hash !== `#${target}`) {
      window.location.hash = target;
      // `hashchange` fires render(); nothing more to do here.
    }
  }

  function render(): void {
    unmountScene?.();
    unmountScene = null;
    unmountAmbient?.();
    unmountAmbient = null;
    appRoot.innerHTML = '';

    const scene = parseScene();
    if (scene === 'menu') {
      unmountAmbient = mountAmbientWorld(canvas);
      unmountScene = mountMenuScene(appRoot, { onEnterHangar: () => navigate('build') });
    } else if (scene === 'build') {
      unmountAmbient = mountAmbientWorld(canvas);
      unmountScene = mountBuildScene(appRoot, {
        onLaunch: (state, library, system) => {
          const vessel = launchVessel(state, library, system.root);
          setActiveVessel(vessel, 0);
          navigate('flight');
        },
      });
    } else if (scene === 'flight') {
      if (!getSession().registry.activeVesselId) {
        // No vessel to fly (e.g. a direct link/refresh on #/flight) — send
        // the player back to the hangar instead of crashing the scene.
        navigate('build');
        return;
      }
      unmountScene = mountFlightScene(canvas, appRoot, navigate);
    } else {
      if (getSession().registry.vessels.length === 0) {
        navigate('build');
        return;
      }
      unmountScene = mountMapScene(canvas, appRoot, navigate);
    }
  }

  window.addEventListener('hashchange', render);
  render();
}

main();
