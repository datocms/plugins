import type { Field, ItemType } from 'datocms-plugin-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildModelContextManifest,
  buildStandaloneFieldDirectory,
  buildStandaloneProjectMap,
  renderModelContextManifest,
} from './contextManifest';

type ModelInput = {
  id: string;
  apiKey: string;
  name?: string;
  fieldIds?: string[];
  block?: boolean;
  relationships?: Partial<
    Record<
      | 'title_field'
      | 'presentation_title_field'
      | 'presentation_image_field'
      | 'image_preview_field'
      | 'excerpt_field'
      | 'ordering_field',
      string
    >
  >;
};

function model({
  id,
  apiKey,
  name = apiKey,
  fieldIds = [],
  block = false,
  relationships = {},
}: ModelInput): ItemType {
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
      singleton: false,
      all_locales_required: false,
      sortable: false,
      modular_block: block,
      draft_mode_active: !block,
      draft_saving_active: false,
      tree: false,
      ordering_direction: null,
      ordering_meta: null,
      has_singleton_item: false,
      hint: null,
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
      presentation_title_field: fieldRelationship(
        relationships.presentation_title_field,
      ),
      presentation_image_field: fieldRelationship(
        relationships.presentation_image_field,
      ),
      title_field: fieldRelationship(relationships.title_field),
      image_preview_field: fieldRelationship(relationships.image_preview_field),
      excerpt_field: fieldRelationship(relationships.excerpt_field),
      ordering_field: fieldRelationship(relationships.ordering_field),
      workflow: { data: null },
    },
    meta: { has_singleton_item: false },
  };
}

type FieldInput = {
  id: string;
  modelId: string;
  apiKey: string;
  fieldType?: Field['attributes']['field_type'];
  label?: string;
  localized?: boolean;
  validators?: Record<string, unknown>;
  editor?: string;
  editorParameters?: Record<string, unknown>;
  fieldExtension?: string;
  hint?: string | null;
  position?: number;
  defaultValue?: unknown;
  addons?: unknown[];
};

