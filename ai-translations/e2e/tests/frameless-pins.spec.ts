import { expect, test } from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { cmaClient } from './setup/cma';
import { RESTRICTED_STORAGE_STATE, TIMEOUTS } from './setup/constants';
import { requireEnv } from './setup/env';
import { step } from './setup/log';
import { recordOutcome } from './setup/outcomes';
import {
  findRecord,
  findRecordByTitle,
  getLocaleValue,
  loadManifest,
} from './steps/assert-record';
import {
  openRecord,
  openTranslationPanel,
  saveRecord,
  translateRecordViaSidebar,
} from './steps/per-record';
import { getPluginParams, setPluginParams } from './steps/plugin-config';

/**
 * Frameless/exclusion/copy-from-source/round-trip/locale-scope pins (spec
 * §9.4). This file sorts after `bulk-reliability.spec.ts` alphabetically, so
 * it runs LAST — every test here opens a record in the editor (taking an
 * editing-session lock), and nothing after it needs those records unlocked.
 *
 * Every "was a phase-0 test.fail() pin" test below asserts the FIXED
 * behavior: the phase-0 plan (`docs/superpowers/plans/2026-07-14-v4-phase0-e2e-foundations.md`,
 * Tasks 5-8) wrote these as `test.fail()` because it predates the engine
 * fixes; those fixes have since landed on this branch, so the pin flips to a
 * plain passing `test()`.
 */

const manifest = loadManifest();
const ARTICLE = manifest.schema.models.article.id;
const BLOCK_VARIANTS = manifest.schema.models.block_variants.id;
// BV Probe and BV Control are both `block_variants` records sharing the same
// [en, it] source-locale set, so `findRecord` can't disambiguate them — use
// the title-based finder added alongside this spec.
const BV_PROBE = findRecordByTitle(manifest, 'block_variants', 'BV Probe');
const BV_CONTROL = findRecordByTitle(manifest, 'block_variants', 'BV Control');
const A1 = findRecord(manifest, 'article', ['en', 'it']); // kitchen sink

const meta = (): ProjectMeta => test.info().project.metadata as ProjectMeta;

/**
 * Tolerant reader for a single_block value's `body` sub-field. The CMA node
 * client has been observed returning both a flattened `{ body }` shape and a
 * JSON:API-ish `{ attributes: { body } }` shape for block values depending on
 * the read path — tolerate both rather than pin one (flag in the first-run
 * report if either shape turns out to never occur).
 */
const bodyOf = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const attributes = record.attributes;
  if (attributes && typeof attributes === 'object') {
    return (attributes as Record<string, unknown>).body;
  }
  return record.body;
};

/** Find the CMA field id of a block model's field by api_key (e.g. `callout.body`). */
const findBlockFieldId = async (
  envName: string,
  blockApiKey: string,
  fieldApiKey: string,
): Promise<string> => {
  const client = cmaClient(envName);
  const itemTypes = await client.itemTypes.list();
  const block = itemTypes.find((it) => it.api_key === blockApiKey);
  expect(block, `the seed must define a "${blockApiKey}" block model`).toBeTruthy();
  const fields = await client.fields.list(block!.id);
  const field = fields.find((f) => f.api_key === fieldApiKey);
  expect(field, `the "${blockApiKey}" block must expose a "${fieldApiKey}" field`).toBeTruthy();
  return field!.id;
};

/** Find the CMA field id of a top-level model field by api_key (e.g. `article.title`). */
const findModelFieldId = async (
  envName: string,
  itemTypeId: string,
  fieldApiKey: string,
): Promise<string> => {
  const fields = await cmaClient(envName).fields.list(itemTypeId);
  const field = fields.find((f) => f.api_key === fieldApiKey);
  expect(field, `the model must expose a "${fieldApiKey}" field`).toBeTruthy();
  return field!.id;
};

