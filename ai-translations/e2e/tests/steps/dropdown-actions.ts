import { type Frame, type Page, expect } from '@playwright/test';
import type { ProjectMeta } from '../fixtures/providers';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from '../setup/constants';
import { note } from '../setup/log';
import { type BulkReport, frameWithButton, parseReport } from './bulk';

/**
 * Steps for the plugin's two dropdown-action surfaces, which live in the
 * DASHBOARD chrome (not the plugin iframe):
 *
 * - the per-field kebab menu ("Translate to →" / "Translate from →"), registered
 *   via `fieldDropdownActions` — the plugin's original core feature;
 * - the record-list batch action ("AI Translate these records"), registered via
 *   `itemsDropdownActions`, which chains the picker → confirm → progress modals.
 *
 * Dashboard DOM contract used here (discovered against the real dashboard):
 * a field's kebab is `[id="field--<fieldPath>"] button.Dropdown__icon-trigger`;
 * open menus render into `.Dropdown__menu-container` portals whose entries are
 * `.Dropdown__menu__option`; hovering a group option (e.g. "Translate to")
 * opens its submenu in a SECOND menu container. The record list only offers
 * multi-selection in the `table` collection appearance, where each row carries
 * an `input[type=checkbox]` and the batch-actions dropdown trigger is
 * `button.Dropdown__icon-trigger--reverse`.
 */

/** Visible dropdown-menu options (across every open menu portal). */
const menuOptions = (page: Page) =>
  page.locator('.Dropdown__menu-container:visible .Dropdown__menu__option');

/**
 * Open a field's kebab menu and return every entry's text once the menu has
 * rendered (the built-in "Go to <field> field" entry is the ready signal —
 * it is present regardless of plugin state, so its appearance means any
 * plugin-registered entries are settled too). Closes the menu before
 * returning, leaving the page as found. Used by the surface-gating tests to
 * assert an action's PRESENCE or ABSENCE deterministically.
 */
export const fieldMenuEntries = async (
  page: Page,
  fieldPath: string,
): Promise<string[]> => {
  const kebab = page
    .locator(`[id="field--${fieldPath}"] button.Dropdown__icon-trigger`)
    .first();
  await expect(kebab, `field ${fieldPath} should render a kebab menu`).toBeVisible({
    timeout: TIMEOUTS.one_min,
  });
  await kebab.click();
  await expect(
    menuOptions(page).filter({ hasText: 'Go to' }).first(),
    'the field menu should render (built-in entry present)',
  ).toBeVisible({ timeout: TIMEOUTS.thirty_sec });
  // Give the plugin's async action registration one settle beat beyond the
  // built-in entry, then read the final entry set.
  await page.waitForTimeout(1500);
  const entries = await menuOptions(page).allTextContents();
  await page.keyboard.press('Escape');
  return entries.map((e) => e.trim());
};

/** Result of a field-dropdown translation: the toasts the run surfaced. */
export type FieldDropdownRunResult = { toasts: string[] };

/**
 * Run one field kebab-menu dropdown action: open the menu, hover the
 * "Translate to/from" group, pick an entry (a locale rendered as
 * `<label> [<code>]`, or a named entry like "All locales"), and wait for the
 * flow's terminal toast. Retries opening the menu until the plugin's actions
 * are registered — the hidden plugin frame boots a beat after the record
 * editor renders, and until then the kebab only holds built-in entries.
 */
