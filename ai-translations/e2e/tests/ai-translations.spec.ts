import { expect, test } from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { cmaClient } from './setup/cma';
import { TIMEOUTS } from './setup/constants';
import {
  assertFieldsUnchanged,
  assertLocaleValuesUnchanged,
  assertLocalesPopulated,
  assertPlaceholdersSurviveAnyField,
  countTopLevelHtmlElements,
  findRecord,
  getLocaleValue,
  loadManifest,
  snapshotFields,
  snapshotLocaleValues,
} from './steps/assert-record';
import { recordOutcome } from './setup/outcomes';
import { step } from './setup/log';
import { bulkPageUrl, frameWithButton, runBulkTranslation } from './steps/bulk';
import {
  runItemsDropdownTranslation,
  translateFieldViaDropdown,
} from './steps/dropdown-actions';
import { openRecord, saveRecord, translateRecordViaSidebar } from './steps/per-record';

/**
 * Provider-agnostic suite. Each Playwright project (openai/google/deepl/anthropic)
 * carries its own forked environment in `project.metadata`, so the same tests run
 * concurrently, one provider per environment. See the design doc for the matrix.
 *
 * ORDERING MATTERS: opening a record in the editor takes an editing-session lock
 * that outlives the test by minutes (closing the page does not release it
 * immediately), and a bulk translation's CMA save of a locked record fails with
 * "the record is locked because it is being edited". So every BULK test (which
 * saves records via the CMA) runs FIRST, and the per-record/field tests (which
 * open records in the editor) run after — never reorder a bulk test below an
 * editor test that touches the same records.
 */
