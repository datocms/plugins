import { describe, expect, it } from 'vitest';
import {
  ALL_LOCALES_VALUE,
  defaultFieldSelection,
  filterTranslatableFields,
  hasAnyFieldSelectedForModel,
  isFieldIncludedInSelection,
  isReadyToTranslate,
  pruneFieldSelection,
  resolveTargetLocales,
  type SdkField,
  sortFieldsByLayoutOrder,
} from './BulkTranslationHelpers';

/**
 * Builds a JSON:API-shaped field with sensible defaults for tests.
 */
function field(opts: {
  id: string;
  api_key: string;
  label?: string;
  localized?: boolean;
  position?: number;
  editor?: string;
}): SdkField {
  return {
    id: opts.id,
    attributes: {
      api_key: opts.api_key,
      label: opts.label ?? opts.api_key,
      localized: opts.localized ?? true,
      position: opts.position ?? 0,
      appearance: { editor: opts.editor ?? 'single_line' },
    },
  };
}

describe('sortFieldsByLayoutOrder', () => {
  it('sorts fields by their position attribute', () => {
    const fields: SdkField[] = [
      field({ id: 'c', api_key: 'c', position: 3 }),
      field({ id: 'a', api_key: 'a', position: 1 }),
      field({ id: 'b', api_key: 'b', position: 2 }),
    ];
    expect(
      sortFieldsByLayoutOrder(fields).map((f) => f.attributes.api_key),
    ).toEqual(['a', 'b', 'c']);
  });

  it('puts Title (position 1) above SEO (position 2) even when the loader returned SEO first', () => {
    // Mirrors the screenshot the user reported: the loader returned SEO
    // before Title, but Title's position is 1 and SEO's position is 2.
    const fields: SdkField[] = [
      field({ id: 's', api_key: 'seo', position: 2 }),
      field({ id: 't', api_key: 'title', position: 1 }),
    ];
    expect(
      sortFieldsByLayoutOrder(fields).map((f) => f.attributes.api_key),
    ).toEqual(['title', 'seo']);
  });

  it('does not mutate the input array', () => {
    const fields: SdkField[] = [
      field({ id: 'b', api_key: 'b', position: 2 }),
      field({ id: 'a', api_key: 'a', position: 1 }),
    ];
    const before = fields.map((f) => f.attributes.api_key);
    sortFieldsByLayoutOrder(fields);
    expect(fields.map((f) => f.attributes.api_key)).toEqual(before);
  });
});

describe('filterTranslatableFields', () => {
  const baseConfig = {
    translationFields: ['single_line', 'seo', 'structured_text', 'file'],
    apiKeysToBeExcludedFromThisPlugin: [],
  };

  it('preserves input order', () => {
    const config = {
      translationFields: ['single_line'],
      apiKeysToBeExcludedFromThisPlugin: [],
    };
    const fields: SdkField[] = [
      field({ id: '3', api_key: 'gamma' }),
      field({ id: '1', api_key: 'alpha' }),
      field({ id: '2', api_key: 'beta' }),
    ];
    expect(filterTranslatableFields(fields, config).map((r) => r.apiKey)).toEqual([
      'gamma',
      'alpha',
      'beta',
    ]);
  });

  it('keeps only localized, allowed, non-excluded fields', () => {
    const fields: SdkField[] = [
      field({ id: '1', api_key: 'title', label: 'Title' }),
      field({
        id: '2',
        api_key: 'untranslated',
        label: 'Untranslated',
        localized: false,
      }),
      field({
        id: '3',
        api_key: 'numeric',
        label: 'Numeric',
        editor: 'integer',
      }),
      field({
        id: '4',
        api_key: 'description',
        label: 'Description',
        editor: 'seo',
      }),
    ];

    const result = filterTranslatableFields(fields, baseConfig);

    expect(result.map((r) => r.apiKey)).toEqual(['title', 'description']);
    expect(result[0]).toEqual({
      id: '1',
      apiKey: 'title',
      label: 'Title',
      editor: 'single_line',
    });
  });

  it('treats modular content variations as rich_text when rich_text is enabled', () => {
    const config = {
      translationFields: ['rich_text'],
      apiKeysToBeExcludedFromThisPlugin: [],
    };
    const fields: SdkField[] = [
      field({ id: '1', api_key: 'blocks', editor: 'rich_text' }),
      field({ id: '2', api_key: 'framed', editor: 'framed_single_block' }),
      field({ id: '3', api_key: 'frameless', editor: 'frameless_single_block' }),
    ];

    const result = filterTranslatableFields(fields, config);
    expect(result.map((r) => r.apiKey)).toEqual([
      'blocks',
      'framed',
      'frameless',
    ]);
  });

  it('treats gallery as file when file is enabled', () => {
    const config = {
      translationFields: ['file'],
      apiKeysToBeExcludedFromThisPlugin: [],
    };
    const fields: SdkField[] = [
      field({ id: '1', api_key: 'cover', editor: 'file' }),
      field({ id: '2', api_key: 'photos', editor: 'gallery' }),
    ];
    expect(filterTranslatableFields(fields, config).map((r) => r.apiKey)).toEqual([
      'cover',
      'photos',
    ]);
  });

  it('honors exclusions by both field id and api_key', () => {
    const config = {
      translationFields: ['single_line'],
      apiKeysToBeExcludedFromThisPlugin: ['internal_name', '42'],
    };
    const fields: SdkField[] = [
      field({ id: '1', api_key: 'title' }),
      field({ id: '2', api_key: 'internal_name' }),
      field({ id: '42', api_key: 'tracking_code' }),
    ];
    expect(filterTranslatableFields(fields, config).map((r) => r.apiKey)).toEqual([
      'title',
    ]);
  });
});

