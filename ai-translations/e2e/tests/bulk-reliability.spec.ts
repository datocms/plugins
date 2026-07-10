import {
  type Frame,
  type FrameLocator,
  type Page,
  expect,
  test,
} from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { cmaClient } from './setup/cma';
import { TIMEOUTS } from './setup/constants';
import { step } from './setup/log';
import { recordOutcome } from './setup/outcomes';
import { loadManifest } from './steps/assert-record';
import { bulkPageUrl, frameWithButton, runBulkTranslation } from './steps/bulk';
import {
  clearFaults,
  injectAuthError,
  injectCmaFieldStrip,
  injectContentError,
  injectRateLimit,
} from './steps/fault-injection';

/**
 * Fault-injection reliability lane. Provider calls run in the browser
 * (`dangerouslyAllowBrowser: true`), so `page.route()` intercepts them and a
 * `429`/`401` can be manufactured with no provider API key. Tests that let a
 * call fall through to the real provider (finite `failTimes`) are gated to the
 * deterministic DeepL lane; the pure-fault tests (every call faulted) exercise
 * each active lane's own error-envelope classification and need no key.
 *
 * These specs drive the progress modal MID-RUN — asserting the pause screen, its
 * countdown, Export gating, and the read-back verdict — which the completion-only
 * `runBulkTranslation` helper cannot expose, so a local `startBulkRun` starts a
 * run and hands back the still-open progress frame.
 */

const manifest = loadManifest();
const PRODUCT_CODE = 'product';
const LOCALIZED_PRODUCT_FIELDS = manifest.schema.models.product.fields
  .filter((field) => field.localized)
  .map((field) => field.api_key);

const meta = (): ProjectMeta => test.info().project.metadata as ProjectMeta;

/** Cancel copy, verbatim from the plan's Global Constraints — rendered inline in the pause panel. */
const CANCEL_WARNING =
  'Stopping does not undo the records already translated; they will be re-translated on the next bulk run.';

/** FrameLocator for the visible bulk-page plugin iframe. */
const bulkFrame = (page: Page): FrameLocator =>
  page
    .locator('iframe[src*="localhost:5173"]')
    .filter({ visible: true })
    .contentFrame();

/** Pick a react-select option (carrying its code in a `<code>` element) by code. */
const selectByCode = async (
  frame: FrameLocator,
  controlIndex: number,
  code: string,
): Promise<void> => {
  await frame.locator('[class*="-control"]').nth(controlIndex).click();
  await frame
    .locator('[class*="-option"]')
    .filter({ has: frame.locator('code', { hasText: new RegExp(`^${code}$`) }) })
    .first()
    .click();
};

/**
 * Starts a bulk run (model + one target locale, source at its default first
 * locale) through confirm, then returns the still-open progress-modal frame
 * WITHOUT waiting for completion — so a test can assert on the pause screen while
 * the run is mid-flight. Faults must already be registered (they are, since a
 * test injects before calling this and this is what navigates).
 */
const startBulkRun = async (
  page: Page,
  opts: { modelCode: string; toLocale: string; onlyFields?: string[] },
): Promise<Frame> => {
  await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const frame = bulkFrame(page);
  // Controls: 0=source, 1=target locales, 2=models, 3+=per-model field pickers.
  await selectByCode(frame, 2, opts.modelCode);
  await frame
    .getByText(/Fields to translate/i)
    .waitFor({ timeout: TIMEOUTS.thirty_sec });
  await selectByCode(frame, 1, opts.toLocale);
  for (const fieldApiKey of opts.onlyFields ?? []) {
    await selectByCode(frame, 3, fieldApiKey);
  }

  await frame
    .getByRole('button', { name: /start bulk translation/i })
    .click();

  const confirmFrame = await frameWithButton(page, /^Translate /);
  await confirmFrame.getByRole('button', { name: /^Translate / }).click();

  return frameWithButton(page, /^(Close|Please wait)/);
};

/** The mid-run pause panel within a progress frame. */
const pausePanel = (frame: Frame) =>
  frame.locator('.TranslationProgressModal__pause');

/** True once no visible plugin iframe still shows the pause screen (modal closed). */
const isPauseGone = async (page: Page): Promise<boolean> => {
  for (const frame of page.frames()) {
    if (!frame.url().includes('localhost:5173')) continue;
    const count = await frame
      .getByText('Translation paused')
      .count()
      .catch(() => 0);
    if (count > 0) return false;
  }
  return true;
};

