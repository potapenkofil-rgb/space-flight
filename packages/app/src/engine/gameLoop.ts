/**
 * The fixed-timestep main loop, exactly per PLAN.md §3.2: an accumulator drives
 * zero or more fixed-`dt` simulation steps per real frame, clamped so a
 * minimized/backgrounded tab can't "catch up" by simulating hours at once, then
 * renders once with an interpolation factor `alpha` between the previous and
 * next simulated state.
 *
 * This module has no DOM/canvas dependency — `step`/`render` are caller-supplied
 * callbacks — specifically so the accumulator arithmetic itself is unit-testable
 * headlessly (see `gameLoop.test.ts`), proving `render` cannot influence
 * simulation state no matter how many times it's called.
 */

export interface GameLoopCallbacks {
  /**
   * Advances the simulation by exactly one fixed step. May be called zero,
   * one, or several times per `advance()` call. Must be deterministic: the
   * same sequence of `dt` values must always produce the same resulting state.
   *
   * @param dt fixed step length, s — always the `dt` this loop was configured with
   */
  step(dt: number): void;
  /**
   * Draws the current frame. Called exactly once per `advance()` call, after
   * all due `step()` calls. MUST NOT mutate simulation state — `render` is
   * purely a function of already-simulated state plus `alpha`.
   *
   * @param alpha interpolation factor in `[0, 1)` between the last completed
   *   step and the next one, for smoothing motion between fixed steps
   */
  render(alpha: number): void;
}

export interface GameLoopOptions {
  /** Fixed simulation step, s. PLAN.md §3.2 mandates `1/60`; that's also the default. */
  readonly dt?: number;
  /** Upper bound on the real elapsed time consumed per `advance()` call, s. PLAN.md §3.2 mandates `0.25`; that's also the default. */
  readonly maxFrameSeconds?: number;
}

export interface GameLoop {
  /**
   * Advances the loop by `realDeltaSeconds` of wall-clock time: clamps it to
   * `maxFrameSeconds`, adds it to the internal accumulator, runs `step(dt)`
   * for as many whole `dt`s as have accumulated, then calls `render(alpha)`
   * exactly once.
   */
  advance(realDeltaSeconds: number): void;
  /** Total number of completed `step()` calls since this loop was created. */
  readonly tickCount: number;
  /** Seconds of unsimulated time currently banked (always in `[0, dt)`). */
  readonly accumulatorSeconds: number;
}

const DEFAULT_DT = 1 / 60;
const DEFAULT_MAX_FRAME_SECONDS = 0.25;

/** Creates a `GameLoop` around the given `step`/`render` callbacks. */
export function createGameLoop(
  callbacks: GameLoopCallbacks,
  options: GameLoopOptions = {}
): GameLoop {
  const dt = options.dt ?? DEFAULT_DT;
  const maxFrameSeconds = options.maxFrameSeconds ?? DEFAULT_MAX_FRAME_SECONDS;
  if (dt <= 0) throw new RangeError('createGameLoop: dt must be positive');

  let accumulator = 0;
  let tickCount = 0;

  return {
    advance(realDeltaSeconds: number): void {
      const clamped = Math.min(Math.max(realDeltaSeconds, 0), maxFrameSeconds);
      accumulator += clamped;
      while (accumulator >= dt) {
        callbacks.step(dt);
        accumulator -= dt;
        tickCount += 1;
      }
      callbacks.render(accumulator / dt);
    },
    get tickCount() {
      return tickCount;
    },
    get accumulatorSeconds() {
      return accumulator;
    },
  };
}
