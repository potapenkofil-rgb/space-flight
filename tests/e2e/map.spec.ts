import { expect, test, type Page } from '@playwright/test';
import { buildMinimalVesselAndLaunch } from './helpers';

/**
 * PLAN.md §7 Agent D acceptance / §8 steps 5-6: the map scene boots with the
 * real vessel just launched from the hangar, orbit/apsis/SOI drawing
 * happens (visually verified via the attached screenshots), focus switches
 * between bodies/vessels, and a maneuver node can be created by clicking the
 * orbit (DESIGN.md §5).
 *
 * Reached through the real router (menu → hangar → launch → flight → `M`)
 * — the old standalone `map.html` page and its fixed-orbit fixtures are
 * gone; the vessel's orbit is now real, physics-derived and not knowable in
 * closed form ahead of time, so the orbit-click test below searches a grid
 * of screen points for one that lands on the real orbit instead of the
 * previous fixture's hand-derived exact pixel coordinates.
 */

const VIEWPORT = { width: 1280, height: 800 };

async function gotoMapFromFlight(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);
  await page.keyboard.press('m');
  await expect(page.getByTestId('map-ui')).toBeVisible();
}

/** Clicks a grid of screen points around the focus body until one lands on the current orbit (within `MapScene.ts`'s own hit-test tolerance) and a maneuver node appears. */
async function placeNodeOnOrbit(page: Page): Promise<void> {
  const canvas = page.locator('#world-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('world canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const maxR = Math.min(box.width, box.height) / 2;
  const radiusFractions = [0.04, 0.08, 0.12, 0.18, 0.25, 0.35, 0.45, 0.6, 0.75, 0.9];
  const angleSteps = 20;

  for (const rf of radiusFractions) {
    const r = rf * maxR;
    for (let i = 0; i < angleSteps; i++) {
      const angle = (i / angleSteps) * Math.PI * 2;
      await page.mouse.click(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      if (await page.getByTestId('map-node-panel').isVisible()) return;
    }
  }
  throw new Error('grid search never landed a click on the vessel orbit');
}

test('map scene boots: canvas, focus panel and hint row render', async ({ page }) => {
  await gotoMapFromFlight(page);

  await expect(page.locator('#world-canvas')).toBeVisible();
  await expect(page.getByTestId('map-focus-panel')).toBeVisible();
  await expect(page.getByTestId('map-hint-row')).toBeVisible();
  // No maneuver node yet: the node readout panel stays hidden.
  await expect(page.getByTestId('map-node-panel')).toBeHidden();

  await page.screenshot({ path: 'tests/e2e/screenshots/map.png' });
});

test('no map panel overlaps the central 50%-height / 40%-width zone (DESIGN.md §3)', async ({ page }) => {
  await gotoMapFromFlight(page);

  const centerRect = {
    left: VIEWPORT.width * 0.3,
    right: VIEWPORT.width * 0.7,
    top: VIEWPORT.height * 0.25,
    bottom: VIEWPORT.height * 0.75,
  };

  for (const testId of ['map-focus-panel', 'map-hint-row']) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, `${testId} should have a bounding box`).not.toBeNull();
    if (!box) continue;
    const panelRect = { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
    const intersects =
      panelRect.left < centerRect.right &&
      panelRect.right > centerRect.left &&
      panelRect.top < centerRect.bottom &&
      panelRect.bottom > centerRect.top;
    expect(intersects, `${testId} must not overlap the central 50%h/40%w zone`).toBe(false);
  }
});

test('switching focus body updates the active button, real Terra/Luna from the loaded system', async ({ page }) => {
  await gotoMapFromFlight(page);

  const terraButton = page.getByTestId('map-focus-body-terra');
  const lunaButton = page.getByTestId('map-focus-body-luna');
  await expect(terraButton).toHaveAttribute('data-active', 'true');
  await expect(lunaButton).toHaveAttribute('data-active', 'false');

  await lunaButton.click();
  await expect(lunaButton).toHaveAttribute('data-active', 'true');
  await expect(terraButton).toHaveAttribute('data-active', 'false');

  // The just-launched vessel is the only one in the registry.
  await expect(page.getByTestId('map-focus-vessel-1')).toBeVisible();
});

test('clicking the orbit places a maneuver node with a real ΔV/time-to readout, delete removes it', async ({ page }) => {
  await gotoMapFromFlight(page);

  await placeNodeOnOrbit(page);
  await expect(page.getByTestId('map-node-panel')).toBeVisible();

  // Freshly placed (zero delta-v): a real, finite time-to and burn-time, and a "0" delta-v.
  const timeToText = await page.getByTestId('map-node-time-to').textContent();
  expect(timeToText).not.toBeNull();
  const deltaVText = await page.getByTestId('map-node-delta-v').textContent();
  expect(deltaVText).not.toBeNull();

  await page.screenshot({ path: 'tests/e2e/screenshots/map-node-created.png' });

  await page.getByTestId('map-node-delete').click();
  await expect(page.getByTestId('map-node-panel')).toBeHidden();
});

test('executing a maneuver node applies it and returns to flight cleanly (PLAN.md §8 step 7)', async ({ page }) => {
  await gotoMapFromFlight(page);

  await placeNodeOnOrbit(page);
  await expect(page.getByTestId('map-node-panel')).toBeVisible();

  await page.getByTestId('map-node-execute').click();
  // Executing consumes the node — the readout panel hides again.
  await expect(page.getByTestId('map-node-panel')).toBeHidden();

  // The vessel is still there and flyable afterward.
  await page.keyboard.press('m');
  await expect(page.getByTestId('flight-hud')).toBeVisible();
});

test('M switches between the flight and map scenes', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);
  await expect(page.getByTestId('flight-hud')).toBeVisible();

  await page.keyboard.press('m');
  await expect(page.getByTestId('map-ui')).toBeVisible();

  await page.keyboard.press('m');
  await expect(page.getByTestId('flight-hud')).toBeVisible();
});

test('Escape returns to the menu from flight and from the map', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-panel')).toBeVisible();
});
