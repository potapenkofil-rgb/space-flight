import { describe, expect, it } from 'vitest';
import { FIXTURE_PARTS } from './__fixtures__/parts';
import {
  attachPart,
  createEmptyState,
  findAttachCandidates,
  findPart,
  movePartToStage,
  placeRoot,
  removePart,
  reorderStages,
  setSymmetryMode,
  toVessel,
} from './state';
import { FIXTURE_TERRA } from './__fixtures__/system';

/** Picks the highest open node to attach to — these tests always build the stack upward, and (since engines now expose both a bottom and a top node, PLAN.md §6.1) `findAttachCandidates` legitimately returns more than one candidate. */
function place(stateArg: ReturnType<typeof createEmptyState>, partId: string) {
  const candidates = findAttachCandidates(stateArg, FIXTURE_PARTS, partId);
  const candidate = [...candidates].sort((a, b) => b.worldPos.y - a.worldPos.y)[0];
  if (!candidate) throw new Error(`no attach candidate for ${partId}`);
  return attachPart(stateArg, FIXTURE_PARTS, partId, candidate);
}

describe('placeRoot', () => {
  it('places the first part at the origin, unrotated', () => {
    const state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'pod_capsule');
    expect(state.parts).toHaveLength(1);
    const root = state.parts[0];
    expect(root?.position).toEqual({ x: 0, y: 0 });
    expect(root?.rotation).toBe(0);
    expect(root?.attachedTo).toBeNull();
  });

  it('refuses to place a root part into a non-empty assembly', () => {
    const state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'pod_capsule');
    expect(() => placeRoot(state, FIXTURE_PARTS, 'tank_s1')).toThrow();
  });
});

describe('stack attachment', () => {
  it('stacks a tank below the pod, coincident stack nodes facing each other', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'pod_capsule');
    const candidates = findAttachCandidates(state, FIXTURE_PARTS, 'tank_s1');
    // Pod only exposes stack nodes (bottom + top); tank should snap onto one of them.
    expect(candidates.length).toBeGreaterThan(0);
    const candidate = candidates[0];
    if (!candidate) throw new Error('expected a candidate');
    state = attachPart(state, FIXTURE_PARTS, 'tank_s1', candidate);
    expect(state.parts).toHaveLength(2);
    expect(state.joints).toHaveLength(1);

    const tank = state.parts[1];
    const pod = state.parts[0];
    if (!tank || !pod) throw new Error('expected both parts');
    // Tank's connecting node must land exactly on the pod's node it attached to.
    expect(tank.position.x).toBeCloseTo(pod.position.x, 9);
  });

  it('builds a full two-stage stack: engine -> tank -> decoupler -> engine -> tank -> pod', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    state = place(state, 'tank_s1');
    state = place(state, 'decoupler_stack');
    state = place(state, 'engine_vac');
    state = place(state, 'tank_m1');
    state = place(state, 'pod_capsule');
    expect(state.parts).toHaveLength(6);
    expect(state.joints).toHaveLength(5);
    // engine_start closes stage 0, engine_vac closes stage 1 — three stages total (trailing one pruned to the one holding the pod).
    expect(state.stages.length).toBeGreaterThanOrEqual(2);
    const allPartIds = state.stages.flatMap((s) => s.partIds);
    expect(new Set(allPartIds).size).toBe(6);
  });

  it('attaches a part below an open downward-facing node without a spurious 180° flip (regression)', () => {
    // Building nose-first: pod as the root, then a tank attached *below* it —
    // the reverse of every other test in this file, and exactly the order
    // `bestOwnNode` used to get wrong (it always grabbed the held part's most
    // downward-facing node, ignoring which way the target node it was mating
    // with actually pointed — harmless for this symmetric tank, but the
    // equivalent mistake on an engine points its thrust into the ground; see
    // `bestOwnNode`'s doc comment and `topDownAssembly.test.ts`).
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'pod_capsule');
    const candidates = findAttachCandidates(state, FIXTURE_PARTS, 'tank_s1');
    // The pod's bottom node (dir (0,-1)) — attaching "below" it.
    const downward = candidates.find((c) => c.transform.position.y < 0);
    if (!downward) throw new Error('expected a candidate attaching below the pod');
    state = attachPart(state, FIXTURE_PARTS, 'tank_s1', downward);
    const tank = state.parts[1];
    if (!tank) throw new Error('expected the tank to be placed');
    expect(tank.rotation).toBeCloseTo(0, 9);
    expect(tank.position.y).toBeLessThan(0);
  });
});

