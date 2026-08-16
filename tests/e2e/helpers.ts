import { expect, type Page } from '@playwright/test';

/**
 * Shared E2E helpers (PLAN.md §7 stage-2 integration): every scene test now
 * goes through the real menu → hangar → launch → flight pipeline (the old
 * `?scene=build` / standalone `flight.html`/`map.html` seams are gone — see
 * `packages/app/src/main.ts`'s router), so assembling-and-launching a vessel
 * is common enough to factor out.
 */

/** Clicks a catalog item, then clicks dead-centre of the workspace canvas — the hangar recentres its camera on the stack's newest open node after every commit, so centre is always the correct attach point when building straight up. */
export async function placePart(page: Page, partId: string, category: string): Promise<void> {
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

/** Opens the hangar from the menu (PLAN.md §8 step 2). */
export async function gotoHangar(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-hangar').click();
  await expect(page.getByTestId('build-overlay')).toBeVisible();
}

/**
 * Builds the smallest launch-worthy vessel that can actually fly (an engine,
 * a fuel tank, a pod) and launches it — the fastest path to a flying vessel
 * for tests that don't care which rocket it is. `engine_launch` alone has no
 * `resources` of its own (PLAN.md §6.1: fuel lives in tanks, not engines), so
 * an engine-plus-pod vessel is launch-*legal* but carries zero propellant —
 * `pnpm e2e`'s own "full throttle climbs off the pad" test caught this: full
 * throttle produced zero actual thrust (`burnEngines` has nothing to draw
 * from) and the vessel just sat there. A tank in between gives it something
 * to burn.
 */
export async function buildMinimalVesselAndLaunch(page: Page): Promise<void> {
  await gotoHangar(page);
  await placePart(page, 'engine_launch', 'engines');
  await placePart(page, 'tank_s1', 'tanks');
  await placePart(page, 'pod_command', 'pod');
  await expect(page.getByTestId('build-launch')).toBeEnabled();
  await page.getByTestId('build-launch').click();
  await expect(page.getByTestId('flight-hud')).toBeVisible();
}

/** Builds the same two-stage rocket `build.spec.ts` verifies the ΔV readout for, and launches it. */
export async function buildTwoStageVesselAndLaunch(page: Page): Promise<void> {
  await gotoHangar(page);
  await placePart(page, 'engine_launch', 'engines');
  await placePart(page, 'tank_s1', 'tanks');
  await placePart(page, 'separator_stack', 'separators');
  await placePart(page, 'engine_vacuum', 'engines');
  await placePart(page, 'tank_m1', 'tanks');
  await placePart(page, 'pod_command', 'pod');
  await expect(page.getByTestId('build-launch')).toBeEnabled();
  await page.getByTestId('build-launch').click();
  await expect(page.getByTestId('flight-hud')).toBeVisible();
}
