import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the smoke suite (PLAN.md §7 item 8). Runs against the
 * production build via `vite preview`, matching the CI order
 * `pnpm build && pnpm e2e` — so the test proves the actual shipped bundle
 * starts, not just the dev server.
 *
 * Chromium is pre-installed in this environment
 * (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) — do not run `playwright
 * install`.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  outputDir: '../../test-results/e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @karman/app exec vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env['CI'],
    cwd: '../..',
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