function field({
  id,
  modelId,
  apiKey,
  fieldType = 'string',
  label = apiKey,
  localized = false,
  validators = {},
  editor = 'single_line',
  editorParameters = {},
  fieldExtension,
  hint = null,
  position = 0,
  defaultValue = null,
  addons = [],
}: FieldInput): Field {
  return {
    type: 'field',
    id,
    attributes: {
      label,
      field_type: fieldType,
      localized,
      default_value: defaultValue,
      api_key: apiKey,
      hint,
      validators,
      appearance: {
        editor,
        ...(fieldExtension ? { field_extension: fieldExtension } : {}),
        parameters: editorParameters,
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

describe('buildModelContextManifest', () => {
  it('projects field semantics without raw defaults or addons', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: ['title-id', 'author-id', 'body-id', 'layout-id'],
      relationships: {
        title_field: 'title-id',
        presentation_title_field: 'title-id',
        excerpt_field: 'body-id',
      },
    });
    const author = model({
      id: 'author-id-type',
      apiKey: 'author',
      fieldIds: ['name-id'],
    });
    const hero = model({
      id: 'hero-id',
      apiKey: 'hero',
      fieldIds: ['heading-id'],
      block: true,
    });
    const fields = [
      field({
        id: 'title-id',
        modelId: article.id,
        apiKey: 'title',
        label: 'Title',
        validators: {
          required: {},
          unique: {},
          length: { min: 3, max: 120 },
        },
        hint: 'A deliberately long title hint for editors.',
        defaultValue: 'Secret default that must not be copied',
        addons: [{ id: 'addon', parameters: { secret: true } }],
      }),
      field({
        id: 'author-id',
        modelId: article.id,
        apiKey: 'author',
        fieldType: 'link',
        validators: {
          item_item_type: {
            item_types: [author.id, 'missing-model-id'],
            on_publish_with_unpublished_references_strategy:
              'publish_references',
          },
        },
        editor: 'link_select',
        position: 1,
      }),
      field({
        id: 'body-id',
        modelId: article.id,
        apiKey: 'body',
        fieldType: 'structured_text',
        localized: true,
        validators: {
          structured_text_blocks: { item_types: [hero.id] },
          structured_text_inline_blocks: { item_types: [hero.id] },
          structured_text_links: { item_types: [article.id, author.id] },
          length: { max: 5_000 },
        },
        editor: 'structured_text',
        editorParameters: {
          nodes: ['heading', 'link'],
          marks: ['strong', 'emphasis'],
          heading_levels: [2, 3],
        },
        position: 2,
      }),
      field({
        id: 'layout-id',
        modelId: article.id,
        apiKey: 'layout',
        fieldType: 'json',
        editor: 'string_multi_select',
        editorParameters: {
          options: [
            { value: 'wide', label: 'Wide' },
            { value: 'narrow', label: 'Narrow' },
            { value: 'full', label: 'Full width' },
          ],
        },
        position: 3,
      }),
    ];

    const manifest = buildModelContextManifest({
      itemType: article,
      itemTypes: [article, author, hero],
      fields,
      maxHintCharacters: 18,
      maxOptionValues: 2,
    });

    expect(manifest.fieldsComplete).toBe(true);
    expect(manifest.fields[0]).toMatchObject({
      apiKey: 'title',
      fieldType: 'string',
      required: true,
      unique: true,
      roles: ['presentation_title', 'title'],
      hint: { truncated: true },
      validators: [
        {
          code: 'length',
          parameters: { min: 3, max: 120 },
        },
      ],
    });
    expect(manifest.fields[1]).toMatchObject({
      apiKey: 'author',
      targets: {
        records: {
          apiKeys: ['author'],
          unresolvedIds: ['missing-model-id'],
        },
      },
      validators: [
        {
          code: 'item_item_type',
          parameters: {
            on_publish_with_unpublished_references_strategy:
              'publish_references',
          },
        },
      ],
    });
    expect(manifest.fields[2]).toMatchObject({
      apiKey: 'body',
      localized: true,
      roles: ['excerpt'],
      targets: {
        blocks: { apiKeys: ['hero'], unresolvedIds: [] },
        inline_blocks: { apiKeys: ['hero'], unresolvedIds: [] },
        linked_records: {
          apiKeys: ['article', 'author'],
          unresolvedIds: [],
        },
      },
      editor: {
        kind: 'structured_text',
        nodes: { values: ['heading', 'link'], omittedCount: 0 },
        marks: { values: ['strong', 'emphasis'], omittedCount: 0 },
        headingLevels: [2, 3],
      },
    });
    expect(manifest.fields[3].editor).toEqual({
      kind: 'string_multi_select',
      options: [
        { value: 'wide', label: 'Wide' },
        { value: 'narrow', label: 'Narrow' },
      ],
      omittedOptionCount: 1,
    });

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('Secret default');
    expect(serialized).not.toContain('addon');
    expect(serialized).not.toContain('secret');
  });

  it('marks missing fields instead of presenting a partial model as complete', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id', 'body-id'],
    });

    const manifest = buildModelContextManifest({
      itemType: article,
      itemTypes: [article],
      fields: [
        field({
          id: 'title-id',
          modelId: article.id,
          apiKey: 'title',
        }),
      ],
    });

    expect(manifest.fieldsComplete).toBe(false);
    expect(manifest.omittedFieldIds).toEqual(['body-id']);
    expect(renderModelContextManifest(manifest)).toContain(
      'fields_complete=false',
    );
    expect(renderModelContextManifest(manifest)).toContain(
      'missing_field_ids=body-id',
    );
  });

  it('exposes a custom editor marker without copying plugin parameters', () => {
    const product = model({
      id: 'product-id',
      apiKey: 'product',
      fieldIds: ['rating-id'],
    });

    const manifest = buildModelContextManifest({
      itemType: product,
      itemTypes: [product],
      fields: [
        field({
          id: 'rating-id',
          modelId: product.id,
          apiKey: 'rating',
          editor: 'plugin-instance-id',
          fieldExtension: 'starRating',
          editorParameters: { token: 'do-not-copy' },
        }),
      ],
    });

    expect(manifest.fields[0].editor).toEqual({
      kind: 'custom',
      fieldExtension: 'starRating',
    });
    expect(JSON.stringify(manifest)).not.toContain('do-not-copy');
    expect(JSON.stringify(manifest)).not.toContain('plugin-instance-id');
  });
});

