import { expect, test } from '@playwright/test';

/**
 * PLAN.md §7 item 8: the game starts, the menu is visible, and a screenshot
 * is captured as visual proof (also serves as the acceptance-report artifact).
 */
test('game starts and shows the main menu', async ({ page }) => {
  await page.goto('/');

  const panel = page.getByTestId('menu-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('menu-title')).toHaveText('Kármán');

  // The floating-origin demo scene (a canvas) must also be present behind the menu.
  await expect(page.locator('#world-canvas')).toBeVisible();

  await page.screenshot({ path: 'tests/e2e/screenshots/menu.png' });
});

test('language switches without a reload', async ({ page }) => {
  await page.goto('/');

  const languageButton = page.getByTestId('menu-language');
  await expect(page.getByTestId('menu-new-flight')).toHaveText('Новый полёт');

  await languageButton.click();
  await expect(page.getByTestId('menu-new-flight')).toHaveText('New Flight');

  await languageButton.click();
  await expect(page.getByTestId('menu-new-flight')).toHaveText('Новый полёт');
});

test('theme toggles between dark and light', async ({ page }) => {
  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('menu-theme').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});
