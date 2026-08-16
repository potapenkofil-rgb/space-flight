/**
 * FIXTURE — a hand-scripted two-stage ascent from Terra's surface to a
 * ~100 km circular-ish orbit (a "scripted rocket ascent" per the task
 * brief), standing in for `stepFlight` (Agent B, still `throws
 * 'not implemented'`) so the flight scene has something believable to
 * render/HUD while other agents' branches are in progress.
 *
 * `sampleScriptedAscent(t)` is a pure function of simulation time — no
 * internal state, no dependency on how many times it's called or in what
 * order — which is exactly what lets `FlightScene.ts` prove `render` never
 * mutates simulation state (PLAN.md §3.2): the "world state" that actually
 * advances is just `t`, owned by the scene's `step()`.
 *
 * The keyframe table is tuned by eye, not integrated from real physics —
 * once Agent B's `stepFlight` and Agent A's on-rails transition exist, the
 * orchestrator replaces the single call site in `FlightScene.ts` with the
 * real simulation loop and this file is deleted.
 */
import type { Vec2 } from '@karman/core';
import { TERRA } from '../../map/fixtures/bodies';
import type { VesselSnapshot } from '../types';

/** Simulation time (s) the first stage separates — used for camera-shake/HUD-flash edge detection by the caller. */
export const STAGE_SEPARATION_TIME_S = 65;

/** Constant vessel footprint for camera zoom bounds (PLAN.md §7 Agent D: "see the landing legs"). */
const VESSEL_SPAN_METERS = 32;

interface Keyframe {
  readonly t: number;
  readonly altitude: number;
  readonly downrangeDeg: number;
  readonly speed: number;
  readonly flightPathAngleDeg: number; // 90 = straight up, 0 = horizontal
  readonly throttle: number;
  readonly fuelFraction: number;
  readonly gForce: number;
  readonly twr: number;
}

