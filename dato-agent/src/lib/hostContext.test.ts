import type { Field, ItemType } from 'datocms-plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRecordHostContext,
  buildStandaloneHostContext,
  CURRENT_RECORD_FORM_STATE_CAVEAT,
  createModelSchemaResolver,
  MAX_CURRENT_RECORD_FORM_STATE_CHARACTERS,
  readCurrentRecordFormState,
} from './hostContext';

type ModelOptions = {
  id: string;
  apiKey: string;
  name?: string;
  fieldIds?: string[];
  block?: boolean;
  singleton?: boolean;
  hint?: string | null;
  presentationTitleFieldId?: string;
};

function model({
  id,
  apiKey,
  name = apiKey,
  fieldIds = [],
  block = false,
  singleton = false,
  hint = null,
  presentationTitleFieldId,
}: ModelOptions): ItemType {
  const fieldRelationship = (fieldId?: string) => ({
    data: fieldId ? { type: 'field' as const, id: fieldId } : null,
  });

  return {
    type: 'item_type',
    id,
    attributes: {
      name,
      api_key: apiKey,
      collection_appearance: 'compact',
      singleton,
      all_locales_required: false,
      sortable: false,
      modular_block: block,
      draft_mode_active: !block,
      draft_saving_active: false,
      tree: false,
      ordering_direction: null,
      ordering_meta: null,
      has_singleton_item: false,
      hint,
      inverse_relationships_enabled: false,
    },
    relationships: {
      singleton_item: { data: null },
      fields: {
        data: fieldIds.map((fieldId) => ({
          type: 'field' as const,
          id: fieldId,
        })),
      },
      fieldsets: { data: [] },
      presentation_title_field: fieldRelationship(presentationTitleFieldId),
      presentation_image_field: fieldRelationship(),
      title_field: fieldRelationship(),
      image_preview_field: fieldRelationship(),
      excerpt_field: fieldRelationship(),
      ordering_field: fieldRelationship(),
      workflow: { data: null },
    },
    meta: { has_singleton_item: false },
  };
}

type FieldOptions = {
  id: string;
  modelId: string;
  apiKey: string;
  type?: Field['attributes']['field_type'];
  label?: string;
  localized?: boolean;
  validators?: Record<string, unknown>;
  hint?: string | null;
  position?: number;
  defaultValue?: unknown;
  addons?: unknown[];
};

function field({
  id,
  modelId,
  apiKey,
  type = 'string',
  label = apiKey,
  localized = false,
  validators = {},
  hint = null,
  position = 0,
  defaultValue = null,
  addons = [],
}: FieldOptions): Field {
  return {
    type: 'field',
    id,
    attributes: {
      label,
      field_type: type,
      localized,
      default_value: defaultValue,
      api_key: apiKey,
      hint,
      validators,
      appearance: {
        editor: type === 'structured_text' ? 'structured_text' : 'single_line',
        parameters: {},
        addons,
      },
      position,
      deep_filtering_enabled: false,
      content_link_enabled: true,
    },
    relationships: {
      item_type: { data: { type: 'item_type', id: modelId } },
      fieldset: { data: null },
    },
  } as Field;
}

const coordinates = {
  siteId: 'site-1',
  siteName: 'Marketing site',
  environment: 'primary',
  isEnvironmentPrimary: true,
  locales: ['en', 'it'],
  uiLocale: 'en',
} as const;

