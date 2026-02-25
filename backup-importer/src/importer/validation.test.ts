/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import { runPreflightImport } from './engine';
import type { RecordExportEnvelope } from './types';
import { validateRecordExportEnvelope } from './validation';

function buildFixture(): RecordExportEnvelope {
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
      fields: [
        {
          id: 'f_related',
          item_type: { id: 'model_page' },
          api_key: 'related',
          field_type: 'link',
          localized: false,
        },
      ],
      itemTypeIdToApiKey: {
        model_page: 'page',
      },
      fieldIdToApiKey: {
        f_related: 'related',
      },
      fieldsByItemType: {
        model_page: [
          {
            fieldId: 'f_related',
            apiKey: 'related',
            fieldType: 'link',
            localized: false,
          },
        ],
      },
    },
    projectConfiguration: {
      site: {
        id: 'site-1',
        locales: ['en'],
        timezone: 'UTC',
      },
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
        id: 'record-a',
        item_type: { id: 'model_page' },
        related: 'record-b',
      },
      {
        id: 'record-b',
        item_type: { id: 'model_page' },
        related: 'record-a',
      },
    ],
    referenceIndex: {
      recordRefs: [
        {
          recordSourceId: 'record-a',
          sourceBlockId: null,
          fieldApiKey: 'related',
          locale: null,
          jsonPath: '$.records[0].related',
          targetSourceId: 'record-b',
          kind: 'link',
        },
      ],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [],
    },
    assetPackageInfo: {
      packageVersion: '2.0.0',
      zipNamingConvention: 'allAssets.part-{part}-of-{total}.{timestamp}.zip',
      zipEntryNamingConvention: 'u_<sourceUploadId>__<sanitizedOriginalFilename>',
      manifestFilename: 'manifest.json',
      chunkingDefaults: {
        maxZipBytes: 157286400,
        maxFilesPerZip: 100,
        sizeSafetyFactor: 1.2,
      },
      lastAssetExportSnapshot: null,
    },
  };
}

describe('validateRecordExportEnvelope', () => {
  test('accepts a valid 2.1.0 export envelope', () => {
    const fixture = buildFixture();
    const result = validateRecordExportEnvelope(fixture);

    expect(result.envelope).not.toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.stats.recordCount).toBe(2);
    expect(result.stats.referenceCounts.recordRefs).toBe(1);
  });

  test('detects duplicate record IDs and unsupported version', () => {
    const fixture = buildFixture();
    fixture.manifest.exportVersion = '9.9.9';
    fixture.records[1].id = 'record-a';

    const result = validateRecordExportEnvelope(fixture);

    expect(result.envelope).toBeNull();
    expect(result.errors.some((error) => error.includes('Unsupported export version'))).toBe(true);
    expect(result.errors.some((error) => error.includes('Duplicate source record IDs'))).toBe(true);
  });

  test('strict preflight fails when unresolved references remain', () => {
    const fixture = buildFixture();
    fixture.records[0].related = 'record-missing';

    const report = runPreflightImport(fixture, { strictMode: true });

    expect(report.ok).toBe(false);
    expect(report.unresolvedSummary.records).toBe(1);
    expect(report.errors.some((error) => error.includes('unresolved references'))).toBe(true);
  });
});
