/**
 * The hangar (build) scene: catalog + workspace + stage stack + readout +
 * symmetry + checklist + flight plan + save/load (PLAN.md §7, Agent C's
 * zone). A plain DOM overlay over its own canvas, per PLAN.md §1 ("the
 * interface is HTML over canvas") — styling from `ui/build/buildPanel.css`
 * classes, colors/fonts only from `ui/tokens.css` tokens (DESIGN.md §1/§2).
 *
 * `library`/`system` default to the local fixtures (`__fixtures__/`) so this
 * scene runs standalone today; pass the real `PartLibrary`/`SystemLibrary`
 * once Agent E's data loader lands (see `__fixtures__/parts.ts`/`system.ts`
 * for the exact swap points).
 */
import {
  formatDeltaV,
  formatMass,
  formatNumber,
  setUnitsLocale,
  type Body,
  type PartCategory,
  type PartDef,
  type PartLibrary,
  type SystemLibrary,
} from '@karman/core';
import { getLocale, onLocaleChange, t } from '../../i18n';
import { createCamera, screenToWorld, worldToScreen, zoomCamera, type Camera } from '../../render/camera';
import { createLamp, createPanel, createPanelBody, createReadoutRow, type LampElements } from '../../ui/build/widgets';
import '../../ui/build/buildPanel.css';
import { listBlueprints, loadBlueprint, saveBlueprint } from './blueprint';
import { CATEGORY_ORDER, emptyFilter, filterCatalog, nonEmptyCategories, type CatalogFilter } from './catalog';
import { overallStatus, runChecklist } from './checklist';
import {
  BASE_PIXELS_PER_METER,
  SNAP_RADIUS_PX,
  pickNearestCandidate,
} from './grid';
import {
  circularOrbitSpeed,
  evaluateFlightPlan,
  type FlightStepDef,
  type FlightStepKind,
} from './flightPlan';
import { drawParsedArt, parsePartArt } from './partArt';
import { computeReadout } from './readout';
import {
  attachPart,
  findAttachCandidates,
  findPart,
  listOpenNodes,
  movePartToStage,
  placeRoot,
  removePart,
  reorderStages,
  setSymmetryMode,
  type AttachCandidate,
  type BuildState,
  type SymmetryCount,
} from './state';
import { drawAssembly, drawGhostPart, drawGrid, drawOpenNodeMarkers } from './workspaceRenderer';
import { FIXTURE_PARTS, FIXTURE_SYSTEM } from './__fixtures__';

const MIN_PPM = 4;
const MAX_PPM = 120;

const CATEGORY_KEY: Record<PartCategory, string> = {
  pod: 'BUILD_CATEGORY_POD',
  tanks: 'BUILD_CATEGORY_TANKS',
  engines: 'BUILD_CATEGORY_ENGINES',
  boosters: 'BUILD_CATEGORY_BOOSTERS',
  separators: 'BUILD_CATEGORY_SEPARATORS',
  fairings: 'BUILD_CATEGORY_FAIRINGS',
  parachutes: 'BUILD_CATEGORY_PARACHUTES',
  legs: 'BUILD_CATEGORY_LEGS',
  rcs: 'BUILD_CATEGORY_RCS',
  power: 'BUILD_CATEGORY_POWER',
  docking: 'BUILD_CATEGORY_DOCKING',
  adapters: 'BUILD_CATEGORY_ADAPTERS',
  control: 'BUILD_CATEGORY_CONTROL',
  structural: 'BUILD_CATEGORY_STRUCTURAL',
  lights: 'BUILD_CATEGORY_LIGHTS',
};

const FLIGHTPLAN_STEP_KEY: Record<FlightStepKind, string> = {
  orbit: 'BUILD_FLIGHTPLAN_STEP_ORBIT',
  transfer: 'BUILD_FLIGHTPLAN_STEP_TRANSFER',
  brake: 'BUILD_FLIGHTPLAN_STEP_BRAKE',
  land: 'BUILD_FLIGHTPLAN_STEP_LAND',
};

