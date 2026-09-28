import type { ScanReport } from '../types';

function cell(value: string) {
  // Keep spreadsheet applications from interpreting content as a formula.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function reportCsv(report: ScanReport): string {
  const rows: string[][] = [
    [
      'URL',
      'Status',
      'HTTP status',
      'Reason',
      'Checked at',
      'Record',
      'Record ID',
      'Model',
      'Field',
      'Locale',
      'Blocks',
      'Stale',
      'Scan state',
    ],
  ];
  for (const group of report.groups) {
    for (const occurrence of group.occurrences) {
      rows.push([
        occurrence.url,
        group.result.status,
        String(group.result.httpStatus ?? ''),
        group.result.message,
        group.result.checkedAt ?? '',
        occurrence.recordTitle,
        occurrence.recordId ?? '',
        occurrence.modelName,
        occurrence.fieldLabel,
        occurrence.locale ?? '',
        occurrence.blockPath.join(' → '),
        group.stale ? 'Yes' : 'No',
        report.state,
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function downloadReport(report: ScanReport) {
  const url = URL.createObjectURL(
    new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `broken-links-${report.startedAt.slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
