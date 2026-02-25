/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import {
  buildAutomaticBlockIdMap,
  collectEmbeddedBlockObjectIds,
} from './blockMapping';
import type { RecordExportEnvelope } from './types';

function buildEnvelope(): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-10T10:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [],
      fields: [],
      itemTypeIdToApiKey: {},
      fieldIdToApiKey: {},
      fieldsByItemType: {},
    },
    records: [
      {
        id: 'record-1',
        item_type: { id: 'model_page' },
        body: [
          {
            id: 'block-1',
            item_type: { id: 'block_hero' },
          },
        ],
      },
    ],
    referenceIndex: {
      recordRefs: [],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [
        {
          recordSourceId: 'record-1',
          sourceBlockId: null,
          fieldApiKey: 'body',
          locale: null,
          jsonPath: '$.records[0].body[0]',
          blockSourceId: 'block-1',
          blockModelId: 'block_hero',
          parentBlockSourceId: null,
          kind: 'modular_content',
          synthetic: false,
        },
        {
          recordSourceId: 'record-1',
          sourceBlockId: null,
          fieldApiKey: 'body',
          locale: null,
          jsonPath: '$.records[0].body[1]',
          blockSourceId: 'block-missing',
          blockModelId: 'block_hero',
          parentBlockSourceId: null,
          kind: 'modular_content',
          synthetic: false,
        },
      ],
    },
  };
}

function buildEnvelopeWithPayloadOnlyBlockRefs(): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-10T10:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [],
      fields: [],
      itemTypeIdToApiKey: {},
      fieldIdToApiKey: {},
      fieldsByItemType: {
        model_page: [
          {
            fieldId: 'f_body',
            apiKey: 'body',
            fieldType: 'modular_content',
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
    records: [
      {
        id: 'record-1',
        item_type: { id: 'model_page' },
        body: ['payload-block-1'],
        content: {
          schema: 'dast',
          blocks: ['payload-block-2'],
          document: {
            type: 'root',
            children: [{ type: 'block', item: 'payload-block-3' }],
          },
        },
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

describe('collectEmbeddedBlockObjectIds', () => {
  test('collects embedded block IDs and ignores top-level record IDs', () => {
    const envelope = buildEnvelope();
    const ids = collectEmbeddedBlockObjectIds(envelope.records);

    expect(ids.has('block-1')).toBe(true);
    expect(ids.has('record-1')).toBe(false);
  });
});

describe('buildAutomaticBlockIdMap', () => {
  test('builds identity map for embedded and referenced block IDs', () => {
    const envelope = buildEnvelope();
    const result = buildAutomaticBlockIdMap({ envelope });

    expect(result.blockIdMap.get('block-1')).toBe('block-1');
    expect(result.blockIdMap.get('block-missing')).toBe('block-missing');
    expect(result.inferredCount).toBe(2);
    expect(result.unresolvedReferenceCount).toBe(0);
  });

  test('discovers block IDs from payload when reference index is sparse', () => {
    const envelope = buildEnvelopeWithPayloadOnlyBlockRefs();
    const result = buildAutomaticBlockIdMap({ envelope });

    expect(result.blockIdMap.get('payload-block-1')).toBe('payload-block-1');
    expect(result.blockIdMap.get('payload-block-2')).toBe('payload-block-2');
    expect(result.blockIdMap.get('payload-block-3')).toBe('payload-block-3');
  });
});