export const translateFieldViaDropdown = async (
  page: Page,
  opts: {
    /** Form path of the field in the CURRENT editing locale, e.g. `excerpt.en`. */
    fieldPath: string;
    group: 'Translate to' | 'Translate from';
    /** Locale code shown in the entry's brackets, e.g. `es`. */
    localeCode?: string;
    /** Exact entry text when it isn't a bracketed locale (e.g. 'All locales'). */
    entryText?: string;
    /**
     * Toast pattern that ends the flow. Defaults to the completion notice; an
     * expected-failure flow (e.g. the empty-source guard) passes its alert
     * pattern instead.
     */
    completionPattern?: RegExp;
    vendor: string;
  },
): Promise<FieldDropdownRunResult> => {
  const { vendor } = opts;
  const kebab = page
    .locator(`[id="field--${opts.fieldPath}"] button.Dropdown__icon-trigger`)
    .first();
  await expect(kebab, `field ${opts.fieldPath} should render a kebab menu`).toBeVisible({
    timeout: TIMEOUTS.one_min,
  });

  // Open the kebab until the plugin's group entry is present (plugin boot race).
  note(vendor, `opening the ${opts.fieldPath} field menu…`);
  const group = menuOptions(page).filter({ hasText: opts.group }).first();
  await expect
    .poll(
      async () => {
        if (await group.count().catch(() => 0)) return true;
        await page.keyboard.press('Escape');
        await kebab.click();
        await page.waitForTimeout(1000);
        return (await group.count().catch(() => 0)) > 0;
      },
      {
        timeout: TIMEOUTS.three_min,
        message: `the "${opts.group}" plugin action never appeared in the ${opts.fieldPath} menu`,
      },
    )
    .toBe(true);

  // Hover the group to open its submenu, then pick the entry (by locale code
  // in brackets, or by its literal text for named entries).
  const entryFilter = opts.entryText ?? `[${opts.localeCode}]`;
  note(vendor, `picking "${opts.group}" → ${entryFilter}…`);
  await group.hover();
  const entry = menuOptions(page).filter({ hasText: entryFilter }).first();
  await entry.click({ timeout: TIMEOUTS.thirty_sec });

  // The run surfaces a warning toast while translating and a notice on
  // completion (or an alert on a guarded failure). Accumulate toasts (they
  // auto-dismiss) until the terminal pattern shows up.
  const completionPattern = opts.completionPattern ?? /Translated "/i;
  note(vendor, 'waiting for the field action to settle…');
  const toasts = new Set<string>();
  await expect
    .poll(
      async () => {
        const texts = await page
          .locator('[class*="oast" i], [class*="otification" i], [role="alert"]')
          .allInnerTexts()
          .catch(() => [] as string[]);
        for (const t of texts) if (t.trim()) toasts.add(t.trim());
        return [...toasts].some((t) => completionPattern.test(t));
      },
      {
        timeout: TIMEOUTS.three_min,
        message: `no toast matching ${completionPattern}; toasts seen:\n${[...toasts].join('\n') || '(none)'}`,
      },
    )
    .toBe(true);
  note(vendor, 'field action settled');
  return { toasts: [...toasts] };
};

/**
 * Select every record in a `table`-appearance record list and return once the
 * batch-actions dropdown trigger is visible. The header checkbox can land
 * during table hydration (especially right after a collection-appearance flip)
 * and lose the selection, so the click retries until the trigger — which only
 * renders while rows are selected — actually shows up.
 */
export const selectAllRecords = async (page: Page): Promise<void> => {
  const selectAll = page.locator(
    '.ItemsTable__header-cell--checkbox input[type="checkbox"]',
  );
  await expect(selectAll, 'the table header select-all checkbox').toBeVisible({
    timeout: TIMEOUTS.one_min,
  });
  const batchTrigger = page.locator('button.Dropdown__icon-trigger--reverse:visible');
  await expect
    .poll(
      async () => {
        if (await batchTrigger.count().catch(() => 0)) return true;
        // check() (not click()) — a plain click would TOGGLE, so a retry
        // firing while the trigger is still rendering would deselect
        // everything and oscillate forever. check() is a no-op when the
        // header checkbox is already on.
        await selectAll.check().catch(() => {});
        await page.waitForTimeout(3000);
        return (await batchTrigger.count().catch(() => 0)) > 0;
      },
      {
        timeout: TIMEOUTS.one_min,
        message: 'selecting all records never surfaced the batch-actions trigger',
      },
    )
    .toBe(true);
};

/** Outcome of an items-dropdown bulk run. */
export type ItemsDropdownRunResult = {
  report: Omit<BulkReport, 'csv' | 'hasRecordLink' | 'recordLinkHref'>;
  /** Dashboard toasts collected after the progress modal closed (the
   * "Successfully translated…" notice or the "need review" alert). */
  toasts: string[];
};

