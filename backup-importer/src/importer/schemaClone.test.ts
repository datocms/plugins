/// <reference types="vitest" />

import { describe, expect, test, vi } from 'vitest';
import { importSchemaCore } from './schemaClone';
import type { JsonObject, RecordExportEnvelope } from './types';

function buildEnvelopeWithField(field: JsonObject): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-17T00:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [
        {
          id: 'source-page',
          name: 'Page',
          api_key: 'page',
          modular_block: false,
        },
        {
          id: 'source-block',
          name: 'Section Block',
          api_key: 'section_block',
          modular_block: true,
        },
      ],
      fields: [field],
      itemTypeIdToApiKey: {
        'source-page': 'page',
        'source-block': 'section_block',
      },
      fieldIdToApiKey: {
        [String(field.id)]: String(field.api_key),
      },
      fieldsByItemType: {
        'source-page': [
          {
            fieldId: String(field.id),
            apiKey: String(field.api_key),
            fieldType: String(field.field_type),
            localized: Boolean(field.localized),
          },
        ],
        'source-block': [],
      },
    },
    records: [],
    referenceIndex: {
      recordRefs: [],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [],
    },
  };
}

async function runSchemaImportAndCaptureFieldCreatePayload(
  field: JsonObject,
  options?: {
    targetLocales?: string[];
    fieldsUpdate?: (fieldId: string, payload: JsonObject) => Promise<unknown>;
  },
) {
  const fieldsCreate = vi.fn(async (_itemTypeId: string, payload: JsonObject) => ({
    id: 'target-field',
    api_key: payload.api_key,
  }));
  const fieldsUpdate = vi.fn(
    options?.fieldsUpdate ?? (async () => ({})),
  );

  const client = {
    site: {
      find: vi.fn(async () => ({
        locales: options?.targetLocales ?? ['en'],
      })),
    },
    itemTypes: {
      list: vi.fn(async () => []),
      create: vi.fn(async (payload: JsonObject) => {
        if (payload.api_key === 'section_block') {
          return { id: 'target-block', api_key: 'section_block' };
        }
        return { id: 'target-page', api_key: 'page' };
      }),
      update: vi.fn(async () => ({})),
    },
    fieldsets: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'target-fieldset' })),
    },
    fields: {
      list: vi.fn(async () => []),
      create: fieldsCreate,
      update: fieldsUpdate,
    },
  } as any;

  const mapping = await importSchemaCore({
    client,
    envelope: buildEnvelopeWithField(field),
  });

  return { fieldsCreate, fieldsUpdate, mapping };
}