// `altitude` and `downrangeDeg` are not eyeballed like the other columns —
// both are the numerical integral (0.02 s sub-steps) of, respectively, radial
// speed (`speed·sin(flightPathAngle)`) and tangential speed
// (`speed·cos(flightPathAngle)` divided by the body's radius at that
// altitude), of a coarser hand-authored speed/flightPathAngle curve,
// resampled at each `t` below. They have to be computed this way — and
// finely enough that linear interpolation *between* the emitted points stays
// close to the true integral — or the vessel's rendered *position* silently
// disagrees with its rendered *velocity*: an earlier version of this table
// picked altitude/downrange by feel (or only matched the integral at a
// handful of widely-spaced points), which raced the vessel through space far
// faster than its own reported speed implied, and the following camera
// (correctly tracking position) chased that phantom drift clean off the edge
// of the screen. See `ascent.test.ts`'s finite-difference regression test
// and the Agent D report for how this was caught and fixed.
const KEYFRAMES: readonly Keyframe[] = [
  { t: 0, altitude: 0, downrangeDeg: 0, speed: 0, flightPathAngleDeg: 90, throttle: 0, fuelFraction: 1, gForce: 1, twr: 0 },
  { t: 1, altitude: 4.17, downrangeDeg: 0.000001, speed: 8.33, flightPathAngleDeg: 89.67, throttle: 0.333, fuelFraction: 0.9833, gForce: 1.1, twr: 0.433 },
  { t: 2, altitude: 16.67, downrangeDeg: 0.000007, speed: 16.67, flightPathAngleDeg: 89.33, throttle: 0.667, fuelFraction: 0.9667, gForce: 1.2, twr: 0.867 },
  { t: 3, altitude: 37.5, downrangeDeg: 0.000025, speed: 25, flightPathAngleDeg: 89, throttle: 1, fuelFraction: 0.95, gForce: 1.3, twr: 1.3 },
  { t: 4, altitude: 70.2, downrangeDeg: 0.000064, speed: 40.42, flightPathAngleDeg: 88.67, throttle: 1, fuelFraction: 0.9333, gForce: 1.342, twr: 1.333 },
  { t: 5, altitude: 118.31, downrangeDeg: 0.000136, speed: 55.83, flightPathAngleDeg: 88.33, throttle: 1, fuelFraction: 0.9167, gForce: 1.383, twr: 1.367 },
  { t: 7, altitude: 260.72, downrangeDeg: 0.000424, speed: 86.67, flightPathAngleDeg: 87.67, throttle: 1, fuelFraction: 0.8833, gForce: 1.467, twr: 1.433 },
  { t: 9, altitude: 464.66, downrangeDeg: 0.000972, speed: 117.5, flightPathAngleDeg: 87, throttle: 1, fuelFraction: 0.85, gForce: 1.55, twr: 1.5 },
  { t: 11, altitude: 730.04, downrangeDeg: 0.00186, speed: 148.33, flightPathAngleDeg: 86.33, throttle: 1, fuelFraction: 0.8167, gForce: 1.633, twr: 1.567 },
  { t: 13, altitude: 1_056.73, downrangeDeg: 0.003172, speed: 179.17, flightPathAngleDeg: 85.67, throttle: 1, fuelFraction: 0.7833, gForce: 1.717, twr: 1.633 },
  { t: 15, altitude: 1_444.6, downrangeDeg: 0.004987, speed: 210, flightPathAngleDeg: 85, throttle: 1, fuelFraction: 0.75, gForce: 1.8, twr: 1.7 },
  { t: 18, altitude: 2_168.74, downrangeDeg: 0.009755, speed: 276, flightPathAngleDeg: 82, throttle: 1, fuelFraction: 0.705, gForce: 1.875, twr: 1.745 },
  { t: 21, altitude: 3_082.78, downrangeDeg: 0.018546, speed: 342, flightPathAngleDeg: 79, throttle: 1, fuelFraction: 0.66, gForce: 1.95, twr: 1.79 },
  { t: 24, altitude: 4_180.8, downrangeDeg: 0.032493, speed: 408, flightPathAngleDeg: 76, throttle: 1, fuelFraction: 0.615, gForce: 2.025, twr: 1.835 },
  { t: 27, altitude: 5_455.3, downrangeDeg: 0.052698, speed: 474, flightPathAngleDeg: 73, throttle: 1, fuelFraction: 0.57, gForce: 2.1, twr: 1.88 },
  { t: 30, altitude: 6_897.26, downrangeDeg: 0.080223, speed: 540, flightPathAngleDeg: 70, throttle: 1, fuelFraction: 0.525, gForce: 2.175, twr: 1.925 },
  { t: 35, altitude: 9_643.4, downrangeDeg: 0.145105, speed: 650, flightPathAngleDeg: 65, throttle: 1, fuelFraction: 0.45, gForce: 2.3, twr: 2 },
  { t: 40, altitude: 12_950.59, downrangeDeg: 0.248641, speed: 862.5, flightPathAngleDeg: 57.5, throttle: 1, fuelFraction: 0.3675, gForce: 2.375, twr: 2.05 },
  { t: 45, altitude: 16_847.16, downrangeDeg: 0.410735, speed: 1_075, flightPathAngleDeg: 50, throttle: 1, fuelFraction: 0.285, gForce: 2.45, twr: 2.1 },
  { t: 50, altitude: 21_102.57, downrangeDeg: 0.640676, speed: 1_287.5, flightPathAngleDeg: 42.5, throttle: 1, fuelFraction: 0.2025, gForce: 2.525, twr: 2.15 },
  { t: 55, altitude: 25_452.33, downrangeDeg: 0.945147, speed: 1_500, flightPathAngleDeg: 35, throttle: 1, fuelFraction: 0.12, gForce: 2.6, twr: 2.2 },
  { t: 59, altitude: 28_885.05, downrangeDeg: 1.246298, speed: 1_700, flightPathAngleDeg: 30, throttle: 0.95, fuelFraction: 0.07, gForce: 2.35, twr: 2.05 },
  { t: 61, altitude: 30_567.74, downrangeDeg: 1.417042, speed: 1_800, flightPathAngleDeg: 27.5, throttle: 0.925, fuelFraction: 0.045, gForce: 2.225, twr: 1.975 },
  { t: 63, altitude: 32_203.42, downrangeDeg: 1.601391, speed: 1_900, flightPathAngleDeg: 25, throttle: 0.9, fuelFraction: 0.02, gForce: 2.1, twr: 1.9 },
  // Held near-empty right up to the separation instant, so the fuel gauge doesn't visibly "refill" during engine cutoff coast.
  { t: 64.9, altitude: 33_700.44, downrangeDeg: 1.783599, speed: 1_900, flightPathAngleDeg: 24, throttle: 0, fuelFraction: 0.02, gForce: 0.1, twr: 0 },
  // Stage separation at t=65: throttle drops to 0 for an instant, fresh stage fuel resets to 1.0, brief freefall.
  { t: STAGE_SEPARATION_TIME_S, altitude: 33_777.72, downrangeDeg: 1.793219, speed: 1_900, flightPathAngleDeg: 24, throttle: 0, fuelFraction: 1, gForce: 0.05, twr: 0 },
  { t: 66, altitude: 34_539.08, downrangeDeg: 1.889463, speed: 1_893.33, flightPathAngleDeg: 23.33, throttle: 0.333, fuelFraction: 0.9833, gForce: 0.333, twr: 0.317 },
  { t: 68, altitude: 35_993.22, downrangeDeg: 2.082159, speed: 1_880, flightPathAngleDeg: 22, throttle: 1, fuelFraction: 0.95, gForce: 0.9, twr: 0.95 },
  { t: 72, altitude: 38_807.86, downrangeDeg: 2.472974, speed: 1_927.69, flightPathAngleDeg: 21.38, throttle: 1, fuelFraction: 0.9192, gForce: 0.915, twr: 0.958 },
  { t: 78, altitude: 43_014.36, downrangeDeg: 3.078674, speed: 1_999.23, flightPathAngleDeg: 20.46, throttle: 1, fuelFraction: 0.8731, gForce: 0.938, twr: 0.969 },
  { t: 85, altitude: 47_881.75, downrangeDeg: 3.814793, speed: 2_082.69, flightPathAngleDeg: 19.38, throttle: 1, fuelFraction: 0.8192, gForce: 0.965, twr: 0.983 },
  { t: 95, altitude: 54_717.55, downrangeDeg: 4.921237, speed: 2_201.92, flightPathAngleDeg: 17.85, throttle: 1, fuelFraction: 0.7423, gForce: 1.004, twr: 1.002 },
  { t: 105, altitude: 61_355.93, downrangeDeg: 6.091892, speed: 2_321.15, flightPathAngleDeg: 16.31, throttle: 1, fuelFraction: 0.6654, gForce: 1.042, twr: 1.021 },
  { t: 120, altitude: 70_798.9, downrangeDeg: 7.967447, speed: 2_500, flightPathAngleDeg: 14, throttle: 1, fuelFraction: 0.55, gForce: 1.1, twr: 1.05 },
  { t: 135, altitude: 79_378.03, downrangeDeg: 9.948585, speed: 2_587.5, flightPathAngleDeg: 12, throttle: 0.925, fuelFraction: 0.475, gForce: 0.975, twr: 0.988 },
  { t: 150, altitude: 86_904.89, downrangeDeg: 11.997766, speed: 2_675, flightPathAngleDeg: 10, throttle: 0.85, fuelFraction: 0.4, gForce: 0.85, twr: 0.925 },
  { t: 165, altitude: 93_280.39, downrangeDeg: 14.114563, speed: 2_762.5, flightPathAngleDeg: 8, throttle: 0.775, fuelFraction: 0.325, gForce: 0.725, twr: 0.863 },
  { t: 180, altitude: 98_406.28, downrangeDeg: 16.298693, speed: 2_850, flightPathAngleDeg: 6, throttle: 0.7, fuelFraction: 0.25, gForce: 0.6, twr: 0.8 },
  { t: 195, altitude: 102_069.04, downrangeDeg: 18.536314, speed: 2_901, flightPathAngleDeg: 3.75, throttle: 0.494, fuelFraction: 0.2125, gForce: 0.431, twr: 0.613 },
  { t: 210, altitude: 104_076.87, downrangeDeg: 20.81361, speed: 2_952, flightPathAngleDeg: 1.5, throttle: 0.287, fuelFraction: 0.175, gForce: 0.263, twr: 0.425 },
  { t: 220, altitude: 104_464.75, downrangeDeg: 22.353829, speed: 2_986, flightPathAngleDeg: 0, throttle: 0.15, fuelFraction: 0.15, gForce: 0.15, twr: 0.3 },
  { t: 240, altitude: 104_464.75, downrangeDeg: 25.451894, speed: 2_986, flightPathAngleDeg: 0, throttle: 0.075, fuelFraction: 0.15, gForce: 0.075, twr: 0.15 },
  { t: 260, altitude: 104_464.75, downrangeDeg: 28.54996, speed: 2_986, flightPathAngleDeg: 0, throttle: 0, fuelFraction: 0.15, gForce: 0, twr: 0 },
];

