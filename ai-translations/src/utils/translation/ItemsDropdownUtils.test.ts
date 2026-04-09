import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import {
  buildTranslatedUpdatePayload,
  type DatoCMSRecordFromAPI,
  shouldTranslateField,
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
        'Field "slug" was skipped: Translated slug is empty after normalization.',
      );
    });

    it('copies source value for required non-translatable fields', async () => {
      vi.mocked(translateFieldValue).mockResolvedValue('Ciao');

      const dictWithRequired = {
        title: {
          editor: 'single_line',
          id: 'field-title',
          isLocalized: true,
          validators: { required: {} },
        },
        slug: { editor: 'slug', id: 'field-slug', isLocalized: true },
        body: { editor: 'structured_text', id: 'field-body', isLocalized: true },
      };

      const result = await buildTranslatedUpdatePayload(
        record,
        'en',
        'it',
        dictWithRequired,
        provider,
        { ...pluginParams, translationFields: ['slug', 'structured_text'] },
        'access-token',
        'main',
      );

      // title is required but not translatable → copies source value
      expect(result.payload.title).toEqual({
        en: 'Hello',
        de: 'Hallo',
        it: 'Hello',
      });
      // slug and body are translated normally
      expect(result.payload.slug).toEqual({
        en: 'hello-world',
        de: 'hallo-welt',
        it: 'Ciao',
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
  });
});
