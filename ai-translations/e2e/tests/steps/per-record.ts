import { type FrameLocator, type Page, expect } from '@playwright/test';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from '../setup/constants';
import type { ProjectMeta } from '../fixtures/providers';
import { note } from '../setup/log';

/** Direct URL to a record's edit form within a specific environment. */
export const editorUrl = (meta: ProjectMeta, itemTypeId: string, itemId: string): string =>
  `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${meta.envName}` +
  `/editor/item_types/${itemTypeId}/items/${itemId}/edit`;

/**
 * A record opened in another (often stale) session shows a "Record editing is
 * disabled … Take over" banner; translating writes to the form, so we must hold
 * the editing session. Take over if the banner is present (two-step confirm).
 */
const takeOverIfLocked = async (page: Page, vendor: string): Promise<void> => {
  const takeOver = page.getByRole('button', { name: 'Take over' });
  if ((await takeOver.count()) === 0) return;
  note(vendor, 'record locked by a stale editing session — taking over');
  await takeOver.first().click();
  const confirm = page.getByRole('button', { name: /yes, take control/i });
  await confirm.click({ timeout: TIMEOUTS.thirty_sec });
  await page.waitForLoadState('networkidle');
};

/** Widest `localhost:5173` iframe width (0 ⇒ the panel is collapsed). */
const panelIframeWidth = (page: Page): Promise<number> =>
  page.$$eval('iframe[src*="localhost:5173"]', (els) =>
    Math.max(0, ...els.map((e) => Math.round(e.getBoundingClientRect().width))),
  );

/**
 * Expand the AI Translations sidebar panel (it ships `startOpen`, but a prior
 * interaction can collapse it) and return a FrameLocator for the *visible*
 * plugin iframe — the hidden bootstrap frame has zero width, so `:visible`
 * selects the right one.
 */
const openTranslationPanel = async (page: Page): Promise<FrameLocator> => {
  const header = page
    .locator('.SidebarPanel__header', { has: page.getByText('AI Translations', { exact: true }) })
    .first();
  // Wait for the panel header to attach+stabilise (the plugin iframe loading
  // re-renders the sidebar, so an explicit scrollIntoView races the detach).
  await expect(header).toBeVisible({ timeout: TIMEOUTS.one_min });
  if ((await panelIframeWidth(page)) === 0) {
    await header.click(); // auto-scrolls and auto-retries if the node re-renders
    await expect.poll(() => panelIframeWidth(page), { timeout: TIMEOUTS.thirty_sec }).toBeGreaterThan(0);
  }
  return page.locator('iframe[src*="localhost:5173"]').filter({ visible: true }).contentFrame();
};

/**
 * Pick a locale in one of the panel's react-select controls by its locale code.
 * Each option renders the code in a `<code>` element (the name+code concatenate
 * without a separator, so a text match on the code alone is unreliable).
 */
const selectLocale = async (
  panel: FrameLocator,
  controlIndex: number,
  localeCode: string,
): Promise<void> => {
  await panel.locator('[class*="-control"]').nth(controlIndex).click();
  await panel
    .locator('[class*="-option"]')
    .filter({ has: panel.locator('code', { hasText: new RegExp(`^${localeCode}$`) }) })
    .first()
    .click();
};

/** Result of driving the sidebar: completion + any user-facing QC toast texts. */
export type SidebarRunResult = { completed: boolean; toasts: string[] };

/**
 * Drive the AI Translations sidebar for the open record: set the source locale,
 * leave the target locales at their default (all other active locales), run, and
 * wait for completion. Returns the dashboard-level toast texts (where the QC
 * `ctx.notice`/`ctx.alert` warnings surface). Does NOT save — the caller saves,
 * then asserts via CMA.
 */
export const translateRecordViaSidebar = async (
  page: Page,
  opts: { fromLocale: string; vendor: string },
): Promise<SidebarRunResult> => {
  const { vendor } = opts;
  note(vendor, 'opening the AI Translations sidebar panel…');
  const panel = await openTranslationPanel(page);

  // Source select is the first control; the target select keeps its default
  // (all other active locales of the record).
  note(vendor, `setting source locale "${opts.fromLocale}"…`);
  await selectLocale(panel, 0, opts.fromLocale);

  note(vendor, 'clicking "Translate all fields" (one provider call per field)…');
  await panel.getByRole('button', { name: 'Translate all fields' }).click();

  // Completion: the panel shows a celebration line once values are applied.
  // Budget for a slow / rate-limited provider translating every field.
  note(vendor, 'translating — waiting for every field to be applied to the form (up to 10 min)…');
  const done = panel.getByText(/Translations were applied to the form/i);
  await expect(done).toBeVisible({ timeout: TIMEOUTS.ten_min });
  note(vendor, 'translations applied to the form ✓');

  // QC warnings/errors surface as dashboard toasts (ctx.notice / ctx.alert),
  // which fire just after completion — give them a beat to render.
  await page.waitForTimeout(1500);
  const toasts = await page
    .locator('[class*="oast" i], [class*="otification" i], [role="alert"]')
    .allInnerTexts()
    .catch(() => []);

  return { completed: true, toasts: toasts.map((t) => t.trim()).filter(Boolean) };
};

/** Open a record's editor, reusing the session, and take over if it's locked. */
export const openRecord = async (
  page: Page,
  meta: ProjectMeta,
  itemTypeId: string,
  itemId: string,
): Promise<void> => {
  note(meta.vendor, `navigating to record ${itemId} in ${meta.envName}…`);
  await page.goto(editorUrl(meta, itemTypeId, itemId), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await takeOverIfLocked(page, meta.vendor);
};

/** Outcome of a save attempt: the CMA PUT status + any field-validation messages. */
export type SaveResult = { status: number; locked: boolean; fieldErrors: string[] };

/** Click Save and resolve with the record-update PUT's status + any field errors. */
const clickSaveAndCapture = async (page: Page): Promise<SaveResult> => {
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled({ timeout: TIMEOUTS.thirty_sec });
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => /\/items\//.test(r.url()) && r.request().method() === 'PUT',
      { timeout: TIMEOUTS.one_min },
    ),
    save.click(),
  ]);
  const status = response.status();
  const body = status >= 400 ? await response.text().catch(() => '') : '';
  const fieldErrors =
    status >= 400
      ? await page.locator('[class*="error" i]').allInnerTexts().catch(() => [])
      : [];
  return { status, locked: /ITEM_LOCKED/.test(body), fieldErrors: fieldErrors.filter(Boolean) };
};

/**
 * Persist the form (the sidebar wrote translated values into the form only) and
 * return the CMA save result. Asserting the PUT status is more reliable than the
 * Save button's state, which doesn't consistently toggle in this dashboard
 * version. Retries once through a fresh take-over if the record is transiently
 * locked by a stale editing session.
 */
export const saveRecord = async (page: Page, vendor: string): Promise<SaveResult> => {
  let result = await clickSaveAndCapture(page);
  if (result.locked) {
    note(vendor, 'save hit a transient ITEM_LOCKED — taking over and retrying once');
    await takeOverIfLocked(page, vendor);
    result = await clickSaveAndCapture(page);
  }
  return result;
};