test.describe('AI Translations — frameless/exclusion/copy/round-trip pins (§9.4)', () => {
  test.beforeEach(({}, testInfo) => {
    const m = meta();
    testInfo.annotations.push({ type: 'lane', description: `${m.vendor} → ${m.envName}` });
  });

  test.afterEach(({}, testInfo) => {
    const ok = testInfo.status === testInfo.expectedStatus || testInfo.status === 'skipped';
    recordOutcome(testInfo.project.name, ok);
  });

  // ── 1. Rendering contract (§9.4-1) ─────────────────────────────────────────
  test('rendering contract: true frameless has no chrome, pseudo/framed do (§9.4-1)', async ({
    page,
  }) => {
    const { vendor } = meta();
    test.setTimeout(TIMEOUTS.three_min);

    await step(vendor, 'open BV Probe', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_PROBE.id));

    await step(vendor, 'the true-frameless field label is absent (no chrome)', async () => {
      await expect(
        page.getByText('True frameless (required → renders FRAMELESS)', { exact: true }),
        'a frameless single_block field must render without its own field label/frame',
      ).toHaveCount(0);
    });

    await step(vendor, 'the pseudo-frameless and framed-control labels render (framed)', async () => {
      await expect(
        page.getByText('Pseudo frameless (no required → renders FRAMED)', { exact: true }),
        'missing `required` silently falls back to the framed renderer, which keeps its label',
      ).toBeVisible({ timeout: TIMEOUTS.one_min });
      await expect(
        page.getByText('Framed control (framed editor → renders FRAMED)', { exact: true }),
      ).toBeVisible();
    });

    await step(vendor, 'the frameless block\'s inner content is still visible', async () => {
      // Frameless removes the CONTAINER chrome only — the block's own
      // sub-field inputs (Title: "Probe note") still render inline. Playwright
      // has no `getByDisplayValue` (that's a Testing Library API), so scan
      // for a visible input/textarea currently holding that value.
      const hasVisibleValue = (value: string): Promise<boolean> =>
        page.evaluate((v) => {
          const els = Array.from(
            document.querySelectorAll('input, textarea'),
          ) as (HTMLInputElement | HTMLTextAreaElement)[];
          return els.some((el) => el.value === v && el.offsetParent !== null);
        }, value);
      await expect
        .poll(() => hasVisibleValue('Probe note'), { timeout: TIMEOUTS.one_min })
        .toBe(true);
    });
  });

  // ── 2. Frameless materialization — was bug #1, now GREEN (§9.4-2) ──────────
  // Keep this test FIRST among the mutating tests: it is the primary
  // regression proof and should not be masked by a later test's side effects.
  test('frameless materialization: translating fills the missing it block (§9.4-2)', async ({
    page,
  }) => {
    // was a phase-0 test.fail() pin; engine fix landed → asserts fixed behavior
    const { vendor, envName } = meta();
    test.setTimeout(TIMEOUTS.twelve_min);

    await step(vendor, 'open BV Probe', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_PROBE.id));
    await step(vendor, 'translate the record en → (all other active locales)', () =>
      translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
    );
    const result = await step(vendor, 'save', () => saveRecord(page, vendor));
    expect(result.status, result.fieldErrors.join(' | ')).toBe(200);

    await step(vendor, 'pseudo_frameless.it was materialised, not dropped (CMA)', async () => {
      const value = await getLocaleValue(envName, BV_PROBE.id, 'pseudo_frameless', 'it');
      expect(
        value,
        'v3 silently dropped the frameless block on translation; the fix must materialise it',
      ).not.toBeNull();
    });
  });

  // ── 3. Framed control — sibling proof the bug was decomposition-specific ──
  test('framed control: translating fills the missing it block too (§9.4-3)', async ({
    page,
  }) => {
    const { vendor, envName } = meta();
    test.setTimeout(TIMEOUTS.twelve_min);

    await step(vendor, 'open BV Probe', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_PROBE.id));
    await step(vendor, 'translate the record en → (all other active locales)', () =>
      translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
    );
    const result = await step(vendor, 'save', () => saveRecord(page, vendor));
    expect(result.status, result.fieldErrors.join(' | ')).toBe(200);

    await step(vendor, 'framed_control.it was materialised (CMA)', async () => {
      const value = await getLocaleValue(envName, BV_PROBE.id, 'framed_control', 'it');
      expect(value, 'the framed control must also gain its missing it block').not.toBeNull();
    });
  });

  // ── 4. Exclusion by field id leaves the sub-field EMPTY (§9.4-4) ──────────
  test('exclusion by field id: excluded sub-field ends up empty (§9.4-4)', async ({ page }) => {
    // was a phase-0 test.fail() pin; engine fix landed → asserts fixed behavior
    const { vendor, envName } = meta();
    test.setTimeout(TIMEOUTS.twelve_min);

    const original = await getPluginParams(envName);
    try {
      const bodyFieldId = await step(vendor, 'find the callout.body field id (CMA)', () =>
        findBlockFieldId(envName, 'callout', 'body'),
      );

      await step(vendor, 'exclude callout.body by field id', () =>
        setPluginParams(envName, {
          ...original,
          apiKeysToBeExcludedFromThisPlugin: [bodyFieldId],
        }),
      );

      await step(vendor, 'open BV Control', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_CONTROL.id));
      await step(vendor, 'translate the record en → (all other active locales)', () =>
        translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
      );
      const result = await step(vendor, 'save', () => saveRecord(page, vendor));
      expect(result.status, result.fieldErrors.join(' | ')).toBe(200);

      await step(
        vendor,
        'the excluded sub-field is empty — NOT the English source, NOT the old it value (CMA)',
        async () => {
          const value = await getLocaleValue(envName, BV_CONTROL.id, 'true_frameless', 'it');
          const body = bodyOf(value);
          const isEmpty = body == null || body === '';
          expect(
            isEmpty,
            `excluded sub-field must be left empty per rev-7 (got: ${JSON.stringify(body)})`,
          ).toBe(true);
        },
      );
    } finally {
      await setPluginParams(envName, original);
    }
  });

  // ── 5. Copy-from-source, SUB-FIELD (proves Task 5) ────────────────────────
  test('copy-from-source by field id: sub-field copies the English source verbatim (Task 5)', async ({
    page,
  }) => {
    const { vendor, envName } = meta();
    test.setTimeout(TIMEOUTS.twelve_min);

    const original = await getPluginParams(envName);
    try {
      const bodyFieldId = await step(vendor, 'find the callout.body field id (CMA)', () =>
        findBlockFieldId(envName, 'callout', 'body'),
      );
      const sourceBody = await step(vendor, 'read the English source body (CMA)', async () => {
        const value = await getLocaleValue(envName, BV_CONTROL.id, 'true_frameless', 'en');
        return bodyOf(value);
      });

      await step(vendor, 'copy callout.body from source instead of translating it', () =>
        setPluginParams(envName, {
          ...original,
          fieldsToCopyFromSource: [bodyFieldId],
        }),
      );

      await step(vendor, 'open BV Control', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_CONTROL.id));
      await step(vendor, 'translate the record en → (all other active locales)', () =>
        translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
      );
      const result = await step(vendor, 'save', () => saveRecord(page, vendor));
      expect(result.status, result.fieldErrors.join(' | ')).toBe(200);

      await step(vendor, 'the it sub-field equals the English source verbatim (CMA)', async () => {
        const value = await getLocaleValue(envName, BV_CONTROL.id, 'true_frameless', 'it');
        const targetBody = bodyOf(value);
        expect(
          targetBody,
          'copy-from-source must copy the English source verbatim, not translate it',
        ).toBe(sourceBody);
      });
    } finally {
      await setPluginParams(envName, original);
    }
  });

  // ── 6. Copy-from-source, TOP-LEVEL (proves the #2 fix) ────────────────────
  test('copy-from-source by field id: top-level field copies the English source verbatim (#2 fix)', async ({
    page,
  }) => {
    const { vendor, envName } = meta();
    test.setTimeout(TIMEOUTS.twelve_min);

    const original = await getPluginParams(envName);
    try {
      const titleFieldId = await step(vendor, 'find the article.title field id (CMA)', () =>
        findModelFieldId(envName, ARTICLE, 'title'),
      );
      const sourceTitle = await getLocaleValue(envName, A1.id, 'title', 'en');

      await step(vendor, 'copy title from source instead of translating it', () =>
        setPluginParams(envName, {
          ...original,
          fieldsToCopyFromSource: [titleFieldId],
        }),
      );

      await step(vendor, 'open the kitchen-sink article', () =>
        openRecord(page, meta(), ARTICLE, A1.id),
      );
      await step(vendor, 'translate the record en → (all other active locales)', () =>
        translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
      );
      const result = await step(vendor, 'save', () => saveRecord(page, vendor));
      expect(result.status, result.fieldErrors.join(' | ')).toBe(200);

      await step(vendor, 'title.it equals the English source verbatim, not translated (CMA)', async () => {
        const targetTitle = await getLocaleValue(envName, A1.id, 'title', 'it');
        expect(
          targetTitle,
          'top-level copy-from-source must copy the source verbatim (source, not a translation)',
        ).toBe(sourceTitle);
      });
    } finally {
      await setPluginParams(envName, original);
    }
  });

  // ── 7. Converter round-trip (§9.4-6) ──────────────────────────────────────
  test('converter round-trip is lossless (§9.4-6)', async ({ page }) => {
    const { vendor, envName } = meta();
    test.setTimeout(TIMEOUTS.three_min);

    const original = await getPluginParams(envName);
    try {
      await step(vendor, 'enable debugging to register the round-trip probe', () =>
        setPluginParams(envName, { ...original, enableDebugging: true }),
      );

      await step(vendor, 'open the kitchen-sink article', () =>
        openRecord(page, meta(), ARTICLE, A1.id),
      );
      const panel = await step(vendor, 'open the AI Translations sidebar panel', () =>
        openTranslationPanel(page),
      );

      const result = await step(
        vendor,
        'run window.__aiTranslationsRoundtrip() inside the panel frame',
        () =>
          // FrameLocator has no `.evaluate` — reach the frame's `window` via a
          // locator inside it (`body` is always present) and evaluate there.
          panel.locator('body').evaluate(() => {
            const hook = (
              window as unknown as {
                __aiTranslationsRoundtrip?: () => Promise<{ ok: boolean; diffs: string[] }>;
              }
            ).__aiTranslationsRoundtrip;
            if (!hook) {
              throw new Error(
                '__aiTranslationsRoundtrip was not registered — enableDebugging did not take effect',
              );
            }
            return hook();
          }),
      );

      // Any legitimate normalization diff should be classified here with a
      // comment rather than silently ignored; today none are expected.
      expect(
        result.diffs,
        `converter round-trip should be lossless:\n${result.diffs.join('\n')}`,
      ).toEqual([]);
    } finally {
      await setPluginParams(envName, original);
    }
  });

  // ── 8. Restricted-role locale scope (§9.4-5) ──────────────────────────────
  test('restricted-role locale scope: in-scope locale lands, out-of-scope stays null (§9.4-5)', async ({
    browser,
  }) => {
    const { vendor, envName } = meta();
    const env = requireEnv();
    test.skip(
      !env.E2E_RESTRICTED_EMAIL || !env.E2E_RESTRICTED_PASSWORD,
      'no restricted-role credentials configured (E2E_RESTRICTED_EMAIL/_PASSWORD) — skipping',
    );
    test.setTimeout(TIMEOUTS.twelve_min);

    const context = await browser.newContext({ storageState: RESTRICTED_STORAGE_STATE });
    try {
      const page = await context.newPage();
      await step(vendor, 'open the kitchen-sink article as the restricted-role user', () =>
        openRecord(page, meta(), ARTICLE, A1.id),
      );
      await step(vendor, 'translate en → all', () =>
        translateRecordViaSidebar(page, { fromLocale: 'en', vendor }),
      );
      const result = await step(vendor, 'save', () => saveRecord(page, vendor));
      expect.soft(result.status, result.fieldErrors.join(' | ')).toBe(200);

      await step(vendor, 'the in-scope locale (it) landed (CMA)', async () => {
        const itValue = await getLocaleValue(envName, A1.id, 'title', 'it');
        expect.soft(itValue, 'a locale within the restricted role\'s scope should land').not.toBeNull();
      });

      // FLIPS IN A LATER PHASE: today an out-of-scope locale is a silent drop
      // (no error surfaced to the user), not a reported failure — this only
      // proves the write never lands, not that the run tells the user why.
      await step(vendor, 'the out-of-scope locale (es) was never written (CMA)', async () => {
        const esValue = await getLocaleValue(envName, A1.id, 'title', 'es');
        expect.soft(
          esValue,
          'an out-of-scope locale must not receive a write — currently a silent drop',
        ).toBeNull();
      });
    } finally {
      await context.close();
    }
  });
});
