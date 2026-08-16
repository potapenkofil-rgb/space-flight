import { expect, test, type Page } from '@playwright/test';

/**
 * PLAN.md §7 Agent D acceptance: the flight scene boots, the HUD renders per
 * DESIGN.md §3 (throttle vertical gauge left, altitude/speed big displays
 * right, atmosphere/G-load top-left, status lamp row along the bottom), and
 * — the hard architectural rule — no panel ever covers the central 50% of
 * height / 40% of width, which DESIGN.md §3 reserves for the rocket.
 *
 * Reaches the scene via `flight.html` directly (see `vite.config.ts`'s
 * multi-page build and the Agent D report) rather than through the menu,
 * since menu → scene routing isn't wired yet.
 */

const VIEWPORT = { width: 1280, height: 800 };

async function gotoFlight(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/flight.html');
  await expect(page.getByTestId('flight-hud')).toBeVisible();
}

test('flight scene boots: canvas and every HUD panel render', async ({ page }) => {
  await gotoFlight(page);

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
  await gotoFlight(page);
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
  await gotoFlight(page);

  await page.keyboard.press('z');
  await page.waitForTimeout(100);
  await expect(page.getByTestId('hud-throttle-value')).toHaveText('100%');

  await page.keyboard.press('x');
  await page.waitForTimeout(100);
  await expect(page.getByTestId('hud-throttle-value')).toHaveText('0%');
});

test('T toggles the SAS lamp', async ({ page }) => {
  await gotoFlight(page);
  const sasLamp = page.getByTestId('hud-lamp-sas');
  await expect(sasLamp).toHaveAttribute('data-state', 'off');

  await page.keyboard.press('t');
  await page.waitForTimeout(100);
  await expect(sasLamp).toHaveAttribute('data-state', 'nominal');
});

test(',/. steps time warp, shown on the warp lamp', async ({ page }) => {
  await gotoFlight(page);
  const warpValue = page.getByTestId('hud-warp-value');
  await expect(warpValue).toContainText('×1');

  await page.keyboard.press('.');
  await page.waitForTimeout(100);
  await expect(warpValue).toContainText('×2');

  await page.keyboard.press(',');
  await page.waitForTimeout(100);
  await expect(warpValue).toContainText('×1');
});

test('ascent, staging and warp-to-orbit all drive the HUD end to end', async ({ page }) => {
  await gotoFlight(page);

  // Warp to 10x (always permitted, PLAN.md §3.3) and hold full throttle so the
  // scripted ascent reaches its staging event (t=65s sim time) quickly.
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await expect(page.getByTestId('hud-warp-value')).toContainText('×10');
  await page.keyboard.press('z');

  await expect(page.getByTestId('hud-stage-value')).toContainText('2/2', { timeout: 15_000 });

  // Altitude should be climbing well off the pad by now.
  const altitudeText = await page.getByTestId('hud-altitude-value').textContent();
  expect(altitudeText).not.toMatch(/^0/);
});
