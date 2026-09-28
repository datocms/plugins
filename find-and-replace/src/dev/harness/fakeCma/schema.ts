import type { RawApiTypes } from '@datocms/cma-client-browser';
import { stableId } from './ids';

/**
 * The fake project's schema, as the CMA serves it (JSON:API resources).
 *
 * Models: Article (draft mode on, localized, slug, Structured Text, SEO),
 * Page (draft mode off: every write goes live; localized Modular Content),
 * Author (draft mode on, Markdown bio). Block models: Quote, Text, Hero and
 * Button (Hero › Button is a Single Block inside a Modular Content block).
 */

export type FieldType = RawApiTypes.Field['attributes']['field_type'];

export type RawField = {
  type: 'field';
  id: string;
  attributes: {
    label: string;
    field_type: FieldType;
    api_key: string;
    localized: boolean;
    validators: Record<string, unknown>;
    appearance: {
      editor: string;
      parameters: Record<string, unknown>;
      addons: unknown[];
    };
    position: number;
    hint: string | null;
    default_value: unknown;
    deep_filtering_enabled: boolean;
  };
  relationships: {
    item_type: { data: { type: 'item_type'; id: string } };
    fieldset: { data: null };
  };
};

export type ModelKey =
  | 'article'
  | 'page'
  | 'author'
  | 'quote'
  | 'text_block'
  | 'hero'
  | 'button';

export type FakeSchema = {
  itemTypes: ReadonlyArray<RawApiTypes.ItemType>;
  fieldsByItemTypeId: ReadonlyMap<string, ReadonlyArray<RawField>>;
  itemTypesById: ReadonlyMap<string, RawApiTypes.ItemType>;
  /** Model id from its api key. */
  modelId(apiKey: ModelKey): string;
  /** Field id from the model and field api keys. */
  fieldId(model: ModelKey, fieldApiKey: string): string;
};

type FieldDefinition = {
  apiKey: string;
  label: string;
  fieldType: FieldType;
  localized?: boolean;
  validators?: Record<string, unknown>;
  editor: string;
  parameters?: Record<string, unknown>;
  hint?: string;
};

type ModelDefinition = {
  apiKey: ModelKey;
  name: string;
  block: boolean;
  draftMode: boolean;
  /** Field api key used as title_field and presentation_title_field. */
  titleField?: string;
  hint?: string;
  fields: FieldDefinition[];
};

export function modelIdFor(apiKey: ModelKey): string {
  return stableId(`item_type:${apiKey}`);
}

export function fieldIdFor(model: ModelKey, fieldApiKey: string): string {
  return stableId(`field:${model}.${fieldApiKey}`);
}

const STRUCTURED_TEXT_MARKS = [
  'strong',
  'emphasis',
  'underline',
  'strikethrough',
  'code',
  'highlight',
];

function structuredTextField(
  apiKey: string,
  label: string,
  blocks: ModelKey[],
  options: { localized?: boolean; links?: ModelKey[] } = {},
): FieldDefinition {
  return {
    apiKey,
    label,
    fieldType: 'structured_text',
    localized: options.localized,
    editor: 'structured_text',
    parameters: {
      marks: STRUCTURED_TEXT_MARKS,
      nodes: ['blockquote', 'code', 'heading', 'link', 'list', 'thematicBreak'],
      heading_levels: [2, 3, 4],
      blocks_start_collapsed: false,
      show_links_target_blank: true,
      show_links_meta_editor: false,
    },
    validators: {
      structured_text_blocks: { item_types: blocks.map(modelIdFor) },
      structured_text_inline_blocks: { item_types: [] },
      structured_text_links: {
        item_types: (options.links ?? []).map(modelIdFor),
        on_publish_with_unpublished_references_strategy: 'fail',
        on_reference_unpublish_strategy: 'delete_references',
        on_reference_delete_strategy: 'delete_references',
      },
    },
  };
}

function seoField(localized: boolean): FieldDefinition {
  return {
    apiKey: 'seo',
    label: 'SEO',
    fieldType: 'seo',
    localized,
    editor: 'seo',
    parameters: {
      fields: ['title', 'description', 'image', 'no_index', 'twitter_card'],
      previews: ['google', 'twitter', 'slack', 'whatsapp', 'telegram'],
    },
    validators: {
      title_length: { max: 60 },
      description_length: { max: 160 },
    },
  };
}

function slugField(urlPrefix: string, titleModel: ModelKey): FieldDefinition {
  return {
    apiKey: 'slug',
    label: 'Slug',
    fieldType: 'slug',
    editor: 'slug',
    parameters: { url_prefix: urlPrefix, placeholder: null },
    validators: {
      required: {},
      unique: {},
      slug_format: { predefined_pattern: 'webpage_slug' },
      slug_title_field: { title_field_id: fieldIdFor(titleModel, 'title') },
    },
  };
}

