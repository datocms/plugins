import { type Frame, type FrameLocator, type Page, expect } from '@playwright/test';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from '../setup/constants';
import { resolvePluginId } from '../setup/plugin-params';
import type { ProjectMeta } from '../fixtures/providers';

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
 * appears (modals mount a beat after the trigger). */
const frameWithButton = async (page: Page, name: RegExp): Promise<Frame> => {
  let found: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (!frame.url().includes('localhost:5173')) continue;
          if (await frame.getByRole('button', { name }).count().catch(() => 0)) {
            found = frame;
            return true;
          }
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
};

const parseReport = (progressText: string, statsText: string): BulkReport => {
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
  opts: { modelCode: string; toLocale: string },
): Promise<BulkReport> => {
  const frame = bulkFrame(page);

  // Controls: 0=source, 1=target locales, 2=models.
  await selectByCode(frame, 2, opts.modelCode);
  await frame.getByText(/Fields to translate/i).waitFor({ timeout: TIMEOUTS.thirty_sec });
  await selectByCode(frame, 1, opts.toLocale);

  await frame.getByRole('button', { name: /start bulk translation/i }).click();

  // Confirm modal (its own iframe): the confirm button reads "Translate <N records>".
  const confirmFrame = await frameWithButton(page, /^Translate /);
  await confirmFrame.getByRole('button', { name: /^Translate / }).click();

  // Progress modal (its own iframe): Close enables only once the run completes.
  const progressFrame = await frameWithButton(page, /^(Close|Please wait)/);
  const close = progressFrame.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeEnabled({ timeout: TIMEOUTS.five_min });

  const progressText = await progressFrame
    .locator('.TranslationProgressModal__progress-text')
    .innerText()
    .catch(() => '');
  const statsText = await progressFrame
    .locator('.TranslationProgressModal__stats')
    .innerText()
    .catch(() => '');
  const report = parseReport(progressText, statsText);

  await close.click();
  return report;
};
