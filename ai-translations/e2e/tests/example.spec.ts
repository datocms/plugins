import { test, expect } from '@playwright/test';

/**
 * Placeholder spec — the real suite is not implemented yet.
 *
 * It will drive the AI Translations plugin against the seeded "AI Translation
 * E2E" project, iterating ../seed/seed-manifest.json: for each record, translate
 * its source locale(s) into the empty target locales and assert the result
 * (placeholder survival, block structure preserved, QC/length checks, etc.).
 *
 * Skipped so the suite is green before @playwright/test is installed and the
 * runner is built.
 */
test.describe('AI Translations E2E', () => {
  test.skip('translates seeded records into empty target locales', async () => {
    expect(true).toBe(true);
  });
});
