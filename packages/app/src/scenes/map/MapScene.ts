/**
 * The map scene (PLAN.md §7 Agent D / DESIGN.md §5): current orbit, apo/pe
 * markers, sphere-of-influence boundary, focus switching between bodies and
 * vessels, and the maneuver node (place by clicking the orbit, drag its
 * prograde/retrograde and radial handles, preview the resulting orbit).
 *
 * Drives the vessel/body fixtures in `fixtures/**` instead of a real
 * `SystemLibrary`/vessel registry (Agent E/F, not landed yet) — see those
 * files' docs for what the orchestrator swaps in later.
 */
import { getLocale, onLocaleChange, t } from '../../i18n';
import { formatDeltaV, formatDistance, setUnitsLocale, v2, type Vec2 } from '@karman/core';
import {
  createCamera,
  screenToWorld,
  worldToScreen,
  zoomCamera,
  type Camera,
} from '../../render/camera';
import {
  drawApsisMarkers,
  drawManeuverNodeMarker,
  drawMapBody,
  drawOrbitPath,
  drawSoiBoundary,
} from '../../render/orbit-renderer';
import { drawBackground } from '../../render/world-renderer';
import { getColor, getFont, getFontSizePx } from '../../ui/tokens';
import { getMapBodyFixture, MAP_BODY_FIXTURES, type MapBodyFixture } from './fixtures/bodies';
import { getMapVesselFixture, MAP_VESSEL_FIXTURES, type MapVesselFixture } from './fixtures/vessels';
import { FIXTURE_ORBIT_KERNEL } from './maneuverNode';
import {
  createManeuverNode,
  nearestTrueAnomaly,
  previewManeuver,
  withProgradeDeltaV,
  withRadialDeltaV,
  type ManeuverNode,
} from './maneuverNode';
import './map.css';

const MIN_PPM = 1e-8;
const MAX_PPM = 0.02;
const ORBIT_HIT_TEST_PX = 20;
const HANDLE_HIT_RADIUS_PX = 11;
const HANDLE_BASE_OFFSET_PX = 34;
const HANDLE_SCALE_PX_PER_MPS = 0.6;
const DELTA_V_PER_HANDLE_PX = 1 / HANDLE_SCALE_PX_PER_MPS;
const HIT_TEST_SAMPLE_COUNT = 360;
const NOW_TIME = 0; // fixed "current time" for the demo — see module doc

type DragMode = 'prograde' | 'radial' | null;

function bodyById(id: string): MapBodyFixture {
  return getMapBodyFixture(id);
}
function vesselById(id: number): MapVesselFixture {
  return getMapVesselFixture(id);
}

function hitTestAnomalies(): number[] {
  const out: number[] = [];
  for (let i = 0; i < HIT_TEST_SAMPLE_COUNT; i++) out.push((i / HIT_TEST_SAMPLE_COUNT) * Math.PI * 2);
  return out;
}
const HIT_TEST_ANOMALIES = hitTestAnomalies();

