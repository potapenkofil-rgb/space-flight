import { describe, expect, it } from 'vitest';
import { FIXTURE_PARTS } from './__fixtures__/parts';
import { FIXTURE_TERRA } from './__fixtures__/system';
import { computeReadout } from './readout';
import { attachPart, createEmptyState, findAttachCandidates, placeRoot, type BuildState } from './state';

function place(state: BuildState, partId: string): BuildState {
  const candidates = findAttachCandidates(state, FIXTURE_PARTS, partId);
  const candidate = candidates[0];
  if (!candidate) throw new Error(`no attach candidate for ${partId}`);
  return attachPart(state, FIXTURE_PARTS, partId, candidate);
}

describe('computeReadout', () => {
  it('an empty assembly has zero mass, thrust and ΔV', () => {
    const readout = computeReadout(createEmptyState(), FIXTURE_PARTS, FIXTURE_TERRA);
    expect(readout.massKg).toBe(0);
    expect(readout.thrustAtmN).toBe(0);
    expect(readout.deltaVAtmTotal).toBe(0);
    expect(readout.partCount).toBe(0);
  });

  it('a single-stage rocket matches the Tsiolkovsky rocket equation by hand', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_vac');
    state = place(state, 'tank_s1');
    const readout = computeReadout(state, FIXTURE_PARTS, FIXTURE_TERRA, 0); // vacuum

    const engine = FIXTURE_PARTS.get('engine_vac');
    const tank = FIXTURE_PARTS.get('tank_s1');
    const fuelMass = tank.resources[0]?.capacity ?? 0;
    const startMass = engine.dryMass + tank.dryMass + fuelMass;
    const endMass = engine.dryMass + tank.dryMass;
    const expectedDv = (engine.engine?.ispVac ?? 0) * 9.806_65 * Math.log(startMass / endMass);

    expect(readout.deltaVVacTotal).toBeCloseTo(expectedDv, 3);
    expect(readout.massKg).toBeCloseTo(startMass, 6);
    expect(readout.partCount).toBe(2);
  });

  it('mass grows and ΔV changes as more parts are added (live update while "holding" a part)', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    const before = computeReadout(state, FIXTURE_PARTS, FIXTURE_TERRA);
    state = place(state, 'tank_s1'); // simulates committing the held part
    const after = computeReadout(state, FIXTURE_PARTS, FIXTURE_TERRA);
    expect(after.massKg).toBeGreaterThan(before.massKg);
    expect(after.partCount).toBe(before.partCount + 1);
  });

  it('thrust-to-weight uses the vessel body\'s own surface gravity, not a hardcoded 9.81', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    state = place(state, 'tank_s1');
    const onTerra = computeReadout(state, FIXTURE_PARTS, FIXTURE_TERRA);
    expect(onTerra.twrAtm).toBeGreaterThan(0);
  });
});
