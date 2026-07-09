import { expect, test } from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { cmaClient } from './setup/cma';
import { TIMEOUTS } from './setup/constants';
import {
  assertFieldsUnchanged,
  assertLocalesPopulated,
  assertPlaceholdersSurviveAnyField,
  findRecord,
  loadManifest,
  snapshotFields,
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
const CATALOG = manifest.schema.models.catalog_entry.id;
const A1 = findRecord(manifest, 'article', ['en', 'it']); // kitchen sink
const A5 = findRecord(manifest, 'article', ['en', 'fr']); // placeholders + over-limit SEO
const A6 = findRecord(manifest, 'article', ['ar', 'zh-Hans']); // non-Latin/RTL/CJK source
const A7 = findRecord(manifest, 'article', ['en', 'ru']); // pre-filled ru target + JSON placeholders

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

    // Negative coverage: non-localized / numeric fields must be left byte-for-byte
    // untouched by translation. Snapshot before, compare after the save.
    const NON_LOCALIZED = ['author_name', 'view_count', 'is_premium'];
    const before = await step(vendor, 'snapshot non-localized/numeric fields', () =>
      snapshotFields(envName, A1.id, NON_LOCALIZED),
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

    await step(vendor, 'assert non-localized/numeric fields were left untouched (CMA)', () =>
      assertFieldsUnchanged(envName, A1.id, before),
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

  test('per-record: translates from a non-Latin (CJK) source and surfaces an untranslatable slug', async ({ page }) => {
    const { vendor, envName } = meta();
    // Translating FROM a hyphenated CJK source (zh-Hans) exercises the non-Latin
    // source path. Run on DeepL (solid CJK support, deterministic).
    test.skip(vendor !== 'deepl', 'non-Latin-source check runs on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);

    await step(vendor, `open non-Latin record ${A6.id} (article, ar+zh-Hans source, en empty)`, () =>
      openRecord(page, meta(), ARTICLE, A6.id),
    );

    const run = await step(vendor, 'translate from zh-Hans via the sidebar (hyphenated CJK source)', () =>
      translateRecordViaSidebar(page, { fromLocale: 'zh-Hans', vendor }),
    );
    // Must FINISH (not hang): a non-Latin slug can't be normalized to a valid
    // webpage-slug, so that one field fails — but the run must still settle and
    // surface it, never blocking on the missing success banner.
    expect(run.completed, 'translation from a non-Latin source should finish (not hang)').toBe(true);
    expect(
      run.toasts.join(' | '),
      `expected the untranslatable slug to be surfaced, got:\n${run.toasts.join('\n') || '(none)'}`,
    ).toMatch(/failed to translate|slug|normaliz/i);

    // The translatable text DID come across from the CJK source: the other active
    // locale (ar) still carries content (the slug kept its prior valid value, so
    // the save succeeds).
    const save = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    if (save.status === 200) {
      await step(vendor, 'assert ar title/excerpt populated from the CJK source (CMA)', () =>
        assertLocalesPopulated(envName, A6.id, ['ar'], ['title', 'excerpt']),
      );
    } else {
      expect(save.fieldErrors.length, 'a save error must be surfaced').toBeGreaterThan(0);
    }
  });

  test('per-record: translates into a pre-filled target locale and preserves JSON placeholders (A7)', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'pre-filled-target check runs on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);

    await step(vendor, `open pre-filled-target record ${A7.id} (article, en + partial ru)`, () =>
      openRecord(page, meta(), ARTICLE, A7.id),
    );

    const run = await step(vendor, 'translate en → ru via the sidebar (ru title/seo already pre-filled)', () =>
      translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
    );
    expect(run.completed, 'translation into a pre-filled target locale should finish').toBe(true);

    const save = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    if (save.status === 200) {
      await step(vendor, 'assert ru title + JSON populated and placeholders survived (CMA)', async () => {
        // Overwrite branch: the previously-empty ru JSON field is now populated and
        // the pre-filled ru title was (re)written from the en source.
        await assertLocalesPopulated(envName, A7.id, ['ru'], ['title', 'featured_data']);
        // The placeholder tokens ({{nights}}, {{brand}}, %s, :slug) in the JSON
        // field must survive translation into the Cyrillic target.
        await assertPlaceholdersSurviveAnyField(envName, A7.id, 'en', ['ru']);
      });
    } else {
      expect(save.fieldErrors.length, 'a save error must be surfaced').toBeGreaterThan(0);
    }
  });

  test('per-record: an over-limit translation surfaces a length alert (catalog badge)', async ({ page }) => {
    const { vendor, envName } = meta();
    // The schema length check is provider-independent; assert the translate-time
    // surfacing once on the deterministic DeepL lane (the `badge` field's tiny
    // limit is overflowed by any real translation).
    test.skip(
      vendor !== 'deepl',
      'schema length check is provider-independent — asserted on the DeepL lane',
    );
    test.setTimeout(TIMEOUTS.five_min);

    // The `catalog_entry` record carrying a `badge` (C3) — the only one seeded
    // with a value that overflows the limit on translation.
    const badgeEntry = await step(vendor, 'find the catalog entry with a badge', async () => {
      const entries = await cmaClient(envName).items.list({
        filter: { type: 'catalog_entry' },
      });
      const found = entries.find((entry) => {
        const badge = entry.badge as Record<string, unknown> | undefined;
        return badge && typeof badge.en === 'string' && badge.en.length > 0;
      });
      expect(found, 'a catalog entry with a badge should exist').toBeTruthy();
      return found!;
    });

    await step(vendor, `open catalog entry ${badgeEntry.id}`, () =>
      openRecord(page, meta(), CATALOG, badgeEntry.id),
    );

    const run = await step(vendor, 'translate via the sidebar (badge overflows the limit)', () =>
      translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
    );

    // Design §6a: a content-corrupting issue must be surfaced at translate time
    // (a ctx.alert toast), not discovered only when the CMA later rejects the save.
    const toasts = run.toasts.join(' | ').toLowerCase();
    expect(
      toasts,
      `expected a length/QC alert among the sidebar toasts, got:\n${run.toasts.join('\n') || '(none)'}`,
    ).toMatch(/badge|length|character|allow|incomplete|issue|exceed|shorten/);
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

  test('bulk: linked-record reference-copy + length-validator report (catalog_entry)', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.five_min);
    const { vendor, envName } = meta();
    // Both behaviours are provider-INDEPENDENT: a link field is never sent to a
    // provider (locale-sync copy), and the length check is schema-side. Asserting
    // them once on the deterministic DeepL lane avoids vendor variance + the
    // free-tier lanes (Gemini rate limits, no Anthropic credits) muddying the
    // outcome. The `catalog_entry` seed model exists solely for this.
    test.skip(
      vendor !== 'deepl',
      'reference-copy + length-validator are provider-independent — asserted on the DeepL lane',
    );

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });

    const report = await step(vendor, 'run bulk translation (catalog_entry → es)', () =>
      runBulkTranslation(page, { modelCode: 'catalog_entry', toLocale: 'es', vendor }),
    );

    // Three catalog records: two only copy linked references (→ completed-with-
    // warnings), one overflows the badge length validator on translation (→ failure).
    expect(report.total, report.summary).toBe(3);
    expect(report.completed + report.withWarnings + report.errors, report.summary).toBe(3);

    // Reference-copy (master 3.6.0): localized Link fields carried into the new
    // locale surface the record as completed-with-warnings, with the copied field
    // named and the reason stated in the CSV report (card #5).
    expect(
      report.withWarnings,
      `expected ≥1 completed-with-warnings (reference copy)\n${report.summary}`,
    ).toBeGreaterThanOrEqual(1);
    expect(report.csv, 'CSV should name the copied link field').toContain('related_articles');
    expect(
      report.csv.toLowerCase(),
      'CSV notes should explain the copied references',
    ).toMatch(/shared references|copied linked/);

    // Length-validator (card #1): a translation over the field's character limit is
    // surfaced as a failure with a reason, never silently truncated/saved.
    expect(
      report.errors,
      `expected ≥1 length-overflow failure (badge)\n${report.summary}`,
    ).toBeGreaterThanOrEqual(1);

    // CMA proof of the shallow, min-count-satisfying reference-copy: the target
    // locale holds the SAME referenced ids as the source (not followed, not
    // re-translated), and the save did not 422 on the size:{min:1} constraint.
    await step(vendor, 'verify related_articles were copied into es (CMA)', async () => {
      const entries = await cmaClient(envName).items.list({
        filter: { type: 'catalog_entry' },
      });
      const copied = entries.find((entry) => {
        const ra = entry.related_articles as Record<string, unknown> | undefined;
        return ra && Array.isArray(ra.es) && (ra.es as unknown[]).length > 0;
      });
      expect(copied, 'a catalog entry should have es references copied from source').toBeTruthy();
      const ra = copied!.related_articles as Record<string, unknown[]>;
      expect(
        ra.es,
        'es references must equal the source references (shallow copy)',
      ).toEqual(ra.en ?? ra.it);
    });
  });

  test('bulk: translates the article model into an empty target locale', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.five_min);
    const { vendor, envName } = meta();
    // Article bulk (the design matrix's second model) into `es` — an EMPTY target
    // for most article records, so we can prove real translated content (differs
    // from the source), not just an overwrite of an already-populated locale.
    test.skip(vendor !== 'deepl', 'article bulk asserted on the DeepL lane');

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });

    const report = await step(vendor, 'run bulk translation (article → es)', () =>
      runBulkTranslation(page, { modelCode: 'article', toLocale: 'es', vendor }),
    );

    // Every article record is accounted for in the report (records with no `en`
    // source report "no eligible fields" rather than being dropped).
    expect(report.total, report.summary).toBeGreaterThanOrEqual(5);
    expect(report.completed + report.withWarnings + report.errors, report.summary).toBe(report.total);

    // Prove real translation INTO AN EMPTY TARGET: at least one article now has an
    // es title that differs from its en source (a copy would be identical).
    await step(vendor, 'assert an article got a translated (≠ source) es title (CMA)', async () => {
      const articles = await cmaClient(envName).items.list({ filter: { type: 'article' } });
      const translated = articles.filter((a) => {
        const title = a.title as Record<string, unknown> | undefined;
        return (
          title &&
          typeof title.en === 'string' &&
          typeof title.es === 'string' &&
          (title.es as string).length > 0 &&
          title.es !== title.en
        );
      });
      expect(
        translated.length,
        'at least one article should have a translated es title differing from its en source',
      ).toBeGreaterThan(0);
    });
  });
});
