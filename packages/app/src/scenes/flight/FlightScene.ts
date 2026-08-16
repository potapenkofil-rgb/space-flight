/**
 * The flight scene (PLAN.md §7 Agent D / §7 stage-2 integration): wires the
 * fixed-timestep loop (`engine/gameLoop.ts`, PLAN.md §3.2), the
 * following/shaking camera, the keyboard control scheme (`input/**`), the
 * world renderer, the HUD and the black-box replay panel together, driving
 * the real `Vessel` launched from the hangar (`game/session.ts`) — the
 * scripted-ascent fixture this scene used to drive is gone; see
 * `flightClock.ts`'s doc for the real physics loop.
 *
 * Everything simulation-facing (`FlightSimState`, the vessel itself) is
 * mutated only inside `flightClock.ts`'s `stepFlightSim`, called only from
 * `step()`; `render()` only reads the result, per §3.2's "render must not
 * mutate state" rule.
 */
import {
  cloneVessel,
  createFlightRecorder,
  stateFromOrbit,
  v2,
  type ControlInput,
  type FlightRecorder,
  type Vessel,
} from '@karman/core';
import { getLocale, onLocaleChange, t } from '../../i18n';
import { createGameLoop } from '../../engine/gameLoop';
import { getActiveVessel, getSession } from '../../game/session';
import { createKeyboardController } from '../../input/inputState';
import { createCamera, flightZoomBounds, followCamera, type Camera } from '../../render/camera';
import { shakeOffset } from '../../render/cameraShake';
import { drawFlightWorld, type VesselPartView } from '../../render/world-renderer';
import { mountFlightHud, type FlightHud } from '../../ui/flight/FlightHud';
import { mountReplayPanel, type ReplayPanel } from '../../ui/replay/replayPanel';
import { setUnitsLocale } from '@karman/core';
import { INITIAL_FLIGHT_SIM_STATE, stepFlightSim, type FlightSimState, type FlightStepResult } from './flightClock';
import type { VesselSnapshot } from './types';

const FIXED_DT = 1 / 60;
/** How often (real seconds) the black-box panel re-opens its `ReplaySession` to pick up newly-recorded ticks — see the module doc on why this isn't fully reactive. */
const REPLAY_REFRESH_SECONDS = 3;

export type FlightNavigate = (scene: 'menu' | 'map') => void;

/** `mm:ss` readout for the black-box timeline (PLAN.md §7 Agent F) — simulation time, not wall-clock. */
function formatFlightTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function desiredPixelsPerMeter(
  altitude: number,
  bodyRadius: number,
  vesselSpanMeters: number,
  viewportShorterSidePx: number
): number {
  const { min, max } = flightZoomBounds(vesselSpanMeters, bodyRadius, viewportShorterSidePx);
  const tt = Math.min(1, altitude / (bodyRadius * 0.6));
  const eased = tt * tt * (3 - 2 * tt); // smoothstep
  return max + (min - max) * eased;
}

/**
 * The `WorldStepFn` the black box needs to replay recorded commands forward
 * (PLAN.md §3.6 / `recording/recorder.ts`'s doc): the active vessel is
 * stepped with the real flight physics at 1x (a rewind reconstructs history,
 * it doesn't need to honor the original warp level); every other vessel
 * (always on-rails, PLAN.md §3.3) is advanced analytically.
 */
function replayStepWorld(
  vessels: readonly Vessel[],
  t: number,
  dt: number,
  step: { readonly activeVesselId: number; readonly input: ControlInput }
): readonly Vessel[] {
  return vessels.map((v) => {
    if (v.id !== step.activeVesselId) {
      if (!v.railOrbit) return v;
      const { r, v: vel } = stateFromOrbit(v.railOrbit, t);
      return { ...v, position: r, velocity: vel };
    }
    const clone = cloneVessel(v);
    const result = stepFlightSim(clone, INITIAL_FLIGHT_SIM_STATE, t, dt, 0, step.input);
    return result.vessel;
  });
}

/** Flattens a vessel's parts into the world renderer's minimal per-part view (PLAN.md §3.7). */
function toVesselPartViews(vessel: Vessel): VesselPartView[] {
  return vessel.parts.map((p) => ({ def: p.def, position: p.position, rotation: p.rotation }));
}

/**
 * Mounts the flight scene: canvas world rendering + HUD DOM + black-box
 * panel. Returns an unmount function that removes every listener/DOM node
 * this created.
 *
 * @param navigate switches to another scene (`M` → map, `Esc` → menu) —
 *   injected by the router (`main.ts`) instead of the old
 *   `window.location.href` page-navigation hack.
 */
