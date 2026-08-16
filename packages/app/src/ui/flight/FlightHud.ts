/**
 * The flight HUD (PLAN.md §7 Agent D / DESIGN.md §3): throttle as a vertical
 * gauge on the left, altitude/speed as big displays on the right (top and
 * bottom), atmosphere/G-load top-left, a status lamp row along the bottom.
 * The center of the screen is left completely untouched — every panel is
 * pinned to an edge (DESIGN.md §3: the central 50% of height and 40% of
 * width must stay clear; see `hud.css` for the layout math and
 * `tests/e2e/flight.spec.ts` for the automated check against real
 * `getBoundingClientRect()`s).
 *
 * Plain DOM over canvas (PLAN.md §1) — this module never touches the
 * `<canvas>`. All text goes through `t()`; all numbers go through
 * `@karman/core`'s `math/units` formatters, which already handle the
 * locale-aware digit grouping/decimal separator (DESIGN.md §6).
 */
import { formatDistance, formatNumber, formatSpeed } from '@karman/core';
import { t } from '../../i18n';
import './hud.css';

export type LampState = 'off' | 'nominal' | 'warning' | 'critical' | 'burn';

export interface FlightHudState {
  readonly throttle: number; // 0..1
  readonly altitude: number; // m
  readonly verticalSpeed: number; // m/s, +up
  readonly speed: number; // m/s, total
  readonly ambientPressure: number; // 0..1
  readonly gForce: number;
  readonly sas: boolean;
  readonly stageIndex: number;
  readonly stageCount: number;
  readonly fuelFraction: number; // 0..1
  readonly warpMultiplier: number;
  readonly warpBlocked: boolean;
}

interface HudRefs {
  readonly atmoValue: HTMLElement;
  readonly gLoadValue: HTMLElement;
  readonly throttleFill: HTMLElement;
  readonly throttleValue: HTMLElement;
  readonly altitudeValue: HTMLElement;
  readonly vSpeedValue: HTMLElement;
  readonly speedValue: HTMLElement;
  readonly warpValue: HTMLElement;
  readonly sasLamp: HTMLElement;
  readonly stageLamp: HTMLElement;
  readonly stageValue: HTMLElement;
  readonly fuelLamp: HTMLElement;
  readonly warpLamp: HTMLElement;
}

function withCorners(panel: HTMLElement): void {
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const tick = document.createElement('span');
    tick.className = `hud-panel-corner ${corner}`;
    panel.appendChild(tick);
  }
}

function labelEl(testId: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'label';
  el.dataset['testid'] = testId;
  return el;
}

function lamp(testId: string): { root: HTMLDivElement; labelEl: HTMLSpanElement } {
  const root = document.createElement('div');
  root.className = 'hud-lamp';
  root.dataset['testid'] = testId;
  root.dataset['state'] = 'off';
  const dot = document.createElement('span');
  dot.className = 'hud-lamp-dot';
  const text = document.createElement('span');
  text.className = 'hud-lamp-label';
  root.append(dot, text);
  return { root, labelEl: text };
}

export interface FlightHud {
  update(state: FlightHudState): void;
  destroy(): void;
}

