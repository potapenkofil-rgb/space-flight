import { describe, expect, it } from 'vitest';
import { createLamp, createPanel, createReadoutRow } from './widgets';

describe('createPanel', () => {
  it('has a Hairline-framed panel class and four Burn corner ticks', () => {
    const panel = createPanel('build-catalog', 'catalog-panel');
    expect(panel.className).toContain('build-panel');
    expect(panel.dataset['testid']).toBe('catalog-panel');
    const corners = panel.querySelectorAll('.build-panel-corner');
    expect(corners).toHaveLength(4);
  });
});

describe('createLamp', () => {
  it('is keyboard-focusable and exposes a status attribute', () => {
    const lamp = createLamp('lamp-engine');
    expect(lamp.root.tabIndex).toBe(0);
    lamp.setStatus('nominal');
    expect(lamp.root.dataset['status']).toBe('nominal');
    lamp.setStatus('critical');
    expect(lamp.root.dataset['status']).toBe('critical');
  });
});

describe('createReadoutRow', () => {
  it('creates a labelled value row', () => {
    const row = createReadoutRow('readout-mass');
    expect(row.root.dataset['testid']).toBe('readout-mass');
    row.value.textContent = '1 234 kg';
    expect(row.value.textContent).toBe('1 234 kg');
  });
});
