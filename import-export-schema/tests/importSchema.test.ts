import { buildClient, type SchemaTypes } from '@datocms/cma-client';
import get from 'lodash-es/get';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportDoc } from '@/entrypoints/ImportPage/buildImportDoc';
import importSchema, {
  type ImportProgress,
} from '@/entrypoints/ImportPage/importSchema';

// Keep appearances deterministic/offline while exercising the real CMA client,
// JSON serialization, error classes, and the plugin's appearance mapping.
vi.mock('@/utils/datocms/fieldTypeInfo', () => ({
  defaultAppearanceForFieldType: async () => ({
    editor: 'single_line',
    parameters: {},
    addons: [],
  }),
  isHardcodedEditor: async (editor: string) =>
    ['single_line', 'slug', 'structured_text'].includes(editor),
}));

// These static CMA validator descriptors also live in a module with SVG/UI
// imports. Isolate that unrelated pipeline from these HTTP engine tests.
vi.mock('@/utils/datocms/schema', () => ({
  validatorsContainingLinks: [
    { field_type: 'link', validator: 'item_item_type.item_types' },
    { field_type: 'links', validator: 'items_item_type.item_types' },
    {
      field_type: 'structured_text',
      validator: 'structured_text_links.item_types',
    },
  ],
  validatorsContainingBlocks: [
    { field_type: 'rich_text', validator: 'rich_text_blocks.item_types' },
    { field_type: 'single_block', validator: 'single_block_blocks.item_types' },
    {
      field_type: 'structured_text',
      validator: 'structured_text_blocks.item_types',
    },
    {
      field_type: 'structured_text',
      validator: 'structured_text_inline_blocks.item_types',
    },
  ],
}));

const relationshipNames = [
  'ordering_field',
  'title_field',
  'image_preview_field',
  'excerpt_field',
  'presentation_title_field',
  'presentation_image_field',
];
const emptyRelationships = () =>
  Object.fromEntries(relationshipNames.map((name) => [name, { data: null }]));

type Data = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: { id: string; type: string } | null }>;
};
type Call = { path: string; method: string; data?: Data };
type Reply = {
  status: number;
  body?: unknown;
};
type MockOptions = {
  latency?: number;
  locales?: string[];
  reply?: (call: Call, calls: Call[]) => Reply | undefined;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiFailure(status = 422): Reply {
  return {
    status,
    body: {
      data: [
        {
          id: 'failure',
          type: 'api_error',
          attributes: {
            code: 'INVALID_FIELD',
            details: {},
            doc_url: '',
          },
        },
      ],
    },
  };
}

function mockProject(options: MockOptions = {}) {
  const calls: Call[] = [];
  const models = new Set<string>();
  const fields = new Set<string>();
  let active = 0;
  const client = buildClient({
    apiToken: null,
    fetchFn: async (url, init) => {
      const call: Call = {
        path: new URL(String(url)).pathname,
        method: init?.method ?? 'GET',
        data: init?.body
          ? (JSON.parse(String(init.body)) as { data: Data }).data
          : undefined,
      };
      calls.push(call);
      active += 1;
      try {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, options.latency ?? 250),
        );
        const reply = options.reply?.(call, calls);
        if (reply) return jsonResponse(reply.body, reply.status);
        return defaultReply(
          call,
          models,
          fields,
          options.locales ?? ['en', 'pt'],
        );
      } finally {
        active -= 1;
      }
    },
  });
  return {
    client,
    calls,
    models,
    fields,
    get active() {
      return active;
    },
  };
}

function defaultReply(
  call: Call,
  models: Set<string>,
  fields: Set<string>,
  locales: string[],
) {
  if (call.path === '/site')
    return jsonResponse({
      data: { id: 'site', type: 'site', attributes: { locales } },
    });
  const data = call.data;
  if (!data) return jsonResponse({ data: [] }, 404);
  if (call.method === 'POST' && data.type === 'item_type') {
    models.add(data.id);
    return jsonResponse({
      data: { ...data, relationships: emptyRelationships() },
    });
  }
  if (call.method === 'POST' && data.type === 'plugin')
    return jsonResponse({
      data: { ...data, attributes: { ...data.attributes, parameters: {} } },
    });
  if (
    call.method === 'POST' &&
    (data.type === 'field' || data.type === 'fieldset')
  ) {
    expect(models.has(call.path.split('/')[2])).toBe(true);
    const slugTitleId = get(
      data.attributes,
      'validators.slug_title_field.title_field_id',
    );
    if (typeof slugTitleId === 'string')
      expect(fields.has(slugTitleId)).toBe(true);
    if (data.type === 'field') fields.add(data.id);
  }
  return jsonResponse({ data });
}