describe('buildRecordHostContext', () => {
  it('combines the current-model manifest with type-aware bounded live values', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: [
        'title-id',
        'body-id',
        'author-id',
        'gallery-id',
        'metadata-id',
      ],
      presentationTitleFieldId: 'title-id',
    });
    const author = model({
      id: 'author-model-id',
      apiKey: 'author',
      name: 'Author',
    });
    const fields = [
      field({
        id: 'title-id',
        modelId: article.id,
        apiKey: 'title',
        label: 'Title',
        localized: true,
        validators: { required: {} },
        defaultValue: 'raw-default-must-not-appear',
        addons: [{ id: 'addon', parameters: { token: 'addon-secret' } }],
      }),
      field({
        id: 'body-id',
        modelId: article.id,
        apiKey: 'body',
        type: 'structured_text',
        position: 1,
      }),
      field({
        id: 'author-id',
        modelId: article.id,
        apiKey: 'author',
        type: 'link',
        validators: {
          item_item_type: { item_types: [author.id] },
        },
        position: 2,
      }),
      field({
        id: 'gallery-id',
        modelId: article.id,
        apiKey: 'gallery',
        type: 'gallery',
        position: 3,
      }),
      field({
        id: 'metadata-id',
        modelId: article.id,
        apiKey: 'metadata',
        type: 'json',
        position: 4,
      }),
    ];
    const result = buildRecordHostContext({
      ...coordinates,
      model: article,
      itemTypes: [article, author],
      fields,
      formValues: {
        title: { en: 'Hello', it: 'Ciao' },
        body: [
          {
            type: 'paragraph',
            children: [
              { text: 'Visible introduction' },
              { text: `Hidden tail ${'Z'.repeat(2_000)}` },
            ],
          },
          {
            type: 'block',
            blockModelId: 'hero-id',
            children: [{ text: '' }],
          },
        ],
        author: 'author-record-id',
        gallery: [
          { id: 'upload-one', metadata: { secret: 'do-not-copy' } },
          { id: 'upload-two' },
        ],
        metadata: {
          safe: true,
          nested: { private: 'raw-json-must-not-appear' },
        },
      },
      activeLocale: 'it',
      status: 'updated',
      dirty: true,
      submitting: false,
      recordId: 'record-1',
      blockCounts: {
        total: 3,
        nonLocalized: 1,
        perLocale: { it: 1, en: 1 },
        maximumPerItem: 100,
      },
      maxCharacters: 7_000,
      maxValueCharacters: 48,
    });

    expect(result.text).toContain('surface=record');
    expect(result.text).toContain('active_locale="it"');
    expect(result.text).toContain('status=updated|dirty=true');
    expect(result.text).toContain(
      'field title|"Title"|string|localized|required',
    );
    expect(result.text).toContain('field body|"body"|structured_text');
    expect(result.text).toContain(
      'live_value|field="title"|type=string|locale="it"|"Ciao"',
    );
    expect(result.text).not.toContain('"Hello"');
    expect(result.text).toContain(
      'live_value|field="author"|type=link|id="author-record-id"',
    );
    expect(result.text).toContain(
      'live_value|field="gallery"|type=gallery|count=2|ids=["upload-one","upload-two"]',
    );
    expect(result.text).toContain(
      'live_value|field="metadata"|type=json|object(keys=2)',
    );
    expect(result.text).toContain('blocks=1');
    expect(result.text).toContain('truncated=true');
    expect(result.text).not.toContain('raw-default-must-not-appear');
    expect(result.text).not.toContain('addon-secret');
    expect(result.text).not.toContain('do-not-copy');
    expect(result.text).not.toContain('raw-json-must-not-appear');
    expect(result.text).not.toContain('Z'.repeat(100));
    expect(result.fingerprint).toMatch(/^hostctx-v1-[0-9a-f]{8}-[0-9a-z]+$/);
  });

  it('is deterministic and changes its bounded fingerprint with live state', () => {
    const page = model({
      id: 'page-id',
      apiKey: 'page',
      fieldIds: ['title-id'],
    });
    const fields = [
      field({
        id: 'title-id',
        modelId: page.id,
        apiKey: 'title',
      }),
    ];
    const base = {
      ...coordinates,
      model: page,
      itemTypes: [page],
      fields,
      formValues: { title: 'A page' },
      activeLocale: 'en',
      status: 'draft' as const,
      dirty: false,
      submitting: false,
      recordId: 'record-1',
    };
    const first = buildRecordHostContext(base);
    const second = buildRecordHostContext({
      ...base,
      formValues: { title: 'A page' },
    });
    const changed = buildRecordHostContext({ ...base, dirty: true });

    expect(second).toEqual(first);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(first.fingerprint.length).toBeLessThan(40);
  });

  it('falls back atomically to a smaller schema mode and bounds live values', () => {
    const fieldIds = Array.from({ length: 20 }, (_, index) => `field-${index}`);
    const largeModel = model({
      id: 'large-id',
      apiKey: 'large',
      fieldIds,
    });
    const fields = fieldIds.map((id, index) =>
      field({
        id,
        modelId: largeModel.id,
        apiKey: `field_${index}`,
        label: `Long field label ${index}`,
        hint: 'H'.repeat(200),
        position: index,
      }),
    );
    const result = buildRecordHostContext({
      ...coordinates,
      model: largeModel,
      itemTypes: [largeModel],
      fields,
      formValues: Object.fromEntries(
        fieldIds.map((_, index) => [
          `field_${index}`,
          `Value ${index} ${'V'.repeat(200)}`,
        ]),
      ),
      activeLocale: 'en',
      status: 'draft',
      dirty: false,
      submitting: false,
      maxCharacters: 1_100,
      maxValueCharacters: 40,
    });

    expect(result.text.length).toBeLessThanOrEqual(1_100);
    expect(result.text).toContain('schema_mode=on_demand');
    expect(result.text).toContain('live_values|included=');
  });

  it('caps JSON string values instead of copying unbounded serialized content', () => {
    const page = model({
      id: 'page-id',
      apiKey: 'page',
      fieldIds: ['settings-id'],
    });
    const result = buildRecordHostContext({
      ...coordinates,
      model: page,
      itemTypes: [page],
      fields: [
        field({
          id: 'settings-id',
          modelId: page.id,
          apiKey: 'settings',
          type: 'json',
        }),
      ],
      formValues: {
        settings: `visible-${'private-tail-'.repeat(100)}`,
      },
      activeLocale: 'en',
      status: 'draft',
      dirty: false,
      submitting: false,
      maxValueCharacters: 24,
    });

    expect(result.text).toContain(
      'live_value|field="settings"|type=json|"visible-private-tail-pr…"|truncated=true',
    );
    expect(result.text).not.toContain('private-tail-'.repeat(10));
  });
});