export function mountMapScene(canvas: HTMLCanvasElement, uiRoot: HTMLElement): () => void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('mountMapScene: 2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let widthPx = window.innerWidth;
  let heightPx = window.innerHeight;

  function resize(): void {
    widthPx = window.innerWidth;
    heightPx = window.innerHeight;
    canvas.width = Math.round(widthPx * dpr);
    canvas.height = Math.round(heightPx * dpr);
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  setUnitsLocale(getLocale());
  const unsubscribeLocale = onLocaleChange(() => {
    setUnitsLocale(getLocale());
    syncPanels();
  });

  let focusVesselId = MAP_VESSEL_FIXTURES[0]!.id;
  let focusBodyId = vesselById(focusVesselId).bodyId;
  let node: ManeuverNode | null = null;
  let dragMode: DragMode = null;

  function fitCameraToBody(bodyId: string): Camera {
    const body = bodyById(bodyId);
    const vessel = vesselById(focusVesselId);
    // Frame whichever is largest: the body's own disc, its vessel's orbit (if
    // that vessel is around this body), or its sphere of influence — otherwise
    // the SOI boundary (DESIGN.md §5) is real but zoomed-in-past, since a body's
    // SOI is typically several times its own radius (e.g. Luna's SOI is ~3.7x
    // its radius) and would never appear on screen at "just show the body" zoom.
    const soiExtent = Number.isFinite(body.soiRadius) ? body.soiRadius * 2.2 : 0;
    const orbitExtent = vessel.bodyId === bodyId ? vessel.orbit.a * (1 + vessel.orbit.e) * 2.4 : 0;
    const extentM = Math.max(body.radius * 2.4, soiExtent, orbitExtent);
    const ppm = Math.min(widthPx, heightPx) / extentM;
    return createCamera(body.position, Math.min(Math.max(ppm, MIN_PPM), MAX_PPM));
  }

  let camera: Camera = fitCameraToBody(focusBodyId);

  // -- DOM: focus switcher (top-left) --
  const ui = document.createElement('div');
  ui.className = 'map-ui';
  ui.dataset['testid'] = 'map-ui';

  const focusPanel = document.createElement('div');
  focusPanel.className = 'map-panel map-panel--focus';
  focusPanel.dataset['testid'] = 'map-focus-panel';
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const tick = document.createElement('span');
    tick.className = `map-panel-corner ${corner}`;
    focusPanel.appendChild(tick);
  }
  const focusHeading = document.createElement('span');
  focusHeading.className = 'label';
  const bodyGroup = document.createElement('div');
  bodyGroup.className = 'map-focus-group';
  const bodyButtons = new Map<string, HTMLButtonElement>();
  for (const body of MAP_BODY_FIXTURES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-focus-button';
    btn.dataset['testid'] = `map-focus-body-${body.id}`;
    btn.addEventListener('click', () => {
      focusBodyId = body.id;
      camera = fitCameraToBody(focusBodyId);
      syncPanels();
    });
    bodyButtons.set(body.id, btn);
    bodyGroup.appendChild(btn);
  }

  const vesselHeading = document.createElement('span');
  vesselHeading.className = 'label';
  const vesselGroup = document.createElement('div');
  vesselGroup.className = 'map-focus-group';
  const vesselButtons = new Map<number, HTMLButtonElement>();
  for (const vessel of MAP_VESSEL_FIXTURES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-focus-button';
    btn.dataset['testid'] = `map-focus-vessel-${vessel.id}`;
    btn.addEventListener('click', () => {
      focusVesselId = vessel.id;
      focusBodyId = vessel.bodyId;
      node = null;
      camera = fitCameraToBody(focusBodyId);
      syncPanels();
    });
    vesselButtons.set(vessel.id, btn);
    vesselGroup.appendChild(btn);
  }
  focusPanel.append(focusHeading, bodyGroup, vesselHeading, vesselGroup);

  // -- DOM: maneuver node readout (top-right) --
  const nodePanel = document.createElement('div');
  nodePanel.className = 'map-panel map-panel--node';
  nodePanel.dataset['testid'] = 'map-node-panel';
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const tick = document.createElement('span');
    tick.className = `map-panel-corner ${corner}`;
    nodePanel.appendChild(tick);
  }
  function nodeRow(testId: string): { row: HTMLDivElement; label: HTMLSpanElement; value: HTMLSpanElement } {
    const row = document.createElement('div');
    row.className = 'map-node-row';
    const label = document.createElement('span');
    label.className = 'label';
    const value = document.createElement('span');
    value.className = 'map-node-value';
    value.dataset['testid'] = testId;
    row.append(label, value);
    return { row, label, value };
  }
  const timeToRow = nodeRow('map-node-time-to');
  const burnTimeRow = nodeRow('map-node-burn-time');
  const deltaVRow = nodeRow('map-node-delta-v');
  const resultRow = nodeRow('map-node-result');
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'map-node-delete';
  deleteButton.dataset['testid'] = 'map-node-delete';
  deleteButton.addEventListener('click', () => {
    node = null;
    syncPanels();
  });
  nodePanel.append(timeToRow.row, burnTimeRow.row, deltaVRow.row, resultRow.row, deleteButton);
  nodePanel.style.display = 'none';

  // -- DOM: bottom hint strip --
  const hintRow = document.createElement('div');
  hintRow.className = 'map-hint-row';
  hintRow.dataset['testid'] = 'map-hint-row';
  const hintLeft = document.createElement('span');
  hintLeft.dataset['testid'] = 'map-hint-add-node';
  const hintRight = document.createElement('span');
  hintRight.dataset['testid'] = 'map-hint-flight';
  hintRow.append(hintLeft, hintRight);

  ui.append(focusPanel, nodePanel, hintRow);
  uiRoot.appendChild(ui);

  function syncPanels(): void {
    focusHeading.textContent = t('MAP_FOCUS_LABEL');
    vesselHeading.textContent = t('MAP_VESSEL_LABEL');
    for (const [id, btn] of bodyButtons) {
      btn.textContent = t(bodyById(id).nameKey);
      btn.dataset['active'] = String(id === focusBodyId);
    }
    for (const [id, btn] of vesselButtons) {
      btn.textContent = t(vesselById(id).nameKey);
      btn.dataset['active'] = String(id === focusVesselId);
    }
    hintLeft.textContent = t('MAP_ADD_NODE_HINT');
    hintRight.textContent = t('MAP_FLIGHT_HINT');
    deleteButton.textContent = t('MAP_MANEUVER_DELETE');

    if (!node) {
      nodePanel.style.display = 'none';
      return;
    }
    nodePanel.style.display = '';
    const vessel = vesselById(focusVesselId);
    const preview = previewManeuver(vessel.orbit, node, NOW_TIME, FIXTURE_ORBIT_KERNEL);
    timeToRow.label.textContent = t('MAP_MANEUVER_TIME_TO');
    timeToRow.value.textContent = `${Math.round(preview.timeToNode)}${t('MAP_UNIT_SECONDS')}`;
    burnTimeRow.label.textContent = t('MAP_MANEUVER_BURN_TIME');
    burnTimeRow.value.textContent = `${preview.burnDurationSeconds.toFixed(1)}${t('MAP_UNIT_SECONDS')}`;
    deltaVRow.label.textContent = t('MAP_MANEUVER_DELTA_V');
    deltaVRow.value.textContent = formatDeltaV(preview.deltaVMagnitude);
    resultRow.label.textContent = t('MAP_MANEUVER_RESULT');
    const apo = preview.resultOrbit.a * (1 + preview.resultOrbit.e) - bodyById(vessel.bodyId).radius;
    const peri = preview.resultOrbit.a * (1 - preview.resultOrbit.e) - bodyById(vessel.bodyId).radius;
    resultRow.value.textContent = `${formatDistance(peri)} / ${formatDistance(apo)}`;
  }
  syncPanels();

  // -- Canvas interaction: click-to-place node, drag prograde/radial handles, wheel to zoom --
  function toCanvasPoint(evt: PointerEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function handleScreenPositions(): { prograde: Vec2; radial: Vec2 } | null {
    if (!node) return null;
    const vessel = vesselById(focusVesselId);
    const body = bodyById(vessel.bodyId);
    const { r, v } = FIXTURE_ORBIT_KERNEL.stateFromOrbit(
      vessel.orbit,
      FIXTURE_ORBIT_KERNEL.timeToTrueAnomaly(vessel.orbit, node.trueAnomaly, NOW_TIME)
    );
    const progradeDir = v2.norm(v);
    const radialDir = v2.norm(r);
    const nodeWorld = v2.add(body.position, r);
    const nodeScreen = worldToScreen(camera, nodeWorld, widthPx, heightPx);

    function handlePoint(dir: Vec2, deltaV: number): Vec2 {
      const worldDirScreen = v2.sub(
        worldToScreen(camera, v2.add(nodeWorld, dir), widthPx, heightPx),
        nodeScreen
      );
      const unit = v2.norm(worldDirScreen);
      const offset = HANDLE_BASE_OFFSET_PX + Math.abs(deltaV) * HANDLE_SCALE_PX_PER_MPS;
      const sign = deltaV < 0 ? -1 : 1;
      return v2.add(nodeScreen, v2.scale(unit, offset * sign));
    }

    return {
      prograde: handlePoint(progradeDir, node.progradeDeltaV),
      radial: handlePoint(radialDir, node.radialDeltaV),
    };
  }

  function onPointerDown(evt: PointerEvent): void {
    const p = toCanvasPoint(evt);
    const handles = handleScreenPositions();
    if (handles) {
      if (v2.len(v2.sub(p, handles.prograde)) <= HANDLE_HIT_RADIUS_PX) {
        dragMode = 'prograde';
        canvas.setPointerCapture(evt.pointerId);
        return;
      }
      if (v2.len(v2.sub(p, handles.radial)) <= HANDLE_HIT_RADIUS_PX) {
        dragMode = 'radial';
        canvas.setPointerCapture(evt.pointerId);
        return;
      }
    }

    // Otherwise: try placing/moving the node if the click landed near the current orbit.
    // World-space nearest-point search is equivalent to a screen-space one here because
    // the camera scales x/y isotropically (same pixelsPerMeter both axes).
    const vessel = vesselById(focusVesselId);
    const body = bodyById(vessel.bodyId);
    const worldClick = v2.sub(screenToWorld(camera, p, widthPx, heightPx), body.position);
    const nu = nearestTrueAnomaly(vessel.orbit, worldClick, HIT_TEST_ANOMALIES);

    const r = (vessel.orbit.a * (1 - vessel.orbit.e * vessel.orbit.e)) / (1 + vessel.orbit.e * Math.cos(nu));
    const theta = vessel.orbit.argPe + nu;
    const worldPoint = v2.add(body.position, { x: r * Math.cos(theta), y: r * Math.sin(theta) });
    const screenDist = v2.len(v2.sub(worldToScreen(camera, worldPoint, widthPx, heightPx), p));

    if (screenDist <= ORBIT_HIT_TEST_PX) {
      node = createManeuverNode(nu);
      syncPanels();
    }
  }

  function onPointerMove(evt: PointerEvent): void {
    if (!dragMode || !node) return;
    const p = toCanvasPoint(evt);
    const vessel = vesselById(focusVesselId);
    const body = bodyById(vessel.bodyId);
    const { r, v } = FIXTURE_ORBIT_KERNEL.stateFromOrbit(
      vessel.orbit,
      FIXTURE_ORBIT_KERNEL.timeToTrueAnomaly(vessel.orbit, node.trueAnomaly, NOW_TIME)
    );
    const nodeWorld = v2.add(body.position, r);
    const nodeScreen = worldToScreen(camera, nodeWorld, widthPx, heightPx);
    const dir = dragMode === 'prograde' ? v2.norm(v) : v2.norm(r);
    const dirScreen = v2.norm(v2.sub(worldToScreen(camera, v2.add(nodeWorld, dir), widthPx, heightPx), nodeScreen));
    const offsetPx = v2.dot(v2.sub(p, nodeScreen), dirScreen);
    const signedOffsetPx = offsetPx; // already signed by the projection
    const magnitude = Math.max(0, Math.abs(signedOffsetPx) - HANDLE_BASE_OFFSET_PX);
    const deltaV = Math.sign(signedOffsetPx) * magnitude * DELTA_V_PER_HANDLE_PX;

    node = dragMode === 'prograde' ? withProgradeDeltaV(node, deltaV) : withRadialDeltaV(node, deltaV);
    syncPanels();
  }

  function onPointerUp(evt: PointerEvent): void {
    dragMode = null;
    if (canvas.hasPointerCapture(evt.pointerId)) canvas.releasePointerCapture(evt.pointerId);
  }

  function onWheel(evt: WheelEvent): void {
    evt.preventDefault();
    const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
    camera = zoomCamera(camera, factor, MIN_PPM, MAX_PPM);
  }

  function onKeydown(evt: KeyboardEvent): void {
    if (evt.code === 'KeyM') window.location.href = 'flight.html';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeydown);

  // -- Render loop (map has no physics to step; it just redraws) --
  function drawApsisLabel(screen: Vec2, altitude: number, color: string): void {
    ctx.save();
    ctx.font = `${getFontSizePx(0)}px ${getFont('data')}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(formatDistance(altitude), screen.x + 10, screen.y);
    ctx.restore();
  }

  function drawHandle(screen: Vec2, labelKey: string): void {
    ctx.save();
    ctx.fillStyle = getColor('burn');
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${getFontSizePx(0)}px ${getFont('data')}`;
    ctx.fillStyle = getColor('inkMuted');
    ctx.textBaseline = 'middle';
    ctx.fillText(t(labelKey), screen.x + 8, screen.y);
    ctx.restore();
  }

  function render(): void {
    drawBackground(ctx, widthPx, heightPx);

    for (const body of MAP_BODY_FIXTURES) {
      drawMapBody(ctx, camera, body.position, body.radius, body.atmosphere !== null, widthPx, heightPx);
      if (body.parentId !== null && Number.isFinite(body.soiRadius)) {
        drawSoiBoundary(ctx, camera, body.position, body.soiRadius, widthPx, heightPx);
      }
    }

    const vessel = vesselById(focusVesselId);
    const body = bodyById(vessel.bodyId);

    drawOrbitPath(ctx, camera, body.position, vessel.orbit, 'current', widthPx, heightPx);
    const currentApsides = drawApsisMarkers(ctx, camera, body.position, vessel.orbit, body.radius, 'current', widthPx, heightPx);
    drawApsisLabel(currentApsides.apoapsis.screen, currentApsides.apoapsis.altitude, getColor('orbit'));
    drawApsisLabel(currentApsides.periapsis.screen, currentApsides.periapsis.altitude, getColor('orbit'));

    // Current vessel position marker ("you are here"), at the fixed demo time.
    const nowState = FIXTURE_ORBIT_KERNEL.stateFromOrbit(vessel.orbit, NOW_TIME);
    const nowScreen = worldToScreen(camera, v2.add(body.position, nowState.r), widthPx, heightPx);
    ctx.save();
    ctx.fillStyle = getColor('ink');
    ctx.beginPath();
    ctx.arc(nowScreen.x, nowScreen.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (node) {
      const preview = previewManeuver(vessel.orbit, node, NOW_TIME, FIXTURE_ORBIT_KERNEL);
      drawOrbitPath(ctx, camera, body.position, preview.resultOrbit, 'planned', widthPx, heightPx);
      const plannedApsides = drawApsisMarkers(ctx, camera, body.position, preview.resultOrbit, body.radius, 'planned', widthPx, heightPx);
      drawApsisLabel(plannedApsides.apoapsis.screen, plannedApsides.apoapsis.altitude, getColor('burn'));
      drawApsisLabel(plannedApsides.periapsis.screen, plannedApsides.periapsis.altitude, getColor('burn'));

      const nodeWorld = v2.add(body.position, preview.worldPos);
      const nodeScreen = drawManeuverNodeMarker(ctx, camera, nodeWorld, widthPx, heightPx);
      // DESIGN.md §5: a mono ΔV readout right next to the node glyph itself.
      ctx.save();
      ctx.font = `${getFontSizePx(0)}px ${getFont('data')}`;
      ctx.fillStyle = getColor('burn');
      ctx.textBaseline = 'top';
      ctx.fillText(formatDeltaV(preview.deltaVMagnitude), nodeScreen.x + 16, nodeScreen.y + 16);
      ctx.restore();

      const handles = handleScreenPositions();
      if (handles) {
        drawHandle(handles.prograde, node.progradeDeltaV >= 0 ? 'MAP_MANEUVER_PROGRADE' : 'MAP_MANEUVER_RETROGRADE');
        drawHandle(handles.radial, node.radialDeltaV >= 0 ? 'MAP_MANEUVER_RADIAL_OUT' : 'MAP_MANEUVER_RADIAL_IN');
      }
    }

    rafId = requestAnimationFrame(render);
  }
  let rafId = requestAnimationFrame(render);

  return () => {
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeydown);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    unsubscribeLocale();
    cancelAnimationFrame(rafId);
    ui.remove();
  };
}
