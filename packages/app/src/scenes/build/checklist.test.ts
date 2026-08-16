import { describe, expect, it } from 'vitest';
import { FIXTURE_PARTS } from './__fixtures__/parts';
import { overallStatus, runChecklist } from './checklist';
import { attachPart, createEmptyState, findAttachCandidates, placeRoot, type BuildState } from './state';

function place(state: BuildState, partId: string): BuildState {
  const candidate = findAttachCandidates(state, FIXTURE_PARTS, partId)[0];
  if (!candidate) throw new Error(`no attach candidate for ${partId}`);
  return attachPart(state, FIXTURE_PARTS, partId, candidate);
}

describe('runChecklist', () => {
  it('an empty assembly is all-critical on COM and engine', () => {
    const items = runChecklist(createEmptyState(), FIXTURE_PARTS);
    expect(items.find((i) => i.id === 'com')?.status).toBe('critical');
    expect(items.find((i) => i.id === 'engine')?.status).toBe('critical');
    expect(overallStatus(items)).toBe('critical');
  });

  it('a pod + tank + engine passes COM and engine, warns on legs and power', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'engine_start');
    state = place(state, 'tank_s1');
    state = place(state, 'pod_capsule');
    const items = runChecklist(state, FIXTURE_PARTS);
    expect(items.find((i) => i.id === 'engine')?.status).toBe('nominal');
    expect(items.find((i) => i.id === 'com')?.status).toBe('nominal');
    // Pod's own reserve counts as a power source, so this should be nominal even without a battery.
    expect(items.find((i) => i.id === 'power')?.status).toBe('nominal');
    expect(items.find((i) => i.id === 'legs')?.status).toBe('warning');
  });

  it('adding legs clears the legs warning', () => {
    let state = placeRoot(createEmptyState(), FIXTURE_PARTS, 'tank_m1');
    state = place(state, 'legs_light');
    const items = runChecklist(state, FIXTURE_PARTS);
    expect(items.find((i) => i.id === 'legs')?.status).toBe('nominal');
  });

  it('overallStatus takes the worst of the set', () => {
    expect(overallStatus([{ id: 'com', status: 'nominal' }, { id: 'engine', status: 'warning' }])).toBe('warning');
    expect(
      overallStatus([
        { id: 'com', status: 'nominal' },
        { id: 'engine', status: 'warning' },
        { id: 'legs', status: 'critical' },
      ])
    ).toBe('critical');
  });
});
