/**
 * Builds and serializes the end-of-run bulk-translation report — a flat,
 * exportable list answering "which record failed and why". Each QC reason
 * becomes its own row (record + field + locale + check + message); a record
 * that only carries a save-level error (no structured flags) yields a single
 * row using its message. Pure functions so they are trivially testable and the
 * UI is a thin renderer over them.
 */

import type { ProgressStatus, ProgressUpdate } from './ItemsDropdownUtils';

/** One exportable line of the bulk report. */
export type BulkReportRow = {
  recordId: string;
  status: ProgressStatus;
  /** Field api key/path, or '' when not field-specific. */
  fieldPath: string;
  /** Target locale, or '' when not locale-specific. */
  locale: string;
  /** 'error' | 'warning' | '' (the latter when unknown). */
  severity: string;
  /** QC check id, or '' for a non-QC (save-level) failure. */
  checkId: string;
  /** Human-readable reason. */
  reason: string;
};

/** Statuses that represent a record worth surfacing in the report. */
const FLAGGED_STATUSES = new Set<ProgressStatus>([
  'error',
  'completed-with-warnings',
]);

/**
 * Flattens the per-record progress stream into report rows, keeping only
 * records that errored or completed with warnings.
 */
export function buildBulkReportRows(
  progress: ProgressUpdate[],
): BulkReportRow[] {
  const rows: BulkReportRow[] = [];
  for (const update of progress) {
    if (!FLAGGED_STATUSES.has(update.status)) continue;

    const flags = update.qcFlags ?? [];
    if (flags.length > 0) {
      for (const flag of flags) {
        rows.push({
          recordId: update.recordId,
          status: update.status,
          fieldPath: flag.fieldPath ?? '',
          locale: flag.locale ?? '',
          severity: flag.severity,
          checkId: flag.checkId,
          reason: flag.message,
        });
      }
      continue;
    }

    // No structured flags (e.g. a CMA save rejection): one row from the message.
    rows.push({
      recordId: update.recordId,
      status: update.status,
      fieldPath: '',
      locale: '',
      severity: update.status === 'error' ? 'error' : 'warning',
      checkId: '',
      reason: update.message ?? '',
    });
  }
  return rows;
}

const CSV_HEADER = 'Record ID,Status,Field,Locale,Severity,Check,Reason';

/** Escapes a single CSV cell per RFC 4180 (quote-wrap when needed). */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serializes report rows to RFC-4180 CSV with a header line. */
export function toBulkReportCsv(rows: BulkReportRow[]): string {
  const lines = rows.map((r) =>
    [
      r.recordId,
      r.status,
      r.fieldPath,
      r.locale,
      r.severity,
      r.checkId,
      r.reason,
    ]
      .map(csvCell)
      .join(','),
  );
  return [CSV_HEADER, ...lines].join('\n');
}

/** Serializes report rows to pretty-printed JSON. */
export function toBulkReportJson(rows: BulkReportRow[]): string {
  return JSON.stringify(rows, null, 2);
}
