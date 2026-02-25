/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import { toCsvImportReport } from './report';
import type { ImportExecutionReport } from './types';

function buildReport(): ImportExecutionReport {
  return {
    ok: false,
    strictMode: true,
    addOnlyDifferencesEnabled: true,
    validationWindowEnabled: true,
    validationFieldsInScope: 12,
    validationFieldsSuspended: 10,
    validationFieldsRestored: 10,
    validationSuspendFailures: 1,
    validationRestoreFailures: 1,
    validationSuspendFailureFieldIds: ['field-a'],
    validationRestoreFailureFieldIds: ['field-b'],
    existingRecordMatches: 3,
    skippedExistingRecords: 3,
    skippedExistingByResource: {
      records: 3,
      fields: 2,
    },
    errors: ['one error'],
    warnings: ['one warning'],
    preflight: null,
    schemaMapping: null,
    assetImport: null,
    createdCount: 1,
    updatedCount: 2,
    publishedCount: 0,
    treeUpdatedCount: 0,
    skippedPatchCount: 1,
    createFailures: [],
    updateFailures: [],
    publishFailures: [],
    treeFailures: [],
    unresolvedSummary: {
      records: 1,
      uploads: 2,
      blocks: 3,
    },
    itemTypeIdMap: new Map([['a', 'b']]),
    fieldIdMap: new Map([['f1', 'f2']]),
    fieldsetIdMap: new Map([['s1', 's2']]),
    recordIdMap: new Map(),
    uploadIdMap: new Map(),
    resumedFromCheckpoint: false,
    checkpointFingerprint: null,
  };
}

describe('toCsvImportReport', () => {
  test('generates summary rows', () => {
    const csv = toCsvImportReport(buildReport());
    expect(csv).toContain('"summary","status","FAILED"');
    expect(csv).toContain('"summary","addOnlyDifferencesEnabled","true"');
    expect(csv).toContain('"summary","validationWindowEnabled","true"');
    expect(csv).toContain('"summary","existingRecordMatches","3"');
    expect(csv).toContain('"summary","skippedExistingByResource.records","3"');
    expect(csv).toContain('"validationSuspendFailureFieldIds","1","field-a"');
    expect(csv).toContain('"validationRestoreFailureFieldIds","1","field-b"');
    expect(csv).toContain('"errors","1","one error"');
    expect(csv).toContain('"warnings","1","one warning"');
  });
});
