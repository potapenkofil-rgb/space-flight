/**
 * The flight scene (PLAN.md §7 Agent D): wires the fixed-timestep loop
 * (`engine/gameLoop.ts`, PLAN.md §3.2), the following/shaking camera, the
 * keyboard control scheme (`input/**`), the world renderer and the HUD
 * together. Everything simulation-facing (`FlightSimState`) lives in
 * `flightClock.ts`; this module only reads its output for `render`, per
 * §3.2's "render must not mutate state" rule — see that file's doc for the
 * proof.
 *
 * Drives the scripted-ascent fixture (`fixtures/ascent.ts`) instead of a
 * real `Vessel` — see that file's doc for why, and the Agent D report for
 * exactly what the orchestrator swaps in once Agent A/B land.
 */
import { getLocale, onLocaleChange } from '../../i18n';
import { createGameLoop } from '../../engine/gameLoop';
import { createKeyboardController } from '../../input/inputState';
import {
  createCamera,
  flightZoomBounds,
  followCamera,
  type Camera,
} from '../../render/camera';
import { shakeOffset } from '../../render/cameraShake';
import { drawFlightWorld } from '../../render/world-renderer';
import { mountFlightHud, type FlightHud } from '../../ui/flight/FlightHud';
import { setUnitsLocale, v2 } from '@karman/core';
import { TERRA } from '../map/fixtures/bodies';
import { INITIAL_FLIGHT_SIM_STATE, stepFlightSim, type FlightSimState, type FlightStepResult } from './flightClock';
import type { VesselSnapshot } from './types';

const FIXED_DT = 1 / 60;

function desiredPixelsPerMeter(
  altitude: number,
  vesselSpanMeters: number,
  viewportShorterSidePx: number
): number {
  const { min, max } = flightZoomBounds(vesselSpanMeters, TERRA.radius, viewportShorterSidePx);
  // Zoom out smoothly as altitude grows, reaching the "see the whole body" bound
  // once altitude is a healthy fraction of the body's own radius.
  const t = Math.min(1, altitude / (TERRA.radius * 0.6));
  const eased = t * t * (3 - 2 * t); // smoothstep
  return max + (min - max) * eased;
}

/**
 * Mounts the flight scene: canvas world rendering + HUD DOM. Returns an
 * unmount function that removes every listener/DOM node this created.
 */
export function mountFlightScene(canvas: HTMLCanvasElement, hudRoot: HTMLElement): () => void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('mountFlightScene: 2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context; // narrowed once, kept non-null for closures below

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  setUnitsLocale(getLocale());
  const unsubscribeLocale = onLocaleChange(() => setUnitsLocale(getLocale()));

  const hud: FlightHud = mountFlightHud(hudRoot);
  const input = createKeyboardController();

  // Anchored at the vessel's actual starting position (the pad, one body-radius
  // up from Terra's centre) — not Terra's centre itself — so `followCamera`'s
  // easing starts already-close instead of chasing a full planet-radius offset
  // (which, at launch-pad zoom, would leave the vessel off-screen for a very
  // long time; see the Agent D report for how this was caught).
  let camera: Camera = createCamera(
    { x: 0, y: TERRA.radius },
    desiredPixelsPerMeter(0, 32, Math.min(widthPx, heightPx))
  );
  let simState: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
  let latest: FlightStepResult = {
    state: simState,
    snapshot: {
      position: { x: 0, y: TERRA.radius },
      velocity: { x: 0, y: 0 },
      rotation: Math.PI / 2,
      altitude: 0,
      throttle: 0,
      ambientPressure: 1,
      gForce: 1,
      sas: false,
      stageIndex: 1,
      stageCount: 2,
      fuelFraction: 1,
      twr: 0,
      justStaged: false,
      vesselSpanMeters: 32,
    },
    appliedWarpMultiplier: 1,
    warpBlocked: false,
  };
  let latestSas = false;

  function onKeydown(evt: KeyboardEvent): void {
    if (evt.code === 'KeyM') window.location.href = 'map.html';
  }
  window.addEventListener('keydown', onKeydown);

  const loop = createGameLoop(
    {
      step: (dt) => {
        const control = input.sample(dt);
        latestSas = control.sas;
        latest = stepFlightSim(simState, dt, input.warpIndex, control.throttle);
        simState = latest.state;

        const targetPpm = desiredPixelsPerMeter(
          latest.snapshot.altitude,
          latest.snapshot.vesselSpanMeters,
          Math.min(widthPx, heightPx)
        );
        camera = followCamera(camera, latest.snapshot.position, targetPpm, dt);
      },
      render: (_alpha) => {
        const snap: VesselSnapshot = latest.snapshot;
        drawFlightWorld(
          ctx,
          camera,
          {
            bodyCenter: { x: 0, y: 0 },
            bodyRadiusMeters: TERRA.radius,
            hasAtmosphere: TERRA.atmosphere !== null,
            vesselPosition: snap.position,
            vesselRotation: snap.rotation,
            vesselSpanMeters: snap.vesselSpanMeters,
            throttle: snap.throttle,
            ambientPressure: snap.ambientPressure,
            shakeOffsetPx: shakeOffset(simState.shake),
          },
          widthPx,
          heightPx
        );

        const radialDir = v2.norm(snap.position);
        const verticalSpeed = v2.dot(snap.velocity, radialDir);

        hud.update({
          throttle: snap.throttle,
          altitude: snap.altitude,
          verticalSpeed,
          speed: v2.len(snap.velocity),
          ambientPressure: snap.ambientPressure,
          gForce: snap.gForce,
          sas: latestSas,
          stageIndex: snap.stageIndex,
          stageCount: snap.stageCount,
          fuelFraction: snap.fuelFraction,
          warpMultiplier: latest.appliedWarpMultiplier,
          warpBlocked: latest.warpBlocked,
        });
      },
    },
    { dt: FIXED_DT, maxFrameSeconds: 0.25 }
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
    window.removeEventListener('keydown', onKeydown);
    unsubscribeLocale();
    input.dispose();
    hud.destroy();
    cancelAnimationFrame(rafId);
  };
}
