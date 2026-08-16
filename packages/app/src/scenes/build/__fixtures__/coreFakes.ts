/**
 * FIXTURE — local stand-ins for `computeMass` and `computeDeltaV`
 * (`packages/core/src/vessels/mass.ts` / `deltav.ts`, PLAN.md §4/§7, Agent B's zone).
 * Both currently `throw new Error('not implemented: ...')` in this worktree —
 * Agent B owns that file and is working on it in parallel (PLAN.md's own
 * instructions to Agent C: don't implement these yourself — that's someone
 * else's zone — build local fixtures/fakes for running and testing instead).
 *
 * These fakes match the real functions' exact signatures (`(v: Vessel) =>
 * MassProperties` / `(v: Vessel, ambientPressure: number) => StageDeltaV[]`)
 * so every call site in this scene (`readout.ts`, `BuildScene.ts`) imports them
 * by name from a single place. Simplifications versus the real PLAN.md §5.3/§5.4
 * physics (both clearly marked below):
 *
 * - `fakeComputeMass`: sums dry mass + current resource levels and takes a
 *   mass-weighted centroid/parallel-axis inertia treating each part as a point
 *   mass — no rigid-body shape integration.
 * - `fakeComputeDeltaV`: assumes each stage burns exactly the propellant
 *   carried by parts in its own `Stage.partIds` (no crossfeed reach-through
 *   from stages above) — good enough for a straight vertical stack, not a
 *   general crossfeed graph.
 *
 * ORCHESTRATOR TODO: once Agent B's real `computeMass`/`computeDeltaV` land in
 * `@karman/core`, swap the two imports below (in `readout.ts`) for the real
 * ones — this file can then be deleted.
 */
import { v2, type MassProperties, type PartDef, type PartLibrary, type StageDeltaV, type Vessel } from '@karman/core';

const G0 = 9.806_65; // Tsiolkovsky constant, PLAN.md §5.3 — never local gravity.

function partDryMassAndResourceMass(def: PartDef, resources: Record<string, number>): number {
  let m = def.dryMass;
  for (const key of Object.keys(resources)) {
    m += resources[key] ?? 0;
  }
  return m;
}

/** FIXTURE for `computeMass` (PLAN.md §4). See file header for the simplification versus the real physics. */
export function fakeComputeMass(v: Vessel, parts: PartLibrary): MassProperties {
  let total = 0;
  let comX = 0;
  let comY = 0;
  for (const inst of v.parts) {
    const def = parts.get(inst.partId);
    const m = partDryMassAndResourceMass(def, inst.resources);
    total += m;
    comX += inst.position.x * m;
    comY += inst.position.y * m;
  }
  const com = total > 0 ? { x: comX / total, y: comY / total } : { x: 0, y: 0 };

  let inertia = 0;
  for (const inst of v.parts) {
    const def = parts.get(inst.partId);
    const m = partDryMassAndResourceMass(def, inst.resources);
    const d2 = v2.len2(v2.sub(inst.position, com));
    inertia += m * d2;
  }

  return { total, com, inertia };
}

/** FIXTURE for `computeDeltaV` (PLAN.md §4/§5.4). See file header for the simplification versus the real physics. */
export function fakeComputeDeltaV(v: Vessel, parts: PartLibrary, ambientPressure: number): StageDeltaV[] {
  const out: StageDeltaV[] = [];
  const byId = new Map(v.parts.map((p) => [p.id, p]));

  for (const stage of [...v.stages].sort((a, b) => a.index - b.index)) {
    // Everything in this stage and every stage that fires *after* it (higher
    // index, per PLAN.md §4: "index 0 = first to fire, typically the bottom
    // stage") is still attached and contributes to start mass.
    const attachedStages = v.stages.filter((s) => s.index >= stage.index);
    const attachedPartIds = new Set(attachedStages.flatMap((s) => s.partIds));

    let startMass = 0;
    for (const id of attachedPartIds) {
      const inst = byId.get(id);
      if (!inst) continue;
      startMass += partDryMassAndResourceMass(parts.get(inst.partId), inst.resources);
    }

    // Simplification: this stage's own tanks are assumed fully burned by this
    // stage's own engine(s) (no crossfeed reach-through from stages above).
    let propellantBurned = 0;
    let hasEngine = false;
    let ispVac = 0;
    let ispSl = 0;
    let thrustVac = 0;
    let thrustSl = 0;
    for (const id of stage.partIds) {
      const inst = byId.get(id);
      if (!inst) continue;
      const def = parts.get(inst.partId);
      if (def.engine) {
        hasEngine = true;
        ispVac = def.engine.ispVac;
        ispSl = def.engine.ispSl;
        thrustVac += def.engine.thrustVac;
        thrustSl += def.engine.thrustSl;
      } else {
        for (const key of Object.keys(inst.resources)) {
          propellantBurned += inst.resources[key] ?? 0;
        }
      }
    }

    const endMass = Math.max(startMass - propellantBurned, 1e-6);
    const isp = hasEngine ? ispSl + (ispVac - ispSl) * (1 - ambientPressure) : 0;
    const ispPureVac = hasEngine ? ispVac : 0;
    const thrust = hasEngine ? thrustSl + (thrustVac - thrustSl) * (1 - ambientPressure) : 0;

    const deltaVVac = hasEngine ? ispPureVac * G0 * Math.log(startMass / endMass) : 0;
    const deltaVAtm = hasEngine ? isp * G0 * Math.log(startMass / endMass) : 0;
    const massFlow = hasEngine && isp > 0 ? thrust / (isp * G0) : 0;
    const burnTime = massFlow > 0 ? propellantBurned / massFlow : 0;

    out.push({ stageIndex: stage.index, deltaVVac, deltaVAtm, startMass, endMass, burnTime });
  }

  return out;
}