describe('readCurrentRecordFormState', () => {
  it('returns bounded type-aware live browser form values with an explicit unsaved-state caveat', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id', 'body-id', 'settings-id', 'gallery-id'],
    });
    const fields = [
      field({
        id: 'title-id',
        modelId: article.id,
        apiKey: 'title',
        label: 'Title',
        localized: true,
      }),
      field({
        id: 'body-id',
        modelId: article.id,
        apiKey: 'body',
        type: 'structured_text',
      }),
      field({
        id: 'settings-id',
        modelId: article.id,
        apiKey: 'settings',
        type: 'json',
      }),
      field({
        id: 'gallery-id',
        modelId: article.id,
        apiKey: 'gallery',
        type: 'gallery',
      }),
    ];
    const result = readCurrentRecordFormState({
      model: article,
      fields,
      formValues: {
        title: { en: 'Unsaved English', it: 'Bozza italiana' },
        body: [
          {
            type: 'paragraph',
            children: [
              { text: `Visible draft ${'B'.repeat(2_000)}` },
              { internalSlateProperty: 'must-not-appear' },
            ],
          },
        ],
        settings: {
          privateToken: 'must-not-appear',
          nested: { secret: true },
        },
        gallery: [{ id: 'upload-1', metadata: { secret: 'must-not-appear' } }],
      },
      activeLocale: 'it',
      locales: ['en', 'it'],
      dirty: true,
      recordId: null,
      requests: [
        { fieldPath: 'title', locale: null },
        { fieldPath: 'body' },
        { fieldPath: 'settings' },
        { fieldPath: 'gallery' },
      ],
      maxValueCharacters: 48,
    });

    expect(result).toMatchObject({
      source: 'current_record_browser_form_state',
      persistence: 'may_be_unsaved',
      savedOrPublishedStateVerified: false,
      caveat: CURRENT_RECORD_FORM_STATE_CAVEAT,
      record: {
        id: null,
        modelId: 'article-id',
        modelApiKey: 'article',
      },
      form: { dirty: true },
      fields: [
        {
          fieldPath: 'title',
          locale: 'it',
          state: 'value',
          summary: '"Bozza italiana"',
        },
        {
          fieldPath: 'body',
          locale: null,
          state: 'value',
          truncated: true,
        },
        {
          fieldPath: 'settings',
          locale: null,
          state: 'value',
          summary: 'object(keys=2)',
        },
        {
          fieldPath: 'gallery',
          locale: null,
          state: 'value',
          summary: 'count=1|ids=["upload-1"]',
        },
      ],
      truncated: true,
    });
    expect(result.fields[1]?.summary).toContain('text="Visible draft');
    expect(JSON.stringify(result)).not.toContain('Unsaved English');
    expect(JSON.stringify(result)).not.toContain('internalSlateProperty');
    expect(JSON.stringify(result)).not.toContain('privateToken');
    expect(JSON.stringify(result)).not.toContain('must-not-appear');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      MAX_CURRENT_RECORD_FORM_STATE_CHARACTERS,
    );
  });

  it('distinguishes value, empty, null, and missing without making per-field save claims', () => {
    const page = model({
      id: 'page-id',
      apiKey: 'page',
      fieldIds: [
        'value-id',
        'empty-id',
        'null-id',
        'missing-id',
        'localized-id',
      ],
    });
    const fields = [
      field({
        id: 'value-id',
        modelId: page.id,
        apiKey: 'value_field',
      }),
      field({
        id: 'empty-id',
        modelId: page.id,
        apiKey: 'empty_field',
        type: 'links',
      }),
      field({
        id: 'null-id',
        modelId: page.id,
        apiKey: 'null_field',
        type: 'file',
      }),
      field({
        id: 'missing-id',
        modelId: page.id,
        apiKey: 'missing_field',
      }),
      field({
        id: 'localized-id',
        modelId: page.id,
        apiKey: 'localized_field',
        localized: true,
      }),
    ];
    const result = readCurrentRecordFormState({
      model: page,
      fields,
      formValues: {
        value_field: 'Saved status is deliberately unknown',
        empty_field: [],
        null_field: null,
        localized_field: { en: 'English only' },
      },
      activeLocale: 'it',
      locales: ['en', 'it'],
      dirty: false,
      recordId: 'record-1',
      requests: [
        { fieldPath: 'value_field' },
        { fieldPath: 'empty_field' },
        { fieldPath: 'null_field' },
        { fieldPath: 'missing_field' },
        { fieldPath: 'localized_field', locale: null },
      ],
    });

    expect(result.fields.map(({ state }) => state)).toEqual([
      'value',
      'empty',
      'null',
      'missing',
      'missing',
    ]);
    expect(result.form).toEqual({ dirty: false });
    expect(result.fields.every((entry) => !('dirty' in entry))).toBe(true);
    expect(result.savedOrPublishedStateVerified).toBe(false);
    expect(result.caveat).toContain('may include unsaved edits');
    expect(result.caveat).toContain('does not prove');
  });

  it('requires exact current-model API keys, complete metadata, and unique requests', () => {
    const page = model({
      id: 'page-id',
      apiKey: 'page',
      fieldIds: ['title-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: page.id,
      apiKey: 'title',
    });
    const base = {
      model: page,
      fields: [title],
      formValues: { title: 'Hello' },
      activeLocale: 'en',
      locales: ['en'],
      dirty: false,
    };

    expect(() =>
      readCurrentRecordFormState({
        ...base,
        requests: [{ fieldPath: ' title' }],
      }),
    ).toThrow(/exact top-level field API key/);
    expect(() =>
      readCurrentRecordFormState({
        ...base,
        requests: [{ fieldPath: 'title' }, { fieldPath: 'title' }],
      }),
    ).toThrow(/requested more than once/);
    expect(() =>
      readCurrentRecordFormState({
        ...base,
        fields: [],
        requests: [{ fieldPath: 'title' }],
      }),
    ).toThrow(/current model fields are complete/);
    expect(() =>
      readCurrentRecordFormState({
        ...base,
        requests: [],
      }),
    ).toThrow(/between 1 and 10 fields/);
    expect(() =>
      readCurrentRecordFormState({
        ...base,
        requests: Array.from({ length: 11 }, () => ({
          fieldPath: 'title',
        })),
      }),
    ).toThrow(/between 1 and 10 fields/);
  });

  it('resolves null localized locales to the active locale and rejects invalid locale use', () => {
    const page = model({
      id: 'page-id',
      apiKey: 'page',
      fieldIds: ['title-id', 'slug-id'],
    });
    const fields = [
      field({
        id: 'title-id',
        modelId: page.id,
        apiKey: 'title',
        localized: true,
      }),
      field({
        id: 'slug-id',
        modelId: page.id,
        apiKey: 'slug',
        type: 'slug',
      }),
    ];
    const base = {
      model: page,
      fields,
      formValues: {
        title: { en: 'English', it: 'Italiano' },
        slug: 'home',
      },
      activeLocale: 'it',
      locales: ['en', 'it'],
      dirty: true,
    };

    expect(
      readCurrentRecordFormState({
        ...base,
        requests: [{ fieldPath: 'title', locale: null }],
      }).fields[0],
    ).toMatchObject({
      locale: 'it',
      summary: '"Italiano"',
    });
    expect(() =>
      readCurrentRecordFormState({
        ...base,
        requests: [{ fieldPath: 'title', locale: 'fr' }],
      }),
    ).toThrow(/not available/);
    expect(() =>
      readCurrentRecordFormState({
        ...base,
        requests: [{ fieldPath: 'slug', locale: 'it' }],
      }),
    ).toThrow(/not localized/);
  });

  it('enforces per-value and aggregate safety bounds', () => {
    const fieldIds = Array.from({ length: 10 }, (_, index) => `field-${index}`);
    const page = model({
      id: 'page-id',
      apiKey: 'page',
      fieldIds,
    });
    const fields = fieldIds.map((id, index) =>
      field({
        id,
        modelId: page.id,
        apiKey: `field_${index}`,
        type: 'text',
      }),
    );
    const result = readCurrentRecordFormState({
      model: page,
      fields,
      formValues: Object.fromEntries(
        fields.map((currentField) => [
          currentField.attributes.api_key,
          'X'.repeat(10_000),
        ]),
      ),
      activeLocale: 'en',
      locales: ['en'],
      dirty: true,
      requests: fields.map((currentField) => ({
        fieldPath: currentField.attributes.api_key,
      })),
    });

    expect(result.fields).toHaveLength(10);
    expect(result.fields.every((entry) => entry.truncated)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      MAX_CURRENT_RECORD_FORM_STATE_CHARACTERS,
    );
    expect(() =>
      readCurrentRecordFormState({
        model: page,
        fields,
        formValues: {},
        activeLocale: 'en',
        locales: ['en'],
        dirty: false,
        requests: [{ fieldPath: 'field_0' }],
        maxValueCharacters: 1_201,
      }),
    ).toThrow(/cannot exceed 1200/);
  });
});

