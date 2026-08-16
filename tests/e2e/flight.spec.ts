import { expect, test } from '@playwright/test';
import { buildMinimalVesselAndLaunch, buildTwoStageVesselAndLaunch } from './helpers';

/**
 * PLAN.md §7 Agent D acceptance / §8 steps 2-5: the flight scene boots with
 * a real vessel just launched from the hangar, the HUD renders per
 * DESIGN.md §3 (throttle vertical gauge left, altitude/speed big displays
 * right, atmosphere/G-load top-left, status lamp row along the bottom), and
 * — the hard architectural rule — no panel ever covers the central 50% of
 * height / 40% of width, which DESIGN.md §3 reserves for the rocket.
 *
 * Reached through the real router (menu → hangar → launch) — the old
 * standalone `flight.html` page and its scripted-ascent fixture are gone;
 * see `packages/app/src/scenes/flight/flightClock.ts` for the real physics
 * loop this now drives.
 */

const VIEWPORT = { width: 1280, height: 800 };

test('flight scene boots: canvas and every HUD panel render', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);

  await expect(page.locator('#world-canvas')).toBeVisible();
  await expect(page.getByTestId('hud-atmo-panel')).toBeVisible();
  await expect(page.getByTestId('hud-throttle-panel')).toBeVisible();
  await expect(page.getByTestId('hud-altitude-panel')).toBeVisible();
  await expect(page.getByTestId('hud-speed-panel')).toBeVisible();
  await expect(page.getByTestId('hud-lamp-row')).toBeVisible();

  // Let a few physics ticks run so the readouts have real (non-placeholder) values.
  await page.waitForTimeout(300);
  await expect(page.getByTestId('hud-altitude-value')).not.toHaveText('');
  await expect(page.getByTestId('hud-speed-value')).not.toHaveText('');

  await page.screenshot({ path: 'tests/e2e/screenshots/flight-hud.png' });
});

test('no HUD panel overlaps the central 50%-height / 40%-width zone (DESIGN.md §3)', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);
  await page.waitForTimeout(200);

  const centerRect = {
    left: VIEWPORT.width * 0.3,
    right: VIEWPORT.width * 0.7,
    top: VIEWPORT.height * 0.25,
    bottom: VIEWPORT.height * 0.75,
  };

  const panelTestIds = [
    'hud-atmo-panel',
    'hud-throttle-panel',
    'hud-altitude-panel',
    'hud-speed-panel',
    'hud-lamp-row',
  ];

  for (const testId of panelTestIds) {
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

test('Z sets full throttle instantly, X cuts it to zero', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);

  await page.keyboard.press('z');
  await page.waitForTimeout(100);
  await expect(page.getByTestId('hud-throttle-value')).toHaveText('100%');

  await page.keyboard.press('x');
  await page.waitForTimeout(100);
  await expect(page.getByTestId('hud-throttle-value')).toHaveText('0%');
});

test('T toggles the SAS lamp', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);
  const sasLamp = page.getByTestId('hud-lamp-sas');
  await expect(sasLamp).toHaveAttribute('data-state', 'off');

  await page.keyboard.press('t');
  await page.waitForTimeout(100);
  await expect(sasLamp).toHaveAttribute('data-state', 'nominal');
});

test(',/. steps time warp, shown on the warp lamp', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);
  const warpValue = page.getByTestId('hud-warp-value');
  await expect(warpValue).toContainText('×1');

  await page.keyboard.press('.');
  await page.waitForTimeout(100);
  await expect(warpValue).toContainText('×2');

  await page.keyboard.press(',');
  await page.waitForTimeout(100);
  await expect(warpValue).toContainText('×1');
});

test('full throttle climbs off the pad — altitude and speed actually change', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildMinimalVesselAndLaunch(page);

  await page.keyboard.press('z');
  await page.waitForTimeout(2000);

  const altitudeText = await page.getByTestId('hud-altitude-value').textContent();
  expect(altitudeText).not.toBeNull();
  expect(altitudeText).not.toMatch(/^0/);
  const speedText = await page.getByTestId('hud-speed-value').textContent();
  expect(speedText).not.toBeNull();
});

test('Space stages the two-stage rocket built in the hangar', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await buildTwoStageVesselAndLaunch(page);
  await expect(page.getByTestId('hud-stage-value')).toContainText('1/2');

  await page.keyboard.press('z');
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');

  // Separation (PLAN.md §3.4) hands the spent first stage off entirely —
  // `splitVessel` re-indexes each resulting piece's own stages from zero, so
  // the continuing (upper) vessel now legitimately has exactly one stage
  // left, not a stale "stage 2 of the original 2".
  await expect(page.getByTestId('hud-stage-value')).toContainText('1/1');
});
