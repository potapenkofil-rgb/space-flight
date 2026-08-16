/**
 * Balance acceptance test (PLAN.md §7 Agent E): the starter-set rocket must
 * reach orbit with a 15-25% ΔV margin. `computeDeltaV` (Agent B's job,
 * `vessels/deltav.ts`) is still `throw new Error('not implemented')` at the
 * time this was written, so this test computes the Tsiolkovsky rocket
 * equation by hand — `ΔV = Isp · g0 · ln(m_start / m_end)` per PLAN.md §5.4 —
 * directly from the real `data/parts/*` masses/Isp loaded through this
 * package's own `loadParts`, against a fixed two-stage "starter set" built
 * from the 25-part roster:
 *
 *   stage 1 (fires first): engine_launch + tank_m1
 *   stage 2 (upper):       engine_vacuum + tank_s1 + pod_command + parachute_mk1 + separator_stack
 *
 * The reference number (PLAN.md §5.7): a 100 km circular orbit costs
 * ≈2 986 m/s ideally, ≈3 800 m/s including ascent losses (gravity/drag) —
 * the acceptance bar is the *ideal* (vacuum, Tsiolkovsky) stack ΔV landing
 * 15–25% above that 3 800 m/s "with losses" figure.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadParts, type PartSourceFile } from './part-loader';
import type { PartDef } from '../vessels/parts';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DATA_PARTS_DIR = join(REPO_ROOT, 'data', 'parts');

/** Tsiolkovsky's constant, PLAN.md §5.3 — NOT local surface gravity. */
const G0 = 9.80665;
/** PLAN.md §5.7: circular 100 km orbit including ascent losses. */
const REQUIRED_DELTA_V = 3800;
const MIN_MARGIN = 0.15;
const MAX_MARGIN = 0.25;

function readAllParts(): readonly PartDef[] {
  const sources: PartSourceFile[] = readdirSync(DATA_PARTS_DIR)
    .sort()
    .map((folderId) => {
      const dir = join(DATA_PARTS_DIR, folderId);
      return {
        origin: `data/parts/${folderId}`,
        folderId,
        json: readFileSync(join(dir, 'part.json'), 'utf8'),
        svg: existsSync(join(dir, 'part.svg')) ? readFileSync(join(dir, 'part.svg'), 'utf8') : null,
      };
    });
  const { parts, issues } = loadParts(sources);
  if (issues.length > 0) {
    throw new Error(`unexpected part-load issues in balance test: ${JSON.stringify(issues)}`);
  }
  return parts;
}

function byId(parts: readonly PartDef[], id: string): PartDef {
  const part = parts.find((p) => p.id === id);
  if (!part) throw new Error(`balance test: missing expected starter part "${id}"`);
  return part;
}

function fullResourceMass(part: PartDef): number {
  return part.resources.reduce((sum, r) => sum + r.capacity, 0);
}

function wetMass(part: PartDef): number {
  return part.dryMass + fullResourceMass(part);
}

/** `ΔV = Isp · g0 · ln(m_start / m_end)` — PLAN.md §5.4, computed by hand (see file header). */
function tsiolkovsky(ispSeconds: number, massStart: number, massEnd: number): number {
  return ispSeconds * G0 * Math.log(massStart / massEnd);
}

describe('starter-set ΔV balance (PLAN.md §7 Agent E acceptance: 15–25% margin over 3 800 m/s)', () => {
  const parts = readAllParts();

  const pod = byId(parts, 'pod_command');
  const parachute = byId(parts, 'parachute_mk1');
  const separator = byId(parts, 'separator_stack');
  const tankS = byId(parts, 'tank_s1');
  const tankM = byId(parts, 'tank_m1');
  const engineVacuum = byId(parts, 'engine_vacuum');
  const engineLaunch = byId(parts, 'engine_launch');

  it('all seven starter parts loaded from data/parts/', () => {
    expect(engineVacuum.engine).not.toBeNull();
    expect(engineLaunch.engine).not.toBeNull();
  });

  // Stage 2 (upper, fires second): pod + parachute + engine_vacuum + one tank_s1.
  // (engine_vacuum carries no resources of its own, so its wet mass == its dry mass.)
  const stage2Dry = pod.dryMass + parachute.dryMass + wetMass(engineVacuum) + tankS.dryMass;
  const stage2Wet = stage2Dry + fullResourceMass(tankS);

  // Stage 1 (lower, fires first): engine_launch + one tank_m1 + separator, carrying stage 2 (full) on top.
  const stage1OwnDry = engineLaunch.dryMass + tankM.dryMass + separator.dryMass;
  const stage1Start = stage1OwnDry + fullResourceMass(tankM) + stage2Wet;
  const stage1End = stage1OwnDry + stage2Wet;

  it('stage 2 (vacuum engine) ΔV', () => {
    const dv2 = tsiolkovsky(engineVacuum.engine!.ispVac, stage2Wet, stage2Dry);
    expect(dv2).toBeGreaterThan(2000);
  });

  it('stage 1 (liftoff engine) ΔV and liftoff TWR > 1.2 (must actually clear the pad)', () => {
    const dv1 = tsiolkovsky(engineLaunch.engine!.ispVac, stage1Start, stage1End);
    expect(dv1).toBeGreaterThan(1000);

    const terraSurfaceGravity = 9.81; // PLAN.md §5.7
    const liftoffWeight = stage1Start * terraSurfaceGravity;
    const twr = engineLaunch.engine!.thrustSl / liftoffWeight;
    expect(twr).toBeGreaterThan(1.2);
  });

  it('total vacuum ΔV of the starter set is 15–25% above the 3 800 m/s orbital requirement', () => {
    const dv2 = tsiolkovsky(engineVacuum.engine!.ispVac, stage2Wet, stage2Dry);
    const dv1 = tsiolkovsky(engineLaunch.engine!.ispVac, stage1Start, stage1End);
    const total = dv1 + dv2;
    const margin = total / REQUIRED_DELTA_V - 1;

    // Surfaces the actual numbers in `pnpm test` output for the balance report.
    console.log(
      `[balance] stage1 dv=${dv1.toFixed(1)} stage2 dv=${dv2.toFixed(1)} total=${total.toFixed(1)} ` +
        `required=${REQUIRED_DELTA_V} margin=${(margin * 100).toFixed(1)}%`
    );

    expect(margin).toBeGreaterThanOrEqual(MIN_MARGIN);
    expect(margin).toBeLessThanOrEqual(MAX_MARGIN);
  });
});