export interface BuildSceneOptions {
  readonly library?: PartLibrary;
  readonly system?: SystemLibrary;
}

export function mountBuildScene(root: HTMLElement, options: BuildSceneOptions = {}): () => void {
  const library: PartLibrary = options.library ?? FIXTURE_PARTS;
  const system: SystemLibrary = options.system ?? FIXTURE_SYSTEM;
  const homeBody: Body = system.root;

  setUnitsLocale(getLocale());

  // ---- working state ---------------------------------------------------
  let state: BuildState = {
    parts: [],
    joints: [],
    symmetryGroups: [],
    stages: [{ id: 'stage-0', partIds: [] }],
    symmetryMode: 1,
    selectedInstanceId: null,
    nextInstanceId: 1,
    nextJointId: 1,
    nextStageOrdinal: 1,
  };
  let heldPartId: string | null = null;
  let pendingCandidate: AttachCandidate | null = null;
  let ghostPosition = { x: 0, y: 0 };
  let ghostRotation = 0;
  let filter: CatalogFilter = emptyFilter();
  let camera: Camera = createCamera({ x: 0, y: 3 }, BASE_PIXELS_PER_METER);
  let draggingStageIndex: number | null = null;
  let flightPlanOpen = false;
  let flightSteps: FlightStepDef[] = [];
  let viewportW = 0;
  let viewportH = 0;

  // ---- DOM scaffold -------------------------------------------------------
  root.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'build-overlay';
  overlay.dataset['testid'] = 'build-overlay';

  // Topbar
  const topbar = document.createElement('div');
  topbar.className = 'build-topbar';
  const title = document.createElement('h1');
  title.className = 'build-title';
  const topbarActions = document.createElement('div');
  topbarActions.className = 'build-topbar-actions';

  const deleteButton = document.createElement('button');
  deleteButton.className = 'build-button';
  deleteButton.type = 'button';
  deleteButton.dataset['testid'] = 'build-delete-part';
  deleteButton.dataset['danger'] = 'true';
  deleteButton.disabled = true;

  const flightPlanToggle = document.createElement('button');
  flightPlanToggle.className = 'build-button';
  flightPlanToggle.type = 'button';
  flightPlanToggle.dataset['testid'] = 'build-flightplan-toggle';

  const blueprintNameInput = document.createElement('input');
  blueprintNameInput.className = 'build-saveload-name';
  blueprintNameInput.type = 'text';
  blueprintNameInput.value = 'my-rocket';
  blueprintNameInput.dataset['testid'] = 'build-blueprint-name';

  const saveButton = document.createElement('button');
  saveButton.className = 'build-button';
  saveButton.type = 'button';
  saveButton.dataset['testid'] = 'build-save';

  const loadSelect = document.createElement('select');
  loadSelect.className = 'build-saveload-name';
  loadSelect.dataset['testid'] = 'build-load-select';

  const loadButton = document.createElement('button');
  loadButton.className = 'build-button';
  loadButton.type = 'button';
  loadButton.dataset['testid'] = 'build-load';

  topbarActions.append(deleteButton, flightPlanToggle, blueprintNameInput, saveButton, loadSelect, loadButton);
  topbar.append(title, topbarActions);

  // Catalog column
  const catalogCol = document.createElement('div');
  catalogCol.className = 'build-catalog-col';

  const catalogPanel = createPanel('build-catalog', 'build-catalog-panel');
  const catalogBody = createPanelBody();
  const searchInput = document.createElement('input');
  searchInput.className = 'build-catalog-search';
  searchInput.type = 'text';
  searchInput.dataset['testid'] = 'build-catalog-search';
  const tabStrip = document.createElement('div');
  tabStrip.className = 'build-catalog-tabs';
  const catalogGrid = document.createElement('div');
  catalogGrid.className = 'build-catalog-grid';
  catalogGrid.dataset['testid'] = 'build-catalog-grid';
  catalogBody.append(searchInput, tabStrip, catalogGrid);
  catalogPanel.appendChild(catalogBody);

  const symmetryPanel = createPanel('build-symmetry', 'build-symmetry-panel');
  const symmetryLabel = document.createElement('span');
  symmetryLabel.className = 'label';
  const symmetryOptions = document.createElement('div');
  symmetryOptions.className = 'build-symmetry-options';
  const symmetryButtons = new Map<SymmetryCount, HTMLButtonElement>();
  for (const count of [1, 2, 4, 6] as const) {
    const button = document.createElement('button');
    button.className = 'build-symmetry-option';
    button.type = 'button';
    button.textContent = String(count);
    button.dataset['testid'] = `build-symmetry-${count}`;
    symmetryButtons.set(count, button);
    symmetryOptions.appendChild(button);
  }
  symmetryPanel.append(symmetryLabel, symmetryOptions);

  catalogCol.append(catalogPanel, symmetryPanel);

  // Workspace
  const workspaceWrap = document.createElement('div');
  workspaceWrap.className = 'build-workspace-wrap';
  const workspacePanel = createPanel('build-workspace-panel');
  const canvas = document.createElement('canvas');
  canvas.className = 'build-workspace-canvas';
  canvas.dataset['testid'] = 'build-workspace-canvas';
  canvas.tabIndex = 0;
  workspacePanel.appendChild(canvas);
  workspaceWrap.appendChild(workspacePanel);

  const readoutPanel = createPanel('build-readout', 'build-readout-panel');
  readoutPanel.style.position = 'absolute';
  readoutPanel.style.top = '10px';
  readoutPanel.style.right = '10px';
  readoutPanel.style.width = '200px';
  const readoutBody = createPanelBody();
  const rowMass = createReadoutRow('build-readout-mass');
  const rowTwr = createReadoutRow('build-readout-twr');
  const rowDv = createReadoutRow('build-readout-dv');
  const rowParts = createReadoutRow('build-readout-parts');
  readoutBody.append(rowMass.root, rowTwr.root, rowDv.root, rowParts.root);
  readoutPanel.appendChild(readoutBody);
  workspaceWrap.appendChild(readoutPanel);

  // Stages column
  const stagesCol = document.createElement('div');
  stagesCol.className = 'build-stages-col';
  const stagesPanel = createPanel('build-stages', 'build-stages-panel');
  const stagesBody = createPanelBody();
  const stagesList = document.createElement('div');
  stagesList.className = 'build-stages-list';
  stagesList.dataset['testid'] = 'build-stages-list';
  const stagesTotal = document.createElement('div');
  stagesTotal.className = 'build-stage-total data';
  stagesTotal.dataset['testid'] = 'build-stage-total';
  stagesBody.append(stagesList, stagesTotal);
  stagesPanel.appendChild(stagesBody);
  stagesCol.appendChild(stagesPanel);

  // Checklist bar
  const checklistBar = createPanel('build-checklist-bar', 'build-checklist-bar');
  const lampCom = createLamp('build-lamp-com');
  const lampEngine = createLamp('build-lamp-engine');
  const lampLegs = createLamp('build-lamp-legs');
  const lampPower = createLamp('build-lamp-power');
  checklistBar.append(lampCom.root, lampEngine.root, lampLegs.root, lampPower.root);
  const lamps: Record<'com' | 'engine' | 'legs' | 'power', LampElements> = {
    com: lampCom,
    engine: lampEngine,
    legs: lampLegs,
    power: lampPower,
  };

  // Flight plan side panel
  const flightPanel = createPanel('build-flightplan', 'build-flightplan-panel');
  flightPanel.dataset['open'] = 'false';
  const flightBody = document.createElement('div');
  flightBody.className = 'build-flightplan-body';
  const flightStepSelect = document.createElement('select');
  flightStepSelect.className = 'build-flightplan-step-select';
  flightStepSelect.dataset['testid'] = 'build-flightplan-step-select';
  const addStepButton = document.createElement('button');
  addStepButton.className = 'build-button';
  addStepButton.type = 'button';
  addStepButton.dataset['testid'] = 'build-flightplan-add-step';
  const flightStepsList = document.createElement('div');
  flightStepsList.dataset['testid'] = 'build-flightplan-steps';
  const flightVerdict = document.createElement('div');
  flightVerdict.className = 'build-flightplan-verdict';
  flightVerdict.dataset['testid'] = 'build-flightplan-verdict';
  flightBody.append(flightStepSelect, addStepButton, flightStepsList, flightVerdict);
  flightPanel.appendChild(flightBody);

  overlay.append(topbar, catalogCol, workspaceWrap, stagesCol, checklistBar, flightPanel);
  root.append(overlay);

  // ---- rendering: static text (locale-dependent) --------------------------
  function renderStaticText(): void {
    title.textContent = t('MENU_HANGAR');
    deleteButton.textContent = t('BUILD_DELETE_PART');
    flightPlanToggle.textContent = t('BUILD_FLIGHTPLAN_TOGGLE');
    blueprintNameInput.placeholder = t('BUILD_BLUEPRINT_NAME_PLACEHOLDER');
    saveButton.textContent = t('BUILD_SAVE');
    loadButton.textContent = t('BUILD_LOAD');
    searchInput.placeholder = t('BUILD_SEARCH_PLACEHOLDER');
    symmetryLabel.textContent = t('BUILD_SYMMETRY_LABEL');
    rowMass.label.textContent = t('BUILD_READOUT_MASS');
    rowTwr.label.textContent = t('BUILD_READOUT_TWR');
    rowDv.label.textContent = t('BUILD_READOUT_DV');
    rowParts.label.textContent = t('BUILD_READOUT_PARTS');
    lampCom.label.textContent = t('BUILD_CHECKLIST_COM');
    lampEngine.label.textContent = t('BUILD_CHECKLIST_ENGINE');
    lampLegs.label.textContent = t('BUILD_CHECKLIST_LEGS');
    lampPower.label.textContent = t('BUILD_CHECKLIST_POWER');
    addStepButton.textContent = t('BUILD_FLIGHTPLAN_ADD_STEP');
    flightStepSelect.innerHTML = '';
    for (const kind of ['orbit', 'transfer', 'brake', 'land'] as const) {
      const opt = document.createElement('option');
      opt.value = kind;
      opt.textContent = t(FLIGHTPLAN_STEP_KEY[kind]);
      flightStepSelect.appendChild(opt);
    }
    renderCatalogTabs();
    renderCatalogGrid();
    renderStages();
    renderFlightPlan();
  }

  // ---- catalog --------------------------------------------------------------
  function renderCatalogPreview(canvasEl: HTMLCanvasElement, def: PartDef): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const size = 48;
    canvasEl.width = size * dpr;
    canvasEl.height = size * dpr;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const parsed = parsePartArt(def.art);
    drawParsedArt(ctx, parsed, 2, 2, size - 4, 2);
  }

  function renderCatalogTabs(): void {
    tabStrip.innerHTML = '';
    for (const category of nonEmptyCategories(library)) {
      const tab = document.createElement('button');
      tab.className = 'build-catalog-tab';
      tab.type = 'button';
      tab.textContent = t(CATEGORY_KEY[category]);
      tab.dataset['testid'] = `build-catalog-tab-${category}`;
      tab.dataset['active'] = String(filter.category === category && filter.query === '');
      tab.addEventListener('click', () => {
        filter = { category, query: '' };
        searchInput.value = '';
        renderCatalogTabs();
        renderCatalogGrid();
      });
      tabStrip.appendChild(tab);
    }
    if (nonEmptyCategories(library).length > 0 && filter.category === null) return;
    if (!CATEGORY_ORDER.includes(filter.category as PartCategory) && filter.query === '') {
      filter = { ...filter, category: nonEmptyCategories(library)[0] ?? null };
    }
  }

  function renderCatalogGrid(): void {
    catalogGrid.innerHTML = '';
    for (const def of filterCatalog(library, filter)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'build-catalog-item';
      item.dataset['testid'] = `build-catalog-item-${def.id}`;
      item.dataset['held'] = String(heldPartId === def.id);
      const previewCanvas = document.createElement('canvas');
      renderCatalogPreview(previewCanvas, def);
      const name = document.createElement('span');
      name.className = 'build-catalog-item-name';
      name.textContent = def.name[getLocale()];
      item.append(previewCanvas, name);
      item.addEventListener('click', () => {
        heldPartId = heldPartId === def.id ? null : def.id;
        pendingCandidate = null;
        renderCatalogGrid();
        renderWorkspace();
        renderReadout();
      });
      catalogGrid.appendChild(item);
    }
  }

  // ---- readout ----------------------------------------------------------
  function previewState(): BuildState {
    if (!heldPartId) return state;
    try {
      if (state.parts.length === 0) return placeRoot(state, library, heldPartId);
      if (pendingCandidate) return attachPart(state, library, heldPartId, pendingCandidate);
    } catch {
      // Held part can't attach here yet (e.g. no compatible node) — preview the committed state instead.
    }
    return state;
  }

  function renderReadout(): void {
    const readout = computeReadout(previewState(), library, homeBody);
    rowMass.value.textContent = formatMass(readout.massKg);
    rowTwr.value.textContent = `${formatNumber(readout.twrAtm, 2)}×`;
    rowDv.value.textContent = formatDeltaV(readout.deltaVAtmTotal);
    rowParts.value.textContent = formatNumber(readout.partCount);
  }

  function renderChecklist(): void {
    const items = runChecklist(state, library);
    for (const item of items) {
      lamps[item.id].setStatus(item.status);
    }
    checklistBar.dataset['overall'] = overallStatus(items);
  }

  // ---- stages -------------------------------------------------------------
  function renderStages(): void {
    stagesList.innerHTML = '';
    const readout = computeReadout(state, library, homeBody);
    state.stages.forEach((stage, index) => {
      const card = document.createElement('div');
      card.className = 'build-stage-card';
      card.draggable = true;
      card.dataset['testid'] = `build-stage-${index}`;
      card.dataset['stageIndex'] = String(index);

      const header = document.createElement('div');
      header.className = 'build-stage-header';
      const label = document.createElement('span');
      label.className = 'build-stage-index label';
      label.textContent = `${t('BUILD_STAGE_LABEL')} ${index + 1}`;
      const dv = document.createElement('span');
      dv.className = 'build-stage-dv data';
      const stageDv = readout.stages.find((s) => s.stageIndex === index);
      dv.textContent = formatDeltaV(stageDv?.deltaVAtm ?? 0);
      header.append(label, dv);

      const partsRow = document.createElement('div');
      partsRow.className = 'build-stage-parts';
      for (const partId of stage.partIds) {
        const inst = findPart(state, partId);
        if (!inst) continue;
        const def = library.get(inst.partId);
        const chip = document.createElement('span');
        chip.className = 'build-stage-part-chip';
        chip.textContent = def.name[getLocale()];
        chip.draggable = true;
        chip.dataset['testid'] = `build-stage-chip-${partId}`;
        chip.addEventListener('click', () => {
          state = { ...state, selectedInstanceId: partId };
          deleteButton.disabled = false;
          renderWorkspace();
        });
        chip.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData('text/build-part-id', String(partId));
          event.stopPropagation();
        });
        partsRow.appendChild(chip);
      }

      card.append(header, partsRow);

      card.addEventListener('dragstart', () => {
        draggingStageIndex = index;
        card.dataset['dragging'] = 'true';
      });
      card.addEventListener('dragend', () => {
        draggingStageIndex = null;
        card.dataset['dragging'] = 'false';
      });
      card.addEventListener('dragover', (event) => {
        event.preventDefault();
        card.dataset['dropTarget'] = 'true';
      });
      card.addEventListener('dragleave', () => {
        card.dataset['dropTarget'] = 'false';
      });
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        card.dataset['dropTarget'] = 'false';
        const partIdRaw = event.dataTransfer?.getData('text/build-part-id');
        if (partIdRaw) {
          state = movePartToStage(state, Number(partIdRaw), index);
          onStateChanged();
          return;
        }
        if (draggingStageIndex !== null && draggingStageIndex !== index) {
          state = reorderStages(state, draggingStageIndex, index);
          onStateChanged();
        }
      });

      stagesList.appendChild(card);
    });

    stagesTotal.textContent = `${t('BUILD_STAGE_TOTAL_DV')}: ${formatDeltaV(readout.deltaVAtmTotal)}`;
  }

  // ---- flight plan --------------------------------------------------------
  function renderFlightPlan(): void {
    flightPanel.dataset['open'] = String(flightPlanOpen);
    flightStepsList.innerHTML = '';
    const readout = computeReadout(state, library, homeBody);
    const verdict = evaluateFlightPlan(flightSteps, (id) => system.get(id), readout.deltaVVacTotal);

    verdict.steps.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = 'build-flightplan-step';
      row.dataset['testid'] = `build-flightplan-step-${index}`;
      const line1 = document.createElement('div');
      line1.className = 'build-flightplan-step-row';
      const kindLabel = document.createElement('span');
      kindLabel.textContent = t(FLIGHTPLAN_STEP_KEY[step.kind]);
      const dvLabel = document.createElement('span');
      dvLabel.className = 'data';
      dvLabel.dataset['testid'] = `build-flightplan-step-dv-${index}`;
      dvLabel.textContent = formatDeltaV(step.requiredDeltaV);
      line1.append(kindLabel, dvLabel);
      const removeButton = document.createElement('button');
      removeButton.className = 'build-button';
      removeButton.type = 'button';
      removeButton.textContent = t('BUILD_FLIGHTPLAN_REMOVE_STEP');
      removeButton.addEventListener('click', () => {
        flightSteps = flightSteps.filter((_, i) => i !== index);
        renderFlightPlan();
      });
      row.append(line1, removeButton);
      flightStepsList.appendChild(row);
    });

    flightVerdict.dataset['sufficient'] = String(verdict.sufficient);
    const reqLabel = `${t('BUILD_FLIGHTPLAN_REQUIRED')} ${formatDeltaV(verdict.totalRequired)} / ${t('BUILD_FLIGHTPLAN_AVAILABLE')} ${formatDeltaV(verdict.available)}`;
    const verdictLabel = verdict.sufficient ? t('BUILD_FLIGHTPLAN_SUFFICIENT') : t('BUILD_FLIGHTPLAN_INSUFFICIENT');
    flightVerdict.textContent = `${reqLabel} — ${verdictLabel}`;
  }

  function stepAltitudeFor(kind: FlightStepKind): number {
    return kind === 'orbit' ? 100_000 : 100_000;
  }

  addStepButton.addEventListener('click', () => {
    const kind = flightStepSelect.value as FlightStepKind;
    const secondBody = system.get('luna') ? 'luna' : null;
    const step: FlightStepDef =
      kind === 'transfer' && secondBody
        ? { kind, bodyId: homeBody.id, altitudeM: stepAltitudeFor(kind), toBodyId: secondBody }
        : { kind, bodyId: kind === 'brake' || kind === 'land' ? (secondBody ?? homeBody.id) : homeBody.id, altitudeM: stepAltitudeFor(kind) };
    flightSteps = [...flightSteps, step];
    renderFlightPlan();
  });

  flightPlanToggle.addEventListener('click', () => {
    flightPlanOpen = !flightPlanOpen;
    flightPlanToggle.dataset['active'] = String(flightPlanOpen);
    renderFlightPlan();
  });

  // ---- workspace canvas ---------------------------------------------------
  function resizeCanvas(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = workspacePanel.getBoundingClientRect();
    viewportW = rect.width;
    viewportH = rect.height;
    canvas.width = Math.round(viewportW * dpr);
    canvas.height = Math.round(viewportH * dpr);
    canvas.style.width = `${viewportW}px`;
    canvas.style.height = `${viewportH}px`;
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderWorkspace();
  }

  function renderWorkspace(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || viewportW === 0 || viewportH === 0) return;
    drawGrid(ctx, camera, viewportW, viewportH);
    drawAssembly(ctx, camera, state, library, viewportW, viewportH);

    if (heldPartId) {
      let candidates: AttachCandidate[] = [];
      try {
        candidates = state.parts.length === 0 ? [] : findAttachCandidates(state, library, heldPartId);
      } catch {
        candidates = [];
      }
      drawOpenNodeMarkers(ctx, camera, candidates, viewportW, viewportH, pendingCandidate ? candidates.indexOf(pendingCandidate) : null);

      if (state.parts.length === 0) {
        ghostPosition = { x: 0, y: 0 };
        ghostRotation = 0;
      } else if (pendingCandidate) {
        ghostPosition = pendingCandidate.transform.position;
        ghostRotation = pendingCandidate.transform.rotation;
      }
      drawGhostPart(ctx, camera, heldPartId, library, ghostPosition, ghostRotation, viewportW, viewportH);
    }
  }

  /**
   * Keeps the growing stack's current attachment point framed near screen
   * centre, panning (never zooming) toward it after every commit — otherwise
   * a tall rocket quickly scrolls its open top node out of easy reach.
   * X stays 0: the main stack is always built along the vertical axis;
   * radial symmetry siblings are deliberately not chased.
   */
  function recenterCamera(): void {
    if (state.parts.length === 0) {
      camera = createCamera({ x: 0, y: 3 }, camera.pixelsPerMeter);
      return;
    }
    const openStackY = listOpenNodes(state, library)
      .filter((n) => n.node.kind === 'stack')
      .map((n) => n.worldPos.y);
    const targetY = openStackY.length > 0 ? Math.max(...openStackY) : Math.max(...state.parts.map((p) => p.position.y));
    camera = createCamera({ x: 0, y: targetY }, camera.pixelsPerMeter);
  }

  function onStateChanged(): void {
    state = { ...state };
    recenterCamera();
    renderReadout();
    renderChecklist();
    renderStages();
    renderFlightPlan();
    renderWorkspace();
    deleteButton.disabled = state.selectedInstanceId === null;
  }

  canvas.addEventListener('pointermove', (event) => {
    if (!heldPartId) return;
    const rect = canvas.getBoundingClientRect();
    const screenPt = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const cursorWorld = screenToWorld(camera, screenPt, viewportW, viewportH);
    if (state.parts.length === 0) {
      pendingCandidate = null;
      ghostPosition = { x: 0, y: 0 };
    } else {
      let candidates: AttachCandidate[] = [];
      try {
        candidates = findAttachCandidates(state, library, heldPartId);
      } catch {
        candidates = [];
      }
      pendingCandidate = pickNearestCandidate(candidates, cursorWorld, camera, viewportW, viewportH, SNAP_RADIUS_PX);
      if (!pendingCandidate) ghostPosition = cursorWorld;
    }
    renderWorkspace();
    renderReadout();
  });

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const screenPt = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (heldPartId) {
      try {
        if (state.parts.length === 0) {
          state = placeRoot(state, library, heldPartId);
        } else if (pendingCandidate) {
          state = attachPart(state, library, heldPartId, pendingCandidate);
        } else {
          return; // nothing to snap to yet — keep holding
        }
      } catch {
        return;
      }
      heldPartId = null;
      pendingCandidate = null;
      renderCatalogGrid();
      onStateChanged();
      return;
    }

    // Selection: nearest placed part within its own footprint radius.
    let best: { id: number; distPx: number } | null = null;
    for (const part of state.parts) {
      const def = library.get(part.partId);
      const centerScreen = worldToScreen(camera, part.position, viewportW, viewportH);
      const radiusPx = (Math.max(def.bounds.w, def.bounds.h) / 2) * camera.pixelsPerMeter + 4;
      const distPx = Math.hypot(screenPt.x - centerScreen.x, screenPt.y - centerScreen.y);
      if (distPx <= radiusPx && (!best || distPx < best.distPx)) best = { id: part.instanceId, distPx };
    }
    state = { ...state, selectedInstanceId: best?.id ?? null };
    deleteButton.disabled = state.selectedInstanceId === null;
    renderWorkspace();
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      camera = zoomCamera(camera, factor, MIN_PPM, MAX_PPM);
      renderWorkspace();
    },
    { passive: false }
  );

  function cancelHeld(): void {
    heldPartId = null;
    pendingCandidate = null;
    renderCatalogGrid();
    renderWorkspace();
    renderReadout();
  }

  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (heldPartId) cancelHeld();
      else if (state.selectedInstanceId !== null) {
        state = { ...state, selectedInstanceId: null };
        deleteButton.disabled = true;
        renderWorkspace();
      }
    }
  });

  deleteButton.addEventListener('click', () => {
    if (state.selectedInstanceId === null) return;
    state = removePart(state, state.selectedInstanceId);
    onStateChanged();
  });

  for (const [count, button] of symmetryButtons) {
    button.addEventListener('click', () => {
      state = setSymmetryMode(state, library, count);
      for (const [c, b] of symmetryButtons) b.dataset['active'] = String(c === count);
      onStateChanged();
    });
  }
  symmetryButtons.get(1)!.dataset['active'] = 'true';

  // ---- save / load ----------------------------------------------------------
  function renderBlueprintList(): void {
    loadSelect.innerHTML = '';
    const names = listBlueprints();
    if (names.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = t('BUILD_NO_BLUEPRINTS');
      opt.disabled = true;
      loadSelect.appendChild(opt);
      loadButton.disabled = true;
      return;
    }
    loadButton.disabled = false;
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      loadSelect.appendChild(opt);
    }
  }

  saveButton.addEventListener('click', () => {
    const name = blueprintNameInput.value.trim();
    if (!name) return;
    saveBlueprint(state, name);
    renderBlueprintList();
  });

  loadButton.addEventListener('click', () => {
    const name = loadSelect.value;
    if (!name) return;
    const loaded = loadBlueprint(name);
    if (!loaded) return;
    state = loaded;
    heldPartId = null;
    pendingCandidate = null;
    onStateChanged();
  });

  searchInput.addEventListener('input', () => {
    filter = { ...filter, query: searchInput.value };
    renderCatalogGrid();
  });

  // ---- resize / locale ----------------------------------------------------
  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(workspacePanel);

  const unsubscribeLocale = onLocaleChange(() => {
    setUnitsLocale(getLocale());
    renderStaticText();
    renderReadout();
    renderChecklist();
  });

  renderStaticText();
  renderBlueprintList();
  renderReadout();
  renderChecklist();
  requestAnimationFrame(resizeCanvas);

  return () => {
    resizeObserver.disconnect();
    unsubscribeLocale();
    root.innerHTML = '';
  };
}

// Re-exported so callers/tests can build a step without importing `flightPlan.ts` directly.
export { circularOrbitSpeed };
export type { FlightStepDef };
