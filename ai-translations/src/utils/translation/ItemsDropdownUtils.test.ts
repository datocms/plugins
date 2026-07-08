import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import {
  buildTranslatedUpdatePayload,
  type DatoCMSRecordFromAPI,
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

      expect(result.payload.title).toEqual({
        en: 'Hello',
        de: 'Hallo',
        it: 'Ciao',
      });
      expect(result.payload.slug).toEqual({
        en: 'hello-world',
        de: 'hallo-welt',
        it: null,
      });
      expect(result.warnings).toContain(
        'Field "slug" to Italian [it] was skipped: Plugin error: Translated slug is empty after normalization.',
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
  });

  describe('translateAndUpdateRecords', () => {
    it('attaches structured report data to the completed progress update', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');
      const updates: ProgressUpdate[] = [];
      const update = vi
        .fn()
        .mockResolvedValue({ meta: { updated_at: '2026-07-08T21:00:00.000Z' } });
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
      expect(finalUpdate?.status).toBe('completed');
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
