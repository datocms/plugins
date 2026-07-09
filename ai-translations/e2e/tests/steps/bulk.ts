import { readFileSync } from 'node:fs';
import { type Frame, type FrameLocator, type Page, expect } from '@playwright/test';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from '../setup/constants';
import { resolvePluginId } from '../setup/plugin-params';
import type { ProjectMeta } from '../fixtures/providers';
import { note } from '../setup/log';

/** Direct URL to the plugin's Bulk Translations settings page in an environment. */
export const bulkPageUrl = async (meta: ProjectMeta): Promise<string> => {
  const pluginId = await resolvePluginId();
  return (
    `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${meta.envName}` +
    `/configuration/p/${pluginId}/pages/ai-bulk-translations`
  );
};

/** FrameLocator for the visible bulk-page plugin iframe. */
const bulkFrame = (page: Page): FrameLocator =>
  page.locator('iframe[src*="localhost:5173"]').filter({ visible: true }).contentFrame();

/** Pick a locale/model option (carrying its code in a `<code>` element) by code. */
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

/** The plugin renders confirm/progress as separate modal iframes; find the one
 * whose document currently holds a button matching `name`, polling until it
 * appears (modals mount a beat after the trigger). `withoutText` skips frames
 * whose body contains that text — needed when two sibling modals expose a
 * same-named button (the items-dropdown picker and the confirm modal both have
 * a "Translate N records" button; only the picker says "Fields to translate"). */
export const frameWithButton = async (
  page: Page,
  name: RegExp,
  withoutText?: string,
): Promise<Frame> => {
  let found: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (!frame.url().includes('localhost:5173')) continue;
          if (!(await frame.getByRole('button', { name }).count().catch(() => 0))) continue;
          if (
            withoutText &&
            (await frame.getByText(withoutText).count().catch(() => 1)) > 0
          ) {
            continue;
          }
          found = frame;
          return true;
        }
        return false;
      },
      { timeout: TIMEOUTS.one_min },
    )
    .toBe(true);
  return found!;
};

/** Parsed outcome of a bulk run, read from the progress modal's summary line. */
export type BulkReport = {
  total: number;
  completed: number;
  withWarnings: number;
  errors: number;
  summary: string;
  /**
   * The exported CSV report text (BOM stripped), captured by clicking the
   * modal's "Export CSV" button — master's per-record report feature (card:
   * "report from bulk translations"). Empty string if the capture failed.
   */
  csv: string;
  /** Whether at least one record row rendered a real editor link (an anchor). */
  hasRecordLink: boolean;
  /** The first record-row editor link's href ('' when none rendered). */
  recordLinkHref: string;
};

/**
 * Trigger the progress modal's "Export CSV" and return the downloaded file's
 * text (leading UTF-8 BOM stripped). `downloadCsv` clicks a blob-URL anchor, so
 * the download event fires on the page rather than inside the modal frame.
 */
const exportReportCsv = async (page: Page, frame: Frame): Promise<string> => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: TIMEOUTS.thirty_sec }),
    frame.getByRole('button', { name: /export csv/i }).click(),
  ]);
  const path = await download.path();
  return readFileSync(path, 'utf8').replace(/^﻿/, '');
};

export const parseReport = (
  progressText: string,
  statsText: string,
): Omit<BulkReport, 'csv' | 'hasRecordLink' | 'recordLinkHref'> => {
  const total = progressText.match(/of\s*(\d+)\s*records/i);
  const stats = statsText.match(/(\d+)\s*successful.*?(\d+)\s*with warnings.*?(\d+)\s*failed/is);
  return {
    total: total ? Number(total[1]) : 0,
    completed: stats ? Number(stats[1]) : 0,
    withWarnings: stats ? Number(stats[2]) : 0,
    errors: stats ? Number(stats[3]) : 0,
    summary: `${progressText} | ${statsText}`.replace(/\s+/g, ' ').trim(),
  };
};

