/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import { prepareRecordPatchJobs } from './engine';
import type { RecordExportEnvelope } from './types';

function buildEnvelope(recordCount: number): RecordExportEnvelope {
  const records = Array.from({ length: recordCount }, (_, index) => {
    const sourceId = `record-${index}`;
    const nextId = `record-${(index + 1) % recordCount}`;

    return {
      id: sourceId,
      item_type: { id: 'model_page' },
      title: `Title ${index}`,
      related: nextId,
    };
  });

  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-10T19:00:00.000Z',
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
            fieldId: 'field-title',
            apiKey: 'title',
            fieldType: 'string',
            localized: false,
          },
          {
            fieldId: 'field-related',
            apiKey: 'related',
            fieldType: 'link',
            localized: false,
          },
        ],
      },
    },
    records,
    referenceIndex: {
      recordRefs: [],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [],
    },
  };
}

function buildRecordIdMap(recordCount: number): Map<string, string> {
  const map = new Map<string, string>();

  for (let index = 0; index < recordCount; index += 1) {
    map.set(`record-${index}`, `target-record-${index}`);
  }

  return map;
}

describe('prepareRecordPatchJobs chunking compatibility', () => {
  test('returns equivalent results when records are processed in chunks', () => {
    const recordCount = 400;
    const envelope = buildEnvelope(recordCount);
    const recordIdMap = buildRecordIdMap(recordCount);

    const allAtOnce = prepareRecordPatchJobs({
      envelope,
      recordIdMap,
    });

    const chunkSize = 57;
    const chunked: typeof allAtOnce = [];

    for (let index = 0; index < envelope.records.length; index += chunkSize) {
      const chunkRecords = envelope.records.slice(index, index + chunkSize);
      chunked.push(
        ...prepareRecordPatchJobs({
          envelope,
          recordIdMap,
          records: chunkRecords,
        }),
      );
    }

    expect(chunked).toHaveLength(allAtOnce.length);

    const byIdFull = new Map(allAtOnce.map((job) => [job.sourceRecordId, job]));
    const byIdChunked = new Map(chunked.map((job) => [job.sourceRecordId, job]));

    expect(byIdChunked.size).toBe(recordCount);

    for (let index = 0; index < recordCount; index += 1) {
      const sourceRecordId = `record-${index}`;
      const expected = byIdFull.get(sourceRecordId);
      const actual = byIdChunked.get(sourceRecordId);

      expect(actual).toBeDefined();
      expect(expected).toBeDefined();
      expect(actual?.targetRecordId).toBe(expected?.targetRecordId);
      expect(actual?.patchPayload).toEqual(expected?.patchPayload);
      expect(actual?.unresolved).toEqual(expected?.unresolved);
    }
  });
});
