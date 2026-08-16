/**
 * FIXTURE — stand-in for Agent E's real 25-part v1 roster (`data/parts/**`,
 * PLAN.md §7, Agent E's zone) and its loader (`packages/core/src/data/**`).
 * Neither exists yet in this worktree, so the hangar is built and tested
 * against this local `PartLibrary` instead — a handful of parts covering
 * every category the two-stage-rocket acceptance scenario (PLAN.md §7,
 * Agent C's zone) needs: a pod, two tanks, two engines, a solid booster, a
 * stack separator, legs, a parachute and two power parts.
 *
 * Every `PartDef` here is shaped exactly like the real contract (PLAN.md §4/§6.1)
 * — `tank_s1`'s numbers are even lifted verbatim from the §6.1 example — so
 * swapping this fixture for the real `PartLibrary` later is a one-line import
 * change in `BuildScene.ts`/`catalog.ts`, not a rewrite.
 *
 * Localized names/descriptions live in the sibling `partText.json`, not as
 * inline string literals here — this file lives outside `i18n/`, and the
 * project's own guard test (`test/no-cyrillic.test.ts`) scans every `.ts` file
 * outside `i18n/` for non-Latin text; `.json` is exempt, matching how the real
 * `data/parts/<id>/part.json` format embeds localized text (PLAN.md §6.1).
 *
 * ORCHESTRATOR TODO: once Agent E's `data/parts/**` + loader land, replace the
 * import of `FIXTURE_PARTS` with the real `PartLibrary`.
 *
 * Art follows DESIGN.md §4: `viewBox="0 0 64 64"`, role names instead of hex
 * (`Panel` fill, `InkMuted` 2-unit stroke, `Burn` only on what burns or
 * separates, `HairlineSoft` for internal lines), origin at the part's bottom
 * stack node, Y up. See `partArt.ts` for the parser/renderer that turns this
 * back into `Path2D` at draw time.
 */
import { degToRad, type AttachNode, type LocalizedText, type PartDef, type PartLibrary, type Vec2 } from '@karman/core';
import rawPartText from './partText.json';

const PART_TEXT = rawPartText as Record<string, { name: LocalizedText; description: LocalizedText }>;

function textFor(id: string): { name: LocalizedText; description: LocalizedText } {
  const entry = PART_TEXT[id];
  if (!entry) throw new Error(`parts fixture: missing partText.json entry for "${id}"`);
  return entry;
}

const VIEW = 64;

/**
 * World-metres → this part's local SVG box. Scales by the part's *longer*
 * side so flat/wide parts (e.g. `solar_panel`) fit inside the 64×64 viewBox
 * instead of overflowing it — `workspaceRenderer.ts`/`partArt.ts` size a
 * part's on-screen box the same way (`Math.max(bounds.w, bounds.h)`), so this
 * must match. Origin at `(VIEW/2, VIEW)` (DESIGN.md §4: origin is the bottom
 * stack node, i.e. bottom-centre of the box).
 */
function svgScale(maxDimM: number): number {
  return VIEW / maxDimM;
}
function svgX(xMeters: number, scale: number): number {
  return VIEW / 2 + xMeters * scale;
}
function svgY(yMeters: number, scale: number): number {
  return VIEW - yMeters * scale;
}

function rect(xM: number, yM: number, wM: number, hM: number, scale: number, fill: string, stroke: string): string {
  const x = svgX(xM - wM / 2, scale);
  const w = wM * scale;
  const y = svgY(yM + hM, scale);
  const h = hM * scale;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`;
}

function line(x1M: number, y1M: number, x2M: number, y2M: number, scale: number, stroke: string): string {
  return `<line x1="${svgX(x1M, scale)}" y1="${svgY(y1M, scale)}" x2="${svgX(x2M, scale)}" y2="${svgY(y2M, scale)}" stroke="${stroke}" stroke-width="1" />`;
}

function polygon(points: readonly Vec2[], scale: number, fill: string, stroke: string): string {
  const pts = points.map((p) => `${svgX(p.x, scale)},${svgY(p.y, scale)}`).join(' ');
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`;
}

