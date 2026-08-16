import { describe, expect, it } from 'vitest';
import { v2 } from '@karman/core';
import { didScriptedStageSeparationOccur, sampleScriptedAscent, STAGE_SEPARATION_TIME_S } from './ascent';
import { TERRA } from '../../map/fixtures/bodies';

describe('sampleScriptedAscent', () => {
  it('is pure: the same t always yields a bitwise-identical snapshot', () => {
    const a = sampleScriptedAscent(42.5);
    const b = sampleScriptedAscent(42.5);
    expect(a).toEqual(b);
  });

  it('starts on the pad: zero altitude, zero speed, full fuel, stage 1 of 2', () => {
    const s = sampleScriptedAscent(0);
    expect(s.altitude).toBe(0);
    expect(v2.len(s.velocity)).toBe(0);
    expect(s.fuelFraction).toBe(1);
    expect(s.stageIndex).toBe(1);
    expect(s.stageCount).toBe(2);
  });

  it('altitude increases (weakly monotonically) over the whole ascent', () => {
    let prevAltitude = -1;
    for (let t = 0; t <= 300; t += 5) {
      const s = sampleScriptedAscent(t);
      expect(s.altitude).toBeGreaterThanOrEqual(prevAltitude - 1e-6);
      prevAltitude = s.altitude;
    }
  });

  it('never dips underground', () => {
    for (let t = 0; t <= 300; t += 1) {
      expect(sampleScriptedAscent(t).altitude).toBeGreaterThanOrEqual(0);
    }
  });

  it('reaches roughly the PLAN.md §5.7 circular-orbit numbers by the end (~100 km, ~2986 m/s)', () => {
    const s = sampleScriptedAscent(260);
    // "circular-ish" per the module doc, not exact — the table is hand-tuned,
    // not integrated from real physics, so this checks the right ballpark
    // rather than an exact figure.
    expect(s.altitude).toBeGreaterThan(90_000);
    expect(s.altitude).toBeLessThan(115_000);
    expect(v2.len(s.velocity)).toBeCloseTo(2_986, -1);
  });

  it('keeps coasting (position advances) well past the scripted keyframes, instead of freezing', () => {
    const a = sampleScriptedAscent(400);
    const b = sampleScriptedAscent(500);
    expect(v2.len(v2.sub(a.position, b.position))).toBeGreaterThan(1000);
    expect(a.altitude).toBeCloseTo(b.altitude, 0); // still ~circular, altitude doesn't drift
  });

  it('ambient pressure drops toward 0 with altitude and stays within [0,1]', () => {
    const low = sampleScriptedAscent(1);
    const high = sampleScriptedAscent(220);
    expect(low.ambientPressure).toBeGreaterThan(high.ambientPressure);
    for (const t of [0, 30, 70, 150, 300]) {
      const p = sampleScriptedAscent(t).ambientPressure;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('position magnitude always exceeds the body radius (never inside Terra)', () => {
    for (let t = 0; t <= 300; t += 10) {
      const s = sampleScriptedAscent(t);
      expect(v2.len(s.position)).toBeGreaterThanOrEqual(TERRA.radius);
    }
  });

  it('fuel resets to full at stage separation, simulating a fresh upper stage', () => {
    const justBefore = sampleScriptedAscent(STAGE_SEPARATION_TIME_S - 0.5);
    const atSep = sampleScriptedAscent(STAGE_SEPARATION_TIME_S);
    expect(justBefore.fuelFraction).toBeLessThan(0.2);
    expect(atSep.fuelFraction).toBeCloseTo(1, 6);
    expect(atSep.stageIndex).toBe(2);
  });

  it('didScriptedStageSeparationOccur fires exactly across the separation instant', () => {
    expect(didScriptedStageSeparationOccur(64, 66)).toBe(true);
    expect(didScriptedStageSeparationOccur(70, 71)).toBe(false);
    expect(didScriptedStageSeparationOccur(0, 10)).toBe(false);
  });

  // Regression test for a real bug caught while reviewing the flight-scene
  // screenshot: an earlier version of the keyframe table picked `downrangeDeg`
  // by eye, independently of `speed`/`flightPathAngle` — the vessel's rendered
  // *position* raced sideways far faster than its reported *velocity* implied,
  // and the camera (correctly tracking position) chased that phantom drift
  // straight off the edge of the viewport. This checks the two stay consistent:
  // the finite-difference velocity from two nearby positions must roughly match
  // the reported `velocity` at every sampled point across the whole ascent.
  it('position and reported velocity agree (finite-difference check)', () => {
    const EPS = 0.02;
    // Every keyframe `t` in ascent.ts — the piecewise-linear interpolation has a
    // legitimate kink (discontinuous slope) right at each one, which a tiny
    // finite-difference window can straddle and briefly amplify; skip those exact
    // neighborhoods rather than the test's own sample grid happening to dodge them.
    const breakpoints = [
      0, 1, 2, 3, 4, 5, 7, 9, 11, 13, 15, 18, 21, 24, 27, 30, 35, 40, 45, 50, 55, 59, 61, 63,
      64.9, 65, 66, 68, 72, 78, 85, 95, 105, 120, 135, 150, 165, 180, 195, 210, 220, 240, 260,
    ];
    for (let t = 0.5; t <= 300; t += 0.5) {
      if (breakpoints.some((b) => Math.abs(t - b) < 0.06)) continue;

      const a = sampleScriptedAscent(t);
      const b = sampleScriptedAscent(t + EPS);
      const numericVelocity = v2.scale(v2.sub(b.position, a.position), 1 / EPS);
      const reportedSpeed = v2.len(a.velocity);
      const numericSpeed = v2.len(numericVelocity);

      // Generous relative tolerance (piecewise-linear keyframes aren't exactly
      // smooth) — this is a sanity check against another order-of-magnitude
      // mismatch like the one that caused the original bug, not a precision test.
      if (reportedSpeed > 1) {
        expect(numericSpeed, `at t=${t}`).toBeGreaterThan(reportedSpeed * 0.5);
        expect(numericSpeed, `at t=${t}`).toBeLessThan(reportedSpeed * 1.5);
      }
    }
  });
});