const MODELS: ModelDefinition[] = [
  {
    apiKey: 'article',
    name: 'Article',
    block: false,
    draftMode: true,
    titleField: 'title',
    hint: 'Blog posts and announcements',
    fields: [
      {
        apiKey: 'title',
        label: 'Title',
        fieldType: 'string',
        localized: true,
        editor: 'single_line',
        parameters: { heading: true, placeholder: null },
        validators: { required: {}, length: { max: 120 } },
      },
      slugField('https://www.acme.test/blog/', 'article'),
      {
        apiKey: 'published_on',
        label: 'Published on',
        fieldType: 'date',
        editor: 'date_picker',
      },
      {
        apiKey: 'author',
        label: 'Author',
        fieldType: 'link',
        editor: 'link_select',
        validators: {
          item_item_type: {
            item_types: [modelIdFor('author')],
            on_publish_with_unpublished_references_strategy: 'fail',
            on_reference_unpublish_strategy: 'delete_references',
            on_reference_delete_strategy: 'delete_references',
          },
        },
      },
      structuredTextField('body', 'Body', ['quote'], {
        localized: true,
        links: ['article', 'author'],
      }),
      seoField(true),
    ],
  },
  {
    apiKey: 'author',
    name: 'Author',
    block: false,
    draftMode: true,
    titleField: 'name',
    fields: [
      {
        apiKey: 'name',
        label: 'Name',
        fieldType: 'string',
        editor: 'single_line',
        parameters: { heading: true, placeholder: null },
        validators: { required: {} },
      },
      {
        apiKey: 'bio',
        label: 'Bio',
        fieldType: 'text',
        editor: 'markdown',
        parameters: {
          toolbar: ['bold', 'italic', 'link', 'unordered_list', 'preview'],
        },
      },
    ],
  },
  {
    apiKey: 'page',
    name: 'Page',
    block: false,
    draftMode: false,
    titleField: 'title',
    hint: 'Website pages. Changes go live when saved.',
    fields: [
      {
        apiKey: 'title',
        label: 'Title',
        fieldType: 'string',
        editor: 'single_line',
        parameters: { heading: true, placeholder: null },
        validators: { required: {}, length: { max: 80 } },
      },
      slugField('https://www.acme.test/', 'page'),
      {
        apiKey: 'content',
        label: 'Content',
        fieldType: 'rich_text',
        localized: true,
        editor: 'rich_text',
        parameters: { start_collapsed: false },
        validators: {
          rich_text_blocks: {
            item_types: (['hero', 'text_block', 'quote'] as const).map(
              modelIdFor,
            ),
          },
        },
      },
      seoField(false),
    ],
  },
  {
    apiKey: 'quote',
    name: 'Quote',
    block: true,
    draftMode: false,
    fields: [
      {
        apiKey: 'text',
        label: 'Text',
        fieldType: 'text',
        editor: 'textarea',
        parameters: { placeholder: null },
        validators: { required: {} },
      },
      {
        apiKey: 'attribution',
        label: 'Attribution',
        fieldType: 'string',
        editor: 'single_line',
        parameters: { heading: false, placeholder: null },
      },
    ],
  },
  {
    apiKey: 'text_block',
    name: 'Text',
    block: true,
    draftMode: false,
    fields: [
      structuredTextField('body', 'Body', ['quote'], { links: ['article'] }),
    ],
  },
  {
    apiKey: 'hero',
    name: 'Hero',
    block: true,
    draftMode: false,
    fields: [
      {
        apiKey: 'heading',
        label: 'Heading',
        fieldType: 'string',
        editor: 'single_line',
        parameters: { heading: true, placeholder: null },
        validators: { required: {} },
      },
      {
        apiKey: 'subheading',
        label: 'Subheading',
        fieldType: 'text',
        editor: 'textarea',
        parameters: { placeholder: null },
      },
      {
        apiKey: 'cta',
        label: 'Call to action',
        fieldType: 'single_block',
        editor: 'framed_single_block',
        parameters: { start_collapsed: false },
        validators: {
          single_block_blocks: { item_types: [modelIdFor('button')] },
        },
      },
    ],
  },
  {
    apiKey: 'button',
    name: 'Button',
    block: true,
    draftMode: false,
    fields: [
      {
        apiKey: 'label',
        label: 'Label',
        fieldType: 'string',
        editor: 'single_line',
        parameters: { heading: false, placeholder: null },
        validators: { required: {}, length: { max: 40 } },
      },
      {
        apiKey: 'url',
        label: 'URL',
        fieldType: 'string',
        editor: 'single_line',
        parameters: { heading: false, placeholder: 'https://' },
        validators: { format: { predefined_pattern: 'url' } },
      },
    ],
  },
];

