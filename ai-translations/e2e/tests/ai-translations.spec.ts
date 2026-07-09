import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { cmaClient } from './setup/cma';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from './setup/constants';
import { resolvePluginId } from './setup/plugin-params';
import {
  assertFieldsUnchanged,
  assertLocaleEmpty,
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
  fieldMenuEntries,
  runItemsDropdownTranslation,
  translateFieldViaDropdown,
} from './steps/dropdown-actions';
import {
  openRecord,
  openTranslationPanel,
  saveRecord,
  translateRecordViaSidebar,
} from './steps/per-record';
import { getPluginParams, setPluginParams } from './steps/plugin-config';

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
      // Each record row links to its editor (master's record-link feature) —
      // and inside a sandbox env the href must carry the environment prefix,
      // or the link lands in the primary environment's editor.
      expect(report.hasRecordLink, 'a completed record row should link to its editor').toBe(true);
      expect(
        report.recordLinkHref,
        'the record link must target the forked (sandbox) environment',
      ).toContain(`/environments/${envName}/`);
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

      // The retained report's own machine export: Download JSON must produce
      // parseable rows carrying the same structured facts as the table.
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: TIMEOUTS.thirty_sec }),
        pageFrame.getByRole('button', { name: 'Download JSON' }).click(),
      ]);
      const rows = JSON.parse(readFileSync((await download.path()) ?? '', 'utf8')) as Array<
        Record<string, unknown>
      >;
      expect(rows.length, 'the JSON export should carry the report rows').toBeGreaterThan(0);
      expect(
        rows.some((r) => r.fieldPath === 'related_articles' && r.checkId === 'reference-copy'),
        'the JSON export should carry the structured reference-copy row',
      ).toBe(true);
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

      // Single-block editors (framed + frameless) — the remaining two heavy
      // editor shapes — must land in the empty target too.
      expect(item.spotlight.es, 'spotlight.es (framed single block) should be populated').toBeTruthy();
      expect(
        item.inline_note.es,
        'inline_note.es (frameless single block) should be populated',
      ).toBeTruthy();
    });
  });

  test('bulk: partial field selection translates only the chosen fields', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);
    const { vendor, envName } = meta();
    // The ModelFieldPicker's field allowlist is a first-class feature every
    // bulk run so far has left at its default (all fields). Prove both halves:
    // the chosen field translates, and the unchosen translatable fields stay
    // untouched (locale-sync writes null for optional unselected fields).
    // Runs on the PRODUCT model: its records are never opened in the editor,
    // so the sparse pt-BR locale this creates can't destabilize the editor
    // tests (the later items-dropdown run fills pt-BR completely anyway).
    test.skip(vendor !== 'deepl', 'field-selection behaviour asserted on the DeepL lane');
    const P1 = findRecord(manifest, 'product', ['en', 'it']);

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });

    const report = await step(vendor, 'run bulk translation (product → pt-BR, name only)', () =>
      runBulkTranslation(page, {
        modelCode: 'product',
        toLocale: 'pt-BR',
        vendor,
        onlyFields: ['name'],
      }),
    );
    expect(report.total, report.summary).toBe(3);
    expect(report.completed + report.withWarnings + report.errors, report.summary).toBe(3);

    await step(vendor, 'assert only the name landed in pt-BR on P1 (CMA)', async () => {
      const item = (await cmaClient(envName).items.find(P1.id)) as Record<
        string,
        Record<string, unknown>
      >;
      const name = item.name['pt-BR'] as string;
      expect(name, 'name.pt-BR should be populated').toBeTruthy();
      // Unselected translatable fields must remain EMPTY in the new locale.
      await assertLocaleEmpty(envName, P1.id, 'pt-BR', [
        'description',
        'promo_markdown',
        'specs_html',
        'seo',
      ]);
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

  test('field dropdown: empty-source guard, translate-from, and all-locales flows (A2)', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'field-dropdown flows asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);

    // 1. The empty-source guard: "Translate from" a locale with no value must
    //    alert and bail BEFORE any provider call — never write anything.
    await step(vendor, 'clear excerpt.es via CMA to make the source verifiably empty', async () => {
      const item = (await cmaClient(envName).items.find(A2.id)) as Record<string, unknown>;
      await cmaClient(envName).items.update(A2.id, {
        excerpt: { ...(item.excerpt as Record<string, unknown>), es: null },
      });
    });
    await step(vendor, `open record ${A2.id} (article, en + es)`, () =>
      openRecord(page, meta(), ARTICLE, A2.id),
    );
    const guard = await step(vendor, 'Translate from → [es] with an empty es source', () =>
      translateFieldViaDropdown(page, {
        fieldPath: 'excerpt.en',
        group: 'Translate from',
        localeCode: 'es',
        completionPattern: /locale is empty/i,
        vendor,
      }),
    );
    expect(
      guard.toasts.join(' | '),
      'the empty-source guard must alert, not translate',
    ).toMatch(/locale is empty/i);

    // 2. "Translate to → All locales": fills every other active locale (es
    //    here) and announces the batch completion.
    const run = await step(vendor, 'Translate to → All locales on excerpt.en', () =>
      translateFieldViaDropdown(page, {
        fieldPath: 'excerpt.en',
        group: 'Translate to',
        entryText: 'All locales',
        // Strict completion form — the in-progress warning toast reads
        // 'Translating … to all locales…' and must not satisfy the wait.
        completionPattern: /Translated "Excerpt" to all locales/i,
        vendor,
      }),
    );
    expect(run.toasts.join(' | ')).toMatch(/Translated "Excerpt" to all locales/i);
    const saveAll = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    expect(saveAll.status, `save should succeed (got ${saveAll.status})`).toBe(200);

    // 3. The reverse direction: clear the CURRENT locale, then "Translate
    //    from" the (now populated) es back into en.
    await step(vendor, 'clear excerpt.en via CMA, keeping the es translation', async () => {
      const item = (await cmaClient(envName).items.find(A2.id)) as Record<string, unknown>;
      await cmaClient(envName).items.update(A2.id, {
        excerpt: { ...(item.excerpt as Record<string, unknown>), en: null },
      });
    });
    await step(vendor, 'reopen the record', () => openRecord(page, meta(), ARTICLE, A2.id));
    const fromRun = await step(vendor, 'Translate from → [es] into the empty en', () =>
      translateFieldViaDropdown(page, {
        fieldPath: 'excerpt.en',
        group: 'Translate from',
        localeCode: 'es',
        vendor,
      }),
    );
    expect(fromRun.toasts.join(' | ')).toMatch(/Translated "Excerpt" from/i);
    const save = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    expect(save.status, `save should succeed (got ${save.status})`).toBe(200);

    await step(vendor, 'assert excerpt.en was rewritten from the es source (CMA)', async () => {
      const en = (await getLocaleValue(envName, A2.id, 'excerpt', 'en')) as string;
      const es = (await getLocaleValue(envName, A2.id, 'excerpt', 'es')) as string;
      expect(en, 'excerpt.en should be populated by Translate from').toBeTruthy();
      expect(en, 'excerpt.en should be a translation of es, not a copy').not.toBe(es);
    });
  });

  test('bulk page: dead-end states — model without records, model without translatable fields', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'dead-end states are provider-independent — asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min);

    // Fixture models live only in this disposable fork (create-if-absent so a
    // kept env can re-run): one translatable model with ZERO records, one model
    // whose only field is untranslatable.
    await step(vendor, 'ensure the dead-end fixture models exist (CMA)', async () => {
      const client = cmaClient(envName);
      const types = await client.itemTypes.list();
      if (!types.some((t) => t.api_key === 'e2e_empty_content')) {
        const emptyModel = await client.itemTypes.create({
          name: 'E2E Empty Content',
          api_key: 'e2e_empty_content',
        });
        await client.fields.create(emptyModel.id, {
          label: 'Title',
          api_key: 'title',
          field_type: 'string',
          localized: true,
        });
      }
      if (!types.some((t) => t.api_key === 'e2e_untranslatable')) {
        const boolModel = await client.itemTypes.create({
          name: 'E2E Untranslatable',
          api_key: 'e2e_untranslatable',
        });
        await client.fields.create(boolModel.id, {
          label: 'Flag',
          api_key: 'flag',
          field_type: 'boolean',
          localized: false,
        });
      }
    });

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });
    const frame = await frameWithButton(page, /Start bulk translation/i);

    await step(vendor, 'a records-less model alerts instead of running', async () => {
      await frame.locator('[class*="-control"]').nth(2).click();
      await frame
        .locator('[class*="-option"]')
        .filter({ has: frame.locator('code', { hasText: /^e2e_empty_content$/ }) })
        .first()
        .click();
      await frame.getByText(/Fields to translate/i).waitFor({ timeout: TIMEOUTS.thirty_sec });
      await frame.getByRole('button', { name: /start bulk translation/i }).click();
      // The dead end surfaces BEFORE any confirm modal: a dashboard alert.
      await expect(
        page.getByText('No records found in the selected models').first(),
        'the no-records alert should surface',
      ).toBeVisible({ timeout: TIMEOUTS.thirty_sec });
    });

    await step(vendor, 'an untranslatable model shows the dead-end notice with a working Remove', async () => {
      await frame.locator('[class*="-control"]').nth(2).click();
      await frame
        .locator('[class*="-option"]')
        .filter({ has: frame.locator('code', { hasText: /^e2e_untranslatable$/ }) })
        .first()
        .click();
      const notice = frame.getByText(/No translatable fields/i).first();
      await expect(notice, 'the picker should name the dead end').toBeVisible({
        timeout: TIMEOUTS.thirty_sec,
      });
      // The readiness blocker names the model and the way out…
      await expect(
        frame.getByText(/has no translatable fields — remove it/i).first(),
      ).toBeVisible();
      // …and Remove actually removes it. Scope to the dead-end notice box —
      // the page has other "Remove" affordances (chip clears, exclusions).
      await frame
        .locator('[class*="noFields"]')
        .getByRole('button', { name: 'Remove' })
        .first()
        .click();
      await expect(frame.getByText(/No translatable fields/i)).toHaveCount(0);
    });
  });

  test('bulk page: readiness blockers gate Start and the target mutex holds', async ({ page }) => {
    const { vendor } = meta();
    test.skip(vendor !== 'deepl', 'readiness UI is provider-independent — asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min);

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });
    const frame = await frameWithButton(page, /Start bulk translation/i);
    const start = frame.getByRole('button', { name: /start bulk translation/i });

    await step(vendor, 'with no model selected, Start is blocked with the reason', async () => {
      await expect(start).toBeDisabled();
      await expect(frame.getByText('Before you can translate:')).toBeVisible();
      await expect(frame.getByText('Pick at least one model to translate.')).toBeVisible();
    });

    await step(vendor, 'target select: a specific locale replaces "All other locales" and back', async () => {
      // Assert on the select's VALUE (its control's chips) — the same string
      // also appears in the field hint and the open options menu.
      const targetControl = frame.locator('[class*="-control"]').nth(1);
      // Picking a specific target drops the sentinel…
      await targetControl.click();
      await frame
        .locator('[class*="-option"]')
        .filter({ has: frame.locator('code', { hasText: /^es$/ }) })
        .first()
        .click();
      await expect(targetControl.getByText('All other locales')).toHaveCount(0);
      await expect(targetControl.locator('code', { hasText: /^es$/ }).first()).toBeVisible();
      // …and re-picking the sentinel drops the specific locale.
      await targetControl.click();
      await frame
        .locator('[class*="-option"]')
        .filter({ hasText: 'All other locales' })
        .first()
        .click();
      await expect(targetControl.getByText('All other locales').first()).toBeVisible();
      await expect(targetControl.locator('code', { hasText: /^es$/ })).toHaveCount(0);
    });

    await step(vendor, 'selecting a model satisfies readiness and Start unlocks', async () => {
      await frame.locator('[class*="-control"]').nth(2).click();
      await frame
        .locator('[class*="-option"]')
        .filter({ has: frame.locator('code', { hasText: /^product$/ }) })
        .first()
        .click();
      await frame.getByText(/Fields to translate/i).waitFor({ timeout: TIMEOUTS.thirty_sec });
      await expect(start).toBeEnabled({ timeout: TIMEOUTS.thirty_sec });
      await expect(frame.getByText(/Ready to translate to \d+ locales?/)).toBeVisible();
    });
  });

  test('per-record: a single-locale record degrades both surfaces gracefully', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'single-locale guard is provider-independent — asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min);

    // A record whose ONLY locale is en: the sidebar must explain itself and the
    // field kebab must offer no translate actions (nowhere to translate to).
    const recordId = await step(vendor, 'ensure the single-locale fixture record exists (CMA)', async () => {
      const client = cmaClient(envName);
      const existing = await client.items.list({
        filter: { type: 'article', fields: { slug: { eq: { en: 'single-locale-guard-e2e' } } } },
      }).catch(() => []);
      if (existing.length > 0) return existing[0].id;
      const created = await client.items.create({
        item_type: { type: 'item_type', id: ARTICLE },
        title: { en: 'Single Locale Guard' },
        slug: { en: 'single-locale-guard-e2e' },
      });
      return created.id;
    });

    await step(vendor, `open the single-locale record ${recordId}`, () =>
      openRecord(page, meta(), ARTICLE, recordId),
    );

    await step(vendor, 'the sidebar panel explains the single-locale limitation', async () => {
      const panel = page
        .locator('iframe[src*="localhost:5173"]')
        .filter({ visible: true })
        .first()
        .contentFrame();
      await expect(
        panel.getByText(/more than one\s+locale/i).first(),
        'the sidebar should state the more-than-one-locale requirement',
      ).toBeVisible({ timeout: TIMEOUTS.one_min });
    });

    await step(vendor, 'the field kebab offers no translate actions', async () => {
      const entries = await fieldMenuEntries(page, 'title.en');
      expect(entries.join(' | ')).toMatch(/Go to/);
      expect(
        entries.join(' | '),
        'no translate actions on a single-locale record',
      ).not.toMatch(/Translate to|Translate from/);
    });
  });

  test('bulk: a non-default source locale drives the run (de → fr)', async ({ page }) => {
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);
    const { vendor, envName } = meta();
    // Every other bulk run leaves the source select at its default (the first
    // project locale). Prove a chosen source drives translation: only the
    // de-sourced product translates; en-only records are accounted for as
    // ineligible rather than silently translated from the wrong source.
    test.skip(vendor !== 'deepl', 'source-locale selection asserted on the DeepL lane');
    const P2 = findRecord(manifest, 'product', ['de', 'es']);

    await step(vendor, 'open the Bulk Translations page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });

    const report = await step(vendor, 'run bulk translation (product, de → fr)', () =>
      runBulkTranslation(page, {
        modelCode: 'product',
        toLocale: 'fr',
        fromLocale: 'de',
        vendor,
      }),
    );
    expect(report.total, report.summary).toBe(3);
    expect(report.completed + report.withWarnings + report.errors, report.summary).toBe(3);

    await step(vendor, 'assert the de-sourced product got a real fr translation (CMA)', async () => {
      const item = (await cmaClient(envName).items.find(P2.id)) as Record<
        string,
        Record<string, unknown>
      >;
      const fr = item.name.fr as string;
      expect(fr, 'name.fr should be populated from the de source').toBeTruthy();
      expect(fr, 'name.fr should be a translation, not a copy of de').not.toBe(item.name.de);
    });
  });

  test('per-record: sidebar target narrowing leaves unselected locales untouched', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'target narrowing asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);

    // Give A2 a third locale (de) so "narrow to de" leaves a REAL unselected
    // locale (es) to protect. Adding a locale requires EVERY localized field to
    // carry an explicit value for it (null is fine) — see the CMA's
    // INVALID_LOCALES rule. Idempotent: skip when de is already present.
    const LOCALIZED = manifest.schema.models.article.fields
      .filter((f) => f.localized)
      .map((f) => f.api_key);
    await step(vendor, 'ensure A2 carries a de slice (CMA)', async () => {
      const client = cmaClient(envName);
      const item = (await client.items.find(A2.id)) as Record<string, unknown>;
      if ((item.title as Record<string, unknown>).de) return;
      const payload: Record<string, unknown> = {};
      for (const field of LOCALIZED) {
        const current = (item[field] ?? {}) as Record<string, unknown>;
        const seed =
          field === 'title' || field === 'excerpt'
            ? current.en
            : field === 'slug'
              ? 'narrowing-fixture-de'
              : null;
        payload[field] = { ...current, de: seed };
      }
      await client.items.update(A2.id, payload);
    });

    const esBefore = await step(vendor, "snapshot A2's es slices (the UNSELECTED target)", () =>
      snapshotLocaleValues(envName, A2.id, 'es', LOCALIZED),
    );

    await step(vendor, `open record ${A2.id} (en + es + de)`, () =>
      openRecord(page, meta(), ARTICLE, A2.id),
    );

    // Narrow the sidebar's target selection from the default (all other
    // locales) to just de, then translate.
    const run = await step(vendor, 'translate en → (de only) via the sidebar', async () => {
      // Expand the panel first (it can be collapsed), THEN narrow the targets.
      // The sidebar pre-resolves its target selection into CONCRETE chips (es +
      // de here; its menu is empty once every option is selected), so narrowing
      // means REMOVING the unwanted chip, not picking from the menu.
      const panel = await openTranslationPanel(page);
      const targetControl = panel.locator('[class*="-control"]').nth(1);
      await targetControl
        .locator('[class*="multi-value"]')
        .filter({ has: panel.locator('code', { hasText: /^es$/ }) })
        .locator('[class*="multi-value__remove"]')
        .click();
      await expect(
        targetControl.locator('code', { hasText: /^es$/ }),
        'the es chip should be removed from the target selection',
      ).toHaveCount(0);
      return translateRecordViaSidebar(page, { fromLocale: 'en', vendor });
    });
    expect(run.completed, 'narrowed translation should finish').toBe(true);

    const save = await step(vendor, 'save the record', () => saveRecord(page, vendor));
    expect(save.status, `save should succeed (got ${save.status})`).toBe(200);

    await step(vendor, 'assert de translated and es byte-untouched (CMA)', async () => {
      await assertLocalesPopulated(envName, A2.id, ['de'], ['title', 'excerpt']);
      // The unselected locale must not have been rewritten by the run.
      await assertLocaleValuesUnchanged(envName, A2.id, 'es', esBefore);
    });
  });

  test('config screen: vendor switch swaps credential fields and gates Save on dirtiness', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'config-screen smoke asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min);

    await step(vendor, "open the plugin's settings screen", async () => {
      const pluginId = await resolvePluginId();
      await page.goto(
        `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${envName}` +
          `/configuration/plugins/${pluginId}/edit`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForTimeout(3000);
    });

    const config = await step(vendor, 'locate the config frame (Save button present)', () =>
      frameWithButton(page, /^Save/),
    );

    await step(vendor, 'assert the DeepL credentials render and Save starts disabled', async () => {
      // The lane's params pin vendor=deepl, so its credential block renders…
      await expect(config.getByText('DeepL API Key').first()).toBeVisible({
        timeout: TIMEOUTS.thirty_sec,
      });
      // …and a pristine (non-dirty) form must not be saveable.
      await expect(
        config.getByRole('button', { name: /^Save/ }),
        'Save should be disabled until the form is dirty',
      ).toBeDisabled();
    });

    await step(vendor, 'switch the vendor to OpenAI and assert the credential swap', async () => {
      await config.locator('[class*="-control"]').first().click();
      await config
        .locator('[class*="-option"]')
        .filter({ hasText: 'OpenAI (ChatGPT)' })
        .first()
        .click();
      await expect(config.getByText('OpenAI API Key').first()).toBeVisible({
        timeout: TIMEOUTS.thirty_sec,
      });
      await expect(
        config.getByText('DeepL API Key'),
        "the DeepL block should be gone after the vendor switch",
      ).toHaveCount(0);
      // The switch dirties the form → Save unlocks. NOT clicked: this test
      // must leave the lane's params untouched.
      await expect(config.getByRole('button', { name: /^Save/ })).toBeEnabled();
    });

    await step(vendor, 'switch back to DeepL (nothing saved)', async () => {
      await config.locator('[class*="-control"]').first().click();
      await config.locator('[class*="-option"]').filter({ hasText: 'DeepL' }).first().click();
      await expect(config.getByText('DeepL API Key').first()).toBeVisible({
        timeout: TIMEOUTS.thirty_sec,
      });
    });
  });

  test('gating: plugin params control which surfaces render', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'surface gating is provider-independent — asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min);

    const P1 = manifest.records.find((r) => r.model === 'product' && r.sourceLocales.includes('en'))!;
    const original = await step(vendor, "snapshot the lane's plugin params", () =>
      getPluginParams(envName),
    );

    /** The record sidebar has rendered when at least one panel header exists. */
    const sidebarSettled = async () => {
      await expect(page.locator('.SidebarPanel__header').first()).toBeVisible({
        timeout: TIMEOUTS.one_min,
      });
      await page.waitForTimeout(2000); // plugin panels register a beat later
    };
    const aiPanel = () =>
      page.locator('.SidebarPanel__header', { hasText: 'AI Translations' });

    try {
      await step(vendor, 'translateWholeRecord=false hides the record sidebar panel', async () => {
        await setPluginParams(envName, { ...original, translateWholeRecord: false });
        await openRecord(page, meta(), ARTICLE, A2.id);
        await sidebarSettled();
        await expect(aiPanel(), 'no AI Translations panel expected').toHaveCount(0);
      });

      await step(vendor, 'translateBulkRecords=false removes the batch actions dropdown', async () => {
        await setPluginParams(envName, { ...original, translateBulkRecords: false });
        // Self-sufficient: multi-select needs the table appearance regardless
        // of whether the items-dropdown test already flipped it in this fork.
        await cmaClient(envName).itemTypes.update(PRODUCT, { collection_appearance: 'table' });
        await page.goto(
          `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${envName}` +
            `/editor/item_types/${PRODUCT}/items`,
          { waitUntil: 'domcontentloaded' },
        );
        // Select every record, wait for the NATIVE batch bar (proof the
        // selection registered)…
        const selectAll = page.locator(
          '.ItemsTable__header-cell--checkbox input[type="checkbox"]',
        );
        await expect(selectAll).toBeVisible({ timeout: TIMEOUTS.one_min });
        await selectAll.check();
        await expect(
          page.getByRole('button', { name: 'Show selection' }),
          'the native batch bar should render for the selection',
        ).toBeVisible({ timeout: TIMEOUTS.thirty_sec });
        // …then assert the plugin-actions dropdown trigger never renders: the
        // trigger exists ONLY to hold plugin batch actions, so with
        // translateBulkRecords=false it must be absent entirely. Give the
        // (hidden) plugin frame time to boot so a not-yet-registered action
        // can't masquerade as a gated one.
        await expect(
          page.locator('iframe[src*="localhost:5173"]').first(),
          'the plugin frame should have booted',
        ).toBeAttached({ timeout: TIMEOUTS.one_min });
        await page.waitForTimeout(5000);
        await expect(
          page.locator('button.Dropdown__icon-trigger--reverse'),
          'the plugin batch-actions trigger must be gated off',
        ).toHaveCount(0);
      });

      await step(vendor, 'model exclusion hides the sidebar AND the bulk-page model option', async () => {
        await setPluginParams(envName, {
          ...original,
          modelsToBeExcludedFromThisPlugin: ['product'],
        });
        // Sidebar gone on the excluded model's records…
        await openRecord(page, meta(), PRODUCT, P1.id);
        await sidebarSettled();
        await expect(aiPanel(), 'excluded model must not get the sidebar').toHaveCount(0);
        // …still present on a non-excluded model…
        await openRecord(page, meta(), ARTICLE, A2.id);
        await sidebarSettled();
        await expect(aiPanel().first(), 'non-excluded model keeps the sidebar').toBeVisible();
        // …and the bulk page's model dropdown omits it (the exclusion
        // previously leaked here — an excluded model stayed bulk-translatable).
        await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        const bulk = await frameWithButton(page, /Start bulk translation/i);
        await bulk.locator('[class*="-control"]').nth(2).click();
        const modelOptions = bulk.locator('[class*="-option"]');
        await expect(modelOptions.first()).toBeVisible({ timeout: TIMEOUTS.thirty_sec });
        const texts = (await modelOptions.allTextContents()).join(' | ');
        expect(texts, 'bulk page should still offer the article model').toContain('article');
        expect(texts, 'bulk page must not offer the excluded product model').not.toContain('product');
      });

      await step(vendor, 'field exclusion strips one field\'s translate actions', async () => {
        await setPluginParams(envName, {
          ...original,
          apiKeysToBeExcludedFromThisPlugin: ['excerpt'],
        });
        await openRecord(page, meta(), ARTICLE, A2.id);
        const excluded = await fieldMenuEntries(page, 'excerpt.en');
        expect(
          excluded.join(' | '),
          'excluded field must have no translate actions',
        ).not.toMatch(/Translate to|Translate from/);
        const kept = await fieldMenuEntries(page, 'title.en');
        expect(kept.join(' | '), 'sibling field keeps its actions').toMatch(/Translate to/);
      });

      await step(vendor, 'translationFields removal disables that editor type\'s actions', async () => {
        // textarea (excerpt) is the probe: its label reliably carries the kebab
        // chrome. (markdown fields render EasyMDE's own toolbar and no label
        // kebab at all in the current dashboard, so they can't be probed here.)
        const fields = (original.translationFields as string[]) ?? [];
        await setPluginParams(envName, {
          ...original,
          translationFields: fields.filter((f) => f !== 'textarea'),
        });
        await openRecord(page, meta(), ARTICLE, A2.id);
        const excerpt = await fieldMenuEntries(page, 'excerpt.en');
        expect(
          excerpt.join(' | '),
          'textarea fields must lose their translate actions',
        ).not.toMatch(/Translate to|Translate from/);
        const kept = await fieldMenuEntries(page, 'title.en');
        expect(kept.join(' | '), 'single_line fields keep theirs').toMatch(/Translate to/);
      });
    } finally {
      await setPluginParams(envName, original);
    }
  });

  test('unconfigured provider: surfaces degrade to configuration prompts', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'unconfigured gating asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min);

    const original = await getPluginParams(envName);
    try {
      await step(vendor, 'blank the DeepL key so isProviderConfigured=false', () =>
        setPluginParams(envName, { ...original, deeplApiKey: '' }),
      );
      await step(vendor, 'open a record', () => openRecord(page, meta(), ARTICLE, A2.id));

      await step(vendor, 'sidebar shows the configure placeholder with Open Settings', async () => {
        const panel = await frameWithButton(page, /Open Settings/);
        await expect(
          panel.getByText(/configure valid credentials/i).first(),
        ).toBeVisible({ timeout: TIMEOUTS.thirty_sec });
      });

      await step(vendor, 'field menu shows the single not-configured action', async () => {
        const entries = await fieldMenuEntries(page, 'title.en');
        expect(entries.join(' | ')).toMatch(/configure valid AI vendor credentials/i);
        expect(entries.join(' | '), 'no live translate actions while unconfigured').not.toMatch(
          /Translate to|Translate from/,
        );
      });
    } finally {
      await setPluginParams(envName, original);
    }
  });

  test('onBoot re-seeds missing default parameters', async ({ page }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'onBoot seeding is provider-independent — asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min);

    const original = await getPluginParams(envName);
    try {
      await step(vendor, 'strip the params down to bare credentials', () =>
        setPluginParams(envName, {
          vendor: 'deepl',
          deeplApiKey: original.deeplApiKey,
          deeplEndpoint: original.deeplEndpoint ?? 'auto',
        }),
      );

      await step(vendor, 'boot the plugin by opening a record', () =>
        openRecord(page, meta(), ARTICLE, A2.id),
      );

      await step(vendor, 'onBoot wrote the missing defaults back (CMA)', async () => {
        await expect
          .poll(
            async () => {
              const params = await getPluginParams(envName);
              return (
                Array.isArray(params.translationFields) &&
                (params.translationFields as string[]).length > 0 &&
                typeof params.prompt === 'string' &&
                (params.prompt as string).length > 0 &&
                params.translateWholeRecord === true &&
                Array.isArray(params.modelsToBeExcludedFromThisPlugin)
              );
            },
            {
              timeout: TIMEOUTS.one_min,
              message: 'onBoot should have re-seeded the default parameters',
            },
          )
          .toBe(true);
      });
    } finally {
      await setPluginParams(envName, original);
    }
  });

  test('bulk run with a broken provider key fails every record with the stated reason', async ({ page }) => {
    const { vendor, envName } = meta();
    // Auth is rejected before any translation happens, so this costs nothing
    // and is fully deterministic — it proves the per-record failure REPORTING
    // (the support card's core ask) under a total-provider-outage.
    test.skip(vendor !== 'deepl', 'provider-failure reporting asserted on the DeepL lane');
    test.setTimeout(TIMEOUTS.five_min + TIMEOUTS.three_min);

    const original = await getPluginParams(envName);
    try {
      await step(vendor, 'point the plugin at an invalid DeepL key', () =>
        setPluginParams(envName, { ...original, deeplApiKey: 'invalid-key-e2e-0000' }),
      );

      await step(vendor, 'open the Bulk Translations page', async () => {
        await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      });

      const report = await step(vendor, 'run bulk translation (product → fr) against the dead key', () =>
        runBulkTranslation(page, { modelCode: 'product', toLocale: 'fr', vendor }),
      );

      // Every record must fail — and each failure must STATE the auth reason
      // in the exported report, not silently vanish.
      expect(report.total, report.summary).toBe(3);
      expect(report.errors, `every record must fail on a dead key\n${report.summary}`).toBe(3);
      expect(
        report.csv.toLowerCase(),
        'the CSV must carry the authorization failure reason',
      ).toMatch(/auth|api key|invalid|credential|forbidden|401|403/);
    } finally {
      await setPluginParams(envName, original);
    }
  });
});