describe('importSchemaCore pass A validators', () => {
  test('keeps required links validators in pass A payload with mapped block IDs', async () => {
    const field: JsonObject = {
      id: 'field-links',
      api_key: 'featured_collections',
      label: 'Featured collections',
      field_type: 'links',
      item_type: { id: 'source-page' },
      validators: {
        items_item_type: {
          item_types: ['source-block'],
        },
      },
    };

    const { fieldsCreate, mapping } =
      await runSchemaImportAndCaptureFieldCreatePayload(field);

    expect(mapping.fields.missing).toHaveLength(0);
    expect(fieldsCreate).toHaveBeenCalledTimes(1);
    const createPayload = fieldsCreate.mock.calls[0]?.[1] as JsonObject;
    expect(createPayload.validators).toEqual({
      items_item_type: {
        item_types: ['target-block'],
      },
    });
  });

  test('keeps required rich text block validators in pass A payload', async () => {
    const field: JsonObject = {
      id: 'field-rich-text',
      api_key: 'socials',
      label: 'Socials',
      field_type: 'rich_text',
      item_type: { id: 'source-page' },
      validators: {
        rich_text_blocks: {
          item_types: ['source-block'],
        },
      },
    };

    const { fieldsCreate, mapping } =
      await runSchemaImportAndCaptureFieldCreatePayload(field);

    expect(mapping.fields.missing).toHaveLength(0);
    expect(fieldsCreate).toHaveBeenCalledTimes(1);
    const createPayload = fieldsCreate.mock.calls[0]?.[1] as JsonObject;
    expect(createPayload.validators).toEqual({
      rich_text_blocks: {
        item_types: ['target-block'],
      },
    });
  });

  test('filters localized default_value locales to target environment locales', async () => {
    const field: JsonObject = {
      id: 'field-title',
      api_key: 'title',
      label: 'Title',
      field_type: 'string',
      item_type: { id: 'source-page' },
      localized: true,
      default_value: {
        en: 'Hello',
        pt: 'Ola',
      },
    };

    const { fieldsUpdate, mapping } = await runSchemaImportAndCaptureFieldCreatePayload(
      field,
      {
        targetLocales: ['en'],
      },
    );

    expect(mapping.fields.missing).toHaveLength(0);
    expect(fieldsUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = fieldsUpdate.mock.calls[0]?.[1] as JsonObject;
    expect(updatePayload.default_value).toEqual({
      en: 'Hello',
    });
  });

  test('retries pass B without default_value when locale mismatch still occurs', async () => {
    const field: JsonObject = {
      id: 'field-title-retry',
      api_key: 'title_retry',
      label: 'Title retry',
      field_type: 'string',
      item_type: { id: 'source-page' },
      localized: true,
      default_value: {
        en: 'Hello',
      },
    };

    let updateCalls = 0;
    const { fieldsUpdate, mapping } = await runSchemaImportAndCaptureFieldCreatePayload(
      field,
      {
        targetLocales: ['en'],
        fieldsUpdate: async (_fieldId, payload) => {
          updateCalls += 1;
          if (updateCalls === 1 && 'default_value' in payload) {
            throw new Error(
              'FIELD_DEFAULT_VALUE_LOCALES_MISMATCH_ENVIRONMENT_LOCALES',
            );
          }
          return {};
        },
      },
    );

    expect(mapping.fields.missing).toHaveLength(0);
    expect(fieldsUpdate).toHaveBeenCalledTimes(2);
    const firstPayload = fieldsUpdate.mock.calls[0]?.[1] as JsonObject;
    const secondPayload = fieldsUpdate.mock.calls[1]?.[1] as JsonObject;
    expect('default_value' in firstPayload).toBe(true);
    expect('default_value' in secondPayload).toBe(false);
  });

  test('retries pass B without appearance.addons when addon id is invalid', async () => {
    const field: JsonObject = {
      id: 'field-sale',
      api_key: 'sale',
      label: 'Sale',
      field_type: 'string',
      item_type: { id: 'source-page' },
      appearance: {
        editor: 'string',
        addons: [{ id: 'source-addon-id' }],
      },
    };

    let updateCalls = 0;
    const capturedPayloads: JsonObject[] = [];
    const { fieldsUpdate, mapping } = await runSchemaImportAndCaptureFieldCreatePayload(
      field,
      {
        targetLocales: ['en'],
        fieldsUpdate: async (_fieldId, payload) => {
          capturedPayloads.push(JSON.parse(JSON.stringify(payload)) as JsonObject);
          updateCalls += 1;
          if (updateCalls === 1) {
            throw new Error(
              'INVALID_FIELD details: {"field":"appearance.addons.0.id","code":"VALIDATION_INVALID"}',
            );
          }
          return { id: 'target-field', ...payload };
        },
      },
    );

    expect(mapping.fields.missing).toHaveLength(0);
    expect(fieldsUpdate).toHaveBeenCalledTimes(2);
    const firstPayload = capturedPayloads[0] as JsonObject;
    const secondPayload = capturedPayloads[1] as JsonObject;
    expect((firstPayload.appearance as JsonObject).addons).toEqual([
      { id: 'source-addon-id' },
    ]);
    expect((secondPayload.appearance as JsonObject).addons).toEqual([]);
  });

  test('retries pass B without full appearance when appearance remains invalid', async () => {
    const field: JsonObject = {
      id: 'field-sale-editor',
      api_key: 'sale_editor',
      label: 'Sale Editor',
      field_type: 'string',
      item_type: { id: 'source-page' },
      appearance: {
        editor: 'unknown_editor',
      },
    };

    let updateCalls = 0;
    const capturedPayloads: JsonObject[] = [];
    const { fieldsUpdate, mapping } = await runSchemaImportAndCaptureFieldCreatePayload(
      field,
      {
        targetLocales: ['en'],
        fieldsUpdate: async (_fieldId, payload) => {
          capturedPayloads.push(JSON.parse(JSON.stringify(payload)) as JsonObject);
          updateCalls += 1;
          if (updateCalls === 1) {
            throw new Error(
              'INVALID_FIELD details: {"field":"appearance.editor","code":"VALIDATION_INVALID"}',
            );
          }
          return {};
        },
      },
    );

    expect(mapping.fields.missing).toHaveLength(0);
    expect(fieldsUpdate).toHaveBeenCalledTimes(2);
    const secondPayload = capturedPayloads[1] as JsonObject;
    expect('appearance' in secondPayload).toBe(false);
  });

  test('falls back to stripping full appearance on INVALID_FORMAT appearance message', async () => {
    const field: JsonObject = {
      id: 'field-sale-format',
      api_key: 'sale_format',
      label: 'Sale Format',
      field_type: 'string',
      item_type: { id: 'source-page' },
      appearance: {
        editor: 'string',
        addons: [{ id: 'source-addon-id' }],
      },
    };

    let updateCalls = 0;
    const capturedPayloads: JsonObject[] = [];
    const { fieldsUpdate, mapping } = await runSchemaImportAndCaptureFieldCreatePayload(
      field,
      {
        targetLocales: ['en'],
        fieldsUpdate: async (_fieldId, payload) => {
          capturedPayloads.push(JSON.parse(JSON.stringify(payload)) as JsonObject);
          updateCalls += 1;
          if (updateCalls === 1) {
            throw new Error(
              'INVALID_FIELD details: {"field":"appearance.addons.0.id","code":"VALIDATION_INVALID"}',
            );
          }
          if (updateCalls === 2) {
            throw new Error(
              'INVALID_FORMAT details: {"messages":["#/data/attributes/appearance: failed schema #/definitions/field/links/1/schema/properties/data/properties/attributes/properties/appearance: \\"addons\\" wasn\'t supplied."]}',
            );
          }
          return {};
        },
      },
    );

    expect(mapping.fields.missing).toHaveLength(0);
    expect(fieldsUpdate).toHaveBeenCalledTimes(3);
    const secondPayload = capturedPayloads[1] as JsonObject;
    const thirdPayload = capturedPayloads[2] as JsonObject;
    expect((secondPayload.appearance as JsonObject).addons).toEqual([]);
    expect('appearance' in thirdPayload).toBe(false);
  });

  test('add-only mode maps existing fields and skips pass B updates', async () => {
    const field: JsonObject = {
      id: 'field-existing',
      api_key: 'title',
      label: 'Title',
      field_type: 'string',
      item_type: { id: 'source-page' },
      localized: false,
      default_value: 'Hello',
    };

    const fieldsCreate = vi.fn(async () => ({ id: 'created-field' }));
    const fieldsUpdate = vi.fn(async () => ({}));
    const itemTypesCreate = vi.fn(async () => ({ id: 'created-item-type' }));

    const mapping = await importSchemaCore({
      client: {
        site: {
          find: vi.fn(async () => ({
            locales: ['en'],
          })),
        },
        itemTypes: {
          list: vi.fn(async () => [
            { id: 'target-page', api_key: 'page' },
            { id: 'target-block', api_key: 'section_block' },
          ]),
          create: itemTypesCreate,
          update: vi.fn(async () => ({})),
        },
        fieldsets: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => ({ id: 'target-fieldset' })),
        },
        fields: {
          list: vi.fn(async (itemTypeId: string) => {
            if (itemTypeId === 'target-page') {
              return [{ id: 'target-title-field', api_key: 'title' }];
            }
            return [];
          }),
          create: fieldsCreate,
          update: fieldsUpdate,
        },
      } as any,
      envelope: buildEnvelopeWithField(field),
      addOnlyDifferences: true,
    });

    expect(mapping.fields.fieldIdMap.get('field-existing')).toBe('target-title-field');
    expect(fieldsCreate).not.toHaveBeenCalled();
    expect(fieldsUpdate).not.toHaveBeenCalled();
    expect(itemTypesCreate).not.toHaveBeenCalled();
    expect(mapping.addOnlySkippedByResource?.fields).toBe(1);
    expect(
      mapping.fields.warnings.some((entry) =>
        entry.includes("[add-only][fields] Skipped existing field 'title'"),
      ),
    ).toBe(true);
  });
});