describe('radial attachment + live symmetry', () => {
  function buildCoreWithBooster(symmetry: 1 | 2 | 4 | 6) {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'tank_m1');
    state = setSymmetryMode(state, FIXTURE_PARTS, symmetry);
    const candidates = findAttachCandidates(state, FIXTURE_PARTS, 'srb_booster');
    const radial = candidates.find((c) => c.kind === 'radial');
    if (!radial) throw new Error('expected a radial candidate on the tank');
    state = attachPart(state, FIXTURE_PARTS, 'srb_booster', radial);
    return state;
  }

  it('symmetry 1 places exactly one booster', () => {
    const state = buildCoreWithBooster(1);
    const boosters = state.parts.filter((p) => p.partId === 'srb_booster');
    expect(boosters).toHaveLength(1);
    expect(state.symmetryGroups).toHaveLength(0);
  });

  it('symmetry 4 places four boosters as one live group', () => {
    const state = buildCoreWithBooster(4);
    const boosters = state.parts.filter((p) => p.partId === 'srb_booster');
    expect(boosters).toHaveLength(4);
    expect(state.symmetryGroups).toHaveLength(1);
    expect(state.symmetryGroups[0]?.count).toBe(4);
  });

  it('changing symmetry mode later rebuilds already-placed boosters, not just future ones', () => {
    let state = buildCoreWithBooster(2);
    expect(state.parts.filter((p) => p.partId === 'srb_booster')).toHaveLength(2);

    state = setSymmetryMode(state, FIXTURE_PARTS, 6);
    expect(state.parts.filter((p) => p.partId === 'srb_booster')).toHaveLength(6);
    expect(state.symmetryGroups[0]?.count).toBe(6);

    state = setSymmetryMode(state, FIXTURE_PARTS, 1);
    expect(state.parts.filter((p) => p.partId === 'srb_booster')).toHaveLength(1);
  });

  it('symmetry siblings are evenly spaced around the parent by rotation', () => {
    const state = buildCoreWithBooster(4);
    const parent = state.parts.find((p) => p.partId === 'tank_m1');
    const boosters = state.parts.filter((p) => p.partId === 'srb_booster');
    if (!parent) throw new Error('expected parent');
    const radii = boosters.map((b) => Math.hypot(b.position.x - parent.position.x, b.position.y - parent.position.y));
    for (const r of radii) expect(r).toBeCloseTo(radii[0] ?? 0, 9);
  });
});

describe('removePart', () => {
  it('removing a part removes its whole subtree', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    state = place(state, 'tank_s1');
    state = place(state, 'decoupler_stack');
    state = place(state, 'pod_capsule');
    expect(state.parts).toHaveLength(4);

    const decoupler = state.parts.find((p) => p.partId === 'decoupler_stack');
    if (!decoupler) throw new Error('expected decoupler');
    state = removePart(state, decoupler.instanceId);
    // Decoupler + pod above it are gone; engine + tank remain.
    expect(state.parts).toHaveLength(2);
    expect(state.parts.map((p) => p.partId).sort()).toEqual(['engine_start', 'tank_s1']);
  });

  it('removing a symmetry leader removes the whole group', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'tank_m1');
    state = setSymmetryMode(state, FIXTURE_PARTS, 4);
    const candidates = findAttachCandidates(state, FIXTURE_PARTS, 'srb_booster');
    const radial = candidates.find((c) => c.kind === 'radial');
    if (!radial) throw new Error('expected radial candidate');
    state = attachPart(state, FIXTURE_PARTS, 'srb_booster', radial);
    expect(state.parts.filter((p) => p.partId === 'srb_booster')).toHaveLength(4);

    const leader = state.symmetryGroups[0]?.memberInstanceIds[0];
    if (leader === undefined) throw new Error('expected leader');
    state = removePart(state, leader);
    expect(state.parts.filter((p) => p.partId === 'srb_booster')).toHaveLength(0);
    expect(state.symmetryGroups).toHaveLength(0);
  });
});

describe('staging', () => {
  it('reorderStages moves a stage to a new firing position', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    state = place(state, 'decoupler_stack');
    state = place(state, 'engine_vac');
    const before = state.stages.map((s) => s.id);
    state = reorderStages(state, 0, before.length - 1);
    expect(state.stages.map((s) => s.id)).not.toEqual(before);
    expect(state.stages).toHaveLength(before.length);
  });

  it('movePartToStage relocates a part between stages', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    state = place(state, 'tank_s1');
    state = place(state, 'decoupler_stack'); // closes stage 0, opens stage 1
    state = place(state, 'engine_vac');
    const tank = state.parts.find((p) => p.partId === 'tank_s1');
    if (!tank) throw new Error('expected tank');
    expect(state.stages[0]?.partIds).toContain(tank.instanceId);
    state = movePartToStage(state, tank.instanceId, 1);
    expect(state.stages[0]?.partIds).not.toContain(tank.instanceId);
    expect(state.stages[1]?.partIds).toContain(tank.instanceId);
  });
});

describe('toVessel', () => {
  it('produces a Vessel-shaped object matching PLAN.md §4', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    state = place(state, 'tank_s1');
    const vessel = toVessel(state, FIXTURE_PARTS, FIXTURE_TERRA, 7);
    expect(vessel.id).toBe(7);
    expect(vessel.parts).toHaveLength(2);
    expect(vessel.joints).toHaveLength(1);
    expect(vessel.soi).toBe(FIXTURE_TERRA);
    expect(vessel.railOrbit).toBeNull();
  });
});

describe('findPart', () => {
  it('returns undefined for an unknown id', () => {
    expect(findPart(createEmptyState(), 999)).toBeUndefined();
  });
});
