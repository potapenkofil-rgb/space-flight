import { describe, expect, it } from 'vitest';
import { createGameLoop } from './gameLoop';

describe('createGameLoop', () => {
  it('runs zero steps for a delta smaller than dt, and reports alpha', () => {
    const steps: number[] = [];
    const alphas: number[] = [];
    const loop = createGameLoop(
      { step: (dt) => steps.push(dt), render: (a) => alphas.push(a) },
      { dt: 1 / 60 }
    );
    loop.advance(1 / 120);
    expect(steps).toHaveLength(0);
    expect(loop.tickCount).toBe(0);
    expect(alphas[0]).toBeCloseTo(0.5, 9);
  });

  it('runs exactly floor(elapsed/dt) steps', () => {
    const steps: number[] = [];
    const loop = createGameLoop({ step: (dt) => steps.push(dt), render: () => {} }, { dt: 1 / 60 });
    loop.advance(3.5 / 60); // 3 full steps + half a step banked
    expect(steps).toHaveLength(3);
    expect(steps.every((d) => d === 1 / 60)).toBe(true);
    expect(loop.accumulatorSeconds).toBeCloseTo(0.5 / 60, 12);
  });

  it('clamps a huge delta (e.g. after the tab was backgrounded) to maxFrameSeconds', () => {
    const steps: number[] = [];
    const loop = createGameLoop(
      { step: (dt) => steps.push(dt), render: () => {} },
      { dt: 1 / 60, maxFrameSeconds: 0.25 }
    );
    loop.advance(10); // 10 real seconds elapsed
    // Only 0.25s worth of steps should ever run, not 10s worth (600 steps).
    expect(steps.length).toBe(Math.floor(0.25 / (1 / 60)));
  });

  it('render never mutates simulation state: total ticks depend only on total elapsed time, not on how it is chunked', () => {
    // dt and the chunk size are both exact powers of two (2^-6, 2^-8), so every
    // partial sum along the way is bit-exact in IEEE754 double — this isolates
    // the loop's own logic from unrelated floating-point summation drift that
    // 1/60-style fractions would introduce (that drift is real, expected, and
    // bounded to +/-1 tick near a boundary, but it is not what this test is
    // meant to catch).
    const dt = 1 / 64;
    const totalRealSeconds = 12 / 64; // well under the default maxFrameSeconds (0.25s)

    // Run A: one big advance() call.
    let renderCallsA = 0;
    const loopA = createGameLoop({ step: () => {}, render: () => renderCallsA++ }, { dt });
    loopA.advance(totalRealSeconds);

    // Run B: the same total time delivered as many small advance() calls
    // (i.e. many more render() calls along the way).
    let renderCallsB = 0;
    const loopB = createGameLoop({ step: () => {}, render: () => renderCallsB++ }, { dt });
    const chunk = 1 / 256; // finer than dt, so this exercises partial accumulation too
    let remaining = totalRealSeconds;
    while (remaining > 0) {
      const d = Math.min(chunk, remaining);
      loopB.advance(d);
      remaining -= d;
    }

    expect(renderCallsA).toBe(1);
    expect(renderCallsB).toBeGreaterThan(1);
    // Despite wildly different render() call counts, simulated state (tick
    // count and banked remainder) must match bit-for-bit.
    expect(loopB.tickCount).toBe(loopA.tickCount);
    expect(loopB.accumulatorSeconds).toBeCloseTo(loopA.accumulatorSeconds, 9);
  });

  it('rejects a non-positive dt', () => {
    expect(() => createGameLoop({ step: () => {}, render: () => {} }, { dt: 0 })).toThrow();
  });
});
