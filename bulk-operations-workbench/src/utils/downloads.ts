import type { ExecutionRow, PreviewRow } from '../types';

function escapeCsvValue(value: string | null | undefined): string {
  const normalized = value ?? '';
  return `"${normalized.split('"').join('""')}"`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function timestampSuffix(): string {
  return new Date().toISOString().split(':').join('-');
}

export function downloadBeforeValuesCsv(rows: PreviewRow[]): string {
  const header = [
    'recordId',
    'modelId',
    'modelName',
    'recordTitle',
    'targetField',
    'sourceField',
    'locale',
    'beforeValue',
    'afterValue',
    'outcome',
    'reason',
  ];

  const csv = [header.join(',')];

  for (const row of rows) {
    csv.push(
      [
        row.recordId,
        row.modelId,
        row.modelName,
        row.recordTitle,
        row.targetFieldApiKey,
        row.sourceFieldApiKey ?? '',
        row.locale ?? '',
        row.beforeValue ?? '',
        row.afterValue ?? '',
        row.outcome,
        row.reason ?? '',
      ]
        .map(escapeCsvValue)
        .join(','),
    );
  }

  const filename = `bulk-operations-before-values.${timestampSuffix()}.csv`;
  downloadBlob(new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8' }), filename);
  return filename;
}

export function downloadExecutionCsv(rows: ExecutionRow[]): string {
  const header = ['recordId', 'modelId', 'modelName', 'recordTitle', 'status', 'message'];
  const csv = [header.join(',')];

  for (const row of rows) {
    csv.push(
      [
        row.recordId,
        row.modelId,
        row.modelName,
        row.recordTitle,
        row.status,
        row.message ?? '',
      ]
        .map(escapeCsvValue)
        .join(','),
    );
  }

  const filename = `bulk-operations-report.${timestampSuffix()}.csv`;
  downloadBlob(new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8' }), filename);
  return filename;
}

export function downloadExecutionJson(rows: ExecutionRow[]): string {
  const filename = `bulk-operations-report.${timestampSuffix()}.json`;
  downloadBlob(
    new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }),
    filename,
  );
  return filename;
}
