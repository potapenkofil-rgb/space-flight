/**
 * The hangar readout: mass, thrust-to-weight, ΔV (per stage and total), part
 * count (PLAN.md §7, "readout"). A pure function of a `BuildState` snapshot, so
 * `BuildScene.ts` can call it both for the committed assembly and for a
 * "preview" snapshot that includes the part currently held on the cursor —
 * satisfying "updates live while the part is still hanging on the cursor" without this
 * module knowing anything about pointers or the DOM.
 */
import type { Body, PartLibrary, StageDeltaV } from '@karman/core';
import { fakeComputeDeltaV, fakeComputeMass } from './__fixtures__/coreFakes';
import { surfaceGravity } from './__fixtures__/system';
import { toVessel, type BuildState } from './state';

export interface Readout {
  readonly massKg: number;
  readonly thrustVacN: number;
  readonly thrustAtmN: number;
  readonly twrAtm: number;
  readonly deltaVVacTotal: number;
  readonly deltaVAtmTotal: number;
  readonly stages: readonly StageDeltaV[];
  readonly partCount: number;
}

/**
 * @param state hangar assembly (or a preview snapshot with a ghost part merged in)
 * @param parts the part library to resolve `PartInstance.partId` against
 * @param body the body the vessel is sitting on, for surface gravity + the
 *   default ambient pressure used for the "at sea level" figures
 * @param ambientPressure `0` (vacuum) .. `1` (sea level); defaults to sea level
 *   (a vessel is being *built*, i.e. presumed still on the pad)
 */
export function computeReadout(
  state: BuildState,
  parts: PartLibrary,
  body: Body,
  ambientPressure = 1
): Readout {
  const vessel = toVessel(state, parts, body);
  vessel.mass = fakeComputeMass(vessel, parts);
  const stages = fakeComputeDeltaV(vessel, parts, ambientPressure);

  const g = surfaceGravity(body);
  let thrustVacN = 0;
  let thrustAtmN = 0;
  const firstStage = state.stages[0];
  if (firstStage) {
    for (const id of firstStage.partIds) {
      const inst = vessel.parts.find((p) => p.id === id);
      if (!inst) continue;
      const def = parts.get(inst.partId);
      if (!def.engine) continue;
      thrustVacN += def.engine.thrustVac;
      thrustAtmN += def.engine.thrustSl + (def.engine.thrustVac - def.engine.thrustSl) * (1 - ambientPressure);
    }
  }

  const massKg = vessel.mass.total;
  const twrAtm = massKg > 0 && g > 0 ? thrustAtmN / (massKg * g) : 0;
  const deltaVVacTotal = stages.reduce((sum, s) => sum + s.deltaVVac, 0);
  const deltaVAtmTotal = stages.reduce((sum, s) => sum + s.deltaVAtm, 0);

  return {
    massKg,
    thrustVacN,
    thrustAtmN,
    twrAtm,
    deltaVVacTotal,
    deltaVAtmTotal,
    stages,
    partCount: state.parts.length,
  };
}
