import { expect, test } from '@playwright/test';
import { gotoHangar, placePart } from './helpers';

/**
 * Hangar acceptance scenario (PLAN.md §7, Agent C's zone / PLAN.md §8 step 2):
 * assemble a two-stage rocket by clicking, verify the ΔV readout, save,
 * reload the page, load — the blueprint comes back identical.
 *
 * Reached through the real menu → hangar route (`packages/app/src/main.ts`'s
 * router) — the temporary `?scene=build` seam is gone.
 *
 * Numbers below mirror the real 25-part v1 roster in `data/parts/*` and the
 * real `computeMass`/`computeDeltaV` in `@karman/core` — this file used to
 * mirror a local fixture roster (`__fixtures__/parts.ts` + a simplified
 * per-stage ΔV fake), both now deleted (PLAN.md §7 stage-2 integration:
 * "swap in the real physics once it lands").
 */

const G0 = 9.806_65;

// Mirrors data/parts/{engine_launch,tank_s1,separator_stack,engine_vacuum,tank_m1,pod_command}/part.json.
const ENGINE_LAUNCH = { dryMass: 1450, ispSl: 255 };
const TANK_S1 = { dryMass: 300, fuel: 2700 };
const SEPARATOR = { dryMass: 40 };
const ENGINE_VACUUM = { dryMass: 470, ispSl: 208 };
const TANK_M1 = { dryMass: 600, fuel: 5400 };
const POD = { dryMass: 950, electricity: 50 };

// Mirrors @karman/core's real computeDeltaV (PLAN.md §5.3/§5.4): stage 0 is
// everything up to and including the first separator (engine_launch draws
// only from tank_s1 — tank_s1's own crossfeed lets the search continue, but
// separator_stack's crossfeed:false blocks it from reaching further up);
// stage 1 is what remains once the separator's own component — and
// everything below it — drops away (engine_vacuum draws only from tank_m1,
// pod_command carries electricity, not fuel, so it never contributes burned mass).
const STAGE0_START =
  ENGINE_LAUNCH.dryMass + TANK_S1.dryMass + TANK_S1.fuel + SEPARATOR.dryMass + ENGINE_VACUUM.dryMass + TANK_M1.dryMass + TANK_M1.fuel + POD.dryMass + POD.electricity;
const STAGE0_END = STAGE0_START - TANK_S1.fuel;
const STAGE0_DV = ENGINE_LAUNCH.ispSl * G0 * Math.log(STAGE0_START / STAGE0_END);

const STAGE1_START = ENGINE_VACUUM.dryMass + TANK_M1.dryMass + TANK_M1.fuel + POD.dryMass + POD.electricity;
const STAGE1_END = STAGE1_START - TANK_M1.fuel;
const STAGE1_DV = ENGINE_VACUUM.ispSl * G0 * Math.log(STAGE1_START / STAGE1_END);

const TOTAL_DV = STAGE0_DV + STAGE1_DV;

/** Parses a Cascadia-Mono-formatted "3 442" (thin-space grouped) number back into a plain JS number. */
function parseFormattedNumber(text: string): number {
  const cleaned = text.replace(/[^\d,.\-−]/g, '').replace('−', '-').replace(',', '.');
  return Number.parseFloat(cleaned);
}


async function buildTwoStageRocket(page: Page): Promise<void> {
  await placePart(page, 'engine_launch', 'engines'); // root
  await placePart(page, 'tank_s1', 'tanks');
  await placePart(page, 'separator_stack', 'separators');
  await placePart(page, 'engine_vacuum', 'engines');
  await placePart(page, 'tank_m1', 'tanks');
  await placePart(page, 'pod_command', 'pod');
}

test('assemble a two-stage rocket by clicking, ΔV readout matches the rocket equation', async ({ page }) => {
  await gotoHangar(page);

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
  await expect(page.getByTestId('build-launch')).toBeEnabled();

  await page.screenshot({ path: 'tests/e2e/screenshots/build-hangar.png', fullPage: true });
});

test('save, reload the page, load — the blueprint is identical', async ({ page }) => {
  await gotoHangar(page);
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

test('radial symmetry 4 places four sets of legs as one live group, visible in the readout part count', async ({ page }) => {
  await gotoHangar(page);
  await placePart(page, 'tank_m1', 'tanks'); // root, so its radial node lands exactly at the recentred origin
  await page.getByTestId('build-symmetry-4').click();

  await page.getByTestId('build-catalog-tab-legs').click();
  await page.getByTestId('build-catalog-item-legs_heavy').click();
  const canvas = page.getByTestId('build-workspace-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('workspace canvas has no bounding box');
  // tank_m1 is the assembly root, placed at world origin; `recenterCamera`
  // parks the camera anchor on its *open top stack node* (world (0, 6) —
  // bounds.h), not its origin. Its radial node sits at local (0.8, 3) m,
  // i.e. (0.8, -3) relative to the anchor. Convert with the hangar's base
  // 26 px/m zoom; screen Y grows downward while world Y grows upward, so a
  // negative Y offset from anchor lands *below* screen centre (PLAN.md §3.1).
  const px = box.x + box.width / 2 + 0.8 * 26;
  const py = box.y + box.height / 2 + 3 * 26;
  await page.mouse.move(px, py);
  await page.mouse.click(px, py);

  await expect(page.getByTestId('build-readout-parts').locator('.build-readout-value')).toHaveText('5');

  // Symmetry 1 collapses the group back down to a single leg ("live" rebuild — PLAN.md §7).
  await page.getByTestId('build-symmetry-1').click();
  await expect(page.getByTestId('build-readout-parts').locator('.build-readout-value')).toHaveText('2');
});
