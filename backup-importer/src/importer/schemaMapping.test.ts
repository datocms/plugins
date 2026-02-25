/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import {
  buildFieldApiKeyMapByItemType,
  buildItemTypeIdMapFromApiKeys,
  buildSchemaMapping,
} from './schemaMapping';
import type { RecordExportEnvelope } from './types';

function buildEnvelope(): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-10T18:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [],
      fields: [
        {
          id: 'field_a_title',
          item_type: { id: 'source_model_a' },
          api_key: 'title',
          field_type: 'string',
          localized: false,
        },
        {
          id: 'field_a_related',
          item_type: { id: 'source_model_a' },
          api_key: 'related',
          field_type: 'link',
          localized: false,
        },
        {
          id: 'field_b_title',
          item_type: { id: 'source_model_b' },
          api_key: 'title',
          field_type: 'string',
          localized: false,
        },
      ],
      itemTypeIdToApiKey: {
        source_model_a: 'page',
        source_model_b: 'article',
      },
      fieldIdToApiKey: {},
      fieldsByItemType: {
        source_model_a: [
          {
            fieldId: 'field_a_title',
            apiKey: 'title',
            fieldType: 'string',
            localized: false,
          },
          {
            fieldId: 'field_a_related',
            apiKey: 'related',
            fieldType: 'link',
            localized: false,
          },
        ],
        source_model_b: [
          {
            fieldId: 'field_b_title',
            apiKey: 'title',
            fieldType: 'string',
            localized: false,
          },
        ],
      },
    },
    records: [
      {
        id: 'record-1',
        item_type: { id: 'source_model_a' },
      },
      {
        id: 'record-2',
        item_type: { id: 'source_model_b' },
      },
    ],
    referenceIndex: {
      recordRefs: [],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [],
    },
  };
}

describe('buildItemTypeIdMapFromApiKeys', () => {
  test('maps source models by api_key in target environment', async () => {
    const envelope = buildEnvelope();
    const client = {
      itemTypes: {
        list: async () => [
          {
            id: 'target_1',
            api_key: 'page',
          },
          {
            id: 'target_2',
            api_key: 'article',
          },
        ],
      },
    };

    const result = await buildItemTypeIdMapFromApiKeys(client as any, envelope);

    expect(result.missing).toHaveLength(0);
    expect(result.itemTypeIdMap.get('source_model_a')).toBe('target_1');
    expect(result.itemTypeIdMap.get('source_model_b')).toBe('target_2');
  });

  test('reports missing mapping entries', async () => {
    const envelope = buildEnvelope();
    const client = {
      itemTypes: {
        list: async () => [
          {
            id: 'target_1',
            api_key: 'page',
          },
        ],
      },
    };

    const result = await buildItemTypeIdMapFromApiKeys(client as any, envelope);

    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].sourceItemTypeId).toBe('source_model_b');
  });
});

describe('buildFieldApiKeyMapByItemType', () => {
  test('maps fields by api_key for mapped item types', async () => {
    const envelope = buildEnvelope();

    const result = await buildFieldApiKeyMapByItemType({
      client: {
        fields: {
          list: async (itemTypeId: string) => {
            if (itemTypeId === 'target_1') {
              return [
                {
                  id: 'target_field_1',
                  api_key: 'title',
                  field_type: 'string',
                  localized: false,
                },
                {
                  id: 'target_field_2',
                  api_key: 'related',
                  field_type: 'link',
                  localized: false,
                },
              ];
            }

            return [
              {
                id: 'target_field_3',
                api_key: 'title',
                field_type: 'string',
                localized: false,
              },
            ];
          },
        },
      } as any,
      envelope,
      itemTypeIdMap: new Map([
        ['source_model_a', 'target_1'],
        ['source_model_b', 'target_2'],
      ]),
    });

    expect(result.missing).toHaveLength(0);
    expect(result.fieldApiKeyMapByItemType.get('source_model_a')?.get('title')).toBe(
      'title',
    );
    expect(
      result.fieldApiKeyMapByItemType.get('source_model_a')?.get('related'),
    ).toBe('related');
  });
});

describe('buildSchemaMapping', () => {
  test('returns combined item/field mapping report', async () => {
    const envelope = buildEnvelope();
    const client = {
      itemTypes: {
        list: async () => [
          {
            id: 'target_1',
            api_key: 'page',
          },
          {
            id: 'target_2',
            api_key: 'article',
          },
        ],
      },
      fields: {
        list: async () => [
          {
            id: 'target_field',
            api_key: 'title',
            field_type: 'string',
            localized: false,
          },
          {
            id: 'target_related',
            api_key: 'related',
            field_type: 'link',
            localized: false,
          },
        ],
      },
    };

    const result = await buildSchemaMapping(client as any, envelope);
    expect(result.itemTypes.missing).toHaveLength(0);
    expect(result.fields.missing).toHaveLength(0);
  });
});
