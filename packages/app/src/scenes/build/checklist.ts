/**
 * Pre-flight checklist: a row of lamps (PLAN.md §7, "pre-launch checks as a
 * row of lamps") — centre of mass, engine present, legs present, power. Pure
 * function of the assembly; `BuildScene.ts` maps `LampStatus` to
 * `Nominal`/`Warning`/`Critical` tokens (DESIGN.md §1).
 */
import { computeMass, type Body, type PartLibrary } from '@karman/core';
import { toVessel, type BuildState } from './state';

export type LampStatus = 'nominal' | 'warning' | 'critical';

export interface ChecklistItem {
  readonly id: 'com' | 'engine' | 'legs' | 'power';
  readonly status: LampStatus;
}

/**
 * `toVessel` requires a `Body` for `Vessel.soi`, but the centre-of-mass check
 * below only reads `computeMass`'s output, which never consults `soi` — an
 * inert placeholder (not a physics fixture: no field of it feeds any
 * computation here) avoids pulling the real `SystemLibrary` into a check that
 * doesn't need one.
 */
const INERT_BODY: Body = {
  id: 'checklist-inert',
  mu: 1,
  radius: 1,
  soiRadius: Number.POSITIVE_INFINITY,
  rotationPeriod: 1,
  atmosphere: null,
  parent: null,
  orbit: null,
  positionAt: () => ({ x: 0, y: 0 }),
  velocityAt: () => ({ x: 0, y: 0 }),
};

/**
 * Centre-of-mass check: flags a COM sitting outside the assembly's own
 * horizontal footprint as `critical` (the rocket will tip on the pad), and one
 * off-centre by more than 15% of the footprint width as a `warning`.
 */
function checkCom(state: BuildState, parts: PartLibrary): LampStatus {
  if (state.parts.length === 0) return 'critical';
  const vessel = toVessel(state, parts, INERT_BODY);
  const mass = computeMass(vessel);
  const xs = state.parts.map((p) => p.position.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const width = Math.max(maxX - minX, 0.5); // avoid division by ~0 for a single-part vessel
  const offsetFraction = Math.abs(mass.com.x - (minX + maxX) / 2) / width;
  if (mass.com.x < minX - width || mass.com.x > maxX + width) return 'critical';
  if (offsetFraction > 0.15) return 'warning';
  return 'nominal';
}

function checkEngine(state: BuildState, parts: PartLibrary): LampStatus {
  const firstStage = state.stages[0];
  if (!firstStage) return 'critical';
  const hasEngine = firstStage.partIds.some((id) => {
    const inst = state.parts.find((p) => p.instanceId === id);
    return inst && parts.get(inst.partId).engine !== null;
  });
  return hasEngine ? 'nominal' : 'critical';
}

function checkLegs(state: BuildState, parts: PartLibrary): LampStatus {
  const hasLegs = state.parts.some((p) => parts.get(p.partId).category === 'legs');
  return hasLegs ? 'nominal' : 'warning';
}

/**
 * A vessel needs *some* electricity source once it has anything worth
 * running (an engine, at minimum — gimbal/ignition draw power). A pod's own
 * built-in reserve (PLAN.md/`pod_capsule`'s `electricity` capacity) covers a
 * short hop; a dedicated `power`-category part (battery/solar) is what earns
 * `nominal` on anything bigger.
 */
function checkPower(state: BuildState, parts: PartLibrary): LampStatus {
  const needsPower = state.parts.some((p) => parts.get(p.partId).engine !== null);
  if (!needsPower) return 'nominal';
  const hasSupply = state.parts.some((p) => {
    const category = parts.get(p.partId).category;
    return category === 'power' || category === 'pod';
  });
  return hasSupply ? 'nominal' : 'warning';
}

/** Runs every pre-flight check, in a fixed, deterministic order. */
export function runChecklist(state: BuildState, parts: PartLibrary): readonly ChecklistItem[] {
  return [
    { id: 'com', status: checkCom(state, parts) },
    { id: 'engine', status: checkEngine(state, parts) },
    { id: 'legs', status: checkLegs(state, parts) },
    { id: 'power', status: checkPower(state, parts) },
  ];
}

/** Worst status across the whole checklist — `critical` beats `warning` beats `nominal`. */
export function overallStatus(items: readonly ChecklistItem[]): LampStatus {
  if (items.some((i) => i.status === 'critical')) return 'critical';
  if (items.some((i) => i.status === 'warning')) return 'warning';
  return 'nominal';
}