function buildField(
  model: ModelDefinition,
  definition: FieldDefinition,
  position: number,
): RawField {
  return {
    type: 'field',
    id: fieldIdFor(model.apiKey, definition.apiKey),
    attributes: {
      label: definition.label,
      field_type: definition.fieldType,
      api_key: definition.apiKey,
      localized: definition.localized ?? false,
      validators: definition.validators ?? {},
      appearance: {
        editor: definition.editor,
        parameters: definition.parameters ?? {},
        addons: [],
      },
      position,
      hint: definition.hint ?? null,
      default_value: null,
      deep_filtering_enabled: false,
    },
    relationships: {
      item_type: { data: { type: 'item_type', id: modelIdFor(model.apiKey) } },
      fieldset: { data: null },
    },
  };
}

function fieldRef(
  model: ModelDefinition,
  apiKey: string | undefined,
): { data: { type: 'field'; id: string } | null } {
  return apiKey
    ? { data: { type: 'field', id: fieldIdFor(model.apiKey, apiKey) } }
    : { data: null };
}

function buildItemType(
  model: ModelDefinition,
  fields: ReadonlyArray<RawField>,
): RawApiTypes.ItemType {
  return {
    type: 'item_type',
    id: modelIdFor(model.apiKey),
    attributes: {
      name: model.name,
      api_key: model.apiKey,
      collection_appearance: 'table',
      singleton: false,
      all_locales_required: false,
      sortable: false,
      modular_block: model.block,
      draft_mode_active: model.draftMode,
      draft_saving_active: false,
      tree: false,
      ordering_direction: null,
      ordering_meta: null,
      has_singleton_item: false,
      hint: model.hint ?? null,
      inverse_relationships_enabled: false,
    },
    relationships: {
      singleton_item: { data: null },
      fields: {
        data: fields.map((field) => ({ type: 'field', id: field.id })),
      },
      fieldsets: { data: [] },
      presentation_title_field: fieldRef(model, model.titleField),
      presentation_image_field: { data: null },
      title_field: fieldRef(model, model.titleField),
      image_preview_field: { data: null },
      excerpt_field: { data: null },
      ordering_field: { data: null },
      workflow: { data: null },
    },
    meta: { has_singleton_item: false },
  };
}

export function buildSchema(): FakeSchema {
  const itemTypes: RawApiTypes.ItemType[] = [];
  const fieldsByItemTypeId = new Map<string, ReadonlyArray<RawField>>();

  for (const model of MODELS) {
    const fields = model.fields.map((definition, index) =>
      buildField(model, definition, index + 1),
    );
    const itemType = buildItemType(model, fields);
    itemTypes.push(itemType);
    fieldsByItemTypeId.set(itemType.id, fields);
  }

  return {
    itemTypes,
    fieldsByItemTypeId,
    itemTypesById: new Map(
      itemTypes.map((itemType) => [itemType.id, itemType]),
    ),
    modelId: modelIdFor,
    fieldId: fieldIdFor,
  };
}

export const SITE_ID = 'harness-site';
export const SITE_LOCALES = ['en', 'it'] as const;

export function buildSite(
  itemTypeIds: ReadonlyArray<string>,
): RawApiTypes.Site {
  return {
    type: 'site',
    id: SITE_ID,
    attributes: {
      name: 'Acme',
      domain: null,
      google_maps_api_token: null,
      imgix_host: 'www.datocms-assets.com',
      internal_domain: 'harness.admin.datocms.com',
      locales: [...SITE_LOCALES] as [string, ...string[]],
      timezone: 'Europe/Rome',
      no_index: false,
      favicon: null,
      last_data_change_at: '2026-09-01T09:00:00.000+02:00',
      require_2fa: false,
      ip_tracking_enabled: false,
      force_use_of_sandbox_environments: false,
      assets_cdn_default_settings: {
        image: { q: 75, auto: ['format'] },
        video: {},
      },
      theme: { type: 'monochromatic', hue: 270, logo: null },
      global_seo: null,
    },
    relationships: {
      account: { data: { type: 'account', id: 'harness-account' } },
      owner: { data: { type: 'account', id: 'harness-account' } },
      item_types: {
        data: itemTypeIds.map((id) => ({ type: 'item_type', id })),
      },
    },
    meta: {
      created_at: '2025-03-14T10:00:00.000+01:00',
      draft_mode_default: true,
      improved_timezone_management: true,
      improved_hex_management: true,
      improved_gql_multilocale_fields: true,
      improved_gql_visibility_control: true,
      improved_boolean_fields: true,
      custom_upload_storage_settings: false,
      improved_validation_at_publishing: true,
      improved_exposure_of_inline_blocks_in_cda: true,
      improved_items_listing: true,
      milliseconds_in_datetime: true,
      non_localized_focal_points: true,
    },
  };
}
