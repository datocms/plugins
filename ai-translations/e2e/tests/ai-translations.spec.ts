import { expect, test } from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { cmaClient } from './setup/cma';
import { TIMEOUTS } from './setup/constants';
import {
  assertLocalesPopulated,
  assertPlaceholdersSurviveAnyField,
  findRecord,
  loadManifest,
} from './steps/assert-record';
import { recordOutcome } from './setup/outcomes';
import { bulkPageUrl, runBulkTranslation } from './steps/bulk';
import { openRecord, saveRecord, translateRecordViaSidebar } from './steps/per-record';

/**
 * Provider-agnostic suite. Each Playwright project (openai/google/deepl/anthropic)
 * carries its own forked environment in `project.metadata`, so the same tests run
 * concurrently, one provider per environment. See the design doc for the matrix.
 */
const manifest = loadManifest();
const ARTICLE = manifest.schema.models.article.id;
const A1 = findRecord(manifest, 'article', ['en', 'it']); // kitchen sink
const A5 = findRecord(manifest, 'article', ['en', 'fr']); // placeholders + over-limit SEO

const meta = (): ProjectMeta => test.info().project.metadata as ProjectMeta;

/**
 * The per-record sidebar translates every field sequentially, one provider call
 * per field/segment. Free-tier chat keys (Gemini, and the free-plan Claude key)
 * rate-limit hard enough that a whole record exceeds any sane test budget, so
 * per-record is skipped for those vendors (still covered by openai + deepl; bulk
 * covers all of them). Supply a paid key and drop the vendor from this guard to
 * re-enable.
 */
const FREE_TIER_VENDORS = new Set<ProjectMeta['vendor']>(['google', 'anthropic']);

const skipPerRecordOnFreeTier = (): void =>
  test.skip(
    FREE_TIER_VENDORS.has(meta().vendor),
    'Free-tier Gemini/Claude rate limits make whole-record sidebar translation exceed the budget',
  );

test.describe('AI Translations', () => {
  // Record each test's outcome for the result-gated env teardown (the JSON
  // report isn't written until after globalTeardown runs).
  test.afterEach(({}, testInfo) => {
    const ok = testInfo.status === testInfo.expectedStatus || testInfo.status === 'skipped';
    recordOutcome(testInfo.project.name, ok);
  });

  test('per-record: sidebar translates a kitchen-sink record and saves', async ({ page }) => {
    skipPerRecordOnFreeTier();
    test.setTimeout(TIMEOUTS.twelve_min + TIMEOUTS.three_min);
    await openRecord(page, meta(), ARTICLE, A1.id);

    const run = await translateRecordViaSidebar(page, { fromLocale: 'en' });
    expect(run.completed, 'translation should complete').toBe(true);

    const save = await saveRecord(page);
    expect(save.status, `save should succeed (got ${save.status}: ${save.fieldErrors.join('; ')})`).toBe(200);

    // The sidebar translates among the record's active locales (en → it here).
    await assertLocalesPopulated(meta().envName, A1.id, ['it'], ['title', 'slug', 'excerpt']);
  });

  test('per-record: placeholder tokens survive, or a save error is surfaced (A5)', async ({ page }) => {
    skipPerRecordOnFreeTier();
    test.setTimeout(TIMEOUTS.twelve_min + TIMEOUTS.three_min);
    await openRecord(page, meta(), ARTICLE, A5.id);

    const run = await translateRecordViaSidebar(page, { fromLocale: 'en' });
    expect(run.completed, 'translation should complete').toBe(true);

    const save = await saveRecord(page);
    if (save.status === 200) {
      // Placeholders ({{…}}, {…}, %s, :slug) must survive into the target locale.
      await assertPlaceholdersSurviveAnyField(meta().envName, A5.id, 'en', ['fr']);
    } else {
      // Card objective #1: a field validation error on save must be surfaced to
      // the user, never silently dropped.
      expect(save.fieldErrors.length, 'a save validation error must be surfaced').toBeGreaterThan(0);
    }
  });

  test('bulk: produces a per-record outcome report across a model', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.five_min);
    await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const report = await runBulkTranslation(page, { modelCode: 'product', toLocale: 'es' });

    // The seed has three product records; every one must be accounted for in the
    // report (the card's "which records translated / warned / failed").
    expect(report.total, report.summary).toBe(3);
    expect(report.completed + report.withWarnings + report.errors, report.summary).toBe(3);

    // Every successfully-translated product must now have a Spanish name.
    if (report.completed + report.withWarnings > 0) {
      const products = await cmaClient(meta().envName).items.list({
        filter: { type: 'product' },
      });
      const withSpanish = products.filter((p) => {
        const name = p.name as Record<string, unknown> | undefined;
        return name && typeof name.es === 'string' && name.es.length > 0;
      });
      expect(withSpanish.length, 'at least one product should have an es name').toBeGreaterThan(0);
    }
  });
});
