import { expect, test, type Page } from '@playwright/test';

/**
 * Hangar acceptance scenario (PLAN.md §7, Agent C's zone): assemble a
 * two-stage rocket by clicking, verify the ΔV readout, save, reload the
 * page, load — the blueprint comes back identical.
 *
 * Reached via the temporary `?scene=build` seam `main.ts` gained for this
 * (see the comment in `packages/app/src/main.ts` — the PLAN.md §7 stage-2
 * integrator is expected to replace it with the real menu → hangar route).
 *
 * This file is new and additive under the shared `tests/e2e/` directory
 * (not itself in Agent C's `scenes/build/**`/`ui/build/**` zone, but the
 * PLAN.md §7 acceptance criteria for this agent explicitly requires a
 * Playwright scenario, and there is nowhere else for it to live).
 *
 * Numbers below mirror the fixture in
 * `packages/app/src/scenes/build/__fixtures__/parts.ts` and the ΔV formula
 * in `packages/app/src/scenes/build/__fixtures__/coreFakes.ts` — both are
 * local stand-ins for Agent B's real `computeMass`/`computeDeltaV`
 * (currently `throw new Error('not implemented: ...')` in this worktree);
 * once those land, this test's expected numbers should be recomputed
 * against the real physics if the fixture roster changes.
 */

const G0 = 9.806_65;

// Mirrors __fixtures__/parts.ts (dry mass kg, resource capacity kg, Isp at sea level, s).
const ENGINE_START = { dryMass: 220, ispSl: 230 };
const TANK_S1 = { dryMass: 300, fuel: 2700 };
const DECOUPLER = { dryMass: 50 };
const ENGINE_VAC = { dryMass: 180, ispSl: 210 };
const TANK_M1 = { dryMass: 550, fuel: 5200 };
const POD = { dryMass: 300, electricity: 100 };

// Mirrors __fixtures__/coreFakes.ts's simplified per-stage split: stage 0 is
// everything up to and including the first separator, stage 1 is the rest.
const STAGE0_START = ENGINE_START.dryMass + TANK_S1.dryMass + TANK_S1.fuel + DECOUPLER.dryMass + ENGINE_VAC.dryMass + TANK_M1.dryMass + TANK_M1.fuel + POD.dryMass + POD.electricity;
const STAGE0_END = STAGE0_START - TANK_S1.fuel;
const STAGE0_DV = ENGINE_START.ispSl * G0 * Math.log(STAGE0_START / STAGE0_END);

const STAGE1_START = ENGINE_VAC.dryMass + TANK_M1.dryMass + TANK_M1.fuel + POD.dryMass + POD.electricity;
const STAGE1_END = STAGE1_START - TANK_M1.fuel - POD.electricity; // the fixture's simplified fake counts every non-engine resource as "propellant" (see coreFakes.ts)
const STAGE1_DV = ENGINE_VAC.ispSl * G0 * Math.log(STAGE1_START / STAGE1_END);

const TOTAL_DV = STAGE0_DV + STAGE1_DV;

/** Parses a Cascadia-Mono-formatted "3 442" (thin-space grouped) number back into a plain JS number. */
function parseFormattedNumber(text: string): number {
  const cleaned = text.replace(/[^\d,.\-−]/g, '').replace('−', '-').replace(',', '.');
  return Number.parseFloat(cleaned);
}

/** Clicks a catalog item, then clicks dead-centre of the workspace canvas — the hangar recentres its camera on the stack's newest open node after every commit (see `BuildScene.ts`'s `recenterCamera`), so centre is always the correct attach point when building straight up. */
async function placeNext(page: Page, partId: string, category: string): Promise<void> {
  await page.getByTestId(`build-catalog-tab-${category}`).click();
  await page.getByTestId(`build-catalog-item-${partId}`).click();
  const canvas = page.getByTestId('build-workspace-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('workspace canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);
}

async function buildTwoStageRocket(page: Page): Promise<void> {
  await placeNext(page, 'engine_start', 'engines'); // root
  await placeNext(page, 'tank_s1', 'tanks');
  await placeNext(page, 'decoupler_stack', 'separators');
  await placeNext(page, 'engine_vac', 'engines');
  await placeNext(page, 'tank_m1', 'tanks');
  await placeNext(page, 'pod_capsule', 'pod');
}

