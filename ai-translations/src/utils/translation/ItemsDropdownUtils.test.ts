import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { withExpectedError } from '../testing/withExpectedError';
import {
  buildTranslatedUpdatePayload,
  type DatoCMSRecordFromAPI,
  deriveRecordLabel,
  type ProgressUpdate,
  shouldTranslateField,
  stripBlockIds,
  summarizeReferenceCopies,
  translateAndUpdateRecords,
} from './ItemsDropdownUtils';

vi.mock('./TranslateField', () => ({
  translateFieldValue: vi.fn(),
  generateRecordContext: vi.fn(() => 'record context'),
}));

import { translateFieldValue } from './TranslateField';
import {
  bumpCheckpoint,
  createRunState,
  type ResumeTarget,
} from '../../engine/report';
import type { QcFlag } from './qc/types';
import { ProviderError } from './types';

describe('ItemsDropdownUtils', () => {
  const pluginParams: ctxParamsType = {
    apiKey: 'test-key',
    gptModel: 'gpt-4',
    translationFields: ['single_line', 'slug', 'structured_text'],
    translateWholeRecord: true,
    translateBulkRecords: true,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
  };

  const provider = {
    vendor: 'openai' as const,
    streamText: vi.fn(),
    completeText: vi.fn(),
  };

  const fieldTypeDictionary = {
    title: { editor: 'single_line', id: 'field-title', isLocalized: true },
    slug: { editor: 'slug', id: 'field-slug', isLocalized: true },
    body: { editor: 'structured_text', id: 'field-body', isLocalized: true },
  };

  const record: DatoCMSRecordFromAPI = {
    id: 'record-1',
    item_type: { id: 'item-type-1' },
    title: { en: 'Hello', de: 'Hallo' },
    slug: { en: 'hello-world', de: 'hallo-welt' },
    body: {
      en: [{ type: 'paragraph', children: [{ text: 'Body text' }] }],
      de: [{ type: 'paragraph', children: [{ text: 'Vorhanden' }] }],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deriveRecordLabel', () => {
    it('truncates by code points so an emoji is never split into a lone surrogate', () => {
      // The emoji straddles UTF-16 index 76/77, so a raw slice(0, 77) keeps the
      // high surrogate and drops its pair — a lone surrogate. 83 code points > 80
      // forces truncation.
      const title = `${'a'.repeat(76)}😀${'b'.repeat(6)}`;
      const labelRecord: DatoCMSRecordFromAPI = {
        id: 'r1',
        item_type: { id: 't1' },
        title: { en: title },
      };

      const label = deriveRecordLabel(labelRecord, 'en');

      expect(label.endsWith('…')).toBe(true);
      // The whole emoji survives, and there is no unpaired surrogate.
      expect(label).toContain('😀');
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label)).toBe(false);
    });

    it('keeps a multi-code-point grapheme cluster (flag emoji) whole when truncating', () => {
      // A regional-indicator flag is TWO code points; a raw code-point slice(0, 77)
      // can cut between them, leaving a lone half-flag. Grapheme-aware slicing
      // keeps the cluster intact. 84 code points (> 80) forces truncation with the
      // flag straddling the 76/77 boundary.
      const title = `${'a'.repeat(76)}🇺🇸${'b'.repeat(6)}`;
      const labelRecord: DatoCMSRecordFromAPI = {
        id: 'r3',
        item_type: { id: 't1' },
        title: { en: title },
      };

      const label = deriveRecordLabel(labelRecord, 'en');

      expect(label.endsWith('…')).toBe(true);
      // The whole flag survives — not a lone regional indicator (half a flag).
      expect(label).toContain('🇺🇸');
      const regionalIndicators = [...label].filter((c) =>
        /\p{Regional_Indicator}/u.test(c),
      );
      expect(regionalIndicators.length % 2).toBe(0);
    });

    it('leaves a short title untouched', () => {
      const labelRecord: DatoCMSRecordFromAPI = {
        id: 'r2',
        item_type: { id: 't1' },
        title: { en: 'Short title' },
      };
      expect(deriveRecordLabel(labelRecord, 'en')).toBe('Short title');
    });
  });

  describe('shouldTranslateField', () => {
    it('returns false for disabled field types', () => {
      expect(
        shouldTranslateField('slug', record, 'en', fieldTypeDictionary, {
          ...pluginParams,
          translationFields: ['single_line'],
        }),
      ).toBe(false);
    });

    it('returns false for excluded fields by API key or field ID', () => {
      expect(
        shouldTranslateField('slug', record, 'en', fieldTypeDictionary, {
          ...pluginParams,
          apiKeysToBeExcludedFromThisPlugin: ['slug'],
        }),
      ).toBe(false);

      expect(
        shouldTranslateField('slug', record, 'en', fieldTypeDictionary, {
          ...pluginParams,
          apiKeysToBeExcludedFromThisPlugin: ['field-slug'],
        }),
      ).toBe(false);
    });

    it('respects an explicit per-model field allowlist', () => {
      // Selected: only 'title' for this model — slug should be skipped.
      const selectedFieldsByModel = { 'item-type-1': ['title'] };

      expect(
        shouldTranslateField(
          'title',
          record,
          'en',
          fieldTypeDictionary,
          pluginParams,
          selectedFieldsByModel,
        ),
      ).toBe(true);

      expect(
        shouldTranslateField(
          'slug',
          record,
          'en',
          fieldTypeDictionary,
          pluginParams,
          selectedFieldsByModel,
        ),
      ).toBe(false);
    });

    it('skips every field when the record model has no selection entry', () => {
      const selectedFieldsByModel = { 'some-other-model': ['title'] };
      expect(
        shouldTranslateField(
          'title',
          record,
          'en',
          fieldTypeDictionary,
          pluginParams,
          selectedFieldsByModel,
        ),
      ).toBe(false);
    });

    it('keeps legacy behavior when no allowlist is passed', () => {
      expect(
        shouldTranslateField(
          'title',
          record,
          'en',
          fieldTypeDictionary,
          pluginParams,
        ),
      ).toBe(true);
    });
  });

  describe('buildTranslatedUpdatePayload', () => {
    it('includes disabled fields with null fallback in the payload (locale sync)', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      expect(result.payload).toEqual({
        title: { en: 'Hello', de: 'Hallo', it: 'Ciao' },
        slug: { en: 'hello-world', de: 'hallo-welt', it: null },
        body: {
          en: [{ type: 'paragraph', children: [{ text: 'Body text' }] }],
          de: [{ type: 'paragraph', children: [{ text: 'Vorhanden' }] }],
          it: null,
        },
      });
      expect(result.warnings).toEqual([]);
    });

    it('includes excluded fields with null fallback in the payload (locale sync)', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        { ...pluginParams, apiKeysToBeExcludedFromThisPlugin: ['field-title'] },
        'access-token',
        'main',
      );

      expect(result.payload).toEqual({
        title: { en: 'Hello', de: 'Hallo', it: null },
        slug: { en: 'hello-world', de: 'hallo-welt', it: 'Ciao' },
        body: {
          en: [{ type: 'paragraph', children: [{ text: 'Body text' }] }],
          de: [{ type: 'paragraph', children: [{ text: 'Vorhanden' }] }],
          it: 'Ciao',
        },
      });
    });

    it('keeps target locale untouched and records a warning when translation fails', async () => {
      vi.mocked(translateFieldValue)
        .mockResolvedValueOnce('Ciao')
        .mockRejectedValueOnce(
          new Error('Translated slug is empty after normalization'),
        )
        .mockResolvedValueOnce([
          { type: 'paragraph', children: [{ text: 'Corpo' }] },
        ]);

      const result = await withExpectedError(
        'record field translation (empty slug)',
        () =>
          buildTranslatedUpdatePayload(
            record,
            'en',
            'it',
            fieldTypeDictionary,
            provider,
            pluginParams,
            'access-token',
            'main',
          ),
      );

      expect(result.payload.title).toEqual({
        en: 'Hello',
        de: 'Hallo',
        it: 'Ciao',
      });
      // The record has no `it` yet, so `it` is a NEW locale. DatoCMS's Locale
      // Sync Rule requires EVERY localized field to carry a newly-added locale
      // or the whole items.update is rejected (VALIDATION_INVALID_LOCALES),
      // losing the successfully-translated siblings too. So a FAILED field is
      // filled with the locale-sync fallback (null for an optional field) — there
      // is no existing `it` value to overwrite, so this is NOT the null-overwrite
      // bug (an existing value is still preserved — see the next test).
      expect(result.payload.slug).toEqual({
        en: 'hello-world',
        de: 'hallo-welt',
        it: null,
      });
      // It is still recorded as a failure (reported, and it fails the record).
      expect(result.failedFields).toEqual([
        {
          field: 'slug',
          error: expect.objectContaining({ source: 'plugin' }),
        },
      ]);
      expect(result.warnings).toContain(
        'Field "slug" to Italian [it] was skipped: Plugin error: Translated slug is empty after normalization.',
      );
    });

    it('preserves an EXISTING target-locale value when a field fails (never overwrites with null)', async () => {
      // The real null-guard: the target locale ALREADY has a value, and the
      // re-translation fails. That existing value must be kept, never nulled.
      vi.mocked(translateFieldValue).mockRejectedValue(
        new Error('provider exploded'),
      );

      const recordWithItSlug: DatoCMSRecordFromAPI = {
        id: 'record-2',
        item_type: { id: 'item-type-1' },
        slug: { en: 'hello-world', it: 'ciao-mondo-esistente' },
      };

      const result = await withExpectedError('field failure with existing it', () =>
        buildTranslatedUpdatePayload(
          recordWithItSlug,
          'en',
          'it',
          { slug: { editor: 'slug', id: 'field-slug', isLocalized: true } },
          provider,
          { ...pluginParams, translationFields: ['slug'] },
          'access-token',
          'main',
        ),
      );

      // slug failed; its existing it value must be untouched (not in payload,
      // and definitely not overwritten with null).
      expect(result.payload).not.toHaveProperty('slug');
      expect(result.failedFields.map((f) => f.field)).toEqual(['slug']);
    });

    it('counts an error-severity QC flag while still translating the field', async () => {
      vi.mocked(translateFieldValue).mockImplementation(async (...args) => {
        // The 14th positional arg carries the internal options incl. onQcFlag.
        const opts = args[13] as
          | { onQcFlag?: (flag: QcFlag) => void }
          | undefined;
        opts?.onQcFlag?.({
          checkId: 'truncated',
          severity: 'error',
          message: 'Provider cut the response off.',
        });
        return 'Ciao';
      });

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      expect(result.translatedFieldCount).toBeGreaterThan(0);
      expect(result.errorCount).toBeGreaterThan(0);
    });

    it('does not count a warning-severity QC flag as an error', async () => {
      vi.mocked(translateFieldValue).mockImplementation(async (...args) => {
        const opts = args[13] as
          | { onQcFlag?: (flag: QcFlag) => void }
          | undefined;
        opts?.onQcFlag?.({
          checkId: 'no-op',
          severity: 'warning',
          message: 'Unchanged from source.',
        });
        return 'Ciao';
      });

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      expect(result.errorCount).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('threads a checkCancellation that throws once the abort signal fires', async () => {
      // The bulk flow's mid-field (block-level) cancellation seam:
      // runWithConcurrency stops launching further block tasks when
      // streamCallbacks.checkCancellation throws, and that predicate must be
      // derived from the run's abortSignal (previously it was dropped entirely).
      const abort = new AbortController();
      let captured: (() => void) | undefined;
      vi.mocked(translateFieldValue).mockImplementation(async (...args) => {
        const streamCallbacks = args[10] as
          | { checkCancellation?: () => void }
          | undefined;
        captured = streamCallbacks?.checkCancellation;
        return 'Ciao';
      });

      await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
        { abortSignal: abort.signal },
      );

      expect(captured).toBeTypeOf('function');
      expect(() => captured?.()).not.toThrow();
      abort.abort();
      expect(() => captured?.()).toThrow();
    });

    it('flags an error when a translated value overflows the field length validator', async () => {
      // The customer's case: translation grows past the field's character limit.
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao mondo bellissimo');

      const dictWithLimit = {
        ...fieldTypeDictionary,
        title: {
          ...fieldTypeDictionary.title,
          validators: { length: { max: 5 } },
        },
      };

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        dictWithLimit,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      expect(result.errorCount).toBeGreaterThan(0);
      expect(
        result.warnings.some(
          (w) => w.includes('title') && w.includes('at most 5'),
        ),
      ).toBe(true);
    });

    it('returns the structured QC flags (not just warning strings) for the report', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao mondo bellissimo');

      const dictWithLimit = {
        ...fieldTypeDictionary,
        title: {
          ...fieldTypeDictionary.title,
          validators: { length: { max: 5 } },
        },
      };

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        dictWithLimit,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      const lengthFlag = result.qcFlags.find(
        (f) => f.checkId === 'length-validator',
      );
      expect(lengthFlag).toMatchObject({
        checkId: 'length-validator',
        severity: 'error',
        fieldPath: 'title',
        locale: 'it',
      });
    });

    it('does not flag a length validator the translation respects', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const dictWithLimit = {
        ...fieldTypeDictionary,
        title: {
          ...fieldTypeDictionary.title,
          validators: { length: { max: 50 } },
        },
      };

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        dictWithLimit,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      expect(result.errorCount).toBe(0);
    });

    it('classifies fatal Yandex credential errors as auth failures (the run-level guard aborts on these)', async () => {
      vi.mocked(translateFieldValue).mockRejectedValue(
        new ProviderError('Permission denied', 403, 'yandex'),
      );
      const yandexProvider = { ...provider, vendor: 'yandex' as const };

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        yandexProvider,
        { ...pluginParams, vendor: 'yandex' },
        'access-token',
        'main',
      );

      // The engine accumulates provider failures per field rather than throwing;
      // the idempotent 'auth' classification (stable across the engine's double
      // normalization) is what `translateAndUpdateRecords` keys on to abort the run.
      expect(result.failedFields.length).toBeGreaterThan(0);
      expect(result.failedFields.every((f) => f.error.code === 'auth')).toBe(
        true,
      );
    });

    it('copies source value for required non-block fields, strips IDs for required block fields', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const bodyWithBlocks = {
        en: [
          {
            type: 'item',
            id: 'block-1',
            attributes: { title: 'Hello' },
            relationships: {
              item_type: { data: { id: 'model-1', type: 'item_type' } },
            },
          },
        ],
        de: [
          {
            type: 'item',
            id: 'block-2',
            attributes: { title: 'Hallo' },
            relationships: {
              item_type: { data: { id: 'model-1', type: 'item_type' } },
            },
          },
        ],
      };

      const recordWithBlocks: DatoCMSRecordFromAPI = {
        ...record,
        body: bodyWithBlocks,
      };

      const dictWithRequired = {
        title: {
          editor: 'single_line',
          id: 'field-title',
          isLocalized: true,
          validators: { required: {} },
        },
        slug: { editor: 'slug', id: 'field-slug', isLocalized: true },
        body: {
          editor: 'structured_text',
          id: 'field-body',
          isLocalized: true,
          validators: { required: {} },
        },
      };

      const result = await buildTranslatedUpdatePayload(
        recordWithBlocks,
        'en',
        'it',
        dictWithRequired,
        provider,
        { ...pluginParams, translationFields: ['slug'] },
        'access-token',
        'main',
      );

      // title is required non-block → copies source value
      expect(result.payload.title).toEqual({
        en: 'Hello',
        de: 'Hallo',
        it: 'Hello',
      });
      // slug is translated normally
      expect(result.payload.slug).toEqual({
        en: 'hello-world',
        de: 'hallo-welt',
        it: 'Ciao',
      });
      // body is required block field → copies source blocks with IDs stripped
      expect(result.payload.body).toEqual({
        en: [
          {
            type: 'item',
            id: 'block-1',
            attributes: { title: 'Hello' },
            relationships: {
              item_type: { data: { id: 'model-1', type: 'item_type' } },
            },
          },
        ],
        de: [
          {
            type: 'item',
            id: 'block-2',
            attributes: { title: 'Hallo' },
            relationships: {
              item_type: { data: { id: 'model-1', type: 'item_type' } },
            },
          },
        ],
        it: [
          {
            type: 'item',
            attributes: { title: 'Hello' },
            relationships: {
              item_type: { data: { id: 'model-1', type: 'item_type' } },
            },
          },
        ],
      });
    });

    it('only translates fields in the per-model allowlist; locale-sync still fills others', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        pluginParams,
        'access-token',
        'main',
        { selectedFieldsByModel: { 'item-type-1': ['title'] } },
      );

      // The translator should have been called exactly once — for `title`.
      expect(translateFieldValue).toHaveBeenCalledTimes(1);

      // title was selected and translated.
      expect(result.payload.title).toEqual({
        en: 'Hello',
        de: 'Hallo',
        it: 'Ciao',
      });
      // slug and body were NOT selected → locale-sync fallback (null, since they're optional).
      expect(result.payload.slug).toEqual({
        en: 'hello-world',
        de: 'hallo-welt',
        it: null,
      });
      expect(result.payload.body).toEqual({
        en: [{ type: 'paragraph', children: [{ text: 'Body text' }] }],
        de: [{ type: 'paragraph', children: [{ text: 'Vorhanden' }] }],
        it: null,
      });
    });

    it('skips fallback for fields that already have the target locale', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const recordWithExistingLocale: DatoCMSRecordFromAPI = {
        id: 'record-2',
        item_type: { id: 'item-type-1' },
        title: { en: 'Hello', it: 'Existing' },
        slug: { en: 'hello-world' },
        body: {
          en: [{ type: 'paragraph', children: [{ text: 'Body text' }] }],
        },
      };

      const result = await buildTranslatedUpdatePayload(
        recordWithExistingLocale,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        { ...pluginParams, translationFields: ['structured_text'] },
        'access-token',
        'main',
      );

      // title already has 'it' → not overwritten
      expect(result.payload.title).toBeUndefined();
      // slug does not have 'it' → gets null fallback
      expect(result.payload.slug).toEqual({
        en: 'hello-world',
        it: null,
      });
    });

    it('copies source references into the new locale for a links field with a min-count validator', async () => {
      const dict = {
        title: { editor: 'single_line', id: 'field-title', isLocalized: true },
        related: {
          editor: 'links_select',
          id: 'field-related',
          isLocalized: true,
          validators: {
            items_item_type: { item_types: ['model-x'] },
            size: { min: 2 },
          },
        },
      };
      const recordWithLinks: DatoCMSRecordFromAPI = {
        id: 'record-links',
        item_type: { id: 'item-type-1' },
        title: { en: 'Hello', de: 'Hallo' },
        related: { en: ['rec-a', 'rec-b'], de: ['rec-c', 'rec-d'] },
      };
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const result = await buildTranslatedUpdatePayload(
        recordWithLinks,
        'en',
        'it',
        dict,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      // The links field is never translated; its source references are copied
      // verbatim into the target locale so the size:{min:2} validator passes.
      expect(result.payload.related).toEqual({
        en: ['rec-a', 'rec-b'],
        de: ['rec-c', 'rec-d'],
        it: ['rec-a', 'rec-b'],
      });
      // The referenced records were NOT followed/translated. The copy is a
      // structured event (consolidated per-record downstream), NOT a per-field
      // warning sentence — `warnings` is reserved for genuine failures.
      expect(result.referenceCopies).toContainEqual({
        field: 'related',
        toLocale: 'it',
      });
      expect(result.warnings).toEqual([]);
      expect(result.referenceFieldsCopied).toBe(1);
    });

    it('carries references into the new locale even without a min-count constraint (symptom 2)', async () => {
      const dict = {
        related: {
          editor: 'links_select',
          id: 'field-related',
          isLocalized: true,
          validators: { items_item_type: { item_types: ['model-x'] } },
        },
      };
      const recordWithLinks: DatoCMSRecordFromAPI = {
        id: 'record-links-2',
        item_type: { id: 'item-type-1' },
        related: { en: ['rec-a'] },
      };

      const result = await buildTranslatedUpdatePayload(
        recordWithLinks,
        'en',
        'it',
        dict,
        provider,
        pluginParams,
        'access-token',
        'main',
      );

      expect(result.payload.related).toEqual({
        en: ['rec-a'],
        it: ['rec-a'],
      });
      expect(result.referenceCopies).toContainEqual({
        field: 'related',
        toLocale: 'it',
      });
      expect(result.referenceFieldsCopied).toBe(1);
    });

    it('copies a single-link reference into the new locale', async () => {
      const dict = {
        hero: {
          editor: 'link_select',
          id: 'field-hero',
          isLocalized: true,
          validators: { item_item_type: { item_types: ['model-x'] } },
        },
      };
      const recordWithLink: DatoCMSRecordFromAPI = {
        id: 'record-link-3',
        item_type: { id: 'item-type-1' },
        hero: { en: 'rec-a' },
      };

      const result = await buildTranslatedUpdatePayload(
        recordWithLink,
        'en',
        'it',
        dict,
        provider,
        pluginParams,
        'access-token',
        'main',
      );

      expect(result.payload.hero).toEqual({ en: 'rec-a', it: 'rec-a' });
      expect(result.referenceCopies).toContainEqual({
        field: 'hero',
        toLocale: 'it',
      });
      expect(result.referenceFieldsCopied).toBe(1);
    });

    it('does not copy or warn when a reference field has no source value', async () => {
      const dict = {
        related: {
          editor: 'links_select',
          id: 'field-related',
          isLocalized: true,
          validators: { items_item_type: { item_types: ['model-x'] } },
        },
      };
      const recordEmptyLinks: DatoCMSRecordFromAPI = {
        id: 'record-links-4',
        item_type: { id: 'item-type-1' },
        related: { en: null },
      };

      const result = await buildTranslatedUpdatePayload(
        recordEmptyLinks,
        'en',
        'it',
        dict,
        provider,
        pluginParams,
        'access-token',
        'main',
      );

      expect(result.payload.related).toEqual({ en: null, it: null });
      expect(result.warnings).toEqual([]);
      expect(result.referenceFieldsCopied).toBe(0);
    });

    it('copies gallery assets into the new locale to satisfy a min-count size validator without warning', async () => {
      const dict = {
        media: {
          editor: 'gallery',
          id: 'field-media',
          isLocalized: true,
          validators: { size: { min: 2 } },
        },
      };
      const recordWithGallery: DatoCMSRecordFromAPI = {
        id: 'record-gallery',
        item_type: { id: 'item-type-1' },
        media: { en: [{ upload_id: 'u1' }, { upload_id: 'u2' }] },
      };

      const result = await buildTranslatedUpdatePayload(
        recordWithGallery,
        'en',
        'it',
        dict,
        provider,
        // file/gallery translation disabled → gallery hits the locale-sync fallback
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      // Assets are shared, not blocks: copied verbatim (no id-stripping),
      // satisfying size:{min:2}. Not a record reference → no warning/count.
      expect(result.payload.media).toEqual({
        en: [{ upload_id: 'u1' }, { upload_id: 'u2' }],
        it: [{ upload_id: 'u1' }, { upload_id: 'u2' }],
      });
      expect(result.warnings).toEqual([]);
      expect(result.referenceFieldsCopied).toBe(0);
    });

    it('treats an empty links array as nothing to carry (no warning, no count)', async () => {
      const dict = {
        related: {
          editor: 'links_select',
          id: 'field-related',
          isLocalized: true,
          validators: { items_item_type: { item_types: ['model-x'] } },
        },
      };
      const recordEmptyArray: DatoCMSRecordFromAPI = {
        id: 'record-links-empty',
        item_type: { id: 'item-type-1' },
        related: { en: [] },
      };

      const result = await buildTranslatedUpdatePayload(
        recordEmptyArray,
        'en',
        'it',
        dict,
        provider,
        pluginParams,
        'access-token',
        'main',
      );

      expect(result.payload.related).toEqual({ en: [], it: [] });
      expect(result.warnings).toEqual([]);
      expect(result.referenceFieldsCopied).toBe(0);
    });

    it('returns writtenLocales containing exactly the translated toLocale for every translated field', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        pluginParams,
        'access-token',
        'main',
      );

      expect(result.writtenLocales).toEqual({
        title: ['it'],
        slug: ['it'],
        body: ['it'],
      });
    });

    it('also threads the locale-sync fallback toLocale into writtenLocales', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      // Only `title` is translated; `slug` and `body` fall back to the
      // locale-sync null fill for the new `it` locale (per the Locale Sync
      // Rule test above). Both write kinds must surface in `writtenLocales`
      // so the form sink can stage every newly-added locale — see the §2.1
      // caveat in `formAdapter.ts` about the record path not (yet)
      // distinguishing the two.
      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        fieldTypeDictionary,
        provider,
        { ...pluginParams, translationFields: ['single_line'] },
        'access-token',
        'main',
      );

      expect(result.writtenLocales).toEqual({
        title: ['it'],
        slug: ['it'],
        body: ['it'],
      });
    });

    describe('copy-from-source fate (spec §4.2/§4.3)', () => {
      it('copies a top-level scalar on the copy list verbatim, overwriting an existing target value, without calling the provider', async () => {
        const recordWithItTitle: DatoCMSRecordFromAPI = {
          id: 'record-copy-1',
          item_type: { id: 'item-type-1' },
          title: { en: 'Hello', de: 'Hallo', it: 'Preexisting' },
          slug: { en: 'hello-world' },
        };

        const result = await buildTranslatedUpdatePayload(
          recordWithItTitle,
          'en',
          'it',
          {
            title: {
              editor: 'single_line',
              id: 'field-title',
              isLocalized: true,
            },
            slug: { editor: 'slug', id: 'field-slug', isLocalized: true },
          },
          provider,
          {
            ...pluginParams,
            translationFields: ['single_line'],
            fieldsToCopyFromSource: ['field-title'],
          },
          'access-token',
          'main',
        );

        // Verbatim source, overwriting the pre-existing `it` value (§4.3 always
        // overwrites — NOT null-guarded like the locale-sync fallback).
        expect(result.payload.title).toEqual({
          en: 'Hello',
          de: 'Hallo',
          it: 'Hello',
        });
        // Never sent to the provider.
        expect(translateFieldValue).not.toHaveBeenCalled();
        // Copying is not translating.
        expect(result.translatedFieldCount).toBe(0);
      });

      it('copies a block-bearing field on the copy list with block ids stripped for fresh instances', async () => {
        const bodyWithBlocks = {
          en: [
            {
              type: 'item',
              id: 'block-1',
              attributes: { title: 'Hello' },
              relationships: {
                item_type: { data: { id: 'model-1', type: 'item_type' } },
              },
            },
          ],
          de: [
            {
              type: 'item',
              id: 'block-2',
              attributes: { title: 'Hallo' },
              relationships: {
                item_type: { data: { id: 'model-1', type: 'item_type' } },
              },
            },
          ],
        };
        const recordWithBlocks: DatoCMSRecordFromAPI = {
          ...record,
          body: bodyWithBlocks,
        };

        const result = await buildTranslatedUpdatePayload(
          recordWithBlocks,
          'en',
          'it',
          fieldTypeDictionary,
          provider,
          {
            ...pluginParams,
            translationFields: ['single_line'],
            fieldsToCopyFromSource: ['field-body'],
          },
          'access-token',
          'main',
        );

        // Source blocks with ids stripped so the CMA mints fresh instances.
        expect(result.payload.body).toEqual({
          en: bodyWithBlocks.en,
          de: bodyWithBlocks.de,
          it: [
            {
              type: 'item',
              attributes: { title: 'Hello' },
              relationships: {
                item_type: { data: { id: 'model-1', type: 'item_type' } },
              },
            },
          ],
        });
      });

      it('leaves an excluded top-level field to the null locale-sync fallback, never copied verbatim', async () => {
        const result = await buildTranslatedUpdatePayload(
          record,
          'en',
          'it',
          fieldTypeDictionary,
          provider,
          {
            ...pluginParams,
            translationFields: ['single_line'],
            apiKeysToBeExcludedFromThisPlugin: ['field-title'],
          },
          'access-token',
          'main',
        );

        // Excluded + optional → null fallback (unchanged), NOT the source value.
        expect(result.payload.title).toEqual({
          en: 'Hello',
          de: 'Hallo',
          it: null,
        });
      });

      it('still translates a normal field on neither list', async () => {
        vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

        const result = await buildTranslatedUpdatePayload(
          record,
          'en',
          'it',
          fieldTypeDictionary,
          provider,
          { ...pluginParams, translationFields: ['single_line'] },
          'access-token',
          'main',
        );

        expect(result.payload.title).toEqual({
          en: 'Hello',
          de: 'Hallo',
          it: 'Ciao',
        });
        expect(result.translatedFieldCount).toBeGreaterThan(0);
      });

      it('threads a copied field toLocale into writtenLocales so the form sink stages it', async () => {
        const result = await buildTranslatedUpdatePayload(
          record,
          'en',
          'it',
          fieldTypeDictionary,
          provider,
          {
            ...pluginParams,
            translationFields: ['single_line'],
            fieldsToCopyFromSource: ['field-title'],
          },
          'access-token',
          'main',
        );

        expect(result.writtenLocales.title).toEqual(['it']);
      });

      it('copies a required (cannotBeBlank) field on the copy list verbatim, never leaving it blank', async () => {
        const dictRequiredTitle = {
          title: {
            editor: 'single_line',
            id: 'field-title',
            isLocalized: true,
            validators: { required: {} },
          },
        };
        const recordRequired: DatoCMSRecordFromAPI = {
          id: 'record-copy-required',
          item_type: { id: 'item-type-1' },
          title: { en: 'Hello', de: 'Hallo' },
        };

        const result = await buildTranslatedUpdatePayload(
          recordRequired,
          'en',
          'it',
          dictRequiredTitle,
          provider,
          { ...pluginParams, fieldsToCopyFromSource: ['field-title'] },
          'access-token',
          'main',
        );

        expect(result.payload.title).toEqual({
          en: 'Hello',
          de: 'Hallo',
          it: 'Hello',
        });
        expect(translateFieldValue).not.toHaveBeenCalled();
      });

      it('records an info-tier "copied-from-source" QC flag for a copied field (not silent)', async () => {
        const result = await buildTranslatedUpdatePayload(
          record,
          'en',
          'it',
          fieldTypeDictionary,
          provider,
          {
            ...pluginParams,
            translationFields: ['single_line'],
            fieldsToCopyFromSource: ['field-title'],
          },
          'access-token',
          'main',
        );

        const flag = result.qcFlags.find(
          (f) => f.checkId === 'copied-from-source',
        );
        expect(flag).toMatchObject({
          checkId: 'copied-from-source',
          severity: 'info',
          fieldPath: 'title',
          locale: 'it',
        });
        // An info-tier flag never escalates the record to a failure.
        expect(result.errorCount).toBe(0);
      });

      it('falls through to the locale-sync fallback when a copy field has an empty source locale (no undefined write)', async () => {
        // `brand` is on the copy list but has no value in the source locale
        // (`en`). A verbatim copy would write `undefined` — dropped on serialize
        // AND, marked `copied`, it would suppress the fallback, so the new locale
        // could miss the field (VALIDATION_INVALID_LOCALES). The copy path must
        // instead leave it for the null locale-sync fallback.
        const dictBrand = {
          brand: { editor: 'single_line', id: 'field-brand', isLocalized: true },
        };
        const recordEmptySource: DatoCMSRecordFromAPI = {
          id: 'record-copy-empty',
          item_type: { id: 'item-type-1' },
          brand: { de: 'Acme' },
        };

        const result = await buildTranslatedUpdatePayload(
          recordEmptySource,
          'en',
          'it',
          dictBrand,
          provider,
          { ...pluginParams, fieldsToCopyFromSource: ['field-brand'] },
          'access-token',
          'main',
        );

        // Optional field, empty source → null fallback for the new locale. No
        // `undefined` value, no verbatim copy.
        expect(result.payload.brand).toEqual({ de: 'Acme', it: null });
        // It was NOT copied — no copy flag, no copied tally.
        expect(
          result.qcFlags.find((f) => f.checkId === 'copied-from-source'),
        ).toBeUndefined();
        expect(result.copiedFieldCount).toBe(0);
        // The fallback still records the newly-written locale.
        expect(result.writtenLocales.brand).toEqual(['it']);
      });

      it('counts a copied field in copiedFieldCount (surfaced for the updated-field tally)', async () => {
        const result = await buildTranslatedUpdatePayload(
          record,
          'en',
          'it',
          fieldTypeDictionary,
          provider,
          {
            ...pluginParams,
            translationFields: ['single_line'],
            fieldsToCopyFromSource: ['field-title'],
          },
          'access-token',
          'main',
        );

        expect(result.copiedFieldCount).toBe(1);
        expect(result.translatedFieldCount).toBe(0);
      });
    });
  });

  describe('translateAndUpdateRecords', () => {
    it('drops a CMA-swallowed field from the report instead of claiming it was translated', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
      const updates: ProgressUpdate[] = [];
      // The CMA accepts the write but silently returns `null` for title.it —
      // the exact shape of a dropped value. The read-back must demote it.
      const update = vi.fn().mockImplementation(async () => ({
        title: { en: 'Hello', it: null },
        meta: { updated_at: '2026-07-08T21:00:00.000Z' },
      }));
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub for the test
      const client = { items: { update } } as any;

      await translateAndUpdateRecords(
        [{ id: 'r1', item_type: { id: 'm1' }, title: { en: 'Hello' } }],
        client,
        provider,
        'en',
        ['it'],
        vi.fn().mockResolvedValue({
          title: { editor: 'single_line', id: 'field-title', isLocalized: true },
        }),
        pluginParams,
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { onProgress: (u) => updates.push(u) },
      );

      const finalUpdate = updates.filter((u) => u.recordId === 'r1').at(-1);
      expect(finalUpdate?.status).toBe('error');
      // The report must not list a field the CMA never persisted.
      expect(finalUpdate?.translatedFieldApiKeys ?? []).not.toContain('title');
      expect(finalUpdate?.translatedFieldIds ?? []).not.toContain('field-title');
      expect(finalUpdate?.warnings?.join(' ')).toMatch(/came back null/i);
    });

    it('attaches structured report data to the completed progress update', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
      const updates: ProgressUpdate[] = [];
      const update = vi
        .fn()
        .mockImplementation(
          async (_id: string, payload: Record<string, unknown>) => ({
            ...payload,
            meta: { updated_at: '2026-07-08T21:00:00.000Z' },
          }),
        );
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub for the test
      const client = { items: { update } } as any;

      const records: DatoCMSRecordFromAPI[] = [
        {
          id: 'r1',
          item_type: { id: 'm1' },
          title: { en: 'Hello' },
          related: { en: ['rec-a', 'rec-b'] },
        },
      ];

      const getFieldTypeDictionary = vi.fn().mockResolvedValue({
        title: { editor: 'single_line', id: 'field-title', isLocalized: true },
        related: {
          editor: 'links_select',
          id: 'field-related',
          isLocalized: true,
          validators: { items_item_type: { item_types: ['m1'] } },
        },
      });

      await translateAndUpdateRecords(
        records,
        client,
        provider,
        'en',
        ['it'],
        getFieldTypeDictionary,
        pluginParams,
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { onProgress: (u) => updates.push(u) },
      );

      const finalUpdate = updates.filter((u) => u.recordId === 'r1').at(-1);
      // A successful record that copied shared references carries a warning, so
      // it is flagged `completed-with-warnings` (design §6b) — this keeps the
      // per-record row icon and the "with warnings" counter in agreement, rather
      // than counting a visibly-warned row as a clean success.
      expect(finalUpdate?.status).toBe('completed-with-warnings');
      // The status message/statusText is clean — no concatenated warning wall.
      expect(finalUpdate?.message).not.toMatch(/shared references/i);
      expect(finalUpdate?.statusText).toBeTruthy();
      expect(finalUpdate?.statusText).not.toMatch(/shared references/i);
      // Warnings stay structured and consolidated to a single per-record line.
      expect(finalUpdate?.warnings).toHaveLength(1);
      expect(finalUpdate?.warnings?.[0]).toContain('"related"');
      // Record + link metadata for the UI.
      expect(finalUpdate?.itemTypeId).toBe('m1');
      expect(finalUpdate?.recordLabel).toBeTruthy();
      // CMA timestamp captured from the update response.
      expect(finalUpdate?.updatedAt).toBe('2026-07-08T21:00:00.000Z');
      // Translated + copied field lists, by api_key and by field id.
      expect(finalUpdate?.translatedFieldApiKeys).toContain('title');
      expect(finalUpdate?.translatedFieldIds).toContain('field-title');
      expect(finalUpdate?.copiedLinkFieldApiKeys).toContain('related');
      expect(finalUpdate?.copiedLinkFieldIds).toContain('field-related');
    });

    it('reports a copy-only record as a success (not "No fields were updated")', async () => {
      // The record's only localized write this run is a copy-from-source field.
      // It is in NEITHER the translated nor the reference-copy tally, so without
      // `copiedFieldCount` in the updated-field total it would hit the
      // `updatedFieldCount === 0 && warnings > 0` guard and be misreported as a
      // hard "No fields were updated" error — even though the copied value WAS
      // persisted.
      const updates: ProgressUpdate[] = [];
      const update = vi
        .fn()
        .mockImplementation(
          async (_id: string, payload: Record<string, unknown>) => ({
            ...payload,
            meta: { updated_at: '2026-07-08T21:00:00.000Z' },
          }),
        );
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
      const client = { items: { update } } as any;

      await translateAndUpdateRecords(
        [{ id: 'r1', item_type: { id: 'm1' }, brand: { en: 'Acme' } }],
        client,
        provider,
        'en',
        ['it'],
        vi.fn().mockResolvedValue({
          brand: { editor: 'single_line', id: 'field-brand', isLocalized: true },
        }),
        { ...pluginParams, fieldsToCopyFromSource: ['field-brand'] },
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { onProgress: (u) => updates.push(u) },
      );

      const finalUpdate = updates.filter((u) => u.recordId === 'r1').at(-1);
      // A written record — must NOT be reported as a failure.
      expect(finalUpdate?.status).not.toBe('error');
      expect(finalUpdate?.statusText).not.toMatch(/no fields were updated/i);
      // The provider was never called — the field was copied, not translated.
      expect(translateFieldValue).not.toHaveBeenCalled();
      // The copied value reached the CMA write verbatim.
      const writtenPayload = update.mock.calls[0]?.[1] as Record<
        string,
        Record<string, unknown>
      >;
      expect(writtenPayload.brand).toEqual({ en: 'Acme', it: 'Acme' });
    });

    it('does not save a record cancelled after its fields translate (pre-save gate)', async () => {
      // Mid-field cancellation can leave a partial field marked `translated`;
      // without a gate check right before the write, that partial value would be
      // persisted if the cancel lands on the last field of the last locale.
      let fieldTranslated = false;
      vi.mocked(translateFieldValue).mockImplementation(async () => {
        fieldTranslated = true;
        return 'Ciao';
      });
      const update = vi.fn().mockResolvedValue({ meta: {} });
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
      const client = { items: { update } } as any;
      const updates: ProgressUpdate[] = [];
      // 'continue' until the field has translated, then 'cancelled' — so only the
      // gate consulted immediately before the CMA write observes the cancel.
      const gate = vi.fn(
        async (): Promise<'continue' | 'cancelled'> =>
          fieldTranslated ? 'cancelled' : 'continue',
      );

      await translateAndUpdateRecords(
        [{ id: 'r1', item_type: { id: 'm1' }, title: { en: 'Hello' } }],
        client,
        provider,
        'en',
        ['it'],
        vi.fn().mockResolvedValue({
          title: { editor: 'single_line', id: 'field-title', isLocalized: true },
        }),
        pluginParams,
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { onProgress: (u) => updates.push(u), gate },
      );

      expect(update).not.toHaveBeenCalled();
      expect(updates.at(-1)?.statusText).toBe('Cancelled');
    });

    it('stops the bulk run after a fatal Yandex configuration error', async () => {
      vi.mocked(translateFieldValue).mockRejectedValue(
        new ProviderError('Folder ID is invalid', 400, 'yandex'),
      );
      const update = vi.fn();
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub for the test
      const client = { items: { update } } as any;
      const records: DatoCMSRecordFromAPI[] = [
        {
          id: 'r1',
          item_type: { id: 'm1' },
          title: { en: 'First' },
        },
        {
          id: 'r2',
          item_type: { id: 'm1' },
          title: { en: 'Second' },
        },
      ];
      const getFieldTypeDictionary = vi.fn().mockResolvedValue({
        title: { editor: 'single_line', id: 'field-title', isLocalized: true },
      });
      const yandexProvider = { ...provider, vendor: 'yandex' as const };

      await expect(
        translateAndUpdateRecords(
          records,
          client,
          yandexProvider,
          'en',
          ['it'],
          getFieldTypeDictionary,
          { ...pluginParams, vendor: 'yandex' },
          { alert: vi.fn(), environment: 'main' },
          'access-token',
        ),
      ).rejects.toThrow(/Folder ID/i);

      expect(translateFieldValue).toHaveBeenCalledTimes(1);
      expect(getFieldTypeDictionary).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    it('pauses via onSystemic instead of aborting when a pause handler is wired', async () => {
      // Same fatal Yandex config error, but with a systemic pause handler
      // present: 'auth' is a SYSTEMIC_CODE, so the systemic-retry loop calls
      // onSystemic (pause) BEFORE the error can fall through to the run-level
      // fatal abort. Returning 'cancelled' ends the run cleanly (resolves),
      // whereas the no-handler abort path rejects. This locks pause-first.
      vi.mocked(translateFieldValue).mockRejectedValue(
        new ProviderError('Folder ID is invalid', 400, 'yandex'),
      );
      const onSystemic = vi.fn().mockResolvedValue('cancelled');
      const update = vi.fn();
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub for the test
      const client = { items: { update } } as any;
      const records: DatoCMSRecordFromAPI[] = [
        { id: 'r1', item_type: { id: 'm1' }, title: { en: 'First' } },
      ];
      const getFieldTypeDictionary = vi.fn().mockResolvedValue({
        title: { editor: 'single_line', id: 'field-title', isLocalized: true },
      });
      const yandexProvider = { ...provider, vendor: 'yandex' as const };

      // Resolves (does not reject): the pause handler intercepts the systemic
      // error and cancels, so the run never reaches the fatal-abort throw.
      await translateAndUpdateRecords(
        records,
        client,
        yandexProvider,
        'en',
        ['it'],
        getFieldTypeDictionary,
        { ...pluginParams, vendor: 'yandex' },
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { onSystemic },
      );

      expect(onSystemic).toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('paces the run through a run-scoped adaptive pacer that widens after a rate limit', async () => {
      // The first provider call 429s; the systemic handler resumes; the retry
      // then succeeds. This exercises the whole wiring chain — createPacer being
      // instantiated in the run and threaded down to the provider-call seam.
      vi.mocked(translateFieldValue)
        .mockRejectedValueOnce(
          Object.assign(new Error('Rate limit exceeded'), { status: 429 }),
        )
        .mockResolvedValue('Ciao');

      const sleeps: number[] = [];
      const sleep = vi.fn(async (ms: number) => {
        sleeps.push(ms);
      });

      const update = vi
        .fn()
        .mockImplementation(
          async (_id: string, payload: Record<string, unknown>) => ({
            ...payload,
            meta: { updated_at: '2026-07-08T21:00:00.000Z' },
          }),
        );
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
      const client = { items: { update } } as any;

      const records: DatoCMSRecordFromAPI[] = [
        { id: 'r1', item_type: { id: 'm1' }, title: { en: 'Hello' } },
      ];
      const getFieldTypeDictionary = vi.fn().mockResolvedValue({
        title: { editor: 'single_line', id: 'field-title', isLocalized: true },
      });

      await translateAndUpdateRecords(
        records,
        client,
        provider,
        'en',
        ['it'],
        getFieldTypeDictionary,
        pluginParams,
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        {
          onProgress: vi.fn(),
          onSystemic: async () => 'retry',
          sleep,
        },
      );

      // Baseline gap for openai is 50ms; after the 429 the pacer doubles it to
      // 100ms. Both waits firing proves the run consults an adaptive pacer that
      // widens — the reactive pause alone would leave `sleeps` empty.
      expect(sleeps).toEqual([50, 100]);
      expect(translateFieldValue).toHaveBeenCalledTimes(2);
    });

    it('persists an incremental checkpoint after each record (resume, step 3)', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
      const update = vi
        .fn()
        .mockImplementation(
          async (_id: string, payload: Record<string, unknown>) => ({
            ...payload,
            meta: { updated_at: '2026-07-08T21:00:00.000Z' },
          }),
        );
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
      const client = { items: { update } } as any;
      const records: DatoCMSRecordFromAPI[] = [
        { id: 'r1', item_type: { id: 'm1' }, title: { en: 'One' } },
        { id: 'r2', item_type: { id: 'm1' }, title: { en: 'Two' } },
      ];
      const getFieldTypeDictionary = vi.fn().mockResolvedValue({
        title: { editor: 'single_line', id: 'field-title', isLocalized: true },
      });
      const checkpoints: number[] = [];
      const persist = vi.fn((state: { checkpoint: number }) => {
        checkpoints.push(state.checkpoint);
      });

      await translateAndUpdateRecords(
        records,
        client,
        provider,
        'en',
        ['it'],
        getFieldTypeDictionary,
        pluginParams,
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { persist },
      );

      // One persisted checkpoint per record, monotonically increasing.
      expect(persist).toHaveBeenCalledTimes(2);
      expect(checkpoints).toEqual([1, 2]);
    });

    it('resumes only the unfinished units, skipping records already done (step 6b)', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
      const update = vi
        .fn()
        .mockImplementation(
          async (id: string, payload: Record<string, unknown>) => ({
            id,
            ...payload,
            meta: { updated_at: '2026-07-08T21:00:00.000Z' },
          }),
        );
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
      const client = { items: { update } } as any;
      const records: DatoCMSRecordFromAPI[] = [
        { id: 'r1', item_type: { id: 'm1' }, title: { en: 'One' } },
        { id: 'r2', item_type: { id: 'm1' }, title: { en: 'Two' } },
      ];
      const getFieldTypeDictionary = vi.fn().mockResolvedValue({
        title: { editor: 'single_line', id: 'field-title', isLocalized: true },
      });
      const priorState = bumpCheckpoint(
        createRunState({
          runId: 'run-1',
          deviceId: 'device-1',
          startedAt: 1,
          operation: 'translate',
          policyDigest: 'abcd1234',
          fromLocale: 'en',
          toLocales: ['it'],
        }),
      );
      const targets: ResumeTarget[] = [{ recordId: 'r2', toLocale: 'it' }];

      await translateAndUpdateRecords(
        records,
        client,
        provider,
        'en',
        ['it'],
        getFieldTypeDictionary,
        pluginParams,
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { resume: { priorState, targets } },
      );

      // r1 is already done (not a target); only r2 is (re-)written.
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith('r2', expect.anything());
    });

    // The merge seam: master's report pipeline (reference copies →
    // completed-with-warnings) and the QC branch's error escalation (design §6b)
    // both feed the per-record status. These assert their interaction end-to-end
    // through translateAndUpdateRecords — behavior neither side's tests exercised.
    const runSingleRecord = async (
      record: DatoCMSRecordFromAPI,
      dict: Record<string, unknown>,
    ): Promise<ProgressUpdate | undefined> => {
      const updates: ProgressUpdate[] = [];
      const update = vi
        .fn()
        .mockImplementation(
          async (_id: string, payload: Record<string, unknown>) => ({
            ...payload,
            meta: { updated_at: '2026-07-08T21:00:00.000Z' },
          }),
        );
      // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
      const client = { items: { update } } as any;
      await translateAndUpdateRecords(
        [record],
        client,
        provider,
        'en',
        ['it'],
        vi.fn().mockResolvedValue(dict),
        pluginParams,
        { alert: vi.fn(), environment: 'main' },
        'access-token',
        { onProgress: (u) => updates.push(u) },
      );
      return updates.filter((u) => u.recordId === record.id).at(-1);
    };

    it('blocks a locale whose translation carries an error-severity QC flag (plan/apply §3)', async () => {
      // The provider truncated the field — a content-corrupting error. Under the
      // plan/apply gate this now BLOCKS the locale (the bad value is never
      // written), and the record surfaces as an error via the failed-locale path.
      vi.mocked(translateFieldValue).mockImplementation(async (...args) => {
        const opts = args[13] as
          | { onQcFlag?: (flag: QcFlag) => void }
          | undefined;
        opts?.onQcFlag?.({
          checkId: 'truncated',
          severity: 'error',
          message: 'Provider cut the response off.',
        });
        return 'Ciao';
      });

      const finalUpdate = await runSingleRecord(
        {
          id: 'qc-err',
          item_type: { id: 'm1' },
          title: { en: 'Hello' },
        },
        {
          title: { editor: 'single_line', id: 'field-title', isLocalized: true },
        },
      );

      expect(finalUpdate?.status).toBe('error');
      // Reported as a failed locale (the truncated value was NOT written), and the
      // structured qcFlag is retained for the report.
      expect(
        finalUpdate?.qcFlags?.some((f) => f.checkId === 'truncated'),
      ).toBe(true);
    });

    it('fails the record when one field\'s provider call fails, even if a sibling field succeeds', async () => {
      // Regression (plan/apply flip review): a provider-FAILED field is not a QC
      // flag, so conform keeps the locale `written`. The record must still surface
      // as `error` via the locale's failed-field accounting — not silently pass as
      // completed-with-warnings.
      vi.mocked(translateFieldValue).mockImplementation(async (...args) => {
        if (args[0] === 'FailMe') throw new Error('provider exploded');
        return 'Ciao';
      });

      const finalUpdate = await runSingleRecord(
        {
          id: 'mixed',
          item_type: { id: 'm1' },
          title: { en: 'Hello' },
          subtitle: { en: 'FailMe' },
        },
        {
          title: { editor: 'single_line', id: 'field-title', isLocalized: true },
          subtitle: { editor: 'single_line', id: 'field-subtitle', isLocalized: true },
        },
      );

      expect(finalUpdate?.status).toBe('error');
    });

    it('lets an error-severity QC flag win over a reference-copy warning (status "error")', async () => {
      // title translates but truncates (error); related is a link field carried
      // over by locale-sync (a warning). The error must win the status, and the
      // update must still carry BOTH signals for the report.
      vi.mocked(translateFieldValue).mockImplementation(async (...args) => {
        const opts = args[13] as
          | { onQcFlag?: (flag: QcFlag) => void }
          | undefined;
        opts?.onQcFlag?.({
          checkId: 'truncated',
          severity: 'error',
          message: 'Provider cut the response off.',
        });
        return 'Ciao';
      });

      const finalUpdate = await runSingleRecord(
        {
          id: 'qc-err-ref',
          item_type: { id: 'm1' },
          title: { en: 'Hello' },
          related: { en: ['rec-a', 'rec-b'] },
        },
        {
          title: { editor: 'single_line', id: 'field-title', isLocalized: true },
          related: {
            editor: 'links_select',
            id: 'field-related',
            isLocalized: true,
            validators: { items_item_type: { item_types: ['m1'] } },
          },
        },
      );

      expect(finalUpdate?.status).toBe('error');
      expect(
        finalUpdate?.qcFlags?.some((f) => f.checkId === 'truncated'),
      ).toBe(true);
      expect(finalUpdate?.copiedLinkFieldApiKeys).toContain('related');
    });

    it('surfaces a warning-severity QC flag as "completed-with-warnings"', async () => {
      vi.mocked(translateFieldValue).mockImplementation(async (...args) => {
        const opts = args[13] as
          | { onQcFlag?: (flag: QcFlag) => void }
          | undefined;
        opts?.onQcFlag?.({
          checkId: 'no-op',
          severity: 'warning',
          message: 'Unchanged from source.',
        });
        return 'Ciao';
      });

      const finalUpdate = await runSingleRecord(
        {
          id: 'qc-warn',
          item_type: { id: 'm1' },
          title: { en: 'Hello' },
        },
        {
          title: { editor: 'single_line', id: 'field-title', isLocalized: true },
        },
      );

      expect(finalUpdate?.status).toBe('completed-with-warnings');
      expect(
        finalUpdate?.qcFlags?.some((f) => f.checkId === 'no-op'),
      ).toBe(true);
    });

    it('escalates an over-length translation to a failure naming the field (card #1)', async () => {
      // The customer's silent-truncation case: the translation grows past the
      // field's length validator. It must surface as a failure BEFORE the CMA
      // 422s, naming the field and the limit.
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao mondo bellissimo');

      const finalUpdate = await runSingleRecord(
        {
          id: 'too-long',
          item_type: { id: 'm1' },
          title: { en: 'Hello' },
        },
        {
          title: {
            editor: 'single_line',
            id: 'field-title',
            isLocalized: true,
            validators: { length: { max: 5 } },
          },
        },
      );

      expect(finalUpdate?.status).toBe('error');
      expect(
        finalUpdate?.warnings?.some(
          (w) => w.includes('title') && w.includes('at most 5'),
        ),
      ).toBe(true);
      expect(
        finalUpdate?.qcFlags?.some((f) => f.checkId === 'length-validator'),
      ).toBe(true);
    });

    describe('optimistic locking (spec §7.2)', () => {
      /** Shape of a real `@datocms/rest-client-utils` `ApiError` 422 body. */
      const staleItemVersionError = {
        request: {
          url: 'https://site-api.datocms.com/items/r1',
          method: 'PUT',
          headers: {},
        },
        response: {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: {},
          body: {
            data: [
              {
                id: 'err',
                type: 'api_error',
                attributes: {
                  code: 'STALE_ITEM_VERSION',
                  details: {},
                  doc_url: 'https://www.datocms.com',
                },
              },
            ],
          },
        },
      };

      it("sends the fetched record's meta.current_version on the update call", async () => {
        vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
        const update = vi
          .fn()
          .mockImplementation(
            async (_id: string, payload: Record<string, unknown>) => ({
              ...payload,
              meta: { updated_at: '2026-07-08T21:00:00.000Z' },
            }),
          );
        // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
        const client = { items: { update } } as any;

        const records: DatoCMSRecordFromAPI[] = [
          {
            id: 'r1',
            item_type: { id: 'm1' },
            title: { en: 'Hello' },
            meta: { current_version: 'version-abc' },
          },
        ];

        await translateAndUpdateRecords(
          records,
          client,
          provider,
          'en',
          ['it'],
          vi.fn().mockResolvedValue({
            title: { editor: 'single_line', id: 'field-title', isLocalized: true },
          }),
          pluginParams,
          { alert: vi.fn(), environment: 'main' },
          'access-token',
          {},
        );

        expect(update).toHaveBeenCalledTimes(1);
        const [, body] = update.mock.calls[0] as [string, Record<string, unknown>];
        expect(body.meta).toEqual({ current_version: 'version-abc' });
      });

      it('marks a STALE_ITEM_VERSION conflict as a per-record error and continues the run', async () => {
        vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
        const update = vi
          .fn()
          .mockRejectedValueOnce(staleItemVersionError)
          .mockImplementation(
            async (_id: string, payload: Record<string, unknown>) => ({
              ...payload,
              meta: { updated_at: '2026-07-08T21:00:00.000Z' },
            }),
          );
        // biome-ignore lint/suspicious/noExplicitAny: minimal CMA client stub
        const client = { items: { update } } as any;

        const records: DatoCMSRecordFromAPI[] = [
          {
            id: 'r1',
            item_type: { id: 'm1' },
            title: { en: 'Hello' },
            meta: { current_version: 'v1' },
          },
          {
            id: 'r2',
            item_type: { id: 'm1' },
            title: { en: 'Hello' },
            meta: { current_version: 'v2' },
          },
        ];

        const updates: ProgressUpdate[] = [];
        await withExpectedError('STALE_ITEM_VERSION mid-run conflict', () =>
          translateAndUpdateRecords(
            records,
            client,
            provider,
            'en',
            ['it'],
            vi.fn().mockResolvedValue({
              title: { editor: 'single_line', id: 'field-title', isLocalized: true },
            }),
            pluginParams,
            { alert: vi.fn(), environment: 'main' },
            'access-token',
            { onProgress: (u) => updates.push(u) },
          ),
        );

        const r1Final = updates.filter((u) => u.recordId === 'r1').at(-1);
        expect(r1Final?.status).toBe('error');
        expect(r1Final?.statusText).toMatch(/changed while translating/i);

        // The run must continue: the second record is still processed and saved.
        const r2Final = updates.filter((u) => u.recordId === 'r2').at(-1);
        expect(r2Final?.status).toBe('completed');
        expect(update).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('summarizeReferenceCopies', () => {
    it('returns null when there are no copies', () => {
      expect(summarizeReferenceCopies([])).toBeNull();
    });

    it('consolidates fields and locales into a single summary line', () => {
      const summary = summarizeReferenceCopies([
        { field: 'related', toLocale: 'it' },
        { field: 'also_related', toLocale: 'it' },
        { field: 'related', toLocale: 'fr' },
        { field: 'also_related', toLocale: 'fr' },
      ]);
      // Each field appears once (deduped), each locale appears once (deduped).
      expect(summary).toContain('"related"');
      expect(summary).toContain('"also_related"');
      expect(summary).toContain('Italian [it]');
      expect(summary).toContain('French [fr]');
      expect(summary).toMatch(/shared references/i);
      // No duplicate field mentions.
      expect(summary?.match(/"related"/g)?.length).toBe(1);
    });
  });

  describe('stripBlockIds', () => {
    it('strips id from top-level block objects', () => {
      const block = {
        type: 'item',
        id: 'block-1',
        attributes: { title: 'Hello' },
        relationships: {
          item_type: { data: { id: 'model-1', type: 'item_type' } },
        },
      };
      expect(stripBlockIds(block)).toEqual({
        type: 'item',
        attributes: { title: 'Hello' },
        relationships: {
          item_type: { data: { id: 'model-1', type: 'item_type' } },
        },
      });
    });

    it('recursively strips ids from nested blocks in arrays', () => {
      const value = [
        {
          type: 'item',
          id: 'outer-1',
          attributes: {
            nested: [
              {
                type: 'item',
                id: 'inner-1',
                attributes: { text: 'Deep' },
              },
            ],
          },
        },
      ];
      expect(stripBlockIds(value)).toEqual([
        {
          type: 'item',
          attributes: {
            nested: [
              {
                type: 'item',
                attributes: { text: 'Deep' },
              },
            ],
          },
        },
      ]);
    });

    it('leaves non-block objects untouched', () => {
      const value = { type: 'paragraph', children: [{ text: 'Hello' }] };
      expect(stripBlockIds(value)).toEqual(value);
    });

    it('preserves id on non-block objects (e.g., relationships)', () => {
      const value = {
        type: 'item_type',
        id: 'model-1',
      };
      // type is not "item", so id should remain
      expect(stripBlockIds(value)).toEqual({
        type: 'item_type',
        id: 'model-1',
      });
    });

    it('passes through primitives and null', () => {
      expect(stripBlockIds(null)).toBeNull();
      expect(stripBlockIds(undefined)).toBeUndefined();
      expect(stripBlockIds('hello')).toBe('hello');
      expect(stripBlockIds(42)).toBe(42);
    });
  });
});
