/// <reference types="vitest" />

import { describe, expect, test, vi } from 'vitest';
import { createDebugLogger } from './debugLogger';
import {
  resolveValidationScope,
  restoreFieldValidations,
  suspendFieldValidations,
} from './validationWindow';
import type { RecordExportEnvelope } from './types';

function buildEnvelope(): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-18T00:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [
        { id: 'source-page', api_key: 'page', modular_block: false },
        { id: 'source-block-a', api_key: 'block_a', modular_block: true },
        { id: 'source-block-b', api_key: 'block_b', modular_block: true },
      ],
      fields: [
        {
          id: 'field-page-content',
          api_key: 'content',
          field_type: 'structured_text',
          item_type: { id: 'source-page' },
          validators: {
            structured_text_blocks: {
              item_types: ['source-block-a'],
            },
          },
        },
        {
          id: 'field-block-a-sections',
          api_key: 'sections',
          field_type: 'modular_content',
          item_type: { id: 'source-block-a' },
          validators: {
            items_item_type: {
              item_types: ['source-block-b'],
            },
          },
        },
        {
          id: 'field-block-b-title',
          api_key: 'title',
          field_type: 'string',
          item_type: { id: 'source-block-b' },
          validators: {
            required: {},
          },
        },
      ],
      itemTypeIdToApiKey: {
        'source-page': 'page',
        'source-block-a': 'block_a',
        'source-block-b': 'block_b',
      },
      fieldIdToApiKey: {
        'field-page-content': 'content',
        'field-block-a-sections': 'sections',
        'field-block-b-title': 'title',
      },
      fieldsByItemType: {
        'source-page': [
          {
            fieldId: 'field-page-content',
            apiKey: 'content',
            fieldType: 'structured_text',
            localized: false,
          },
        ],
        'source-block-a': [
          {
            fieldId: 'field-block-a-sections',
            apiKey: 'sections',
            fieldType: 'modular_content',
            localized: false,
          },
        ],
        'source-block-b': [
          {
            fieldId: 'field-block-b-title',
            apiKey: 'title',
            fieldType: 'string',
            localized: false,
          },
        ],
      },
    },
    projectConfiguration: {
      site: null,
      scheduledPublications: [],
      scheduledUnpublishings: [],
      fieldsets: [],
      menuItems: [],
      schemaMenuItems: [],
      modelFilters: [],
      plugins: [],
      workflows: [],
      roles: [],
      webhooks: [],
      buildTriggers: [],
      warnings: [],
    },
    records: [
      {
        id: 'record-page-1',
        item_type: { id: 'source-page' },
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

describe('validationWindow', () => {
  test('resolveValidationScope recursively includes nested block models', () => {
    const envelope = buildEnvelope();
    const logger = createDebugLogger({ enabled: false });

    const scope = resolveValidationScope({
      envelope,
      sourceRecordIds: ['record-page-1'],
      logger,
    });

    expect(scope.sourceItemTypeIds.has('source-page')).toBe(true);
    expect(scope.sourceItemTypeIds.has('source-block-a')).toBe(true);
    expect(scope.sourceItemTypeIds.has('source-block-b')).toBe(true);
    expect(scope.sourceFieldEntries).toHaveLength(3);
  });

  test('suspend and restore validations using source-to-target maps', async () => {
    const envelope = buildEnvelope();
    const logger = createDebugLogger({ enabled: false });
    const scope = resolveValidationScope({
      envelope,
      sourceRecordIds: ['record-page-1'],
      logger,
    });

    const fieldsUpdate = vi.fn(async () => ({}));
    const client = {
      fields: {
        list: vi.fn(async (itemTypeId?: string) => {
          if (itemTypeId === 'target-page') {
            return [
              {
                id: 'target-field-page-content',
                api_key: 'content',
                field_type: 'structured_text',
                validators: {
                  structured_text_blocks: {
                    item_types: ['target-block-a'],
                  },
                  size: { min: 1 },
                },
                all_locales_required: true,
              },
            ];
          }

          if (itemTypeId === 'target-block-a') {
            return [
              {
                id: 'target-field-block-a-sections',
                api_key: 'sections',
                field_type: 'modular_content',
                validators: {
                  items_item_type: {
                    item_types: ['target-block-b'],
                  },
                  size: { min: 1 },
                },
                all_locales_required: true,
              },
            ];
          }

          if (itemTypeId === 'target-block-b') {
            return [
              {
                id: 'target-field-block-b-title',
                api_key: 'title',
                field_type: 'string',
                validators: {
                  required: {},
                },
                all_locales_required: true,
              },
            ];
          }

          return [];
        }),
        update: fieldsUpdate,
      },
    } as any;

    const itemTypeIdMap = new Map([
      ['source-page', 'target-page'],
      ['source-block-a', 'target-block-a'],
      ['source-block-b', 'target-block-b'],
    ]);
    const fieldIdMap = new Map([
      ['field-page-content', 'target-field-page-content'],
      ['field-block-a-sections', 'target-field-block-a-sections'],
      ['field-block-b-title', 'target-field-block-b-title'],
    ]);

    const suspend = await suspendFieldValidations({
      client,
      scope,
      itemTypeIdMap,
      fieldIdMap,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
      updateConcurrency: 2,
      logger,
    });

    expect(suspend.ok).toBe(true);
    expect(suspend.suspendedCount).toBe(3);
    expect(suspend.failures).toHaveLength(0);
    expect(fieldsUpdate).toHaveBeenCalledWith(
      'target-field-page-content',
      expect.objectContaining({
        all_locales_required: false,
        validators: {
          structured_text_blocks: {
            item_types: ['target-block-a'],
          },
        },
      }),
    );
    expect(fieldsUpdate).toHaveBeenCalledWith(
      'target-field-block-a-sections',
      expect.objectContaining({
        all_locales_required: false,
        validators: {
          items_item_type: {
            item_types: ['target-block-b'],
          },
        },
      }),
    );
    expect(fieldsUpdate).toHaveBeenCalledWith(
      'target-field-block-b-title',
      expect.objectContaining({
        all_locales_required: false,
        validators: {},
      }),
    );

    fieldsUpdate.mockClear();

    const restore = await restoreFieldValidations({
      client,
      snapshots: suspend.snapshots,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
      updateConcurrency: 2,
      logger,
    });

    expect(restore.ok).toBe(true);
    expect(restore.restoredCount).toBe(3);
    expect(restore.failures).toHaveLength(0);
    expect(fieldsUpdate).toHaveBeenCalledWith(
      'target-field-page-content',
      expect.objectContaining({
        all_locales_required: true,
      }),
    );
    expect(fieldsUpdate).toHaveBeenCalledWith(
      'target-field-block-a-sections',
      expect.objectContaining({
        all_locales_required: true,
      }),
    );
    expect(fieldsUpdate).toHaveBeenCalledWith(
      'target-field-block-b-title',
      expect.objectContaining({
        all_locales_required: true,
      }),
    );
  });
});