const manifest = loadManifest();
const ARTICLE = manifest.schema.models.article.id;
const CATALOG = manifest.schema.models.catalog_entry.id;
const PRODUCT = manifest.schema.models.product.id;
const A1 = findRecord(manifest, 'article', ['en', 'it']); // kitchen sink
const A2 = findRecord(manifest, 'article', ['en', 'es']); // sparse (field-dropdown target)
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

  // ── Bulk tests first: they save records via the CMA and MUST run before any
  // editor test locks those records (see the ordering note at the top). ──────

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

    // Provider-appropriate outcome (audit 24): the product model has no link
    // fields and no length validators, so on the deterministic DeepL lane the
    // only legitimate failure is the one product whose source locale is empty
    // ("no eligible fields"); QC may add warnings (heavy editors are enabled on
    // this lane), but a second hard failure would mean the lane itself broke.
    if (vendor === 'deepl') {
      expect(
        report.errors,
        `DeepL product bulk should fail at most the source-less record\n${report.summary}`,
      ).toBeLessThanOrEqual(1);
      expect(
        report.completed + report.withWarnings,
        `DeepL should translate every en-sourced product\n${report.summary}`,
      ).toBeGreaterThanOrEqual(2);
    }

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
    // …and specifically the badge record's failure must be the LENGTH validator,
    // not an incidental error like a lingering editing-session lock — that ambiguity
    // previously masked the very behaviour this test exists to prove.
    expect(
      report.csv.toLowerCase(),
      'the failure row must state a length/validation reason',
    ).toMatch(/length|character|validation|exceed|too long/);

    // The persisted review list (audit 20/21): closing the progress modal must
    // NOT discard the report — the bulk page keeps a full on-page table of every
    // flagged record/field/severity/reason until the next run. runBulkTranslation
    // has already closed the modal by the time it returns, but the dismissed
    // modal's iframe can linger "visible", so locate the bulk page by its content
    // (the retained report's own "Download CSV" button) rather than by visibility.
    await step(vendor, 'assert the on-page report table survives closing the modal', async () => {
      const pageFrame = await frameWithButton(page, /^Download CSV$/);
      const reportRegion = pageFrame.getByRole('region', {
        name: 'Bulk translation report',
      });
      await expect(reportRegion, 'the retained report region should be visible').toBeVisible();
      const text = (await reportRegion.innerText()).toLowerCase();
      expect(text, 'report should summarize the flagged records').toMatch(/issues? across \d+ records?/);
      expect(text, 'report should retain a warning-severity row').toContain('warning');
      expect(text, 'report should retain the failure row').toContain('error');
      // The reference-copy rows must NAME the copied field and state the shared-
      // references reason — not just flag the record with a bare "Translated …".
      expect(text, 'report should name the copied link field').toContain('related_articles');
      expect(text, 'report should state the reference-copy reason').toMatch(
        /shared references|copied/,
      );
    });

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
    test.setTimeout(TIMEOUTS.ten_min + TIMEOUTS.five_min);
    const { vendor, envName } = meta();
    // Article bulk (the design matrix's second model) into `es` — an EMPTY target
    // for most article records, so we can prove real translated content (differs
    // from the source), not just an overwrite of an already-populated locale.
    // The DeepL lane translates EVERY editor (incl. structured_text/rich_text/
    // single_block — see plugin-params.ts), so this run also proves the heavy
    // editors land in the empty target.
    test.skip(vendor !== 'deepl', 'article bulk asserted on the DeepL lane');

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });

    const report = await step(vendor, 'run bulk translation (article → es)', () =>
      runBulkTranslation(page, {
        modelCode: 'article',
        toLocale: 'es',
        vendor,
        // Every editor is enabled on this lane, so the kitchen-sink article alone
        // fans out into dozens of segment calls — give the run a 10-min budget.
        closeTimeout: TIMEOUTS.ten_min,
      }),
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

    // The kitchen-sink article (A1) proves every heavy editor translated into
    // the EMPTY es target — the audit's "assert translated editors, not just
    // presence" gap, plus the 3.5.6 HTML over-split regression ("AI Translate
    // truncating HTML response arrays"): a dropped top-level segment breaks
    // source/target element-count parity.
    //
    // First pin A1's own row in the CSV: if the record failed (e.g. a transient
    // provider/API error fails the whole record), surface ITS stated reason
    // instead of a bare "field not populated" downstream.
    await step(vendor, 'assert A1 itself translated (CSV row is not a failure)', async () => {
      const a1Row = report.csv
        .split('\n')
        .find((line) => line.includes(A1.id));
      expect(a1Row, `A1 (${A1.id}) should appear in the CSV report`).toBeTruthy();
      expect(
        a1Row!.startsWith('failure'),
        `A1 must translate on the DeepL lane — its report row says:\n${a1Row}`,
      ).toBe(false);
      return Promise.resolve();
    });

    await step(vendor, 'assert A1 heavy editors translated into es with structure intact (CMA)', async () => {
      const item = (await cmaClient(envName).items.find(A1.id)) as Record<
        string,
        Record<string, unknown>
      >;

      // WYSIWYG: same number of top-level HTML elements, different text.
      const htmlEn = item.body_html.en as string;
      const htmlEs = item.body_html.es as string;
      expect(htmlEs, 'body_html.es should be populated').toBeTruthy();
      expect(
        countTopLevelHtmlElements(htmlEs),
        `translated HTML must keep every top-level element (3.5.6 over-split crop)\nen: ${htmlEn}\nes: ${htmlEs}`,
      ).toBe(countTopLevelHtmlElements(htmlEn));
      expect(htmlEs, 'body_html.es should differ from its en source').not.toBe(htmlEn);

      // Modular content: the es locale carries the same NUMBER of blocks.
      const blocksEn = item.content_blocks.en as unknown[];
      const blocksEs = item.content_blocks.es as unknown[];
      expect(
        blocksEs?.length,
        'content_blocks.es must carry every source block (no cropped multi-block array)',
      ).toBe(blocksEn.length);

      // Structured text: populated and not a byte-copy of the source.
      const stEn = JSON.stringify(item.structured_body.en ?? null);
      const stEs = JSON.stringify(item.structured_body.es ?? null);
      expect(item.structured_body.es, 'structured_body.es should be populated').toBeTruthy();
      expect(stEs, 'structured_body.es should differ from its en source').not.toBe(stEn);

      // File + gallery: the es locale got its own (metadata-translated) values.
      expect(item.cover_image.es, 'cover_image.es should be populated').toBeTruthy();
      expect(
        (item.media_gallery.es as unknown[])?.length,
        'media_gallery.es should carry every source asset',
      ).toBe((item.media_gallery.en as unknown[]).length);
    });
  });

  // ── Editor-based tests: everything below opens records in the record editor
  // and leaves lingering editing-session locks — keep them after the bulk tests. ──

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

    // Source-locale integrity: translating en → the other locales must never
    // mutate the `en` slice of ANY localized field. Regression guard for the
    // ≤3.4.5 bug where multi-locale SEO translation mutated data in-place and
    // corrupted the source ("Fixing corrupted AI Translation SEO Fields").
    const LOCALIZED = manifest.schema.models.article.fields
      .filter((f) => f.localized)
      .map((f) => f.api_key);
    const sourceBefore = await step(vendor, "snapshot every localized field's en (source) value", () =>
      snapshotLocaleValues(envName, A1.id, 'en', LOCALIZED),
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

    await step(vendor, 'assert the en (source) slice of every localized field is untouched (CMA)', () =>
      assertLocaleValuesUnchanged(envName, A1.id, 'en', sourceBefore),
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
    // Must FINISH (not hang): this is the regression guard for the harness bug
    // where a partial field failure withheld the success banner and the helper
    // waited on it for the full timeout.
    expect(run.completed, 'translation from a non-Latin source should finish (not hang)').toBe(true);
    // Outcome depends on what DeepL returns for the hyphenated CJK slug: if the
    // translation keeps Latin-ish text the slug normalizes fine and the run
    // succeeds wholesale; if it comes back in Arabic script the slug normalizes
    // to empty and that failure MUST be surfaced. Both are correct plugin
    // behaviour — what's never acceptable is finishing silently with neither.
    const toastText = run.toasts.join(' | ');
    const surfacedOutcome =
      /Translations were applied/i.test(toastText) ||
      /failed to translate|slug|normaliz/i.test(toastText);
    expect(
      surfacedOutcome,
      `expected either the success banner or a surfaced slug failure, got:\n${run.toasts.join('\n') || '(none)'}`,
    ).toBe(true);

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

  test('field dropdown: "Translate to" fills an empty target locale (A2 excerpt)', async ({ page }) => {
    const { vendor, envName } = meta();
    // The per-field kebab actions (fieldDropdownActions/executeFieldDropdownAction)
    // are the plugin's original surface and run the same TranslateField pipeline
    // for every vendor, so one deterministic lane suffices.
    test.skip(vendor !== 'deepl', 'field-dropdown surface asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min);

    // Make the target verifiably EMPTY first (the fork is disposable): a
    // populated `es` after the action then proves a real translation write, not
    // a leftover. `excerpt` has no validators, so nulling one locale is safe.
    await step(vendor, 'clear excerpt.es via CMA so the write is provable', async () => {
      const item = (await cmaClient(envName).items.find(A2.id)) as Record<string, unknown>;
      const excerpt = item.excerpt as Record<string, unknown>;
      await cmaClient(envName).items.update(A2.id, {
        excerpt: { ...excerpt, es: null },
      });
    });

    await step(vendor, `open record ${A2.id} (article, en + es)`, () =>
      openRecord(page, meta(), ARTICLE, A2.id),
    );

    const run = await step(vendor, 'run the field kebab action: Translate to → [es]', () =>
      translateFieldViaDropdown(page, {
        fieldPath: 'excerpt.en',
        group: 'Translate to',
        localeCode: 'es',
        vendor,
      }),
    );
    // executeFieldDropdownAction surfaces its completion via ctx.notice.
    expect(
      run.toasts.join(' | '),
      `expected the field-translated notice, got:\n${run.toasts.join('\n') || '(none)'}`,
    ).toMatch(/Translated "Excerpt"/i);

    const save = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    expect(save.status, `save should succeed (got ${save.status}: ${save.fieldErrors.join('; ')})`).toBe(200);

    await step(vendor, 'assert excerpt.es was written from the en source (CMA)', async () => {
      const es = (await getLocaleValue(envName, A2.id, 'excerpt', 'es')) as string;
      const en = (await getLocaleValue(envName, A2.id, 'excerpt', 'en')) as string;
      expect(es, 'excerpt.es should be populated by the dropdown action').toBeTruthy();
      expect(es, 'excerpt.es should be a translation, not a copy').not.toBe(en);
    });
  });

  test('items dropdown: "AI Translate these records" picker flow translates a selection', async ({ page }) => {
    const { vendor, envName } = meta();
    // The record-list batch surface (itemsDropdownActions → picker modal →
    // confirm → progress) is dashboard-chrome + modal plumbing shared by every
    // vendor; assert it once on the deterministic lane. Products are never
    // opened in the record editor by any other test, so no editing-session
    // lock can bite this flow's CMA saves.
    test.skip(vendor !== 'deepl', 'items-dropdown surface asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min + TIMEOUTS.three_min);

    // Multi-selection only exists in the `table` collection appearance; the
    // seed uses the default compact list. Flip it in this disposable fork.
    await step(vendor, 'switch the product model to the table appearance (CMA)', () =>
      cmaClient(envName).itemTypes.update(PRODUCT, { collection_appearance: 'table' }),
    );

    const { report, toasts } = await step(
      vendor,
      'select all products and run "AI Translate these records" (en → pt-BR)',
      () =>
        runItemsDropdownTranslation(page, meta(), {
          itemTypeId: PRODUCT,
          toLocale: 'pt-BR',
          closeTimeout: TIMEOUTS.ten_min,
        }),
    );

    // Every selected record is accounted for — including the one product with
    // no `en` source, which must be reported rather than dropped.
    expect(report.total, report.summary).toBe(3);
    expect(report.completed + report.withWarnings + report.errors, report.summary).toBe(3);

    // The dropdown handler must surface an end-of-run summary (a success
    // notice, or the review alert when any record was flagged).
    expect(
      toasts.join(' | '),
      `expected a completion notice/alert, got:\n${toasts.join('\n') || '(none)'}`,
    ).toMatch(/translated|need review/i);

    // CMA proof: at least one en-sourced product now carries a REAL pt-BR
    // translation (differing from its en source) written by the picker flow.
    await step(vendor, 'assert a product got a translated pt-BR name (CMA)', async () => {
      const products = await cmaClient(envName).items.list({ filter: { type: 'product' } });
      const translated = products.filter((p) => {
        const name = p.name as Record<string, unknown> | undefined;
        return (
          name &&
          typeof name.en === 'string' &&
          typeof name['pt-BR'] === 'string' &&
          (name['pt-BR'] as string).length > 0 &&
          name['pt-BR'] !== name.en
        );
      });
      expect(
        translated.length,
        'at least one product should have a translated pt-BR name differing from its en source',
      ).toBeGreaterThan(0);
    });
  });
});
