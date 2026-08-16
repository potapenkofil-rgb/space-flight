/**
 * The flight scene's *simulation-side* state advance — deliberately the only
 * piece of `scenes/flight/**` that mutates anything, so PLAN.md §3.2's rule
 * ("`render` must not mutate simulation state... two runs with a different
 * number of `render()` calls give bitwise-identical state") is structurally
 * true: `FlightScene.ts`'s `render(alpha)` never calls anything in this
 * file, only reads what the last `step(dt)` produced. See
 * `flightClock.test.ts` for the same property `gameLoop.test.ts` proves for
 * the generic accumulator, proved here for this scene's own state.
 *
 * Also owns the warp-request gating from PLAN.md §3.3: warp above 10× is
 * only valid off-rails-free — engine off, above the atmosphere, not on the
 * ground. The scripted-ascent fixture never actually lands, but the check is
 * implemented for real so the HUD's "blocked" lamp means something.
 */
import { WARP_LEVELS } from '../../input/inputState';
import { kickShake, NO_SHAKE, thrustShakeImpulsePerSecond, updateShake, type CameraShake } from '../../render/cameraShake';
import { STAGE_SEPARATION_SHAKE_PX } from './constants';
import { didScriptedStageSeparationOccur, sampleScriptedAscent } from './fixtures/ascent';
import type { VesselSnapshot } from './types';
import { TERRA } from '../map/fixtures/bodies';

export interface FlightSimState {
  readonly simTime: number;
  readonly shake: CameraShake;
}

export const INITIAL_FLIGHT_SIM_STATE: FlightSimState = Object.freeze({
  simTime: 0,
  shake: NO_SHAKE,
});

export interface FlightStepResult {
  readonly state: FlightSimState;
  readonly snapshot: VesselSnapshot;
  readonly appliedWarpMultiplier: number;
  readonly warpBlocked: boolean;
}

const MAX_UNRESTRICTED_WARP_INDEX = WARP_LEVELS.indexOf(10);

function highWarpAllowed(snapshot: VesselSnapshot, throttle: number): boolean {
  const atmosphereTop = TERRA.atmosphere?.top ?? 0;
  return throttle <= 0 && snapshot.altitude > atmosphereTop && snapshot.altitude > 0;
}

/**
 * Advances the flight scene's simulation-side state by exactly one fixed
 * tick. Pure given its inputs (no reads of wall-clock time, no DOM) — the
 * only "world state" is `FlightSimState`, threaded explicitly in and out.
 *
 * @param state the previous tick's state
 * @param dt fixed physics tick length, s (PLAN.md §3.2: `1/60`)
 * @param requestedWarpIndex index into `WARP_LEVELS` the player has asked for
 * @param throttle this tick's commanded throttle, `0..1` — gates high warp
 *   (PLAN.md §3.3) and overrides the ascent fixture's own scripted throttle
 *   in the returned snapshot, so the HUD/plume reflect real input
 */
export function stepFlightSim(
  state: FlightSimState,
  dt: number,
  requestedWarpIndex: number,
  throttle: number
): FlightStepResult {
  const beforeSnapshot = sampleScriptedAscent(state.simTime);
  const wantsHighWarp = requestedWarpIndex > MAX_UNRESTRICTED_WARP_INDEX;
  const allowed = !wantsHighWarp || highWarpAllowed(beforeSnapshot, throttle);
  const appliedIndex = allowed ? requestedWarpIndex : MAX_UNRESTRICTED_WARP_INDEX;
  const appliedWarpMultiplier = WARP_LEVELS[appliedIndex] ?? 1;

  const prevTime = state.simTime;
  const nextTime = prevTime + dt * appliedWarpMultiplier;
  const justStaged = didScriptedStageSeparationOccur(prevTime, nextTime);

  const rawSnapshot = sampleScriptedAscent(nextTime);
  // `rawSnapshot.throttle` is the *scripted* keyframe curve baked into the ascent
  // fixture (it drives the pre-recorded altitude/speed/fuel numbers, which don't
  // actually respond to player input — see fixtures/ascent.ts's doc). The HUD
  // gauge and the engine plume both need to show what the player *commanded*
  // instead, or Z/X/Shift/Ctrl would visibly do nothing — so it's overridden here
  // with the real commanded throttle this function already received.
  const snapshot: VesselSnapshot = { ...rawSnapshot, throttle, justStaged };

  let shake = updateShake(state.shake, dt);
  if (justStaged) shake = kickShake(shake, STAGE_SEPARATION_SHAKE_PX);
  const thrustKick = thrustShakeImpulsePerSecond(snapshot.twr, snapshot.throttle) * dt;
  if (thrustKick > 0) shake = kickShake(shake, thrustKick);

  return {
    state: { simTime: nextTime, shake },
    snapshot,
    appliedWarpMultiplier,
    warpBlocked: wantsHighWarp && !allowed,
  };
}