/** Mounts the flight HUD into `root` (typically `#app-root`) and returns an updater/destroyer. */
export function mountFlightHud(root: HTMLElement): FlightHud {
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.dataset['testid'] = 'flight-hud';

  // -- Atmosphere / G-load (top-left) --
  const atmoPanel = document.createElement('div');
  atmoPanel.className = 'hud-panel hud-panel--atmo';
  atmoPanel.dataset['testid'] = 'hud-atmo-panel';
  withCorners(atmoPanel);

  const atmoRow = document.createElement('div');
  atmoRow.className = 'hud-row';
  const atmoLabel = labelEl('hud-atmo-label');
  const atmoValue = document.createElement('span');
  atmoValue.className = 'hud-value';
  atmoValue.dataset['testid'] = 'hud-atmo-value';
  atmoRow.append(atmoLabel, atmoValue);

  const gRow = document.createElement('div');
  gRow.className = 'hud-row';
  const gLabel = labelEl('hud-gload-label');
  const gLoadValue = document.createElement('span');
  gLoadValue.className = 'hud-value';
  gLoadValue.dataset['testid'] = 'hud-gload-value';
  gRow.append(gLabel, gLoadValue);

  atmoPanel.append(atmoRow, gRow);

  // -- Throttle (left edge, vertical) --
  const throttlePanel = document.createElement('div');
  throttlePanel.className = 'hud-panel hud-panel--throttle';
  throttlePanel.dataset['testid'] = 'hud-throttle-panel';
  withCorners(throttlePanel);

  const throttleLabel = labelEl('hud-throttle-label');
  const throttleTrack = document.createElement('div');
  throttleTrack.className = 'hud-throttle-track';
  for (const pct of [25, 50, 75]) {
    const tick = document.createElement('span');
    tick.className = 'hud-throttle-tick';
    tick.style.bottom = `${pct}%`;
    throttleTrack.appendChild(tick);
  }
  const throttleFill = document.createElement('div');
  throttleFill.className = 'hud-throttle-fill';
  throttleFill.dataset['testid'] = 'hud-throttle-fill';
  throttleTrack.appendChild(throttleFill);
  const throttleValue = document.createElement('span');
  throttleValue.className = 'hud-value';
  throttleValue.dataset['testid'] = 'hud-throttle-value';
  throttlePanel.append(throttleLabel, throttleTrack, throttleValue);

  // -- Altitude (top-right) --
  const altitudePanel = document.createElement('div');
  altitudePanel.className = 'hud-panel hud-panel--altitude';
  altitudePanel.dataset['testid'] = 'hud-altitude-panel';
  withCorners(altitudePanel);

  const altitudeLabel = labelEl('hud-altitude-label');
  const altitudeValue = document.createElement('div');
  altitudeValue.className = 'hud-big-number';
  altitudeValue.dataset['testid'] = 'hud-altitude-value';
  const vSpeedRow = document.createElement('div');
  vSpeedRow.className = 'hud-row';
  const vSpeedLabel = labelEl('hud-vspeed-label');
  const vSpeedValue = document.createElement('span');
  vSpeedValue.className = 'hud-value';
  vSpeedValue.dataset['testid'] = 'hud-vspeed-value';
  vSpeedRow.append(vSpeedLabel, vSpeedValue);
  altitudePanel.append(altitudeLabel, altitudeValue, vSpeedRow);

  // -- Speed (bottom-right) --
  const speedPanel = document.createElement('div');
  speedPanel.className = 'hud-panel hud-panel--speed';
  speedPanel.dataset['testid'] = 'hud-speed-panel';
  withCorners(speedPanel);

  const speedLabel = labelEl('hud-speed-label');
  const speedValue = document.createElement('div');
  speedValue.className = 'hud-big-number';
  speedValue.dataset['testid'] = 'hud-speed-value';
  speedPanel.append(speedLabel, speedValue);

  // -- Status lamp row (bottom, full width) --
  const lampRow = document.createElement('div');
  lampRow.className = 'hud-lamp-row';
  lampRow.dataset['testid'] = 'hud-lamp-row';

  const sas = lamp('hud-lamp-sas');
  const stage = lamp('hud-lamp-stage');
  const stageValue = document.createElement('span');
  stageValue.className = 'hud-lamp-label';
  stageValue.dataset['testid'] = 'hud-stage-value';
  stage.root.appendChild(stageValue);
  const fuel = lamp('hud-lamp-fuel');
  const warp = lamp('hud-lamp-warp');
  const warpValue = document.createElement('span');
  warpValue.className = 'hud-lamp-label';
  warpValue.dataset['testid'] = 'hud-warp-value';
  warp.root.appendChild(warpValue);

  const mapHint = document.createElement('span');
  mapHint.className = 'hud-map-hint';
  mapHint.dataset['testid'] = 'hud-map-hint';
  mapHint.textContent = t('FLIGHT_MAP_HINT');

  lampRow.append(sas.root, stage.root, fuel.root, warp.root, mapHint);

  hud.append(atmoPanel, throttlePanel, altitudePanel, speedPanel, lampRow);
  root.appendChild(hud);

  const refs: HudRefs = {
    atmoValue,
    gLoadValue,
    throttleFill,
    throttleValue,
    altitudeValue,
    vSpeedValue,
    speedValue,
    warpValue,
    sasLamp: sas.root,
    stageLamp: stage.root,
    stageValue,
    fuelLamp: fuel.root,
    warpLamp: warp.root,
  };

  function renderStaticLabels(): void {
    atmoLabel.textContent = t('FLIGHT_ATMOSPHERE_LABEL');
    gLabel.textContent = t('FLIGHT_G_LOAD_LABEL');
    throttleLabel.textContent = t('FLIGHT_THROTTLE_LABEL');
    altitudeLabel.textContent = t('FLIGHT_ALTITUDE_LABEL');
    vSpeedLabel.textContent = t('FLIGHT_VSPEED_LABEL');
    speedLabel.textContent = t('FLIGHT_SPEED_LABEL');
    sas.labelEl.textContent = t('FLIGHT_SAS_LABEL');
    fuel.labelEl.textContent = t('FLIGHT_FUEL_LABEL');
    mapHint.textContent = t('FLIGHT_MAP_HINT');
  }
  renderStaticLabels();

  function lampState(el: HTMLElement, state: LampState): void {
    el.dataset['state'] = state;
  }

  function update(state: FlightHudState): void {
    refs.atmoValue.textContent = `${formatNumber(state.ambientPressure * 100, 0)}%`;
    refs.gLoadValue.textContent = `${formatNumber(state.gForce, 2)}${t('FLIGHT_UNIT_G')}`;

    refs.throttleFill.style.height = `${Math.round(state.throttle * 100)}%`;
    refs.throttleValue.textContent = `${Math.round(state.throttle * 100)}%`;

    refs.altitudeValue.textContent = formatDistance(state.altitude);
    refs.vSpeedValue.textContent = formatSpeed(state.verticalSpeed);
    refs.speedValue.textContent = formatSpeed(state.speed);

    lampState(refs.sasLamp, state.sas ? 'nominal' : 'off');

    refs.stageValue.textContent = `${t('FLIGHT_STAGE_LABEL')} ${state.stageIndex}/${state.stageCount}`;
    lampState(refs.stageLamp, 'off');

    lampState(refs.fuelLamp, state.fuelFraction < 0.25 ? 'warning' : 'nominal');

    refs.warpValue.textContent = `${t('FLIGHT_WARP_LABEL')} ×${formatNumber(state.warpMultiplier, 0)}`;
    lampState(refs.warpLamp, state.warpBlocked ? 'warning' : state.warpMultiplier > 1 ? 'burn' : 'off');
  }

  function destroy(): void {
    hud.remove();
  }

  return { update, destroy };
}
