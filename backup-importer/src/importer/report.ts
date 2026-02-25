import type { ImportExecutionReport } from './types';

function escapeCsv(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function toCsvImportReport(report: ImportExecutionReport): string {
  const rows: string[][] = [];

  rows.push(['section', 'key', 'value']);
  rows.push(['summary', 'status', report.ok ? 'OK' : 'FAILED']);
  rows.push(['summary', 'strictMode', String(report.strictMode)]);
  rows.push([
    'summary',
    'addOnlyDifferencesEnabled',
    String(report.addOnlyDifferencesEnabled),
  ]);
  rows.push([
    'summary',
    'validationWindowEnabled',
    String(report.validationWindowEnabled),
  ]);
  rows.push([
    'summary',
    'validationFieldsInScope',
    String(report.validationFieldsInScope),
  ]);
  rows.push([
    'summary',
    'validationFieldsSuspended',
    String(report.validationFieldsSuspended),
  ]);
  rows.push([
    'summary',
    'validationFieldsRestored',
    String(report.validationFieldsRestored),
  ]);
  rows.push([
    'summary',
    'validationSuspendFailures',
    String(report.validationSuspendFailures),
  ]);
  rows.push([
    'summary',
    'validationRestoreFailures',
    String(report.validationRestoreFailures),
  ]);
  rows.push([
    'summary',
    'existingRecordMatches',
    String(report.existingRecordMatches),
  ]);
  rows.push([
    'summary',
    'skippedExistingRecords',
    String(report.skippedExistingRecords),
  ]);
  rows.push(['summary', 'createdCount', String(report.createdCount)]);
  rows.push(['summary', 'updatedCount', String(report.updatedCount)]);
  rows.push(['summary', 'publishedCount', String(report.publishedCount)]);
  rows.push(['summary', 'treeUpdatedCount', String(report.treeUpdatedCount)]);
  rows.push(['summary', 'skippedPatchCount', String(report.skippedPatchCount)]);
  rows.push([
    'summary',
    'unresolved.records',
    String(report.unresolvedSummary.records),
  ]);
  rows.push([
    'summary',
    'unresolved.uploads',
    String(report.unresolvedSummary.uploads),
  ]);
  rows.push([
    'summary',
    'unresolved.blocks',
    String(report.unresolvedSummary.blocks),
  ]);
  rows.push([
    'summary',
    'mappedItemTypes',
    String(report.itemTypeIdMap.size),
  ]);
  rows.push(['summary', 'mappedFields', String(report.fieldIdMap.size)]);
  rows.push([
    'summary',
    'mappedFieldsets',
    String(report.fieldsetIdMap.size),
  ]);

  Object.entries(report.skippedExistingByResource)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([resource, count]) => {
      rows.push(['summary', `skippedExistingByResource.${resource}`, String(count)]);
    });

  report.errors.forEach((error, index) => {
    rows.push(['errors', String(index + 1), error]);
  });

  report.warnings.forEach((warning, index) => {
    rows.push(['warnings', String(index + 1), warning]);
  });

  report.createFailures.forEach((failure, index) => {
    rows.push([
      'createFailures',
      String(index + 1),
      `${failure.sourceRecordId}: ${failure.message}`,
    ]);
  });

  report.updateFailures.forEach((failure, index) => {
    rows.push([
      'updateFailures',
      String(index + 1),
      `${failure.sourceRecordId} (${failure.targetRecordId ?? ''}): ${failure.message}`,
    ]);
  });

  report.publishFailures.forEach((failure, index) => {
    rows.push([
      'publishFailures',
      String(index + 1),
      `${failure.sourceRecordId} (${failure.targetRecordId ?? ''}): ${failure.message}`,
    ]);
  });

  report.treeFailures.forEach((failure, index) => {
    rows.push([
      'treeFailures',
      String(index + 1),
      `${failure.sourceRecordId} (${failure.targetRecordId ?? ''}): ${failure.message}`,
    ]);
  });

  report.validationSuspendFailureFieldIds.forEach((fieldId, index) => {
    rows.push(['validationSuspendFailureFieldIds', String(index + 1), fieldId]);
  });

  report.validationRestoreFailureFieldIds.forEach((fieldId, index) => {
    rows.push(['validationRestoreFailureFieldIds', String(index + 1), fieldId]);
  });

  return rows.map((row) => row.map((value) => escapeCsv(value)).join(',')).join('\n');
}

export function downloadImportReport(report: ImportExecutionReport) {
  const timestamp = new Date().toISOString();

  const jsonBlob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(jsonBlob, `backup-import-report-${timestamp}.json`);

  const csvBlob = new Blob([toCsvImportReport(report)], {
    type: 'text/csv',
  });
  downloadBlob(csvBlob, `backup-import-report-${timestamp}.csv`);
}