describe('buildStandaloneHostContext', () => {
  it('uses the complete detailed map only when every model and field fits', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id'],
    });
    const author = model({
      id: 'author-id',
      apiKey: 'author',
      fieldIds: ['name-id'],
    });
    const result = buildStandaloneHostContext({
      ...coordinates,
      itemTypes: [author, article],
      loadedFields: [
        field({
          id: 'title-id',
          modelId: article.id,
          apiKey: 'title',
        }),
        field({
          id: 'name-id',
          modelId: author.id,
          apiKey: 'name',
        }),
      ],
      highlightedItemId: 'item-1',
      location: {
        pathname: '/editor/item_types/article-id/items',
        search: '?query=hello',
        hash: '',
      },
      maxCharacters: 5_000,
    });

    expect(result.text).toContain('surface=standalone');
    expect(result.text).toContain('highlighted_item_id="item-1"');
    expect(result.text).toContain('schema_mode=detailed_complete');
    expect(result.text).toContain('project_map|complete=true|models=2/2');
    expect(result.text).toContain('model article');
    expect(result.text).toContain('model author');
    expect(result.text).not.toContain('schema_on_demand=');
  });

  it('discards an incomplete detailed map and emits every compact model', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: ['title-id', 'body-id'],
    });
    const hero = model({
      id: 'hero-id',
      apiKey: 'hero',
      name: 'Hero',
      fieldIds: ['heading-id'],
      block: true,
    });
    const result = buildStandaloneHostContext({
      ...coordinates,
      itemTypes: [hero, article],
      loadedFields: [
        field({
          id: 'title-id',
          modelId: article.id,
          apiKey: 'title',
        }),
      ],
      maxCharacters: 2_000,
    });

    expect(result.text).toContain('schema_mode=directory_complete');
    expect(result.text).toContain('model_directory|complete=true|models=2');
    expect(result.text).toContain(
      'model_directory_entry|id="article-id"|api_key="article"|name="Article"|kind=model|fields=2',
    );
    expect(result.text).toContain(
      'model_directory_entry|id="hero-id"|api_key="hero"|name="Hero"|kind=block|fields=1',
    );
    expect(result.text).toContain('schema_on_demand=Use get_model_schema');
    expect(result.text).not.toContain('field title|');
    expect(result.text).not.toContain('missing_field_ids=');
  });

  it('uses a complete compact field directory before falling back to model-by-model schema discovery', () => {
    const articleFieldIds = Array.from(
      { length: 10 },
      (_, index) => `article-field-${index}`,
    );
    const authorFieldIds = Array.from(
      { length: 6 },
      (_, index) => `author-field-${index}`,
    );
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: articleFieldIds,
      presentationTitleFieldId: articleFieldIds[0],
    });
    const author = model({
      id: 'author-id',
      apiKey: 'author',
      name: 'Author',
      fieldIds: authorFieldIds,
    });
    const loadedFields = [
      ...articleFieldIds.map((id, index) =>
        field({
          id,
          modelId: article.id,
          apiKey: index === 0 ? 'title' : `article_field_${index}`,
          type: index === 1 ? 'structured_text' : 'string',
          localized: index === 1,
          hint: 'A'.repeat(200),
          position: index,
        }),
      ),
      ...authorFieldIds.map((id, index) =>
        field({
          id,
          modelId: author.id,
          apiKey: index === 0 ? 'bio' : `author_field_${index}`,
          type: index === 0 ? 'text' : 'string',
          hint: 'B'.repeat(200),
          position: index,
        }),
      ),
    ];
    const result = buildStandaloneHostContext({
      ...coordinates,
      itemTypes: [author, article],
      loadedFields,
      maxCharacters: 2_400,
    });

    expect(result.text.length).toBeLessThanOrEqual(2_400);
    expect(result.text).toContain('schema_mode=field_directory_complete');
    expect(result.text).toContain(
      'field_directory|field_coverage_complete=true|models=2/2',
    );
    expect(result.text).toContain(
      'fields_by_type={"string":["title","article_field_2"',
    );
    expect(result.text).toContain('"structured_text":["article_field_1"]');
    expect(result.text).toContain('localized_fields=["article_field_1"]');
    expect(result.text).toContain(
      'field_roles={"title":["presentation_title"]}',
    );
    expect(result.text).toContain('fields_by_type={"text":["bio"]');
    expect(result.text).toContain(
      'without calling get_model_schema for every model',
    );
    expect(result.text).not.toContain('A'.repeat(40));
    expect(result.text).not.toContain('schema_on_demand=');
  });

  it('keeps field routing complete at the standalone eager-load boundary', () => {
    const itemTypes = Array.from({ length: 40 }, (_, modelIndex) =>
      model({
        id: `model-id-${modelIndex.toString().padStart(2, '0')}`,
        apiKey: `content_model_${modelIndex}`,
        name: `Content model ${modelIndex}`,
        fieldIds: Array.from(
          { length: 10 },
          (_, fieldIndex) => `field-${modelIndex}-${fieldIndex}`,
        ),
      }),
    );
    const loadedFields = itemTypes.flatMap((itemType, modelIndex) =>
      itemType.relationships.fields.data.map((relationship, fieldIndex) =>
        field({
          id: relationship.id,
          modelId: itemType.id,
          apiKey: `content_field_${fieldIndex}`,
          type: fieldIndex === 1 ? 'structured_text' : 'string',
          localized: fieldIndex === 1,
          hint: `Verbose editor guidance ${modelIndex} ${'H'.repeat(180)}`,
          position: fieldIndex,
        }),
      ),
    );
    const result = buildStandaloneHostContext({
      ...coordinates,
      itemTypes,
      loadedFields,
    });

    expect(result.text.length).toBeLessThanOrEqual(14_000);
    expect(result.text).toContain('schema_mode=field_directory_complete');
    expect(result.text).toContain(
      'field_directory|field_coverage_complete=true|models=40/40',
    );
    expect(result.text.match(/\nmodel_fields\|/g)).toHaveLength(40);
    expect(result.text).not.toContain('schema_on_demand=');
  });

  it('falls back to the complete directory when whole detailed models do not fit', () => {
    const fieldIds = Array.from({ length: 12 }, (_, index) => `field-${index}`);
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds,
    });
    const result = buildStandaloneHostContext({
      ...coordinates,
      itemTypes: [article],
      loadedFields: fieldIds.map((id, index) =>
        field({
          id,
          modelId: article.id,
          apiKey: `field_${index}`,
          hint: 'H'.repeat(200),
          position: index,
        }),
      ),
      maxCharacters: 800,
    });

    expect(result.text.length).toBeLessThanOrEqual(800);
    expect(result.text).toContain('schema_mode=directory_complete');
    expect(result.text).toContain('model_directory|complete=true|models=1');
    expect(result.text).not.toContain('project_map|complete=false');
  });

  it('uses an explicit schema-on-demand fallback rather than a partial directory', () => {
    const itemTypes = Array.from({ length: 20 }, (_, index) =>
      model({
        id: `model-id-${index}`,
        apiKey: `model_${index}`,
        name: `A long model name ${index}`,
      }),
    );

    const result = buildStandaloneHostContext({
      ...coordinates,
      itemTypes,
      loadedFields: [],
      maxCharacters: 384,
    });

    expect(result.text.length).toBeLessThanOrEqual(384);
    expect(result.text).toContain('schema_mode=directory_omitted_due_to_size');
    expect(result.text).toContain(
      'model_directory|complete=false|models=20|omitted=20|reason=max_characters',
    );
    expect(result.text).toContain('schema_on_demand=Use get_model_schema');
    expect(result.text).not.toContain('model_directory_entry|');
  });
});