/**
 * Drive the Bulk Translations page: pick a content model + one target locale
 * (source stays at its default first locale), start, confirm, wait for the
 * progress modal to finish, and return the parsed per-run report. Bounded to one
 * model + one locale to keep real-provider runtime sane.
 */
export const runBulkTranslation = async (
  page: Page,
  opts: {
    modelCode: string;
    toLocale: string;
    vendor: string;
    /** Progress-modal completion budget; default 5 min. The DeepL lane translates
     * EVERY editor (incl. structured/rich text), so heavy models need longer. */
    closeTimeout?: number;
    /**
     * Narrow the model's field selection to exactly these api_keys (default:
     * every translatable field). Relies on ModelFieldPicker's narrowing rule —
     * picking a specific field while "All fields" is active replaces the
     * selection with just that field; further picks add to it.
     */
    onlyFields?: string[];
  },
): Promise<BulkReport> => {
  const { vendor } = opts;
  const frame = bulkFrame(page);

  // Controls: 0=source, 1=target locales, 2=models, 3+=per-model field pickers.
  note(vendor, `selecting model "${opts.modelCode}"…`);
  await selectByCode(frame, 2, opts.modelCode);
  await frame.getByText(/Fields to translate/i).waitFor({ timeout: TIMEOUTS.thirty_sec });
  note(vendor, `selecting target locale "${opts.toLocale}"…`);
  await selectByCode(frame, 1, opts.toLocale);

  if (opts.onlyFields?.length) {
    note(vendor, `narrowing field selection to [${opts.onlyFields.join(', ')}]…`);
    // First pick narrows "All fields" down to that one; later picks add.
    for (const fieldApiKey of opts.onlyFields) {
      await selectByCode(frame, 3, fieldApiKey);
    }
    await expect(
      frame.getByText(
        new RegExp(`${opts.onlyFields.length} of \\d+ fields? selected`),
      ),
      'the field picker should confirm the narrowed selection',
    ).toBeVisible({ timeout: TIMEOUTS.thirty_sec });
  }

  note(vendor, 'starting the bulk run…');
  await frame.getByRole('button', { name: /start bulk translation/i }).click();

  // Confirm modal (its own iframe): the confirm button reads "Translate <N records>".
  note(vendor, 'confirming the run…');
  const confirmFrame = await frameWithButton(page, /^Translate /);
  await confirmFrame.getByRole('button', { name: /^Translate / }).click();

  // Progress modal (its own iframe): Close enables only once the run completes.
  const closeTimeout = opts.closeTimeout ?? TIMEOUTS.five_min;
  note(
    vendor,
    `bulk run in progress — waiting for the progress modal to finish (up to ${Math.round(closeTimeout / 60_000)} min)…`,
  );
  const progressFrame = await frameWithButton(page, /^(Close|Please wait)/);
  const close = progressFrame.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeEnabled({ timeout: closeTimeout });

  const progressText = await progressFrame
    .locator('.TranslationProgressModal__progress-text')
    .innerText()
    .catch(() => '');
  const statsText = await progressFrame
    .locator('.TranslationProgressModal__stats')
    .innerText()
    .catch(() => '');
  const report = parseReport(progressText, statsText);
  note(vendor, `bulk run finished: ${report.summary}`);

  // Master's report affordances (card: "report from bulk translations"): the
  // finished modal exposes an Export CSV button and links each record row to its
  // editor. Reuse this single (expensive) real-provider run to exercise both.
  const csv = await exportReportCsv(page, progressFrame).catch((error) => {
    note(vendor, `Export CSV capture failed: ${error}`);
    return '';
  });
  const recordLinks = progressFrame.locator('a.TranslationProgressModal__record-link');
  const hasRecordLink = (await recordLinks.count().catch(() => 0)) > 0;
  const recordLinkHref = hasRecordLink
    ? ((await recordLinks.first().getAttribute('href').catch(() => '')) ?? '')
    : '';

  await close.click();
  return { ...report, csv, hasRecordLink, recordLinkHref };
};