const LAST_KEYFRAME = KEYFRAMES[KEYFRAMES.length - 1]!;
/** Angular rate (rad/s) used to keep coasting downrange after the scripted ascent ends, so the demo doesn't freeze mid-orbit. */
const ORBITAL_ANGULAR_RATE = LAST_KEYFRAME.speed / (TERRA.radius + LAST_KEYFRAME.altitude);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolate(t: number, pick: (k: Keyframe) => number): number {
  if (t <= KEYFRAMES[0]!.t) return pick(KEYFRAMES[0]!);
  if (t >= LAST_KEYFRAME.t) return pick(LAST_KEYFRAME);
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i]!;
    const b = KEYFRAMES[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const local = span <= 0 ? 0 : (t - a.t) / span;
      return lerp(pick(a), pick(b), local);
    }
  }
  return pick(LAST_KEYFRAME);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Samples the scripted ascent at simulation time `t` (s ≥ 0). Pure — same `t` always yields the same snapshot. */
export function sampleScriptedAscent(t: number): VesselSnapshot {
  const clampedT = Math.max(0, t);
  const altitude = interpolate(clampedT, (k) => k.altitude);
  const speed = interpolate(clampedT, (k) => k.speed);
  const flightPathAngle = degToRad(interpolate(clampedT, (k) => k.flightPathAngleDeg));
  const throttle = interpolate(clampedT, (k) => k.throttle);
  const fuelFraction = interpolate(clampedT, (k) => k.fuelFraction);
  const gForce = interpolate(clampedT, (k) => k.gForce);
  const twr = interpolate(clampedT, (k) => k.twr);

  let downrangeRad: number;
  if (clampedT >= LAST_KEYFRAME.t) {
    downrangeRad = degToRad(LAST_KEYFRAME.downrangeDeg) + ORBITAL_ANGULAR_RATE * (clampedT - LAST_KEYFRAME.t);
  } else {
    downrangeRad = degToRad(interpolate(clampedT, (k) => k.downrangeDeg));
  }

  const radius = TERRA.radius + altitude;
  const localUp: Vec2 = { x: Math.sin(downrangeRad), y: Math.cos(downrangeRad) };
  const localEast: Vec2 = { x: Math.cos(downrangeRad), y: -Math.sin(downrangeRad) };
  const position: Vec2 = { x: radius * localUp.x, y: radius * localUp.y };

  const radialSpeed = speed * Math.sin(flightPathAngle);
  const tangentialSpeed = speed * Math.cos(flightPathAngle);
  const velocity: Vec2 = {
    x: radialSpeed * localUp.x + tangentialSpeed * localEast.x,
    y: radialSpeed * localUp.y + tangentialSpeed * localEast.y,
  };

  const rotation = speed > 0.01 ? Math.atan2(velocity.y, velocity.x) : Math.atan2(localUp.y, localUp.x);

  const ambientPressure = TERRA.atmosphere
    ? Math.max(0, Math.exp(-altitude / TERRA.atmosphere.scaleHeight))
    : 0;

  const stageIndex = clampedT < STAGE_SEPARATION_TIME_S ? 1 : 2;

  return {
    position,
    velocity,
    rotation,
    altitude,
    throttle,
    ambientPressure: Math.min(1, ambientPressure),
    gForce,
    sas: false,
    stageIndex,
    stageCount: 2,
    fuelFraction,
    twr,
    justStaged: false, // edge detection is the caller's job — see module doc
    vesselSpanMeters: VESSEL_SPAN_METERS,
  };
}

/** True if the scripted stage separation happened strictly between `prevT` and `currT` (edge-triggered, like `ControlInput.stage`). */
export function didScriptedStageSeparationOccur(prevT: number, currT: number): boolean {
  return prevT < STAGE_SEPARATION_TIME_S && currT >= STAGE_SEPARATION_TIME_S;
}