describe('createModelSchemaResolver', () => {
  it('accepts exact ID, API key, and name and skips loading complete fields', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: ['title-id'],
    });
    const fields = [
      field({
        id: 'title-id',
        modelId: article.id,
        apiKey: 'title',
      }),
    ];
    const loadItemTypeFields = vi.fn();
    const resolve = createModelSchemaResolver({
      itemTypes: [article],
      loadedFields: fields,
      loadItemTypeFields,
    });
    const byId = resolve('article-id');
    const byApiKey = resolve('article');
    const byName = resolve('Article');

    expect(byApiKey).toBe(byId);
    expect(byName).toBe(byId);
    await expect(byId).resolves.toMatchObject({
      text: expect.stringContaining('render_complete=true'),
    });
    expect(loadItemTypeFields).not.toHaveBeenCalled();
  });

  it('rejects unknown and ambiguous exact identifiers', async () => {
    const first = model({
      id: 'first-id',
      apiKey: 'shared',
      name: 'First',
    });
    const second = model({
      id: 'second-id',
      apiKey: 'second',
      name: 'shared',
    });
    const resolve = createModelSchemaResolver({
      itemTypes: [first, second],
      loadedFields: [],
      loadItemTypeFields: vi.fn(),
    });

    await expect(resolve('missing')).rejects.toThrow(/No DatoCMS model/);
    await expect(resolve('shared')).rejects.toThrow(/ambiguous/);
    await expect(resolve(' ')).rejects.toThrow(/is required/);
  });

  it('deduplicates concurrent loads and retries after rejection', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: ['title-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
    });
    let finishFirstLoad: ((fields: readonly Field[]) => void) | undefined;
    const firstLoad = new Promise<readonly Field[]>((resolve) => {
      finishFirstLoad = resolve;
    });
    const loadItemTypeFields = vi.fn().mockReturnValue(firstLoad);
    const resolve = createModelSchemaResolver({
      itemTypes: [article],
      loadedFields: [],
      loadItemTypeFields,
    });
    const byId = resolve(article.id);
    const byApiKey = resolve(article.attributes.api_key);

    expect(byApiKey).toBe(byId);
    expect(loadItemTypeFields).toHaveBeenCalledOnce();
    finishFirstLoad?.([title]);
    await expect(byId).resolves.toMatchObject({
      text: expect.stringContaining('field title'),
    });

    const retryLoader = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce([title]);
    const retryResolve = createModelSchemaResolver({
      itemTypes: [article],
      loadedFields: [],
      loadItemTypeFields: retryLoader,
    });

    await expect(retryResolve('article')).rejects.toThrow('temporary failure');
    await expect(retryResolve('article')).resolves.toMatchObject({
      text: expect.stringContaining('field title'),
    });
    expect(retryLoader).toHaveBeenCalledTimes(2);
  });

  it('returns an explicitly bounded whole-line schema result', async () => {
    const fieldIds = Array.from({ length: 16 }, (_, index) => `field-${index}`);
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds,
    });
    const resolve = createModelSchemaResolver({
      itemTypes: [article],
      loadedFields: [],
      loadItemTypeFields: vi.fn().mockResolvedValue(
        fieldIds.map((id, index) =>
          field({
            id,
            modelId: article.id,
            apiKey: `field_${index}`,
            label: `A very descriptive label ${index}`,
            hint: 'H'.repeat(200),
            position: index,
          }),
        ),
      ),
      maxCharacters: 700,
    });
    const result = await resolve('article');

    expect(result.text.length).toBeLessThanOrEqual(700);
    expect(result.text).toContain('render_complete=false');
    expect(result.text).toMatch(/omitted_rendered_fields=[1-9]/);
    const nextCursor = Number(result.text.match(/next_cursor=(\d+)/)?.[1]);
    expect(nextCursor).toBeGreaterThan(0);

    const nextPage = await resolve('article', nextCursor);
    expect(nextPage.text).toContain(`cursor=${nextCursor}`);
    expect(nextPage.text).not.toBe(result.text);
    expect(result.text.split('\n').every((line) => line.length < 700)).toBe(
      true,
    );
    await expect(resolve('article', -1)).rejects.toThrow(
      /non-negative integer/,
    );
  });
});
