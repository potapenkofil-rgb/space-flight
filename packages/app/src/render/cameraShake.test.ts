import { describe, expect, it } from 'vitest';
import {
  kickShake,
  NO_SHAKE,
  shakeOffset,
  thrustShakeImpulsePerSecond,
  updateShake,
} from './cameraShake';

describe('camera shake', () => {
  it('is silent at rest', () => {
    expect(shakeOffset(NO_SHAKE)).toEqual({ x: 0, y: 0 });
  });

  it('kickShake adds amplitude, updateShake decays it toward zero', () => {
    let shake = kickShake(NO_SHAKE, 10);
    expect(shake.amplitude).toBe(10);
    for (let i = 0; i < 200; i++) shake = updateShake(shake, 1 / 60);
    expect(shake.amplitude).toBeLessThan(0.01);
  });

  it('offsets never exceed the current amplitude', () => {
    const shake = kickShake(NO_SHAKE, 6);
    const offset = shakeOffset(shake);
    expect(Math.abs(offset.x)).toBeLessThanOrEqual(6);
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(6);
  });

  it('thrustShakeImpulsePerSecond is zero below the TWR threshold or with the engine off', () => {
    expect(thrustShakeImpulsePerSecond(1.2, 1)).toBe(0);
    expect(thrustShakeImpulsePerSecond(3, 0)).toBe(0);
  });

  it('thrustShakeImpulsePerSecond grows with TWR and throttle, and is capped', () => {
    const low = thrustShakeImpulsePerSecond(2, 1);
    const high = thrustShakeImpulsePerSecond(5, 1);
    expect(high).toBeGreaterThan(low);
    expect(thrustShakeImpulsePerSecond(50, 1)).toBeLessThanOrEqual(4);
  });
});
