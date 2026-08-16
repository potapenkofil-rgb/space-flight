import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKeyboardController, WARP_LEVELS, type KeyboardController } from './inputState';

function keydown(code: string, repeat = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat }));
}
function keyup(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
}

describe('createKeyboardController', () => {
  let controller: KeyboardController;

  beforeEach(() => {
    controller = createKeyboardController();
  });
  afterEach(() => {
    controller.dispose();
  });

  it('starts at zero throttle, centered rotation, SAS off', () => {
    const input = controller.sample(1 / 60);
    expect(input.throttle).toBe(0);
    expect(input.rotate).toBe(0);
    expect(input.sas).toBe(false);
    expect(input.stage).toBe(false);
  });

  it('Z jumps throttle to full instantly', () => {
    keydown('KeyZ');
    expect(controller.sample(1 / 60).throttle).toBe(1);
  });

  it('X cuts throttle to zero instantly', () => {
    keydown('KeyZ');
    controller.sample(1 / 60);
    keydown('KeyX');
    expect(controller.sample(1 / 60).throttle).toBe(0);
  });

  it('holding Shift ramps throttle up gradually, not instantly', () => {
    keydown('ShiftLeft');
    const afterOneTick = controller.sample(1 / 60).throttle;
    expect(afterOneTick).toBeGreaterThan(0);
    expect(afterOneTick).toBeLessThan(1);
    // Continuing to hold it eventually saturates at 1, never overshoots.
    for (let i = 0; i < 300; i++) controller.sample(1 / 60);
    expect(controller.sample(1 / 60).throttle).toBe(1);
  });

  it('holding Ctrl ramps throttle down gradually and clamps at zero', () => {
    keydown('KeyZ');
    controller.sample(1 / 60);
    keyup('KeyZ');
    keydown('ControlLeft');
    for (let i = 0; i < 300; i++) controller.sample(1 / 60);
    expect(controller.sample(1 / 60).throttle).toBe(0);
  });

  it('A/D drive rotate in opposite directions and cancel when both held', () => {
    keydown('KeyA');
    expect(controller.sample(1 / 60).rotate).toBe(1);
    keydown('KeyD');
    expect(controller.sample(1 / 60).rotate).toBe(0);
    keyup('KeyA');
    expect(controller.sample(1 / 60).rotate).toBe(-1);
  });

  it('T toggles SAS on keydown, ignores auto-repeat, does not re-toggle on keyup', () => {
    keydown('KeyT');
    expect(controller.sample(1 / 60).sas).toBe(true);
    keydown('KeyT', true); // OS auto-repeat while held must not double-toggle
    expect(controller.sample(1 / 60).sas).toBe(true);
    keyup('KeyT');
    expect(controller.sample(1 / 60).sas).toBe(true);
    keydown('KeyT');
    expect(controller.sample(1 / 60).sas).toBe(false);
  });

  it('Space fires stage exactly once per press, even across several sample() calls', () => {
    keydown('Space');
    expect(controller.sample(1 / 60).stage).toBe(true);
    expect(controller.sample(1 / 60).stage).toBe(false);
    expect(controller.sample(1 / 60).stage).toBe(false);
  });

  it('holding Space (auto-repeat) does not re-fire stage', () => {
    keydown('Space');
    controller.sample(1 / 60); // consumes the one edge
    keydown('Space', true);
    expect(controller.sample(1 / 60).stage).toBe(false);
  });

  it('. and , step through WARP_LEVELS and clamp at the ends', () => {
    expect(controller.warpIndex).toBe(0);
    keydown('Period');
    expect(controller.warpIndex).toBe(1);
    keydown('Comma');
    keydown('Comma');
    expect(controller.warpIndex).toBe(0); // clamped, not negative
    for (let i = 0; i < WARP_LEVELS.length + 2; i++) keydown('Period');
    expect(controller.warpIndex).toBe(WARP_LEVELS.length - 1); // clamped at the top
  });

  it('dispose() stops listening', () => {
    controller.dispose();
    keydown('KeyZ');
    expect(controller.sample(1 / 60).throttle).toBe(0);
  });
});
