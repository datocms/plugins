import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the AI Translations E2E suite.
 *
 * Specs live in `e2e/tests/`; the `e2e/seed/` scripts build the fixture project
 * (DatoCMS site "AI Translation E2E", id 219952) the specs run against.
 *
 * Kept directory-scoped so it never overlaps with Vitest, which is restricted to
 * `src/**` in vitest.config.ts. Run with `npx playwright test` (deps + npm
 * scripts are added separately).
 */
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: './test-results',
  use: {
    trace: 'on-first-retry',
    // baseURL: 'https://<your-project>.admin.datocms.com', // set when specs drive the DatoCMS UI
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