/**
 * Drive the record-list batch action end to end: select every record with the
 * header checkbox, run "AI Translate these records", configure the picker
 * (keep the default source = the project's first locale, pick ONE target
 * locale), confirm, wait for the progress modal, and return its parsed report
 * plus the post-run toasts.
 *
 * Requires the model's collection appearance to be `table` (the compact list
 * has no selection affordance) — flip it via CMA in the test's forked env.
 */
export const runItemsDropdownTranslation = async (
  page: Page,
  meta: ProjectMeta,
  opts: { itemTypeId: string; toLocale: string; closeTimeout?: number },
): Promise<ItemsDropdownRunResult> => {
  const { vendor } = meta;

  note(vendor, 'opening the record list (table appearance)…');
  await page.goto(
    `https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/environments/${meta.envName}` +
      `/editor/item_types/${opts.itemTypeId}/items`,
    { waitUntil: 'domcontentloaded' },
  );
  note(vendor, 'selecting every record…');
  await selectAllRecords(page);
  const batchTrigger = page.locator('button.Dropdown__icon-trigger--reverse:visible');

  // The plugin's items action registers once its hidden frame has booted.
  note(vendor, 'opening the batch-actions menu…');
  const action = menuOptions(page)
    .filter({ hasText: 'AI Translate these records' })
    .first();
  await expect
    .poll(
      async () => {
        if (await action.count().catch(() => 0)) return true;
        await page.keyboard.press('Escape');
        await batchTrigger.click();
        await page.waitForTimeout(1000);
        return (await action.count().catch(() => 0)) > 0;
      },
      {
        timeout: TIMEOUTS.three_min,
        message: 'the "AI Translate these records" batch action never appeared',
      },
    )
    .toBe(true);
  await action.click();

  // Picker modal: source defaults to the project's first locale; picking one
  // explicit target replaces the default "All other locales" chip.
  note(vendor, `picker: choosing target locale "${opts.toLocale}"…`);
  const picker = await frameWithButton(page, /^Translate \d+ record/);
  await picker.locator('[class*="-control"]').nth(1).click();
  await picker
    .locator('[class*="-option"]')
    .filter({ has: picker.locator('code', { hasText: new RegExp(`^${opts.toLocale}$`) }) })
    .first()
    .click();
  const startButton = picker.getByRole('button', { name: /^Translate \d+ record/ });
  await expect(startButton).toBeEnabled({ timeout: TIMEOUTS.one_min });
  await startButton.click();

  // Confirm modal: same button label as the picker — tell them apart by the
  // picker-only "Fields to translate" heading.
  note(vendor, 'confirming the run…');
  const confirm = await frameWithButton(
    page,
    /^Translate \d+ record/,
    'Fields to translate',
  );
  await confirm.getByRole('button', { name: /^Translate \d+ record/ }).click();

  // Progress modal: identical to the bulk page's — reuse its stats contract.
  const closeTimeout = opts.closeTimeout ?? TIMEOUTS.five_min;
  note(
    vendor,
    `translating — waiting for the progress modal to finish (up to ${Math.round(closeTimeout / 60_000)} min)…`,
  );
  const progress: Frame = await frameWithButton(page, /^(Close|Please wait)/);
  const close = progress.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeEnabled({ timeout: closeTimeout });

  const progressText = await progress
    .locator('.TranslationProgressModal__progress-text')
    .innerText()
    .catch(() => '');
  const statsText = await progress
    .locator('.TranslationProgressModal__stats')
    .innerText()
    .catch(() => '');
  const report = parseReport(progressText, statsText);
  note(vendor, `items-dropdown run finished: ${report.summary}`);
  await close.click();

  // The dropdown handler surfaces a completion notice (or a "need review"
  // alert) AFTER the modal resolves — give it a beat and collect the toasts.
  const toasts = new Set<string>();
  for (let i = 0; i < 10; i += 1) {
    const texts = await page
      .locator('[class*="oast" i], [class*="otification" i], [role="alert"]')
      .allInnerTexts()
      .catch(() => [] as string[]);
    for (const t of texts) if (t.trim()) toasts.add(t.trim());
    if ([...toasts].some((t) => /translated|need review|canceled/i.test(t))) break;
    await page.waitForTimeout(1000);
  }
  return { report, toasts: [...toasts] };
};
