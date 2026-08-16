/**
 * Time-warp levels and the gate on which of them are available (PLAN.md §7,
 * Agent A: warp levels 1, 2, 5, 10, 50, 100, 1000, 10000, 100000; above 10x
 * requires on-rails flight and being outside the atmosphere, and a refusal
 * must always carry a reason instead of silently doing nothing).
 *
 * Contract note: PLAN.md §4 does not pin down a timewarp function signature —
 * only the descriptive requirement above. This module is Agent A's design for
 * it: small, pure functions with no `Vessel`/`Body` mutation, so Agent D's
 * flight scene can drive the ',' / '.' warp keys against it directly. Flagged
 * here (and in the Agent A report) as a §4 gap filled rather than guessed at
 * silently.
 */
import { v2 } from '../math/vec2';
import type { Body } from '../orbits/types';
import type { Vessel } from '../vessels/vessel';

/**
 * The fixed ladder of selectable warp multipliers (dimensionless — multiplies
 * simulation seconds per real second). PLAN.md §7: `1, 2, 5, 10, 50, 100,
 * 1000, 10000, 100000`.
 */
export const WARP_LEVELS: readonly number[] = [1, 2, 5, 10, 50, 100, 1000, 10000, 100000];

/** Above this multiplier, PLAN.md §3.3/§7 require on-rails flight and being outside the atmosphere. */
export const MAX_ATMOSPHERIC_WARP = 10;

/** Why a requested warp level was refused. */
export type WarpDenialReason =
  /** `level` is not one of `WARP_LEVELS`. */
  | 'invalid-level'
  /** `level > MAX_ATMOSPHERIC_WARP` requires the vessel to be on-rails (PLAN.md §3.3). */
  | 'requires-rails'
  /** `level > MAX_ATMOSPHERIC_WARP` requires being above the body's atmosphere. */
  | 'requires-vacuum';

/** Outcome of a warp-level request: what was actually granted, and why not if it wasn't. */
export interface WarpDecision {
  /** The level actually in effect after this request. */
  readonly level: number;
  /** `true` iff `level` is exactly the level that was requested. */
  readonly granted: boolean;
  /** `null` when `granted`; otherwise the reason the requested level was refused. */
  readonly reason: WarpDenialReason | null;
}

/** The minimal facts {@link canSelectWarpLevel} needs about a vessel's current situation. */
export interface WarpContext {
  /** Whether the vessel is currently on-rails (PLAN.md §3.3: `Vessel.railOrbit !== null`). */
  readonly onRails: boolean;
  /** Altitude above the current body's surface, m (`|position| - body.radius`). */
  readonly altitude: number;
  /** The current body's atmosphere top altitude, m, or `null` if it has none. */
  readonly atmosphereTop: number | null;
}

/** `true` iff `level` is one of the fixed {@link WARP_LEVELS}. */
export function isWarpLevelValid(level: number): boolean {
  return WARP_LEVELS.includes(level);
}

/** Derives a {@link WarpContext} from a live `Vessel` and its current `Body` (== `vessel.soi`). */
export function warpContextForVessel(vessel: Vessel): WarpContext {
  const body: Body = vessel.soi;
  const altitude = v2.len(vessel.position) - body.radius;
  return {
    onRails: vessel.railOrbit !== null,
    altitude,
    atmosphereTop: body.atmosphere ? body.atmosphere.top : null,
  };
}

/**
 * Decides whether `level` may be selected right now. Levels up to and
 * including {@link MAX_ATMOSPHERIC_WARP} are always available (subject to
 * being one of {@link WARP_LEVELS}); higher levels additionally require
 * `ctx.onRails` and being above the atmosphere (PLAN.md §3.3/§7). Never
 * silent: a refusal always carries a {@link WarpDenialReason}.
 */
export function canSelectWarpLevel(level: number, ctx: WarpContext): WarpDecision {
  if (!isWarpLevelValid(level)) {
    return { level, granted: false, reason: 'invalid-level' };
  }
  if (level <= MAX_ATMOSPHERIC_WARP) {
    return { level, granted: true, reason: null };
  }
  if (!ctx.onRails) {
    return { level, granted: false, reason: 'requires-rails' };
  }
  const inAtmosphere = ctx.atmosphereTop !== null && ctx.altitude < ctx.atmosphereTop;
  if (inAtmosphere) {
    return { level, granted: false, reason: 'requires-vacuum' };
  }
  return { level, granted: true, reason: null };
}

/**
 * Requests a change of warp level from `currentLevel` to `requestedLevel`.
 * Returns the decision: if refused, `level` falls back to `currentLevel`
 * (clamped to a valid, still-permitted level as a last resort) rather than
 * silently doing nothing with no explanation — the UI reads `reason` to tell
 * the player why the warp they asked for didn't happen (PLAN.md §7: on
 * refusal, return the reason, don't stay silent).
 */
export function requestWarpLevel(currentLevel: number, requestedLevel: number, ctx: WarpContext): WarpDecision {
  const decision = canSelectWarpLevel(requestedLevel, ctx);
  if (decision.granted) return decision;

  // Fall back to the current level if it's still valid under `ctx`; otherwise
  // drop to 1x, which is always permitted.
  const fallbackLevel = canSelectWarpLevel(currentLevel, ctx).granted ? currentLevel : 1;
  return { level: fallbackLevel, granted: false, reason: decision.reason };
}

/**
 * Steps to the next higher (`direction=1`) or lower (`direction=-1`) entry in
 * {@link WARP_LEVELS} from `current`, clamped at the ends. Intended for the
 * `,`/`.` warp keys (PLAN.md §7, Agent D's keymap) — does not itself check
 * `WarpContext`; pass the result through {@link canSelectWarpLevel} /
 * {@link requestWarpLevel} before applying it.
 */
export function stepWarpLevel(current: number, direction: 1 | -1): number {
  const index = WARP_LEVELS.indexOf(current);
  if (index === -1) return WARP_LEVELS[0]!; // unknown level: reset to the safe 1x rung
  const next = Math.min(Math.max(index + direction, 0), WARP_LEVELS.length - 1);
  return WARP_LEVELS[next]!;
}
