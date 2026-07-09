/**
 * csvExport.ts
 * Pure CSV helpers plus a browser download trigger for the bulk-translation
 * report. Kept out of the modal component so the mapping/escaping is unit-testable.
 */
import type { ProgressUpdate } from './translation/ItemsDropdownUtils';

/**
 * Escapes a single CSV field per RFC 4180: null/undefined become empty, and
 * values containing a comma, quote, CR, or LF are wrapped in quotes with any
 * internal quotes doubled.
 */
function escapeCsvValue(value: string | null | undefined): string {
  let str = value ?? '';
  // Neutralize spreadsheet formula injection (OWASP): a leading =, +, -, @, or
  // control char makes Excel/Sheets evaluate the cell as a formula. Record
  // titles feed this and are editor-controlled, so prefix risky values with a
  // quote (rendered as plain text by spreadsheet apps).
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds RFC 4180 CSV text (CRLF line endings) from a header row and data rows.
 *
 * @param headers - Column headers.
 * @param rows - Row values (null/undefined render as empty cells).
 * @returns The CSV document as a string (no BOM).
 */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | null | undefined>>,
): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeCsvValue).join(','),
  );
  return lines.join('\r\n');
}

/** Column order for the translation report. */
export const TRANSLATION_REPORT_HEADERS = [
  'status',
  'updated_at',
  'record_id',
  'title',
  'edit_url',
  'source_locale',
  'target_locales',
  'translated_field_api_keys',
  'translated_field_ids',
  'copied_link_field_api_keys',
  'copied_link_field_ids',
  'notes',
  'item_type_id',
  'record_index',
] as const;

/** Options for building report rows. */
export interface TranslationReportOptions {
  fromLocale: string;
  toLocales: string[];
  /** Resolves a record's editor URL for the `edit_url` column. */
  buildUrl: (update: ProgressUpdate) => string | undefined;
}

/**
 * Maps the per-record progress updates to a CSV status token.
 */
function reportStatus(update: ProgressUpdate): string | null {
  if (update.status === 'error') return 'failure';
  // The bulk emitter reports every warned success — a QC warning-severity flag
  // or a copied linked reference — as `completed-with-warnings`, so it must map
  // to a `warning` row or the record would be silently dropped from the report
  // (the "which records warned and why" data the report exists to surface).
  if (update.status === 'completed-with-warnings') return 'warning';
  if (update.status === 'completed') {
    return (update.warnings?.length ?? 0) > 0 ? 'warning' : 'success';
  }
  return null; // in-progress records are not reported
}

/**
 * Builds the header list and per-record rows for the translation report CSV.
 * In-progress updates are skipped so a mid-run export only lists finished work.
 *
 * @param updates - The (deduped) per-record progress updates.
 * @param opts - Locale context and a record URL builder.
 * @returns Headers plus one row per finished record.
 */
export function buildTranslationReportRows(
  updates: ProgressUpdate[],
  opts: TranslationReportOptions,
): { headers: string[]; rows: string[][] } {
  const targetLocales = opts.toLocales.join(', ');
  const rows: string[][] = [];

  for (const update of updates) {
    const status = reportStatus(update);
    if (!status) continue;
    rows.push([
      status,
      update.updatedAt ?? '',
      update.recordId,
      update.recordLabel ?? '',
      opts.buildUrl(update) ?? '',
      opts.fromLocale,
      targetLocales,
      (update.translatedFieldApiKeys ?? []).join(', '),
      (update.translatedFieldIds ?? []).join(', '),
      (update.copiedLinkFieldApiKeys ?? []).join(', '),
      (update.copiedLinkFieldIds ?? []).join(', '),
      (update.warnings ?? []).join(' | '),
      update.itemTypeId ?? '',
      String(update.recordIndex),
    ]);
  }

  return { headers: [...TRANSLATION_REPORT_HEADERS], rows };
}

/**
 * Triggers a browser download of CSV text. Prepends a UTF-8 BOM so spreadsheet
 * apps read non-ASCII (accents, CJK) correctly. Falls back to opening the CSV
 * in a new tab if the sandbox blocks the download attribute.
 *
 * @param filename - Suggested file name.
 * @param csv - CSV document text (without BOM).
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    window.open(url, '_blank', 'noopener');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
