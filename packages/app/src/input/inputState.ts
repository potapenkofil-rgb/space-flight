/**
 * Turns raw keyboard events into a per-tick `ControlInput` (the exact shape
 * `stepFlight` expects, PLAN.md §4) plus the two things `ControlInput` itself
 * doesn't cover: the SAS toggle latch and the requested time-warp level
 * (PLAN.md §7 Agent D / Agent A `timewarp.ts` — Agent A owns *validating* a
 * warp request; this module only tracks what the player asked for).
 *
 * Pure DOM event bookkeeping — no simulation math lives here, so it is
 * trivially unit-testable by synthesizing `KeyboardEvent`s (see
 * `inputState.test.ts`).
 */
import type { ControlInput } from '@karman/core';
import { ZERO } from '@karman/core';
import { DEFAULT_KEYMAP, type Keymap } from './keymap';

/** Warp steps, exactly per PLAN.md §7 Agent A. */
export const WARP_LEVELS: readonly number[] = [1, 2, 5, 10, 50, 100, 1_000, 10_000, 100_000];

/** How fast `Shift`/`Ctrl` ramp the throttle, fraction of full range per second. */
const THROTTLE_RAMP_PER_SECOND = 0.75;

export interface KeyboardControllerOptions {
  readonly keymap?: Keymap;
  readonly target?: EventTarget;
}

export interface KeyboardController {
  /**
   * Samples the current input state for one physics tick, advancing the
   * throttle ramp by `dt` seconds and consuming (exactly once) any pending
   * edge-triggered stage request. Call once per `step(dt)`, not once per
   * rendered frame (PLAN.md §3.2) — see `ControlInput.stage`'s doc for why.
   */
  sample(dt: number): ControlInput;
  /** Index into {@link WARP_LEVELS} the player has requested via `,`/`.`. Not clamped against flight rules — the caller applies PLAN.md §3.3's restrictions. */
  readonly warpIndex: number;
  /** Removes all event listeners. */
  dispose(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

/** Creates a {@link KeyboardController} listening on `options.target` (default `window`). */
export function createKeyboardController(options: KeyboardControllerOptions = {}): KeyboardController {
  const keymap = options.keymap ?? DEFAULT_KEYMAP;
  const target = options.target ?? window;

  const pressed = new Set<string>();
  let throttle = 0;
  let sas = false;
  let stagePending = false;
  let warpIndex = 0;

  function bound(action: keyof Keymap, code: string): boolean {
    return keymap[action].includes(code);
  }

  function onKeyDown(evt: Event): void {
    const event = evt as KeyboardEvent;
    if (isEditableTarget(event.target)) return;
    pressed.add(event.code);
    if (event.repeat) return;

    if (bound('throttleFull', event.code)) throttle = 1;
    else if (bound('throttleCutoff', event.code)) throttle = 0;
    else if (bound('stage', event.code)) stagePending = true;
    else if (bound('toggleSas', event.code)) sas = !sas;
    else if (bound('warpUp', event.code)) warpIndex = Math.min(warpIndex + 1, WARP_LEVELS.length - 1);
    else if (bound('warpDown', event.code)) warpIndex = Math.max(warpIndex - 1, 0);
    else return;
    event.preventDefault();
  }

  function onKeyUp(evt: Event): void {
    const event = evt as KeyboardEvent;
    pressed.delete(event.code);
  }

  function onBlur(): void {
    pressed.clear();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  function isActionHeld(action: keyof Keymap): boolean {
    return keymap[action].some((code) => pressed.has(code));
  }

  return {
    sample(dt: number): ControlInput {
      if (isActionHeld('throttleUp')) throttle += THROTTLE_RAMP_PER_SECOND * dt;
      if (isActionHeld('throttleDown')) throttle -= THROTTLE_RAMP_PER_SECOND * dt;
      throttle = Math.min(1, Math.max(0, throttle));

      let rotate = 0;
      if (isActionHeld('rotateLeft')) rotate += 1;
      if (isActionHeld('rotateRight')) rotate -= 1;

      const stage = stagePending;
      stagePending = false;

      return {
        throttle,
        rotate,
        rcsTranslate: ZERO,
        sas,
        stage,
      };
    },
    get warpIndex() {
      return warpIndex;
    },
    dispose(): void {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
