/**
 * Builds and serializes the end-of-run bulk-translation report — a flat,
 * exportable list answering "which record failed and why". Each QC reason
 * becomes its own row (record + field + locale + check + message), each
 * reference-copied link field becomes its own row stating WHY the record is
 * flagged (the references were shared, not translated), and each free-text
 * warning becomes its own row; only a record that carries none of these yields
 * a single row using its message. Pure functions so they are trivially testable
 * and the UI is a thin renderer over them.
 */

import type { ProgressStatus, ProgressUpdate } from './ItemsDropdownUtils';

/** One exportable line of the bulk report. */
export type BulkReportRow = {
  recordId: string;
  /** Editor-friendly record label, when known. */
  recordTitle?: string;
  /** Absolute link to the record's editor, when it can be built. */
  editUrl?: string;
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

/** Fields shared by every row derived from the same record. */
type CommonRowFields = Pick<
  BulkReportRow,
  'recordId' | 'recordTitle' | 'editUrl' | 'status'
>;

/** Resolves a record's editor URL for the report's `editUrl` column. */
type BuildUrl = (update: ProgressUpdate) => string | undefined;

/** Statuses that represent a record worth surfacing in the report. */
const FLAGGED_STATUSES = new Set<ProgressStatus>([
  'error',
  'completed-with-warnings',
]);

/**
 * Prefix of the consolidated warning the progress stream raises for
 * reference-copied link fields (see ItemsDropdownUtils' buildReferenceCopyWarning).
 * `buildBulkReportRows` already emits a structured row per copied field, so the
 * matching free-text warning is dropped to avoid reporting the same fact twice.
 */
const REFERENCE_COPY_WARNING_PREFIX = 'Copied linked records';

/**
 * Reason attached to each reference-copied link field's row. Mirrors the
 * consolidated warning the progress stream raises so the retained report and
 * the progress modal's CSV export tell the same story.
 */
const REFERENCE_COPY_REASON =
  'Linked records were copied into the new locale(s) as shared references and ' +
  "weren't translated — review whether they should differ per locale.";

/** Row fields shared by every entry derived from `update`. */
const commonRowFields = (
  update: ProgressUpdate,
  buildUrl?: BuildUrl,
): CommonRowFields => ({
  recordId: update.recordId,
  recordTitle: update.recordLabel ?? '',
  editUrl: buildUrl?.(update) ?? '',
  status: update.status,
});

/** One row per structured QC flag on the record. */
const qcFlagRows = (
  update: ProgressUpdate,
  common: CommonRowFields,
): BulkReportRow[] =>
  (update.qcFlags ?? []).map((flag) => ({
    ...common,
    fieldPath: flag.fieldPath ?? '',
    locale: flag.locale ?? '',
    severity: flag.severity,
    checkId: flag.checkId,
    reason: flag.message,
  }));

/** One row per link field whose references were copied instead of translated. */
const referenceCopyRows = (
  update: ProgressUpdate,
  common: CommonRowFields,
): BulkReportRow[] =>
  (update.copiedLinkFieldApiKeys ?? []).map((fieldApiKey) => ({
    ...common,
    fieldPath: fieldApiKey,
    locale: '',
    severity: 'warning',
    checkId: 'reference-copy',
    reason: REFERENCE_COPY_REASON,
  }));

/**
 * One row per free-text warning, skipping the consolidated reference-copy
 * warning (already represented by structured referenceCopyRows). These carry
 * the real reason for a "completed with warnings" record whose only signal is a
 * warning string (e.g. a skipped field after a rate limit).
 */
const warningRows = (
  update: ProgressUpdate,
  common: CommonRowFields,
): BulkReportRow[] =>
  (update.warnings ?? [])
    .filter((warning) => !warning.startsWith(REFERENCE_COPY_WARNING_PREFIX))
    .map((warning) => ({
      ...common,
      fieldPath: '',
      locale: '',
      severity: 'warning',
      checkId: 'warning',
      reason: warning,
    }));

/** Last-resort row from the record-level message (e.g. a CMA save rejection). */
const messageRow = (
  update: ProgressUpdate,
  common: CommonRowFields,
): BulkReportRow => ({
  ...common,
  fieldPath: '',
  locale: '',
  severity: update.status === 'error' ? 'error' : 'warning',
  checkId: '',
  reason: update.message ?? '',
});

/**
 * Flattens the per-record progress stream into report rows, keeping only
 * records that errored or completed with warnings. A record contributes one
 * row per QC flag, one row per reference-copied link field, and one row per
 * free-text warning (deduped against the reference-copy warning); only when it
 * carries none of these does its bare message become the row.
 *
 * @param progress - The per-record progress updates.
 * @param buildUrl - Optional resolver for each row's editor link.
 */
export function buildBulkReportRows(
  progress: ProgressUpdate[],
  buildUrl?: BuildUrl,
): BulkReportRow[] {
  return progress
    .filter((update) => FLAGGED_STATUSES.has(update.status))
    .flatMap((update) => {
      const common = commonRowFields(update, buildUrl);
      const structured = [
        ...qcFlagRows(update, common),
        ...referenceCopyRows(update, common),
        ...warningRows(update, common),
      ];
      return structured.length > 0 ? structured : [messageRow(update, common)];
    });
}

const CSV_HEADER =
  'Record ID,Record title,Edit URL,Status,Field,Locale,Severity,Check,Reason';

/**
 * Escapes a single CSV cell per RFC 4180 (quote-wrap when needed) and
 * neutralizes spreadsheet formula injection (OWASP): a leading =, +, -, @, or
 * control char makes Excel/Sheets evaluate the cell as a formula. Record titles
 * feed this and are editor-controlled, so risky values are prefixed with a
 * quote (rendered as plain text by spreadsheet apps).
 */
function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** Serializes report rows to RFC-4180 CSV with a header line. */
export function toBulkReportCsv(rows: BulkReportRow[]): string {
  const lines = rows.map((r) =>
    [
      r.recordId,
      r.recordTitle ?? '',
      r.editUrl ?? '',
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
