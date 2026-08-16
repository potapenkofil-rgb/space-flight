import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEYMAP, actionsForCode, isBound, loadKeymap, rebind, saveKeymap } from './keymap';

describe('keymap', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('binds the exact keys from PLAN.md §7 Agent D', () => {
    expect(DEFAULT_KEYMAP.throttleFull).toContain('KeyZ');
    expect(DEFAULT_KEYMAP.throttleCutoff).toContain('KeyX');
    expect(DEFAULT_KEYMAP.throttleUp).toContain('ShiftLeft');
    expect(DEFAULT_KEYMAP.throttleDown).toContain('ControlLeft');
    expect(DEFAULT_KEYMAP.stage).toContain('Space');
    expect(DEFAULT_KEYMAP.rotateLeft).toContain('KeyA');
    expect(DEFAULT_KEYMAP.rotateRight).toContain('KeyD');
    expect(DEFAULT_KEYMAP.toggleSas).toContain('KeyT');
    expect(DEFAULT_KEYMAP.warpDown).toContain('Comma');
    expect(DEFAULT_KEYMAP.warpUp).toContain('Period');
  });

  it('rebind replaces a single action without touching the others', () => {
    const next = rebind(DEFAULT_KEYMAP, 'stage', 'KeyJ');
    expect(next.stage).toEqual(['KeyJ']);
    expect(next.rotateLeft).toEqual(DEFAULT_KEYMAP.rotateLeft);
  });

  it('isBound / actionsForCode agree with each other', () => {
    expect(isBound(DEFAULT_KEYMAP, 'stage', 'Space')).toBe(true);
    expect(isBound(DEFAULT_KEYMAP, 'stage', 'KeyQ')).toBe(false);
    expect(actionsForCode(DEFAULT_KEYMAP, 'Space')).toEqual(['stage']);
  });

  it('loadKeymap falls back to defaults with nothing persisted', () => {
    expect(loadKeymap()).toEqual(DEFAULT_KEYMAP);
  });

  it('saveKeymap / loadKeymap round-trips a rebind', () => {
    const next = rebind(DEFAULT_KEYMAP, 'toggleSas', 'KeyR');
    saveKeymap(next);
    const loaded = loadKeymap();
    expect(loaded.toggleSas).toEqual(['KeyR']);
    expect(loaded.warpUp).toEqual(DEFAULT_KEYMAP.warpUp); // untouched actions still fill in from defaults
  });

  it('loadKeymap ignores corrupt persisted data', () => {
    localStorage.setItem('karman:keymap', '{not json');
    expect(loadKeymap()).toEqual(DEFAULT_KEYMAP);
  });
});
