/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import { buildBootstrapCreatePayload } from './executor';
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
      itemTypes: [{ id: 'model_page', api_key: 'page' }],
      fields: [],
      itemTypeIdToApiKey: { model_page: 'page' },
      fieldIdToApiKey: {},
      fieldsByItemType: {
        model_page: [
          {
            fieldId: 'f_title',
            apiKey: 'title',
            fieldType: 'string',
            localized: false,
          },
          {
            fieldId: 'f_related',
            apiKey: 'related',
            fieldType: 'link',
            localized: false,
          },
          {
            fieldId: 'f_content',
            apiKey: 'content',
            fieldType: 'structured_text',
            localized: false,
          },
        ],
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

describe('buildBootstrapCreatePayload', () => {
  test('keeps scalar fields and removes relational fields', () => {
    const envelope = buildEnvelope();

    const payload = buildBootstrapCreatePayload({
      sourceRecord: {
        id: 'record-1',
        item_type: { id: 'model_page' },
        title: 'Hello',
        related: 'record-2',
        content: {
          schema: 'dast',
        },
        legacy_note: 'still included',
      },
      sourceItemTypeId: 'model_page',
      targetItemTypeId: 'target_model_page',
      envelope,
    });

    expect(payload.item_type).toEqual({
      type: 'item_type',
      id: 'target_model_page',
    });
    expect(payload.title).toBe('Hello');
    expect(payload.related).toBeUndefined();
    expect(payload.content).toBeUndefined();
    expect(payload.legacy_note).toBe('still included');
  });

  test('can include resolved relational fields when enabled', () => {
    const envelope = buildEnvelope();

    const payload = buildBootstrapCreatePayload({
      sourceRecord: {
        id: 'record-1',
        item_type: { id: 'model_page' },
        title: 'Hello',
        related: 'record-2',
      },
      sourceItemTypeId: 'model_page',
      targetItemTypeId: 'target_model_page',
      envelope,
      includeResolvedRelations: true,
      idMaps: {
        recordIds: new Map([['record-2', 'target-record-2']]),
        uploadIds: new Map(),
        blockIds: new Map(),
      },
    });

    expect(payload.related).toBe('target-record-2');
  });
});
