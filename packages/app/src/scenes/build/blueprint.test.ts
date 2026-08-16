import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_PARTS } from './__fixtures__/parts';
import {
  deleteBlueprint,
  deserializeBlueprint,
  listBlueprints,
  loadBlueprint,
  saveBlueprint,
  serializeBlueprint,
} from './blueprint';
import { attachPart, createEmptyState, findAttachCandidates, placeRoot, setSymmetryMode, type BuildState } from './state';

function place(state: BuildState, partId: string): BuildState {
  const candidate = findAttachCandidates(state, FIXTURE_PARTS, partId)[0];
  if (!candidate) throw new Error(`no attach candidate for ${partId}`);
  return attachPart(state, FIXTURE_PARTS, partId, candidate);
}

function buildTwoStageRocket(): BuildState {
  let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
  state = place(state, 'tank_s1');
  state = place(state, 'decoupler_stack');
  state = place(state, 'engine_vac');
  state = place(state, 'tank_m1');
  state = place(state, 'pod_capsule');
  state = setSymmetryMode(state, FIXTURE_PARTS, 2);
  const boosterCandidate = findAttachCandidates(state, FIXTURE_PARTS, 'srb_booster').find((c) => c.kind === 'radial');
  if (boosterCandidate) state = attachPart(state, FIXTURE_PARTS, 'srb_booster', boosterCandidate);
  return state;
}

beforeEach(() => {
  localStorage.clear();
});

describe('serializeBlueprint / deserializeBlueprint round trip', () => {
  it('reproduces an identical BuildState (structurally)', () => {
    const state = buildTwoStageRocket();
    const doc = serializeBlueprint(state, 'test-rocket', () => new Date('2026-08-16T00:00:00Z'));
    const restored = deserializeBlueprint(doc);

    expect(restored.parts).toEqual(state.parts);
    expect(restored.joints).toEqual(state.joints);
    expect(restored.stages).toEqual(state.stages);
    expect(restored.symmetryGroups).toEqual(state.symmetryGroups);
    expect(restored.symmetryMode).toBe(state.symmetryMode);
  });

  it('rejects an unknown format version', () => {
    const state = buildTwoStageRocket();
    const doc = serializeBlueprint(state, 'x');
    expect(() => deserializeBlueprint({ ...doc, formatVersion: 999 })).toThrow();
  });
});

describe('localStorage save/load (PLAN.md §6.3 dev-mode backend)', () => {
  it('a saved blueprint loads back byte-identical to what was saved', () => {
    const state = buildTwoStageRocket();
    saveBlueprint(state, 'my-rocket');
    const loaded = loadBlueprint('my-rocket');
    expect(loaded).not.toBeNull();
    expect(loaded?.parts).toEqual(state.parts);
    expect(loaded?.joints).toEqual(state.joints);
    expect(loaded?.stages).toEqual(state.stages);
  });

  it('listBlueprints tracks saved names, alphabetically', () => {
    saveBlueprint(buildTwoStageRocket(), 'zeta');
    saveBlueprint(buildTwoStageRocket(), 'alpha');
    expect(listBlueprints()).toEqual(['alpha', 'zeta']);
  });

  it('loading an unknown blueprint returns null instead of throwing', () => {
    expect(loadBlueprint('does-not-exist')).toBeNull();
  });

  it('deleteBlueprint removes it from both storage and the index', () => {
    saveBlueprint(buildTwoStageRocket(), 'to-delete');
    expect(listBlueprints()).toContain('to-delete');
    deleteBlueprint('to-delete');
    expect(listBlueprints()).not.toContain('to-delete');
    expect(loadBlueprint('to-delete')).toBeNull();
  });

  it('saving under an existing name overwrites it without duplicating the index', () => {
    saveBlueprint(placeRoot(createEmptyState(), FIXTURE_PARTS, 'pod_capsule'), 'same-name');
    saveBlueprint(buildTwoStageRocket(), 'same-name');
    expect(listBlueprints().filter((n) => n === 'same-name')).toHaveLength(1);
    expect(loadBlueprint('same-name')?.parts.length).toBeGreaterThan(1);
  });
});