function field(
  modelId: string,
  id: string,
  position: number,
  fieldType = 'string',
  validators: Record<string, unknown> = {},
): SchemaTypes.Field {
  return {
    type: 'field',
    id,
    attributes: {
      label: id,
      api_key: id,
      position,
      field_type: fieldType,
      localized: false,
      validators,
      default_value: null,
      appearance: { editor: 'single_line', parameters: {}, addons: [] },
      hint: null,
    },
    relationships: {
      item_type: { data: { type: 'item_type', id: modelId } },
      fieldset: { data: null },
    },
  } as unknown as SchemaTypes.Field;
}

function model(
  index: number,
  fieldCount: number,
  fieldsetCount: number,
): ImportDoc['itemTypes']['entitiesToCreate'][number] {
  const id = `model_${index}`;
  const fields = Array.from({ length: fieldCount }, (_, i) =>
    field(id, `${id}_field_${i}`, i + fieldsetCount),
  );
  const fieldsets = Array.from(
    { length: fieldsetCount },
    (_, i) =>
      ({
        type: 'fieldset',
        id: `${id}_fieldset_${i}`,
        attributes: {
          title: `Group ${i}`,
          position: i,
          collapsible: false,
          start_collapsed: false,
        },
        relationships: { item_type: { data: { id, type: 'item_type' } } },
      }) as SchemaTypes.Fieldset,
  );
  return {
    entity: {
      id,
      type: 'item_type',
      attributes: {
        name: id,
        api_key: id,
        modular_block: index % 3 === 0,
        ordering_direction: 'asc',
        ordering_meta: null,
      },
      relationships: emptyRelationships(),
    } as unknown as SchemaTypes.ItemType,
    fields,
    fieldsets,
  };
}

function document(
  modelCount = 1,
  fieldCount = 2,
  fieldsetCount = 1,
  pluginCount = 0,
): ImportDoc {
  return {
    itemTypes: {
      entitiesToCreate: Array.from({ length: modelCount }, (_, index) =>
        model(index, fieldCount, fieldsetCount),
      ),
      idsToReuse: {},
    },
    plugins: {
      entitiesToCreate: Array.from(
        { length: pluginCount },
        (_, index) =>
          ({
            type: 'plugin',
            id: `plugin_${index}`,
            attributes: {
              name: `Plugin ${index}`,
              package_name: `plugin-package-${index}`,
              parameters: { globalSetting: index },
            },
            meta: { version: '2' },
          }) as unknown as SchemaTypes.Plugin,
      ),
      idsToReuse: {},
    },
    idsToReplace: { itemTypes: {}, fields: {}, fieldsets: {}, plugins: {} },
  };
}

async function finish<T>(promise: Promise<T>) {
  let result: { value: T } | { error: unknown } | undefined;
  void promise.then(
    (value) => {
      result = { value };
    },
    (error: unknown) => {
      result = { error };
    },
  );
  await vi.runAllTimersAsync();
  if (!result) throw new Error('Import did not settle');
  if ('error' in result) throw result.error;
  return result.value;
}

async function rejected(promise: Promise<unknown>) {
  try {
    await finish(promise);
  } catch (error) {
    return error;
  }
  throw new Error('Import unexpectedly succeeded');
}