describe('buildStandaloneProjectMap', () => {
  it('is complete when every whole model fits', () => {
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
    const fields = [
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
    ];

    const map = buildStandaloneProjectMap({
      itemTypes: [author, article],
      fields,
      maxCharacters: 2_000,
    });

    expect(map.complete).toBe(true);
    expect(map.includedModelApiKeys).toEqual(['article', 'author']);
    expect(map.omittedModelApiKeys).toEqual([]);
    expect(map.text).toContain('complete=true');
    expect(map.characterCount).toBeLessThanOrEqual(map.maxCharacters);
  });

  it('omits whole model manifests and reports omissions when bounded', () => {
    const first = model({
      id: 'first-id',
      apiKey: 'first',
      fieldIds: ['first-title-id'],
    });
    const second = model({
      id: 'second-id',
      apiKey: 'second',
      fieldIds: ['second-title-id'],
    });
    const fields = [
      field({
        id: 'first-title-id',
        modelId: first.id,
        apiKey: 'first_title',
        hint: 'A'.repeat(200),
      }),
      field({
        id: 'second-title-id',
        modelId: second.id,
        apiKey: 'second_title',
        hint: 'B'.repeat(200),
      }),
    ];
    const oneModelMap = buildStandaloneProjectMap({
      itemTypes: [first],
      fields,
      maxCharacters: 1_000,
    });
    const bounded = buildStandaloneProjectMap({
      itemTypes: [first, second],
      fields,
      maxCharacters: oneModelMap.characterCount + 40,
    });

    expect(bounded.complete).toBe(false);
    expect(bounded.includedModelApiKeys).toHaveLength(1);
    expect(bounded.omittedModelApiKeys).toHaveLength(1);
    expect(bounded.text).toContain('complete=false');
    expect(bounded.text).toContain('omitted_models=1');
    expect(bounded.characterCount).toBeLessThanOrEqual(bounded.maxCharacters);

    for (const includedApiKey of bounded.includedModelApiKeys) {
      expect(bounded.text).toContain(`model ${includedApiKey}`);
      expect(bounded.text).toContain('fields_complete=true');
    }

    for (const omittedApiKey of bounded.omittedModelApiKeys) {
      expect(bounded.text).not.toContain(`model ${omittedApiKey}|`);
    }
  });

  it('reports source-incomplete models independently from budget omissions', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id', 'body-id'],
    });

    const map = buildStandaloneProjectMap({
      itemTypes: [article],
      fields: [
        field({
          id: 'title-id',
          modelId: article.id,
          apiKey: 'title',
        }),
      ],
      maxCharacters: 2_000,
    });

    expect(map.complete).toBe(false);
    expect(map.omittedModelApiKeys).toEqual([]);
    expect(map.sourceIncompleteModelApiKeys).toEqual(['article']);
    expect(map.text).toContain('source_incomplete_models=1');
    expect(map.text).toContain('missing_field_ids=body-id');
  });

  it('rejects a budget too small to communicate completeness safely', () => {
    expect(() =>
      buildStandaloneProjectMap({
        itemTypes: [],
        fields: [],
        maxCharacters: 50,
      }),
    ).toThrow(/at least 96/);
  });
});

