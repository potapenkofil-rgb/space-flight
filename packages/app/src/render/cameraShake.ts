/**
 * Screen-space camera shake (DESIGN.md §3: "camera shake on stage
 * separation"; PLAN.md §7 Agent D: "shake on separation and high thrust").
 * Deliberately kept out of `Camera` itself: shake is a purely cosmetic pixel
 * offset applied only at draw time, never folded into `camera.anchor` — if it
 * were, `screenToWorld` (used for map click-picking, maneuver-node dragging)
 * would jitter along with it.
 *
 * Uses a seeded PRNG, not `Math.random` — consistent with PLAN.md §3.6's
 * "no `Math.random` without an explicit seed" rule for the sim core; the
 * renderer isn't part of the deterministic sim, but there is no reason to
 * reach for a global-state RNG when a tiny local one is just as easy and
 * makes the shake trail reproducible for tests/screenshots.
 */

export interface CameraShake {
  /** Current shake amplitude, screen px. Decays toward 0 every `update`. */
  readonly amplitude: number;
  readonly seed: number;
}

/** A shake state at rest. */
export const NO_SHAKE: CameraShake = Object.freeze({ amplitude: 0, seed: 1 });

/** Adds an impulse (e.g. on stage separation) to the current shake, in screen px. */
export function kickShake(shake: CameraShake, impulsePx: number): CameraShake {
  return { amplitude: shake.amplitude + impulsePx, seed: shake.seed };
}

/**
 * Decays `shake` by `dt` seconds and returns the updated state. `halfLifeSeconds`
 * is how long it takes the amplitude to fall to half its value.
 */
export function updateShake(shake: CameraShake, dt: number, halfLifeSeconds = 0.15): CameraShake {
  if (shake.amplitude < 0.01) return NO_SHAKE;
  const decay = Math.pow(0.5, dt / halfLifeSeconds);
  return { amplitude: shake.amplitude * decay, seed: (shake.seed * 1103515245 + 12345) >>> 0 };
}

/** Deterministic pseudo-random screen-space offset for the current `shake` state, in CSS px. */
export function shakeOffset(shake: CameraShake): { x: number; y: number } {
  if (shake.amplitude <= 0) return { x: 0, y: 0 };
  const a = ((shake.seed >>> 8) & 0xffff) / 0xffff; // [0,1)
  const b = ((shake.seed >>> 16) & 0xffff) / 0xffff;
  return {
    x: (a * 2 - 1) * shake.amplitude,
    y: (b * 2 - 1) * shake.amplitude,
  };
}

/**
 * How much shake a sustained high-thrust burn should add per second of thrust
 * (PLAN.md §7 Agent D: "shake ... on ... high thrust"), as a function of
 * throttle-weighted acceleration relative to the body's surface gravity —
 * i.e. shake scales with how hard the vessel is currently burning, not with
 * an absolute thrust number, so it behaves sensibly for any rocket size.
 *
 * @param twr thrust-to-weight ratio this tick, dimensionless
 * @param throttle commanded throttle, `0..1`
 */
export function thrustShakeImpulsePerSecond(twr: number, throttle: number): number {
  if (throttle <= 0 || twr <= 1.5) return 0;
  return Math.min(4, (twr - 1.5) * 0.6) * throttle;
}
