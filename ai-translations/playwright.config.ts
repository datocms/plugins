import { defineConfig, devices } from '@playwright/test';
import { TIMEOUTS } from './e2e/tests/setup/constants';
import { requireEnv } from './e2e/tests/setup/env';
import { PROVIDERS } from './e2e/tests/fixtures/providers';

// Fail fast on a misconfigured environment before launching anything.
requireEnv();

/**
 * Browser-driven E2E for the AI Translations plugin. Three projects — one per
 * provider — run fully in parallel (`workers: 3`), each against its own
 * fast-forked sandbox environment provisioned in `global-setup`. Specs live in
 * `e2e/tests/`; `e2e/seed/` builds the fixture project the forks are taken from.
 * See docs/superpowers/specs/2026-06-24-ai-translations-e2e-design.md.
 *
 * Directory-scoped so it never overlaps with Vitest (restricted to `src/**`).
 */
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/tests/setup/global-setup.ts',
  globalTeardown: './e2e/tests/setup/global-teardown.ts',
  workers: 3,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/playwright-report', open: 'never' }],
    ['json', { outputFile: 'e2e/test-results/results.json' }],
  ],
  outputDir: './e2e/test-results',
  expect: { timeout: TIMEOUTS.thirty_sec },
  use: {
    actionTimeout: TIMEOUTS.thirty_sec,
    navigationTimeout: TIMEOUTS.thirty_sec,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: 'e2e/.auth/state.json',
  },
  // The dev-URL plugin must be live during the run.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: TIMEOUTS.three_min,
  },
  projects: PROVIDERS.map((provider) => ({
    name: provider.vendor,
    use: {
      ...devices['Desktop Chrome'],
      metadata: { vendor: provider.vendor, envName: provider.envName },
    },
  })),
});
