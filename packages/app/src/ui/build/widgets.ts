/**
 * Small reusable DOM widgets shared across the hangar's panels (DESIGN.md §3):
 * a panel frame with `Burn` corner ticks, and a checklist lamp. Pure DOM
 * construction — no state, no event wiring — so `BuildScene.ts` composes these
 * and attaches its own listeners.
 */
import type { LampStatus } from '../../scenes/build/checklist';

/** A 1px-`Hairline` panel with `Burn` corner ticks (DESIGN.md §3), no rounded corners. `testId` sets `data-testid` for Playwright. */
export function createPanel(className: string, testId?: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = `build-panel ${className}`;
  if (testId) panel.dataset['testid'] = testId;
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const tick = document.createElement('span');
    tick.className = `build-panel-corner corner-${corner}`;
    panel.appendChild(tick);
  }
  return panel;
}

/** The content area inside a `createPanel` frame — corner ticks are absolutely positioned siblings, so content needs its own box. */
export function createPanelBody(): HTMLDivElement {
  const body = document.createElement('div');
  body.className = 'build-panel-body';
  return body;
}

const LAMP_ROLE: Record<LampStatus, string> = { nominal: 'nominal', warning: 'warning', critical: 'critical' };

export interface LampElements {
  readonly root: HTMLDivElement;
  readonly dot: HTMLSpanElement;
  readonly label: HTMLSpanElement;
  setStatus(status: LampStatus): void;
}

/** One checklist lamp: a status dot + label (DESIGN.md §1: `Nominal`/`Warning`/`Critical` tokens). */
export function createLamp(testId: string): LampElements {
  const root = document.createElement('div');
  root.className = 'build-lamp';
  root.dataset['testid'] = testId;
  root.tabIndex = 0;

  const dot = document.createElement('span');
  dot.className = 'build-lamp-dot';

  const label = document.createElement('span');
  label.className = 'build-lamp-label label';

  root.append(dot, label);

  return {
    root,
    dot,
    label,
    setStatus(status: LampStatus) {
      root.dataset['status'] = LAMP_ROLE[status];
    },
  };
}

/** A labelled numeric readout row (used by the ΔV/mass/TWR readout panel), e.g. "ΔV  3 800 m/s". */
export function createReadoutRow(testId: string): { root: HTMLDivElement; label: HTMLSpanElement; value: HTMLSpanElement } {
  const root = document.createElement('div');
  root.className = 'build-readout-row';
  root.dataset['testid'] = testId;
  const label = document.createElement('span');
  label.className = 'build-readout-label label';
  const value = document.createElement('span');
  value.className = 'build-readout-value data';
  root.append(label, value);
  return { root, label, value };
}
