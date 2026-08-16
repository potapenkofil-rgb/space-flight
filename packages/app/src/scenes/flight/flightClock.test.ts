import { describe, expect, it } from 'vitest';
import { createGameLoop } from '../../engine/gameLoop';
import { WARP_LEVELS } from '../../input/inputState';
import { INITIAL_FLIGHT_SIM_STATE, stepFlightSim, type FlightSimState } from './flightClock';

const DT = 1 / 60;

describe('stepFlightSim', () => {
  it('advances simTime by dt at warp 1x with no warp requested', () => {
    const result = stepFlightSim(INITIAL_FLIGHT_SIM_STATE, DT, 0, 0);
    expect(result.state.simTime).toBeCloseTo(DT, 9);
    expect(result.appliedWarpMultiplier).toBe(1);
    expect(result.warpBlocked).toBe(false);
  });

  it('blocks warp above 10x while low in the atmosphere, clamping to 10x', () => {
    const highWarpIndex = WARP_LEVELS.indexOf(100);
    const result = stepFlightSim(INITIAL_FLIGHT_SIM_STATE, DT, highWarpIndex, 0);
    expect(result.appliedWarpMultiplier).toBe(10);
    expect(result.warpBlocked).toBe(true);
  });

  it('blocks warp above 10x while the engine is firing, even above the atmosphere', () => {
    // Fast-forward to well above the atmosphere ceiling (60 km) first.
    let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
    for (let i = 0; i < 60 * 250; i++) {
      state = stepFlightSim(state, DT, 0, 0).state;
    }
    const highWarpIndex = WARP_LEVELS.indexOf(1_000);
    const result = stepFlightSim(state, DT, highWarpIndex, 1); // throttle=1: still burning
    expect(result.warpBlocked).toBe(true);
    expect(result.appliedWarpMultiplier).toBe(10);
  });

  it('allows warp above 10x once above the atmosphere with the engine off', () => {
    let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
    for (let i = 0; i < 60 * 250; i++) {
      state = stepFlightSim(state, DT, 0, 0).state;
    }
    expect(state.simTime).toBeGreaterThan(250);
    const highWarpIndex = WARP_LEVELS.indexOf(1_000);
    const result = stepFlightSim(state, DT, highWarpIndex, 0);
    expect(result.warpBlocked).toBe(false);
    expect(result.appliedWarpMultiplier).toBe(1_000);
  });

  it('flags justStaged on exactly the tick crossing the scripted separation time, not before or after', () => {
    let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
    let sawStageOnTick = -1;
    for (let i = 0; i < 60 * 90; i++) {
      const result = stepFlightSim(state, DT, 0, 1);
      state = result.state;
      if (result.snapshot.justStaged) {
        expect(sawStageOnTick).toBe(-1); // fires exactly once
        sawStageOnTick = i;
      }
    }
    expect(sawStageOnTick).toBeGreaterThan(0);
  });

  it('kicks camera shake on stage separation', () => {
    let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
    let sawShakeJump = false;
    for (let i = 0; i < 60 * 90; i++) {
      const before = state.shake.amplitude;
      const result = stepFlightSim(state, DT, 0, 1);
      state = result.state;
      if (state.shake.amplitude > before + 1) sawShakeJump = true;
    }
    expect(sawShakeJump).toBe(true);
  });
});

describe('render never mutates flight simulation state (PLAN.md §3.2)', () => {
  it('two runs with a different number of render() calls produce identical FlightSimState', () => {
    function run(renderCallsPerStep: number): FlightSimState {
      let state: FlightSimState = INITIAL_FLIGHT_SIM_STATE;
      const renderReadsOfState: FlightSimState[] = [];
      const loop = createGameLoop(
        {
          step: (dt) => {
            state = stepFlightSim(state, dt, 0, 1).state;
          },
          render: () => {
            // render is only ever allowed to *read* state, never call stepFlightSim.
            for (let i = 0; i < renderCallsPerStep; i++) {
              renderReadsOfState.push(state);
            }
          },
        },
        { dt: DT }
      );
      for (let i = 0; i < 300; i++) loop.advance(DT * (1 + (i % 3))); // irregular frame pacing
      void renderReadsOfState;
      return state;
    }

    const a = run(0);
    const b = run(5);
    expect(a).toEqual(b);
  });
});