test('assemble a two-stage rocket by clicking, ΔV readout matches the rocket equation', async ({ page }) => {
  await page.goto('/?scene=build');
  await expect(page.getByTestId('build-overlay')).toBeVisible();

  await buildTwoStageRocket(page);

  await expect(page.getByTestId('build-readout-parts').locator('.build-readout-value')).toHaveText('6');

  const dvText = await page.getByTestId('build-readout-dv').locator('.build-readout-value').textContent();
  expect(dvText).not.toBeNull();
  const dvValue = parseFormattedNumber(dvText ?? '');
  // formatDeltaV rounds to whole m/s above 100 m/s (math/units.ts) — allow that rounding.
  expect(dvValue).toBeCloseTo(TOTAL_DV, 0);

  await expect(page.getByTestId('build-stage-0')).toBeVisible();
  await expect(page.getByTestId('build-stage-1')).toBeVisible();
  const stage0Dv = await page.getByTestId('build-stage-0').locator('.build-stage-dv').textContent();
  expect(parseFormattedNumber(stage0Dv ?? '')).toBeCloseTo(STAGE0_DV, 0);
  const stage1Dv = await page.getByTestId('build-stage-1').locator('.build-stage-dv').textContent();
  expect(parseFormattedNumber(stage1Dv ?? '')).toBeCloseTo(STAGE1_DV, 0);

  // Pre-launch checklist: an engine + a full two-stage stack should read nominal on COM and engine.
  await expect(page.getByTestId('build-lamp-engine')).toHaveAttribute('data-status', 'nominal');
  await expect(page.getByTestId('build-lamp-com')).toHaveAttribute('data-status', 'nominal');

  await page.screenshot({ path: 'tests/e2e/screenshots/build-hangar.png', fullPage: true });
});

test('save, reload the page, load — the blueprint is identical', async ({ page }) => {
  await page.goto('/?scene=build');
  await buildTwoStageRocket(page);

  const beforeParts = await page.getByTestId('build-readout-parts').locator('.build-readout-value').textContent();
  const beforeDv = await page.getByTestId('build-readout-dv').locator('.build-readout-value').textContent();
  const beforeMass = await page.getByTestId('build-readout-mass').locator('.build-readout-value').textContent();
  const beforeStage0Chips = await page.getByTestId('build-stage-0').locator('.build-stage-part-chip').allTextContents();
  const beforeStage1Chips = await page.getByTestId('build-stage-1').locator('.build-stage-part-chip').allTextContents();

  const blueprintName = 'e2e-two-stage';
  await page.getByTestId('build-blueprint-name').fill(blueprintName);
  await page.getByTestId('build-save').click();

  await page.reload();
  await expect(page.getByTestId('build-overlay')).toBeVisible();
  // A freshly reloaded hangar starts empty.
  await expect(page.getByTestId('build-readout-parts').locator('.build-readout-value')).toHaveText('0');

  await page.getByTestId('build-load-select').selectOption(blueprintName);
  await page.getByTestId('build-load').click();

  await expect(page.getByTestId('build-readout-parts').locator('.build-readout-value')).toHaveText(beforeParts ?? '');
  await expect(page.getByTestId('build-readout-dv').locator('.build-readout-value')).toHaveText(beforeDv ?? '');
  await expect(page.getByTestId('build-readout-mass').locator('.build-readout-value')).toHaveText(beforeMass ?? '');
  await expect(page.getByTestId('build-stage-0').locator('.build-stage-part-chip')).toHaveText(beforeStage0Chips);
  await expect(page.getByTestId('build-stage-1').locator('.build-stage-part-chip')).toHaveText(beforeStage1Chips);
});

test('radial symmetry 4 places four boosters as one live group, visible in the readout part count', async ({ page }) => {
  await page.goto('/?scene=build');
  await placeNext(page, 'tank_m1', 'tanks'); // root, so its radial node lands exactly at the recentred origin
  await page.getByTestId('build-symmetry-4').click();

  await page.getByTestId('build-catalog-tab-boosters').click();
  await page.getByTestId('build-catalog-item-srb_booster').click();
  const canvas = page.getByTestId('build-workspace-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('workspace canvas has no bounding box');
  // tank_m1 is the assembly root, placed at world origin; `recenterCamera`
  // parks the camera anchor on its *open top stack node* (world (0, 4.8) —
  // bounds.h), not its origin. Its radial node sits at local
  // (bounds.w/2, bounds.h/2) = (0.8, 2.4) m, i.e. (0.8, -2.4) relative to the
  // anchor. Convert with the hangar's base 26 px/m zoom; screen Y grows
  // downward while world Y grows upward, so a negative Y offset from anchor
  // lands *below* screen centre (PLAN.md §3.1).
  const px = box.x + box.width / 2 + 0.8 * 26;
  const py = box.y + box.height / 2 + 2.4 * 26;
  await page.mouse.move(px, py);
  await page.mouse.click(px, py);

  await expect(page.getByTestId('build-readout-parts').locator('.build-readout-value')).toHaveText('5');

  // Symmetry 1 collapses the group back down to a single booster ("live" rebuild — PLAN.md §7).
  await page.getByTestId('build-symmetry-1').click();
  await expect(page.getByTestId('build-readout-parts').locator('.build-readout-value')).toHaveText('2');
});