export function mountFlightScene(canvas: HTMLCanvasElement, hudRoot: HTMLElement, navigate: FlightNavigate): () => void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('mountFlightScene: 2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context; // narrowed once, kept non-null for closures below

  const session = getSession();
  const initialVessel = getActiveVessel();
  if (!initialVessel) {
    throw new Error('mountFlightScene: no active vessel — launch one from the hangar first');
  }
  let vessel: Vessel = initialVessel;

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

  // Anchored at the vessel's actual starting position (the pad, not the
  // body's centre) so `followCamera`'s easing starts already-close instead
  // of chasing a full planet-radius offset.
  let camera: Camera = createCamera(
    vessel.position,
    desiredPixelsPerMeter(0, vessel.soi.radius, 32, Math.min(widthPx, heightPx))
  );
  let simState: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
  let latest: FlightStepResult = {
    state: simState,
    snapshot: {
      position: vessel.position,
      velocity: vessel.velocity,
      rotation: Math.PI / 2,
      altitude: v2.len(vessel.position) - vessel.soi.radius,
      throttle: 0,
      ambientPressure: 1,
      gForce: 1,
      sas: false,
      stageIndex: vessel.currentStage + 1,
      stageCount: vessel.stages.length,
      fuelFraction: 1,
      twr: 0,
      justStaged: false,
      vesselSpanMeters: 32,
    },
    vessel,
    simTime: session.simTime,
    appliedWarpMultiplier: 1,
    warpBlocked: false,
    warpBlockedReason: null,
  };
  let latestSas = false;

  // -- Black box (PLAN.md §7 Agent F): record every tick, refresh the panel periodically. --
  let recorder: FlightRecorder = createFlightRecorder(replayStepWorld, { dt: FIXED_DT });
  let replayPanel: ReplayPanel | null = null;
  let timeSinceReplayRefresh = Number.POSITIVE_INFINITY;

  function refreshReplayPanel(): void {
    replayPanel?.unmount();
    replayPanel = mountReplayPanel(hudRoot, {
      session: recorder.openReplay(),
      vesselId: vessel.id,
      formatTime: formatFlightTime,
      t,
      onStartFromHere(atTime, vessels) {
        const restored = vessels.find((v) => v.id === vessel.id) ?? vessels[0];
        if (!restored) return;
        vessel = restored;
        session.simTime = atTime;
        recorder = createFlightRecorder(replayStepWorld, { dt: FIXED_DT });
        timeSinceReplayRefresh = Number.POSITIVE_INFINITY;
      },
    });
  }

  function onKeydown(evt: KeyboardEvent): void {
    if (evt.code === 'KeyM') navigate('map');
    else if (evt.code === 'Escape') navigate('menu');
  }
  window.addEventListener('keydown', onKeydown);

  const loop = createGameLoop(
    {
      step: (dt) => {
        const control = input.sample(dt);
        latestSas = control.sas;
        latest = stepFlightSim(vessel, simState, session.simTime, dt, input.warpIndex, control);
        vessel = latest.vessel;
        simState = latest.state;
        session.simTime = latest.simTime;
        recorder.tick(latest.simTime, [vessel], control);

        const targetPpm = desiredPixelsPerMeter(
          latest.snapshot.altitude,
          vessel.soi.radius,
          latest.snapshot.vesselSpanMeters,
          Math.min(widthPx, heightPx)
        );
        camera = followCamera(camera, latest.snapshot.position, targetPpm, dt);

        timeSinceReplayRefresh += dt;
        if (timeSinceReplayRefresh >= REPLAY_REFRESH_SECONDS) {
          timeSinceReplayRefresh = 0;
          refreshReplayPanel();
        }
      },
      render: (_alpha) => {
        const snap: VesselSnapshot = latest.snapshot;
        drawFlightWorld(
          ctx,
          camera,
          {
            bodyCenter: { x: 0, y: 0 },
            bodyRadiusMeters: vessel.soi.radius,
            hasAtmosphere: vessel.soi.atmosphere !== null,
            vesselPosition: snap.position,
            vesselRotation: snap.rotation,
            vesselSpanMeters: snap.vesselSpanMeters,
            throttle: snap.throttle,
            ambientPressure: snap.ambientPressure,
            vesselParts: toVesselPartViews(vessel),
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
    replayPanel?.unmount();
    cancelAnimationFrame(rafId);
  };
}