function progressRecorder() {
  const values: ImportProgress[] = [];
  return {
    values,
    update: (progress: ImportProgress) => values.push(progress),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('schema import', () => {
  it('maps cyclic links, nested block validators, replacement IDs, slugs and localized defaults without mutating the export', async () => {
    const doc = document(2, 0, 1, 1);
    const first = doc.itemTypes.entitiesToCreate[0];
    const second = doc.itemTypes.entitiesToCreate[1];
    first.entity.attributes.modular_block = false;
    second.entity.attributes.modular_block = true;
    first.fields = [
      field(first.entity.id, 'title', 1),
      field(first.entity.id, 'body', 2, 'structured_text', {
        structured_text_blocks: { item_types: [second.entity.id] },
        structured_text_inline_blocks: { item_types: [second.entity.id] },
        structured_text_links: {
          item_types: [first.entity.id, 'existing_export_id'],
        },
      }),
      field(first.entity.id, 'slug', 3, 'slug', {
        slug_title_field: { title_field_id: 'title' },
      }),
    ];
    second.fields = [
      field(second.entity.id, 'backlink', 1, 'link', {
        item_item_type: { item_types: [first.entity.id] },
      }),
    ];
    first.fields[0].attributes.localized = true;
    first.fields[0].attributes.default_value = { en: 'Hello', it: 'Ciao' };
    first.fields[0].attributes.appearance = {
      editor: 'plugin_0',
      parameters: { fieldSetting: true },
      addons: [{ id: 'plugin_0', parameters: { addonSetting: 'x' } }],
    };
    first.fields[0].relationships.fieldset.data = {
      type: 'fieldset',
      id: first.fieldsets[0].id,
    };
    first.entity.relationships.title_field.data = {
      type: 'field',
      id: 'title',
    };
    doc.itemTypes.idsToReuse.existing_export_id = 'existing_project_id';
    doc.idsToReplace.itemTypes[first.entity.id] = true;
    doc.idsToReplace.fields.title = true;
    doc.idsToReplace.fieldsets[first.fieldsets[0].id] = true;
    doc.idsToReplace.plugins.plugin_0 = true;
    const original = JSON.stringify(doc);
    const project = mockProject();
    const result = await finish(importSchema(doc, project.client, () => {}));
    const body = project.calls.find((call) => call.data?.id === 'body')?.data;
    expect(
      get(body, 'attributes.validators.structured_text_links.item_types'),
    ).toEqual([
      result.itemTypeIdByExportId[first.entity.id],
      'existing_project_id',
    ]);
    expect(
      get(body, 'attributes.validators.structured_text_blocks.item_types'),
    ).toEqual([second.entity.id]);
    expect(
      get(
        body,
        'attributes.validators.structured_text_inline_blocks.item_types',
      ),
    ).toEqual([second.entity.id]);
    const title = project.calls.find(
      (call) => call.data?.id === result.fieldIdByExportId.title,
    )?.data;
    expect(title?.attributes.default_value).toEqual({ en: 'Hello', pt: null });
    expect(title?.attributes.appearance).toMatchObject({
      editor: result.pluginIdByExportId.plugin_0,
      parameters: { fieldSetting: true },
      addons: [
        {
          id: result.pluginIdByExportId.plugin_0,
          parameters: { addonSetting: 'x' },
        },
      ],
    });
    expect(title?.relationships?.fieldset.data?.id).toBe(
      result.fieldsetIdByExportId[first.fieldsets[0].id],
    );
    const slug = project.calls.find((call) => call.data?.id === 'slug')?.data;
    expect(
      get(slug, 'attributes.validators.slug_title_field.title_field_id'),
    ).toBe(result.fieldIdByExportId.title);
    expect(JSON.stringify(doc)).toBe(original);
  });

  it('reorders numerically and sequentially within a model, updating progress for every entity', async () => {
    const doc = document(1, 3, 1);
    doc.itemTypes.entitiesToCreate[0].fields.reverse();
    const project = mockProject();
    const progress = progressRecorder();
    await finish(importSchema(doc, project.client, progress.update));
    const reorderCalls = project.calls.filter(
      (call) =>
        call.method === 'PUT' &&
        ['field', 'fieldset'].includes(call.data?.type ?? ''),
    );
    expect(reorderCalls.map((call) => call.data?.attributes.position)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(progress.values.at(-1)).toMatchObject({ finished: 11, total: 11 });
    expect(project.calls).toHaveLength(11);
  });
});

describe('schema import failures and cancellation', () => {
  it.each([
    'missing dependency',
    'duplicate ID',
    'invalid slug',
    'missing fieldset',
  ])('rejects %s before sending requests', async (kind) => {
    const doc = document();
    const itemType = doc.itemTypes.entitiesToCreate[0];
    if (kind === 'missing dependency')
      itemType.fields.push(
        field(itemType.entity.id, 'link', 4, 'link', {
          item_item_type: { item_types: ['missing'] },
        }),
      );
    if (kind === 'duplicate ID') itemType.fields.push(itemType.fields[0]);
    if (kind === 'invalid slug')
      itemType.fields.push(
        field(itemType.entity.id, 'slug', 4, 'slug', {
          slug_title_field: { title_field_id: 'missing' },
        }),
      );
    if (kind === 'missing fieldset')
      itemType.fields[0].relationships.fieldset.data = {
        type: 'fieldset',
        id: 'missing',
      };
    const project = mockProject();
    expect(
      await rejected(importSchema(doc, project.client, () => {})),
    ).toBeInstanceOf(Error);
    expect(project.calls).toHaveLength(0);
  });

  it.each(['model finalization', 'reorder', 'plugin settings'])(
    'reports %s failure and drains in-flight work without completing progress',
    async (phase) => {
      const doc = document(4, 3, 1, phase === 'plugin settings' ? 2 : 0);
      const project = mockProject({
        latency: 500,
        reply: (call) => {
          if (
            phase === 'model finalization' &&
            call.method === 'PUT' &&
            call.path.startsWith('/item-types/')
          )
            return apiFailure();
          if (
            phase === 'reorder' &&
            call.method === 'PUT' &&
            call.path.startsWith('/fields/')
          )
            return apiFailure();
          if (
            phase === 'plugin settings' &&
            call.method === 'PUT' &&
            call.path.startsWith('/plugins/')
          )
            return apiFailure();
          return undefined;
        },
      });
      const progress = progressRecorder();
      expect(
        await rejected(importSchema(doc, project.client, progress.update)),
      ).toBeInstanceOf(Error);
      expect(project.active).toBe(0);
      expect(progress.values.at(-1)?.finished).toBeLessThan(
        progress.values.at(-1)?.total ?? 0,
      );
      if (phase === 'plugin settings') expect(project.models.size).toBe(0);
      if (phase === 'model finalization')
        expect(
          project.calls.some(
            (call) => call.method === 'PUT' && call.path.startsWith('/fields/'),
          ),
        ).toBe(false);
    },
  );

  it('waits for in-flight creates when cancelled and does not begin dependent fields', async () => {
    const doc = document(15, 2, 1);
    const project = mockProject({ latency: 500 });
    let cancel = false;
    setTimeout(() => {
      cancel = true;
    }, 800);
    const error = await rejected(
      importSchema(doc, project.client, () => {}, {
        shouldCancel: () => cancel,
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Import cancelled');
    expect(project.active).toBe(0);
    expect(project.models.size).toBeLessThanOrEqual(4);
    expect(project.fields.size).toBe(0);
  });

  it('rejects an unexpected API-created ID instead of returning broken mappings', async () => {
    const project = mockProject({
      reply: (call) =>
        call.method === 'POST'
          ? { status: 200, body: { data: { ...call.data, id: 'unexpected' } } }
          : undefined,
    });
    const error = await rejected(
      importSchema(document(), project.client, () => {}),
    );
    expect((error as Error).message).toContain('unexpected entity ID');
    expect(project.fields.size).toBe(0);
  });
});

describe('plugin import', () => {
  it('preserves private legacy plugin definitions and exported global settings', async () => {
    const doc = document(0, 0, 0, 1);
    const plugin = doc.plugins.entitiesToCreate[0];
    plugin.meta.version = '1';
    plugin.attributes.package_name = null;
    plugin.attributes.url = 'https://example.test/plugin';
    plugin.attributes.field_types = ['string'];
    plugin.attributes.plugin_type = 'field_editor';
    const definitions = {
      global: [
        { id: 'globalSetting', type: 'integer', label: 'Global setting' },
      ],
      instance: [],
    };
    plugin.attributes.parameter_definitions = definitions;
    const project = mockProject();
    await finish(importSchema(doc, project.client, () => {}));
    const created = project.calls.find((call) => call.method === 'POST')?.data;
    expect(created?.attributes).toMatchObject({
      field_types: ['string'],
      plugin_type: 'field_editor',
      parameter_definitions: definitions,
    });
    const configured = project.calls.find(
      (call) => call.method === 'PUT',
    )?.data;
    expect(configured?.attributes.parameters).toEqual({ globalSetting: 0 });
  });
});
