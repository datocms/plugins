/**
 * Builds and serializes the end-of-run bulk-translation report — a flat,
 * exportable list answering "which record failed and why". Each QC reason
 * becomes its own row (record + field + locale + check + message), each
 * reference-copied link field becomes its own row stating WHY the record is
 * flagged (the references were shared, not translated); a record that carries
 * neither yields a single row using its message. Pure functions so they are
 * trivially testable and the UI is a thin renderer over them.
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
 * Reason attached to each reference-copied link field's row. Mirrors the
 * consolidated warning the progress stream raises (see ItemsDropdownUtils'
 * buildReferenceCopyWarning) so the retained report and the progress modal's
 * CSV export tell the same story.
 */
const REFERENCE_COPY_REASON =
  'Linked records were copied into the new locale(s) as shared references and ' +
  "weren't translated — review whether they should differ per locale.";

/** One row per structured QC flag on the record. */
const qcFlagRows = (update: ProgressUpdate): BulkReportRow[] =>
  (update.qcFlags ?? []).map((flag) => ({
    recordId: update.recordId,
    status: update.status,
    fieldPath: flag.fieldPath ?? '',
    locale: flag.locale ?? '',
    severity: flag.severity,
    checkId: flag.checkId,
    reason: flag.message,
  }));

/** One row per link field whose references were copied instead of translated. */
const referenceCopyRows = (update: ProgressUpdate): BulkReportRow[] =>
  (update.copiedLinkFieldApiKeys ?? []).map((fieldApiKey) => ({
    recordId: update.recordId,
    status: update.status,
    fieldPath: fieldApiKey,
    locale: '',
    severity: 'warning',
    checkId: 'reference-copy',
    reason: REFERENCE_COPY_REASON,
  }));

/** Last-resort row from the record-level message (e.g. a CMA save rejection). */
const messageRow = (update: ProgressUpdate): BulkReportRow => ({
  recordId: update.recordId,
  status: update.status,
  fieldPath: '',
  locale: '',
  severity: update.status === 'error' ? 'error' : 'warning',
  checkId: '',
  reason: update.message ?? '',
});

/**
 * Flattens the per-record progress stream into report rows, keeping only
 * records that errored or completed with warnings. A record contributes one
 * row per QC flag PLUS one row per reference-copied link field (the usual
 * reason a record is merely "completed with warnings"); only when it carries
 * neither does its bare message become the row.
 */
export function buildBulkReportRows(
  progress: ProgressUpdate[],
): BulkReportRow[] {
  return progress
    .filter((update) => FLAGGED_STATUSES.has(update.status))
    .flatMap((update) => {
      const structured = [...qcFlagRows(update), ...referenceCopyRows(update)];
      return structured.length > 0 ? structured : [messageRow(update)];
    });
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