describe('resolveTargetLocales', () => {
  it('expands the all-locales sentinel and drops the source', () => {
    const result = resolveTargetLocales(
      [ALL_LOCALES_VALUE],
      ['en', 'fr', 'de', 'es'],
      'en',
    );
    expect(result).toEqual(['fr', 'de', 'es']);
  });

  it('keeps explicit selection order', () => {
    expect(
      resolveTargetLocales(['de', 'fr'], ['en', 'fr', 'de'], 'en'),
    ).toEqual(['de', 'fr']);
  });

  it('drops the source locale even when explicitly selected', () => {
    expect(
      resolveTargetLocales(['en', 'fr'], ['en', 'fr', 'de'], 'en'),
    ).toEqual(['fr']);
  });

  it('deduplicates repeated locales', () => {
    expect(
      resolveTargetLocales(
        ['fr', 'de', 'fr'],
        ['en', 'fr', 'de'],
        'en',
      ),
    ).toEqual(['fr', 'de']);
  });

  it('returns empty when only the source is selected', () => {
    expect(resolveTargetLocales(['en'], ['en', 'fr'], 'en')).toEqual([]);
  });

  it('all-locales sentinel takes precedence and ignores other entries', () => {
    expect(
      resolveTargetLocales(
        [ALL_LOCALES_VALUE, 'fr'],
        ['en', 'fr', 'de'],
        'en',
      ),
    ).toEqual(['fr', 'de']);
  });
});

describe('hasAnyFieldSelectedForModel', () => {
  it('returns true only when there is at least one field selected', () => {
    expect(hasAnyFieldSelectedForModel('m1', { m1: ['title'] })).toBe(true);
    expect(hasAnyFieldSelectedForModel('m1', { m1: [] })).toBe(false);
    expect(hasAnyFieldSelectedForModel('m1', {})).toBe(false);
  });
});

describe('isFieldIncludedInSelection', () => {
  it('is permissive when no selection is provided', () => {
    expect(isFieldIncludedInSelection('m1', 'title', undefined)).toBe(true);
  });

  it('is strict when a selection is provided', () => {
    const selection = { m1: ['title', 'description'] };
    expect(isFieldIncludedInSelection('m1', 'title', selection)).toBe(true);
    expect(isFieldIncludedInSelection('m1', 'untracked', selection)).toBe(false);
    expect(isFieldIncludedInSelection('m2', 'title', selection)).toBe(false);
  });
});

describe('isReadyToTranslate', () => {
  it('requires source, targets, models, and a non-empty field selection for every model', () => {
    expect(
      isReadyToTranslate({
        sourceLocale: 'en',
        targetLocales: ['fr'],
        selectedModelIds: ['m1'],
        selectedFieldsByModel: { m1: ['title'] },
      }),
    ).toBe(true);

    expect(
      isReadyToTranslate({
        sourceLocale: null,
        targetLocales: ['fr'],
        selectedModelIds: ['m1'],
        selectedFieldsByModel: { m1: ['title'] },
      }),
    ).toBe(false);

    expect(
      isReadyToTranslate({
        sourceLocale: 'en',
        targetLocales: [],
        selectedModelIds: ['m1'],
        selectedFieldsByModel: { m1: ['title'] },
      }),
    ).toBe(false);

    expect(
      isReadyToTranslate({
        sourceLocale: 'en',
        targetLocales: ['fr'],
        selectedModelIds: [],
        selectedFieldsByModel: {},
      }),
    ).toBe(false);

    expect(
      isReadyToTranslate({
        sourceLocale: 'en',
        targetLocales: ['fr'],
        selectedModelIds: ['m1', 'm2'],
        selectedFieldsByModel: { m1: ['title'] },
      }),
    ).toBe(false);
  });
});

describe('defaultFieldSelection', () => {
  it('selects every field by default', () => {
    expect(
      defaultFieldSelection([
        { id: '1', apiKey: 'title', label: 'Title', editor: 'single_line' },
        {
          id: '2',
          apiKey: 'description',
          label: 'Description',
          editor: 'seo',
        },
      ]),
    ).toEqual(['title', 'description']);
  });

  it('handles empty input', () => {
    expect(defaultFieldSelection([])).toEqual([]);
  });
});

describe('pruneFieldSelection', () => {
  it('drops entries for models that are no longer selected', () => {
    const before = {
      m1: ['title'],
      m2: ['description'],
      m3: ['name'],
    };
    const after = pruneFieldSelection(before, ['m1', 'm3']);
    expect(after).toEqual({ m1: ['title'], m3: ['name'] });
    // input is not mutated
    expect(before).toEqual({
      m1: ['title'],
      m2: ['description'],
      m3: ['name'],
    });
  });

  it('returns an empty map when no models are kept', () => {
    expect(pruneFieldSelection({ m1: ['x'] }, [])).toEqual({});
  });
});