test.describe('AI Translations — bulk reliability', () => {
  test.beforeEach(({}, testInfo) => {
    const m = meta();
    testInfo.annotations.push({
      type: 'lane',
      description: `${m.vendor} → ${m.envName}`,
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    await clearFaults(page).catch(() => {});
    const ok =
      testInfo.status === testInfo.expectedStatus ||
      testInfo.status === 'skipped';
    recordOutcome(testInfo.project.name, ok);
  });

  // ── Pure-fault tests: every provider call is faulted, so they need no API key
  // and run on every active lane, exercising that vendor's error envelope. ────

  test('a locale-wide rate limit pauses before anything is written', async ({
    page,
  }) => {
    const { vendor, envName } = meta();
    test.setTimeout(TIMEOUTS.five_min);

    // NOTE: a 429 is systemic, so the run pauses at the FIRST field and never
    // reaches `items.update`. This test therefore proves "a rate limit writes
    // nothing", NOT "a failed field is not nulled" — the fallback loop is never
    // entered. The null-guard itself is pinned by the content-error test below,
    // which is the only remaining path into that loop.
    const before = await step(vendor, 'snapshot every product fr slice (CMA)', async () => {
      const products = await cmaClient(envName).items.list({
        filter: { type: 'product' },
      });
      return products.map((item) => ({
        id: item.id,
        fr: Object.fromEntries(
          LOCALIZED_PRODUCT_FIELDS.map((field) => {
            const localized = item[field] as Record<string, unknown> | null;
            return [field, localized?.fr];
          }),
        ),
      }));
    });

    await step(vendor, 'fault every provider call with a 429', () =>
      injectRateLimit(page, { vendor, failTimes: 999 }),
    );

    const frame = await step(vendor, 'start product → fr and reach the pause', () =>
      startBulkRun(page, { modelCode: PRODUCT_CODE, toLocale: 'fr' }),
    );
    await expect(
      pausePanel(frame),
      'a systemic rate limit should pause the run',
    ).toBeVisible({ timeout: TIMEOUTS.one_min });

    // Stop the run from the pause screen; the failed fields were never saved.
    await step(vendor, 'cancel from the pause panel', async () => {
      await pausePanel(frame).getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(() => isPauseGone(page), { timeout: TIMEOUTS.one_min }).toBe(true);
    });

    await step(vendor, 'assert no product fr slice became null (CMA)', async () => {
      const products = await cmaClient(envName).items.list({
        filter: { type: 'product' },
      });
      for (const snapshot of before) {
        const item = products.find((p) => p.id === snapshot.id);
        expect(item, `product ${snapshot.id} should still exist`).toBeTruthy();
        for (const field of LOCALIZED_PRODUCT_FIELDS) {
          const localized = item?.[field] as Record<string, unknown> | null;
          expect(
            JSON.stringify(localized?.fr),
            `${field}[fr] must be unchanged — a failed translation must never overwrite it (esp. with null)`,
          ).toBe(JSON.stringify(snapshot.fr[field]));
        }
      }
    });
  });

  // The real null-guard regression. A content-scoped error (400) fails ONE field
  // and lets the run continue to the save, which is the only way into the
  // locale-sync fallback loop. Its siblings hit the real provider, so this test
  // needs a key — it is gated to the deterministic DeepL lane.
  test('a content-scoped field failure leaves its locale untouched, never null', async ({
    page,
  }) => {
    const { vendor, envName } = meta();
    test.skip(vendor !== 'deepl', 'needs a real provider for the sibling fields');
    test.setTimeout(TIMEOUTS.five_min);

    const client = cmaClient(envName);

    // Take a real product's source text for one field. The provider request must
    // carry that text verbatim, so it is a reliable body matcher for faulting
    // exactly this field's call and no other.
    const { victimField, siblingField, victimSource } = await step(
      vendor,
      'pick a victim field from real seed content (CMA)',
      async () => {
        const [product] = await client.items.list({
          filter: { type: 'product' },
        });
        const stringFields = LOCALIZED_PRODUCT_FIELDS.filter((field) => {
          const value = (product[field] as Record<string, unknown> | null)?.en;
          return typeof value === 'string' && value.trim().length > 8;
        });
        expect(
          stringFields.length,
          'the seed needs >=2 localized string fields to fault one and translate the other',
        ).toBeGreaterThanOrEqual(2);
        return {
          victimField: stringFields[0],
          siblingField: stringFields[1],
          victimSource: (product[stringFields[0]] as Record<string, string>).en,
        };
      },
    );

    const before = await step(vendor, 'snapshot fr slices (CMA)', async () => {
      const products = await client.items.list({ filter: { type: 'product' } });
      return new Map(
        products.map((item) => [
          item.id,
          (item[victimField] as Record<string, unknown> | null)?.fr,
        ]),
      );
    });

    await step(vendor, `fault only "${victimField}" calls with a 400`, () =>
      injectContentError(
        page,
        vendor,
        new RegExp(victimSource.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ),
    );

    await step(vendor, 'open the bulk page', async () => {
      await page.goto(await bulkPageUrl(meta()), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });

    const report = await step(vendor, 'run product → fr to completion', () =>
      runBulkTranslation(page, {
        modelCode: PRODUCT_CODE,
        toLocale: 'fr',
        vendor,
        onlyFields: [victimField, siblingField],
      }),
    );

    // A failed field fails its record — a partially translated record is never
    // reported as a clean success.
    expect(report.errors, report.summary).toBeGreaterThan(0);
    expect(report.completed, report.summary).toBe(0);

    await step(vendor, 'the victim field is untouched; its sibling translated', async () => {
      const products = await client.items.list({ filter: { type: 'product' } });
      for (const item of products) {
        const victim = (item[victimField] as Record<string, unknown> | null)?.fr;
        expect(
          JSON.stringify(victim),
          `${victimField}[fr] must keep its prior value — a failed translation must never overwrite it with null`,
        ).toBe(JSON.stringify(before.get(item.id)));

        const sibling = (item[siblingField] as Record<string, unknown> | null)?.fr;
        expect(
          sibling,
          `${siblingField}[fr] should have translated normally alongside the failure`,
        ).toBeTruthy();
      }
    });

    // The CSV must not claim the faulted field was translated.
    expect(report.csv).not.toMatch(
      new RegExp(`${victimField}[^\\n]*\\btranslated\\b`, 'i'),
    );
  });

  test('an auth error pauses immediately without a countdown', async ({ page }) => {
    const { vendor } = meta();
    test.setTimeout(TIMEOUTS.five_min);

    await step(vendor, 'fault every provider call with a 401', () =>
      injectAuthError(page, vendor),
    );

    const frame = await step(vendor, 'start product → fr and reach the pause', () =>
      startBulkRun(page, { modelCode: PRODUCT_CODE, toLocale: 'fr' }),
    );

    await step(vendor, 'auth pauses at once, Resume enabled, no countdown', async () => {
      await expect(pausePanel(frame)).toBeVisible({ timeout: TIMEOUTS.one_min });
      // Auth is systemic but not a rate limit: manual pause, no auto-retry.
      await expect(
        frame.getByRole('button', { name: 'Resume' }),
        'a non-rate-limit systemic error enables Resume immediately',
      ).toBeEnabled();
      await expect(
        frame.locator('.TranslationProgressModal__pause-countdown'),
        'an auth pause must not show an auto-retry countdown',
      ).toHaveCount(0);
    });

    await step(vendor, 'cancel out of the auth pause', async () => {
      await pausePanel(frame).getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(() => isPauseGone(page), { timeout: TIMEOUTS.one_min }).toBe(true);
    });
  });

  test('Cancel from the pause panel warns that written records are not undone', async ({
    page,
  }) => {
    const { vendor } = meta();
    test.setTimeout(TIMEOUTS.five_min);

    await step(vendor, 'fault every provider call with a 429', () =>
      injectRateLimit(page, { vendor, failTimes: 999 }),
    );

    const frame = await step(vendor, 'start product → fr and reach the pause', () =>
      startBulkRun(page, { modelCode: PRODUCT_CODE, toLocale: 'fr' }),
    );
    await expect(pausePanel(frame)).toBeVisible({ timeout: TIMEOUTS.one_min });

    await step(vendor, 'the exact cancel warning is shown inline (no nested modal)', async () => {
      await expect(
        frame.locator('.TranslationProgressModal__pause-warning'),
        'the pause panel must spell out the cancel consequence verbatim',
      ).toHaveText(CANCEL_WARNING);
    });

    await step(vendor, 'cancel closes the run', async () => {
      await pausePanel(frame).getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(() => isPauseGone(page), { timeout: TIMEOUTS.one_min }).toBe(true);
    });
  });

  // ── Fall-through tests: a finite fault, then the real provider. DeepL only. ──

  test('a rate limit pauses with a countdown and auto-resumes', async ({ page }) => {
    const { vendor } = meta();
    test.skip(vendor !== 'deepl', 'auto-resume falls through to the real provider — DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min);

    await step(vendor, 'fault the first provider call with a 429 (Retry-After: 2s)', () =>
      injectRateLimit(page, { vendor, retryAfterSeconds: 2, failTimes: 1 }),
    );

    const frame = await step(vendor, 'start product → fr (name only)', () =>
      startBulkRun(page, {
        modelCode: PRODUCT_CODE,
        toLocale: 'fr',
        onlyFields: ['name'],
      }),
    );

    await step(vendor, 'the pause shows a countdown with Resume disabled', async () => {
      await expect(pausePanel(frame)).toBeVisible({ timeout: TIMEOUTS.one_min });
      await expect(
        frame.locator('.TranslationProgressModal__pause-countdown'),
        'a rate-limit auto-retry must show its countdown',
      ).toHaveText(/Retrying automatically in \d+s/);
      await expect(
        frame.getByRole('button', { name: 'Resume' }),
        'Resume stays disabled while the auto-retry countdown runs',
      ).toBeDisabled();
    });

    await step(vendor, 'the run then auto-resumes and completes', async () => {
      const close = frame.getByRole('button', { name: 'Close', exact: true });
      await expect(close).toBeEnabled({ timeout: TIMEOUTS.five_min });
    });
  });

  test('an exhausted retry budget waits for a manual resume', async ({ page }) => {
    const { vendor } = meta();
    test.skip(vendor !== 'deepl', 'manual resume falls through to the real provider — DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min);

    // Four consecutive 429s: three auto-retries, then the budget is spent and the
    // pause persists with an enabled Resume; the fifth call hits the real provider.
    await step(vendor, 'fault the first four provider calls with a 429', () =>
      injectRateLimit(page, { vendor, failTimes: 4 }),
    );

    const frame = await step(vendor, 'start product → fr (name only)', () =>
      startBulkRun(page, {
        modelCode: PRODUCT_CODE,
        toLocale: 'fr',
        onlyFields: ['name'],
      }),
    );

    const resume = frame.getByRole('button', { name: 'Resume' });
    await step(vendor, 'after the budget is exhausted Resume becomes enabled', async () => {
      await expect(pausePanel(frame)).toBeVisible({ timeout: TIMEOUTS.one_min });
      // The three auto-retries pass; once spent, the pause hands over to the user.
      await expect(resume, 'an exhausted rate-limit budget enables manual Resume').toBeEnabled({
        timeout: TIMEOUTS.five_min,
      });
      await expect(
        frame.locator('.TranslationProgressModal__pause-countdown'),
        'no countdown once the auto-retry budget is spent',
      ).toHaveCount(0);
    });

    await step(vendor, 'clicking Resume continues the run to completion', async () => {
      await resume.click();
      const close = frame.getByRole('button', { name: 'Close', exact: true });
      await expect(close).toBeEnabled({ timeout: TIMEOUTS.five_min });
    });
  });

  test('Retry-After is honored: the pause lasts at least the header delay', async ({
    page,
  }) => {
    const { vendor } = meta();
    test.skip(vendor !== 'deepl', 'timing check falls through to the real provider — DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min);

    await step(vendor, 'fault the first provider call with a 429 (Retry-After: 5s)', () =>
      injectRateLimit(page, { vendor, retryAfterSeconds: 5, failTimes: 1 }),
    );

    const frame = await step(vendor, 'start product → fr (name only)', () =>
      startBulkRun(page, {
        modelCode: PRODUCT_CODE,
        toLocale: 'fr',
        onlyFields: ['name'],
      }),
    );

    await step(vendor, 'the auto-resume waits out the 5s Retry-After', async () => {
      await expect(pausePanel(frame)).toBeVisible({ timeout: TIMEOUTS.one_min });
      const pausedAt = Date.now();
      // The pause clears only when the countdown elapses and the retry fires.
      await expect(pausePanel(frame)).toHaveCount(0, { timeout: TIMEOUTS.thirty_sec });
      const waited = Date.now() - pausedAt;
      expect(
        waited,
        `the run should have waited ~5s for the Retry-After hint, waited ${waited}ms`,
      ).toBeGreaterThanOrEqual(4500);
    });
  });

  test('blind backoff applies when Retry-After is absent', async ({ page }) => {
    const { vendor } = meta();
    test.skip(vendor !== 'deepl', 'blind-backoff resume falls through to the real provider — DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min);

    // No `retry-after` header — the browser often cannot read it (CORS), so the
    // exponential backoff must carry the wait on its own.
    await step(vendor, 'fault the first provider call with a headerless 429', () =>
      injectRateLimit(page, { vendor, failTimes: 1 }),
    );

    const frame = await step(vendor, 'start product → fr (name only)', () =>
      startBulkRun(page, {
        modelCode: PRODUCT_CODE,
        toLocale: 'fr',
        onlyFields: ['name'],
      }),
    );

    await step(vendor, 'the run still pauses, waits, and resumes to completion', async () => {
      await expect(pausePanel(frame)).toBeVisible({ timeout: TIMEOUTS.one_min });
      const close = frame.getByRole('button', { name: 'Close', exact: true });
      await expect(close).toBeEnabled({ timeout: TIMEOUTS.five_min });
    });
  });

  test('Export CSV is disabled mid-run and while paused, enabled once complete', async ({
    page,
  }) => {
    const { vendor } = meta();
    test.skip(vendor !== 'deepl', 'export gating asserted against a completing run — DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min);

    await step(vendor, 'fault the first provider call with a 429', () =>
      injectRateLimit(page, { vendor, retryAfterSeconds: 2, failTimes: 1 }),
    );

    const frame = await step(vendor, 'start product → fr (name only)', () =>
      startBulkRun(page, {
        modelCode: PRODUCT_CODE,
        toLocale: 'fr',
        onlyFields: ['name'],
      }),
    );
    const exportButton = frame.getByRole('button', { name: /export csv/i });

    await step(vendor, 'Export is disabled while the run is paused', async () => {
      await expect(pausePanel(frame)).toBeVisible({ timeout: TIMEOUTS.one_min });
      await expect(
        exportButton,
        'a paused run is not a finished run — its CSV would be misleadingly partial',
      ).toBeDisabled();
    });

    await step(vendor, 'Export is enabled once the run completes', async () => {
      const close = frame.getByRole('button', { name: 'Close', exact: true });
      await expect(close).toBeEnabled({ timeout: TIMEOUTS.five_min });
      await expect(exportButton, 'a completed run offers its report').toBeEnabled();
    });
  });

  test('a CMA read-back mismatch fails the record', async ({ page }) => {
    const { vendor } = meta();
    test.skip(vendor !== 'deepl', 'read-back needs a real translation to strip — DeepL lane');
    test.setTimeout(TIMEOUTS.ten_min);

    // Let the translation and CMA save succeed, then null the saved `name.ja` in
    // the response the plugin reads back — the structural check must catch the
    // CMA "silently dropping" a value the run believed it wrote and fail the record.
    await step(vendor, 'strip name.ja from every CMA update response', () =>
      injectCmaFieldStrip(page, 'name', 'ja'),
    );

    const report = await step(vendor, 'run product → ja (name only) to completion', () =>
      runBulkTranslation(page, {
        modelCode: PRODUCT_CODE,
        toLocale: 'ja',
        vendor,
        onlyFields: ['name'],
      }),
    );

    await step(vendor, 'the stripped write is reported as a failure naming the field + locale', () => {
      expect(
        report.errors,
        `a read-back mismatch must fail the record\n${report.summary}`,
      ).toBeGreaterThanOrEqual(1);
      expect(report.csv, 'the failure note should name the dropped field').toContain('name');
      expect(
        report.csv,
        'the failure note should name the target locale',
      ).toContain('Japanese [ja]');
      expect(
        report.csv.toLowerCase(),
        'the note should state the CMA came back without the value',
      ).toMatch(/came back (null|absent|empty) from the cma/);
      return Promise.resolve();
    });
  });
});