function svgDoc(body: string): string {
  return `<svg viewBox="0 0 ${VIEW} ${VIEW}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function stackNode(pos: Vec2, dir: Vec2, size = 1): AttachNode {
  return { pos, dir, size, kind: 'stack' };
}
function radialNode(pos: Vec2, dir: Vec2, size = 1): AttachNode {
  return { pos, dir, size, kind: 'radial' };
}

// -- pod_capsule --------------------------------------------------------------
const podBounds = { w: 1.4, h: 1.8 };
const podScale = svgScale(Math.max(podBounds.w, podBounds.h));
const POD_CAPSULE: PartDef = {
  id: 'pod_capsule',
  name: textFor('pod_capsule').name,
  description: textFor('pod_capsule').description,
  category: 'pod',
  dryMass: 300,
  resources: [{ id: 'electricity', capacity: 100 }],
  engine: null,
  dragArea: 0.9,
  nodeStrength: 500_000,
  maxLandingSpeed: 0,
  crossfeed: false,
  nodes: [stackNode({ x: 0, y: 0 }, { x: 0, y: -1 }), stackNode({ x: 0, y: podBounds.h }, { x: 0, y: 1 })],
  bounds: podBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      polygon(
        [
          { x: -podBounds.w / 2, y: 0 },
          { x: -podBounds.w / 2, y: podBounds.h * 0.55 },
          { x: 0, y: podBounds.h },
          { x: podBounds.w / 2, y: podBounds.h * 0.55 },
          { x: podBounds.w / 2, y: 0 },
        ],
        podScale,
        'Panel',
        'InkMuted'
      ) + line(-podBounds.w / 2, podBounds.h * 0.55, podBounds.w / 2, podBounds.h * 0.55, podScale, 'HairlineSoft')
    ),
  },
};

// -- tank_s1 (numbers lifted verbatim from PLAN.md §6.1) ----------------------
const tankSBounds = { w: 1.6, h: 3.2 };
const tankSScale = svgScale(Math.max(tankSBounds.w, tankSBounds.h));
const TANK_S: PartDef = {
  id: 'tank_s1',
  name: textFor('tank_s1').name,
  description: textFor('tank_s1').description,
  category: 'tanks',
  dryMass: 300,
  resources: [{ id: 'fuel', capacity: 2700 }],
  engine: null,
  dragArea: 1.4,
  nodeStrength: 480_000,
  maxLandingSpeed: 0,
  crossfeed: true,
  nodes: [
    stackNode({ x: 0, y: 0 }, { x: 0, y: -1 }),
    stackNode({ x: 0, y: tankSBounds.h }, { x: 0, y: 1 }),
    radialNode({ x: tankSBounds.w / 2, y: tankSBounds.h / 2 }, { x: 1, y: 0 }),
  ],
  bounds: tankSBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      rect(0, 0, tankSBounds.w, tankSBounds.h, tankSScale, 'Panel', 'InkMuted') +
        line(-tankSBounds.w / 2, tankSBounds.h * 0.3, tankSBounds.w / 2, tankSBounds.h * 0.3, tankSScale, 'HairlineSoft') +
        line(-tankSBounds.w / 2, tankSBounds.h * 0.7, tankSBounds.w / 2, tankSBounds.h * 0.7, tankSScale, 'HairlineSoft')
    ),
  },
};

// -- tank_m ---------------------------------------------------------------
const tankMBounds = { w: 1.6, h: 4.8 };
const tankMScale = svgScale(Math.max(tankMBounds.w, tankMBounds.h));
const TANK_M: PartDef = {
  id: 'tank_m1',
  name: textFor('tank_m1').name,
  description: textFor('tank_m1').description,
  category: 'tanks',
  dryMass: 550,
  resources: [{ id: 'fuel', capacity: 5200 }],
  engine: null,
  dragArea: 1.6,
  nodeStrength: 520_000,
  maxLandingSpeed: 0,
  crossfeed: true,
  nodes: [
    stackNode({ x: 0, y: 0 }, { x: 0, y: -1 }),
    stackNode({ x: 0, y: tankMBounds.h }, { x: 0, y: 1 }),
    radialNode({ x: tankMBounds.w / 2, y: tankMBounds.h / 2 }, { x: 1, y: 0 }),
  ],
  bounds: tankMBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      rect(0, 0, tankMBounds.w, tankMBounds.h, tankMScale, 'Panel', 'InkMuted') +
        line(-tankMBounds.w / 2, tankMBounds.h * 0.25, tankMBounds.w / 2, tankMBounds.h * 0.25, tankMScale, 'HairlineSoft') +
        line(-tankMBounds.w / 2, tankMBounds.h * 0.5, tankMBounds.w / 2, tankMBounds.h * 0.5, tankMScale, 'HairlineSoft') +
        line(-tankMBounds.w / 2, tankMBounds.h * 0.75, tankMBounds.w / 2, tankMBounds.h * 0.75, tankMScale, 'HairlineSoft')
    ),
  },
};

// -- engine_start (sea-level) --------------------------------------------
const engStartBounds = { w: 1.6, h: 1.4 };
const engStartScale = svgScale(Math.max(engStartBounds.w, engStartBounds.h));
const ENGINE_START: PartDef = {
  id: 'engine_start',
  name: textFor('engine_start').name,
  description: textFor('engine_start').description,
  category: 'engines',
  dryMass: 220,
  resources: [],
  engine: {
    thrustVac: 240_000,
    thrustSl: 210_000,
    ispVac: 265,
    ispSl: 230,
    gimbal: degToRad(6),
    minThrottle: 0.4,
    fuel: 'fuel',
  },
  dragArea: 0.9,
  nodeStrength: 450_000,
  maxLandingSpeed: 0,
  crossfeed: false,
  // Bottom node lets an interstage/decoupler sit below this engine when it's
  // not the rocket's very bottom part; top node receives the tank above it.
  nodes: [stackNode({ x: 0, y: 0 }, { x: 0, y: -1 }), stackNode({ x: 0, y: engStartBounds.h }, { x: 0, y: 1 })],
  bounds: engStartBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      rect(0, engStartBounds.h * 0.35, engStartBounds.w * 0.7, engStartBounds.h * 0.65, engStartScale, 'Panel', 'InkMuted') +
        polygon(
          [
            { x: -engStartBounds.w * 0.35, y: engStartBounds.h * 0.35 },
            { x: engStartBounds.w * 0.35, y: engStartBounds.h * 0.35 },
            { x: engStartBounds.w * 0.5, y: 0 },
            { x: -engStartBounds.w * 0.5, y: 0 },
          ],
          engStartScale,
          'Burn',
          'InkMuted'
        )
    ),
  },
};

// -- engine_vac (vacuum) ---------------------------------------------------
const engVacBounds = { w: 1.2, h: 1.0 };
const engVacScale = svgScale(Math.max(engVacBounds.w, engVacBounds.h));
const ENGINE_VAC: PartDef = {
  id: 'engine_vac',
  name: textFor('engine_vac').name,
  description: textFor('engine_vac').description,
  category: 'engines',
  dryMass: 180,
  resources: [],
  engine: {
    thrustVac: 60_000,
    thrustSl: 20_000,
    ispVac: 340,
    ispSl: 210,
    gimbal: degToRad(4),
    minThrottle: 0,
    fuel: 'fuel',
  },
  dragArea: 0.5,
  nodeStrength: 380_000,
  maxLandingSpeed: 0,
  crossfeed: false,
  nodes: [stackNode({ x: 0, y: 0 }, { x: 0, y: -1 }), stackNode({ x: 0, y: engVacBounds.h }, { x: 0, y: 1 })],
  bounds: engVacBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      rect(0, engVacBounds.h * 0.3, engVacBounds.w * 0.6, engVacBounds.h * 0.7, engVacScale, 'Panel', 'InkMuted') +
        polygon(
          [
            { x: -engVacBounds.w * 0.3, y: engVacBounds.h * 0.3 },
            { x: engVacBounds.w * 0.3, y: engVacBounds.h * 0.3 },
            { x: engVacBounds.w * 0.42, y: 0 },
            { x: -engVacBounds.w * 0.42, y: 0 },
          ],
          engVacScale,
          'Burn',
          'InkMuted'
        )
    ),
  },
};

// -- srb_booster ------------------------------------------------------------
const srbBounds = { w: 1.0, h: 3.0 };
const srbScale = svgScale(Math.max(srbBounds.w, srbBounds.h));
const SRB_BOOSTER: PartDef = {
  id: 'srb_booster',
  name: textFor('srb_booster').name,
  description: textFor('srb_booster').description,
  category: 'boosters',
  dryMass: 400,
  resources: [{ id: 'solidFuel', capacity: 3_200 }],
  engine: {
    thrustVac: 300_000,
    thrustSl: 320_000,
    ispVac: 220,
    ispSl: 190,
    gimbal: 0,
    minThrottle: 1,
    fuel: 'solidFuel',
  },
  dragArea: 0.6,
  nodeStrength: 350_000,
  maxLandingSpeed: 0,
  crossfeed: false,
  nodes: [radialNode({ x: -srbBounds.w / 2, y: srbBounds.h * 0.75 }, { x: -1, y: 0 })],
  bounds: srbBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      rect(0, srbBounds.h * 0.15, srbBounds.w, srbBounds.h * 0.85, srbScale, 'Panel', 'InkMuted') +
        polygon(
          [
            { x: -srbBounds.w / 2, y: srbBounds.h * 0.15 },
            { x: srbBounds.w / 2, y: srbBounds.h * 0.15 },
            { x: srbBounds.w * 0.3, y: 0 },
            { x: -srbBounds.w * 0.3, y: 0 },
          ],
          srbScale,
          'Burn',
          'InkMuted'
        )
    ),
  },
};

// -- decoupler_stack ----------------------------------------------------------
const decouplerBounds = { w: 1.6, h: 0.4 };
const decouplerScale = svgScale(Math.max(decouplerBounds.w, decouplerBounds.h));
const DECOUPLER: PartDef = {
  id: 'decoupler_stack',
  name: textFor('decoupler_stack').name,
  description: textFor('decoupler_stack').description,
  category: 'separators',
  dryMass: 50,
  resources: [],
  engine: null,
  dragArea: 0.2,
  nodeStrength: 300_000,
  maxLandingSpeed: 0,
  crossfeed: true,
  nodes: [
    stackNode({ x: 0, y: 0 }, { x: 0, y: -1 }),
    stackNode({ x: 0, y: decouplerBounds.h }, { x: 0, y: 1 }),
  ],
  bounds: decouplerBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(rect(0, 0, decouplerBounds.w, decouplerBounds.h, decouplerScale, 'Burn', 'InkMuted')),
  },
};

// -- legs -------------------------------------------------------------------
const legsBounds = { w: 0.6, h: 1.0 };
const legsScale = svgScale(Math.max(legsBounds.w, legsBounds.h));
const LEGS: PartDef = {
  id: 'legs_light',
  name: textFor('legs_light').name,
  description: textFor('legs_light').description,
  category: 'legs',
  dryMass: 60,
  resources: [],
  engine: null,
  dragArea: 0.1,
  nodeStrength: 200_000,
  maxLandingSpeed: 6,
  crossfeed: false,
  nodes: [radialNode({ x: -legsBounds.w / 2, y: legsBounds.h * 0.7 }, { x: -1, y: 0 })],
  bounds: legsBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      line(0, legsBounds.h * 0.9, -legsBounds.w * 0.9, 0, legsScale, 'InkMuted') +
        line(-legsBounds.w * 0.9, 0, -legsBounds.w * 1.3, 0, legsScale, 'InkMuted')
    ),
  },
};

// -- parachute ----------------------------------------------------------------
const chuteBounds = { w: 0.6, h: 0.8 };
const chuteScale = svgScale(Math.max(chuteBounds.w, chuteBounds.h));
const PARACHUTE: PartDef = {
  id: 'parachute',
  name: textFor('parachute').name,
  description: textFor('parachute').description,
  category: 'parachutes',
  dryMass: 40,
  resources: [],
  engine: null,
  dragArea: 0.3,
  nodeStrength: 150_000,
  maxLandingSpeed: 0,
  crossfeed: false,
  nodes: [stackNode({ x: 0, y: 0 }, { x: 0, y: -1 })],
  bounds: chuteBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(
      polygon(
        [
          { x: -chuteBounds.w / 2, y: chuteBounds.h * 0.3 },
          { x: 0, y: chuteBounds.h },
          { x: chuteBounds.w / 2, y: chuteBounds.h * 0.3 },
        ],
        chuteScale,
        'Panel',
        'InkMuted'
      )
    ),
  },
};

// -- battery ------------------------------------------------------------------
const batteryBounds = { w: 0.5, h: 0.4 };
const batteryScale = svgScale(Math.max(batteryBounds.w, batteryBounds.h));
const BATTERY: PartDef = {
  id: 'battery',
  name: textFor('battery').name,
  description: textFor('battery').description,
  category: 'power',
  dryMass: 30,
  resources: [{ id: 'electricity', capacity: 200 }],
  engine: null,
  dragArea: 0.05,
  nodeStrength: 150_000,
  maxLandingSpeed: 0,
  crossfeed: false,
  nodes: [radialNode({ x: -batteryBounds.w / 2, y: batteryBounds.h / 2 }, { x: -1, y: 0 })],
  bounds: batteryBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(rect(0, 0, batteryBounds.w, batteryBounds.h, batteryScale, 'Panel', 'InkMuted')),
  },
};

// -- solar_panel ----------------------------------------------------------------
const solarBounds = { w: 0.8, h: 0.15 };
const solarScale = svgScale(Math.max(solarBounds.w, solarBounds.h));
const SOLAR_PANEL: PartDef = {
  id: 'solar_panel',
  name: textFor('solar_panel').name,
  description: textFor('solar_panel').description,
  category: 'power',
  dryMass: 20,
  resources: [],
  engine: null,
  dragArea: 0.15,
  nodeStrength: 90_000,
  maxLandingSpeed: 0,
  crossfeed: false,
  nodes: [radialNode({ x: -solarBounds.w / 2, y: solarBounds.h / 2 }, { x: -1, y: 0 })],
  bounds: solarBounds,
  art: {
    viewBox: { w: VIEW, h: VIEW },
    svg: svgDoc(rect(0, 0, solarBounds.w, solarBounds.h, solarScale, 'HairlineSoft', 'InkMuted')),
  },
};

const ALL_PARTS: readonly PartDef[] = [
  POD_CAPSULE,
  TANK_S,
  TANK_M,
  ENGINE_START,
  ENGINE_VAC,
  SRB_BOOSTER,
  DECOUPLER,
  LEGS,
  PARACHUTE,
  BATTERY,
  SOLAR_PANEL,
];

const BY_ID = new Map<string, PartDef>(ALL_PARTS.map((p) => [p.id, p]));

export const FIXTURE_PARTS: PartLibrary = {
  get(id: string): PartDef {
    const part = BY_ID.get(id);
    if (!part) throw new Error(`FIXTURE_PARTS: unknown part "${id}"`);
    return part;
  },
  all(): readonly PartDef[] {
    return ALL_PARTS;
  },
};