describe('buildStandaloneFieldDirectory', () => {
  it('keeps every field type and read-routing semantic while omitting verbose details', () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: ['title-id', 'body-id', 'author-id'],
      relationships: {
        title_field: 'title-id',
        presentation_title_field: 'title-id',
      },
    });
    const author = model({
      id: 'author-model-id',
      apiKey: 'author',
      name: 'Author',
      fieldIds: ['name-id'],
    });
    const fields = [
      field({
        id: 'title-id',
        modelId: article.id,
        apiKey: 'title',
        label: 'A verbose title label',
        hint: 'A verbose editing hint that is intentionally not copied.',
        validators: { required: {}, length: { max: 120 } },
      }),
      field({
        id: 'body-id',
        modelId: article.id,
        apiKey: 'body',
        fieldType: 'structured_text',
        localized: true,
        position: 1,
      }),
      field({
        id: 'author-id',
        modelId: article.id,
        apiKey: 'author',
        fieldType: 'link',
        validators: {
          item_item_type: { item_types: [author.id] },
        },
        position: 2,
      }),
      field({
        id: 'name-id',
        modelId: author.id,
        apiKey: 'name',
      }),
    ];

    const directory = buildStandaloneFieldDirectory({
      itemTypes: [author, article],
      fields,
      maxCharacters: 2_000,
    });

    expect(directory.complete).toBe(true);
    expect(directory.includedModelApiKeys).toEqual(['article', 'author']);
    expect(directory.text).toContain(
      'field_directory|field_coverage_complete=true|models=2/2',
    );
    expect(directory.text).toContain(
      'relationship_targets=bounded|max_relationship_targets_per_field=8',
    );
    expect(directory.text).toContain(
      'fields_by_type={"string":["title"],"structured_text":["body"],"link":["author"]}',
    );
    expect(directory.text).toContain('localized_fields=["body"]');
    expect(directory.text).toContain(
      'field_roles={"title":["presentation_title","title"]}',
    );
    expect(directory.text).toContain(
      'field_targets={"author":"records=author"}',
    );
    expect(directory.text).not.toContain('verbose title label');
    expect(directory.text).not.toContain('verbose editing hint');
    expect(directory.text).not.toContain('required');
    expect(directory.text).not.toContain('length');
  });

  it('marks relationship target lists as bounded and reports omissions', () => {
    const targets = Array.from({ length: 10 }, (_, index) =>
      model({
        id: `target-id-${index}`,
        apiKey: `target_${index}`,
      }),
    );
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['related-id'],
    });
    const directory = buildStandaloneFieldDirectory({
      itemTypes: [article, ...targets],
      fields: [
        field({
          id: 'related-id',
          modelId: article.id,
          apiKey: 'related',
          fieldType: 'links',
          validators: {
            items_item_type: {
              item_types: targets.map((target) => target.id),
            },
          },
        }),
      ],
      maxCharacters: 4_000,
    });

    expect(directory.complete).toBe(true);
    expect(directory.text).toContain(
      'relationship_targets=bounded|max_relationship_targets_per_field=8',
    );
    expect(directory.text).toContain(
      'records=target_0,target_1,target_2,target_3,target_4,target_5,target_6,target_7,+2',
    );
  });

  it('reports source gaps and budget omissions instead of presenting a partial directory as complete', () => {
    const first = model({
      id: 'first-id',
      apiKey: 'first',
      fieldIds: ['first-title-id', 'missing-id'],
    });
    const second = model({
      id: 'second-id',
      apiKey: 'second',
      fieldIds: ['second-title-id'],
    });
    const fields = [
      field({
        id: 'first-title-id',
        modelId: first.id,
        apiKey: 'first_title',
      }),
      field({
        id: 'second-title-id',
        modelId: second.id,
        apiKey: 'second_title',
      }),
    ];
    const incomplete = buildStandaloneFieldDirectory({
      itemTypes: [first, second],
      fields,
      maxCharacters: 2_000,
    });

    expect(incomplete.complete).toBe(false);
    expect(incomplete.sourceIncompleteModelApiKeys).toEqual(['first']);
    expect(incomplete.text).toContain('source_incomplete_models=1');

    const firstOnly = buildStandaloneFieldDirectory({
      itemTypes: [first],
      fields,
      maxCharacters: 2_000,
    });
    const bounded = buildStandaloneFieldDirectory({
      itemTypes: [first, second],
      fields,
      maxCharacters: firstOnly.characterCount + 20,
    });

    expect(bounded.complete).toBe(false);
    expect(bounded.omittedModelApiKeys).toHaveLength(1);
    expect(bounded.text).toContain('omitted_models=1');
    expect(bounded.characterCount).toBeLessThanOrEqual(bounded.maxCharacters);
  });
});
