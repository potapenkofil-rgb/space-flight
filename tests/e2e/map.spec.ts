import { expect, test, type Page } from '@playwright/test';

/**
 * PLAN.md §7 Agent D acceptance: the map scene boots, orbit/apsis/SOI
 * drawing happens (visually verified via the attached screenshots — see the
 * Agent D report), focus switches between bodies/vessels, and a maneuver
 * node can be created by clicking the orbit and dragged along
 * prograde/radial (DESIGN.md §5).
 *
 * The click/drag coordinates below are derived from the same formulas
 * `MapScene.ts`/`fixtures/{bodies,vessels}.ts` use (Terra radius
 * 1,000,000 m, the default focus vessel's 1,100,000 m circular orbit,
 * `fitCameraToBody`'s framing) — see the comments inline. If those fixture
 * constants ever change, these coordinates need to move with them.
 */

const VIEWPORT = { width: 1280, height: 800 };

// -- Mirrors scenes/map/fixtures/{bodies,vessels}.ts and MapScene.ts's fitCameraToBody --
const TERRA_RADIUS = 1_000_000;
const ORBIT_A = 1_100_000; // TERRA_RADIUS + 100_000, PLAN.md §5.7 circular parking orbit
const EXTENT_M = Math.max(TERRA_RADIUS * 2.4, ORBIT_A * 2.4);
const PPM = Math.min(VIEWPORT.width, VIEWPORT.height) / EXTENT_M;
const NODE_SCREEN = { x: ORBIT_A * PPM + VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const HANDLE_BASE_OFFSET_PX = 34; // MapScene.ts's HANDLE_BASE_OFFSET_PX
const PROGRADE_HANDLE = { x: NODE_SCREEN.x, y: NODE_SCREEN.y - HANDLE_BASE_OFFSET_PX };

async function gotoMap(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/map.html');
  await expect(page.getByTestId('map-ui')).toBeVisible();
}

test('map scene boots: canvas, focus panel and hint row render', async ({ page }) => {
  await gotoMap(page);

  await expect(page.locator('#world-canvas')).toBeVisible();
  await expect(page.getByTestId('map-focus-panel')).toBeVisible();
  await expect(page.getByTestId('map-hint-row')).toBeVisible();
  // No maneuver node yet: the node readout panel stays hidden.
  await expect(page.getByTestId('map-node-panel')).toBeHidden();

  await page.screenshot({ path: 'tests/e2e/screenshots/map.png' });
});

test('no map panel overlaps the central 50%-height / 40%-width zone (DESIGN.md §3)', async ({ page }) => {
  await gotoMap(page);

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

test('switching focus body/vessel updates the active button', async ({ page }) => {
  await gotoMap(page);

  const stationButton = page.getByTestId('map-focus-vessel-1');
  const probeButton = page.getByTestId('map-focus-vessel-2');
  await expect(stationButton).toHaveAttribute('data-active', 'true');
  await expect(probeButton).toHaveAttribute('data-active', 'false');

  await probeButton.click();
  await expect(probeButton).toHaveAttribute('data-active', 'true');
  await expect(stationButton).toHaveAttribute('data-active', 'false');

  const lunaButton = page.getByTestId('map-focus-body-luna');
  await lunaButton.click();
  await expect(lunaButton).toHaveAttribute('data-active', 'true');
});

test('clicking the orbit places a maneuver node, dragging prograde changes delta-v and the result orbit', async ({
  page,
}) => {
  await gotoMap(page);

  // Click on the current (circular, 100 km) orbit's rightmost point.
  await page.mouse.click(NODE_SCREEN.x, NODE_SCREEN.y);
  await expect(page.getByTestId('map-node-panel')).toBeVisible();

  const deltaVBefore = await page.getByTestId('map-node-delta-v').textContent();
  const resultBefore = await page.getByTestId('map-node-result').textContent();

  await page.screenshot({ path: 'tests/e2e/screenshots/map-node-created.png' });

  // Drag the prograde handle "up" (away from the node along the prograde direction)
  // to add a prograde burn, which should raise the apoapsis of the result orbit.
  await page.mouse.move(PROGRADE_HANDLE.x, PROGRADE_HANDLE.y);
  await page.mouse.down();
  await page.mouse.move(PROGRADE_HANDLE.x, PROGRADE_HANDLE.y - 150, { steps: 12 });
  await page.mouse.up();

  const deltaVAfter = await page.getByTestId('map-node-delta-v').textContent();
  const resultAfter = await page.getByTestId('map-node-result').textContent();

  expect(deltaVAfter).not.toBe(deltaVBefore);
  expect(resultAfter).not.toBe(resultBefore);

  await page.screenshot({ path: 'tests/e2e/screenshots/map-node-dragged.png' });

  // Deleting the node hides the panel again.
  await page.getByTestId('map-node-delete').click();
  await expect(page.getByTestId('map-node-panel')).toBeHidden();
});

test('M switches between the flight and map scenes', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/flight.html');
  await expect(page.getByTestId('flight-hud')).toBeVisible();

  await page.keyboard.press('m');
  await expect(page.getByTestId('map-ui')).toBeVisible();

  await page.keyboard.press('m');
  await expect(page.getByTestId('flight-hud')).toBeVisible();
});
