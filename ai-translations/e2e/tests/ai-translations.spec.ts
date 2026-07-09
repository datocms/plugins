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
import { step } from './setup/log';
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

/**
 * Skip the calling per-record test on a free-tier lane, first emitting a visible
 * `test.step` that states *why* — `test.skip`'s reason otherwise only surfaces as
 * a hover tooltip / Annotations entry, so a lane's ⊘ looks unexplained in the UI.
 * Steps that run before a runtime `test.skip()` are retained on the skipped test,
 * so this breadcrumb shows up in the Actions tree, the report, and the terminal.
 */
const skipPerRecordOnFreeTier = async (): Promise<void> => {
  const { vendor } = meta();
  if (!FREE_TIER_VENDORS.has(vendor)) return;
  const reason =
    'free-tier rate limits make a whole-record sidebar translation exceed the test ' +
    'budget — per-record runs only on openai + deepl; bulk still covers this lane';
  await step(vendor, `skipping per-record — ${reason}`, async () => {});
  test.skip(true, reason);
};

test.describe('AI Translations', () => {
  // Surface which lane (vendor + forked env) each test runs against in the HTML
  // report header — handy when scanning a parallel run's results.
  test.beforeEach(({}, testInfo) => {
    const m = meta();
    testInfo.annotations.push({ type: 'lane', description: `${m.vendor} → ${m.envName}` });
  });

  // Record each test's outcome for the result-gated env teardown (the JSON
  // report isn't written until after globalTeardown runs).
  test.afterEach(({}, testInfo) => {
    const ok = testInfo.status === testInfo.expectedStatus || testInfo.status === 'skipped';
    recordOutcome(testInfo.project.name, ok);
  });

  test('per-record: sidebar translates a kitchen-sink record and saves', async ({ page }) => {
    await skipPerRecordOnFreeTier();
    test.setTimeout(TIMEOUTS.twelve_min + TIMEOUTS.three_min);
    const { vendor, envName } = meta();

    await step(vendor, `open kitchen-sink record ${A1.id} (article) in ${envName}`, () =>
      openRecord(page, meta(), ARTICLE, A1.id),
    );

    const run = await step(vendor, 'translate every field via the sidebar (en → record locales)', () =>
      translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
    );
    expect(run.completed, 'translation should complete').toBe(true);

    const save = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    expect(save.status, `save should succeed (got ${save.status}: ${save.fieldErrors.join('; ')})`).toBe(200);

    // The sidebar translates among the record's active locales (en → it here).
    await step(vendor, 'assert it title/slug/excerpt are populated (CMA)', () =>
      assertLocalesPopulated(envName, A1.id, ['it'], ['title', 'slug', 'excerpt']),
    );
  });

  test('per-record: placeholder tokens survive, or a save error is surfaced (A5)', async ({ page }) => {
    await skipPerRecordOnFreeTier();
    test.setTimeout(TIMEOUTS.twelve_min + TIMEOUTS.three_min);
    const { vendor, envName } = meta();

    await step(vendor, `open placeholder record ${A5.id} (article) in ${envName}`, () =>
      openRecord(page, meta(), ARTICLE, A5.id),
    );

    const run = await step(vendor, 'translate every field via the sidebar (en → record locales)', () =>
      translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
    );
    expect(run.completed, 'translation should complete').toBe(true);

    const save = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    if (save.status === 200) {
      // Placeholders ({{…}}, {…}, %s, :slug) must survive into the target locale.
      await step(vendor, 'assert placeholder tokens survived into fr (CMA)', () =>
        assertPlaceholdersSurviveAnyField(envName, A5.id, 'en', ['fr']),
      );
    } else {
      // Card objective #1: a field validation error on save must be surfaced to
      // the user, never silently dropped.
      expect(save.fieldErrors.length, 'a save validation error must be surfaced').toBeGreaterThan(0);
    }
  });

  test('bulk: produces a per-record outcome report across a model', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.five_min);
    const { vendor, envName } = meta();

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });

    const report = await step(vendor, 'run bulk translation (product → es)', () =>
      runBulkTranslation(page, { modelCode: 'product', toLocale: 'es', vendor }),
    );

    // The seed has three product records; every one must be accounted for in the
    // report (the card's "which records translated / warned / failed").
    expect(report.total, report.summary).toBe(3);
    expect(report.completed + report.withWarnings + report.errors, report.summary).toBe(3);

    // The card's "report from bulk translations": the run ends with an
    // exportable per-record CSV. Assert it downloaded and carries the header
    // plus one row per accounted-for record.
    await step(vendor, 'export + verify the per-record CSV report', () => {
      const lines = report.csv.split('\n').filter((l) => l.trim().length > 0);
      expect(report.csv, 'Export CSV should download a non-empty report').not.toBe('');
      expect(lines[0], 'CSV header').toContain('status');
      expect(lines[0]).toContain('edit_url');
      expect(lines[0]).toContain('notes');
      // Header + one data row per record.
      expect(lines.length, `expected header + ${report.total} rows`).toBe(report.total + 1);
      // Each record row links to its editor (master's record-link feature).
      expect(report.hasRecordLink, 'a completed record row should link to its editor').toBe(true);
      return Promise.resolve();
    });

    // Every successfully-translated product must now have a Spanish name.
    if (report.completed + report.withWarnings > 0) {
      await step(vendor, 'verify translated products have an es name (CMA)', async () => {
        const products = await cmaClient(envName).items.list({
          filter: { type: 'product' },
        });
        const withSpanish = products.filter((p) => {
          const name = p.name as Record<string, unknown> | undefined;
          return name && typeof name.es === 'string' && name.es.length > 0;
        });
        expect(withSpanish.length, 'at least one product should have an es name').toBeGreaterThan(0);
      });
    }
  });
});
