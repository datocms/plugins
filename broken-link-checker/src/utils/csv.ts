import type { ResolvedItemPresentationInfo } from 'datocms-plugin-sdk';
import type { ScanReport } from '../types';

function cell(value: string) {
  // Keep spreadsheet applications from interpreting content as a formula.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The title of each record by its ID, as DatoCMS presents it. */
export type RecordTitles = ReadonlyMap<string, string>;

const NO_TITLES: RecordTitles = new Map();

/** The IDs of the records that the report names, once each, in report order. */
export function reportRecordIds(report: ScanReport): string[] {
  const ids = new Set<string>();
  for (const group of report.groups) {
    for (const { recordId } of group.occurrences) {
      if (recordId !== undefined) ids.add(recordId);
    }
  }
  return [...ids];
}

/** Records asked of the host in one call: a large report asks in steps. */
const TITLES_PER_CALL = 500;

/**
 * The titles of the records, from the host (`ctx.loadItemPresentationInfo`):
 * the same titles that DatoCMS shows. A record that is gone has no title.
 */
export async function loadRecordTitles(
  ids: readonly string[],
  load: (
    ids: string[],
  ) => Promise<
    Array<Pick<ResolvedItemPresentationInfo, 'id' | 'title'> | null>
  >,
): Promise<RecordTitles> {
  const titles = new Map<string, string>();
  for (let start = 0; start < ids.length; start += TITLES_PER_CALL) {
    // biome-ignore lint/performance/noAwaitInLoops: one step at a time keeps each request to the host small.
    const infos = await load(ids.slice(start, start + TITLES_PER_CALL));
    for (const info of infos) if (info) titles.set(info.id, info.title);
  }
  return titles;
}

/** One row at a time: exports must not hold a second matrix of all locations. */
export function* reportCsvRows(
  report: ScanReport,
  titles: RecordTitles = NO_TITLES,
): Generator<string> {
  yield `\uFEFF${[
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
  ]
    .map(cell)
    .join(',')}\r\n`;
  for (const group of report.groups) {
    for (const occurrence of group.occurrences) {
      yield `${[
        occurrence.url,
        group.result.status,
        String(group.result.httpStatus ?? ''),
        group.result.message,
        group.result.checkedAt ?? '',
        (occurrence.recordId && titles.get(occurrence.recordId)) ?? '',
        occurrence.recordId ?? '',
        occurrence.modelName,
        occurrence.fieldLabel,
        occurrence.locale ?? '',
        occurrence.blockPath.join(' → '),
        group.stale ? 'Yes' : 'No',
        report.state,
      ]
        .map(cell)
        .join(',')}\r\n`;
    }
  }
}

/** For callers needing text; the browser download uses bounded chunks below. */
export function reportCsv(
  report: ScanReport,
  titles: RecordTitles = NO_TITLES,
): string {
  return [...reportCsvRows(report, titles)].join('');
}

const CSV_CHUNK_ROWS = 1_000;
const CSV_CHUNK_CHARACTERS = 256 * 1_024;
const CSV_TYPE = 'text/csv;charset=utf-8';

const yieldToBrowser = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Encode chunks immediately, yielding between them so checking, progress and
 * cancellation keep running. Blob parts avoid a full-sized CSV JS string;
 * the browser still needs enough storage for the downloaded file itself.
 * An individual oversized row is encoded on its own.
 */
export async function reportBlob(
  report: ScanReport,
  titles: RecordTitles = NO_TITLES,
  yieldWork: () => Promise<void> = yieldToBrowser,
): Promise<Blob> {
  const parts: Blob[] = [];
  let rows: string[] = [];
  let characters = 0;
  const append = () => {
    parts.push(new Blob([rows.join('')], { type: CSV_TYPE }));
    rows = [];
    characters = 0;
  };
  for (const row of reportCsvRows(report, titles)) {
    if (rows.length > 0 && characters + row.length > CSV_CHUNK_CHARACTERS) {
      append();
      // biome-ignore lint/performance/noAwaitInLoops: sequential encoding keeps only one text chunk in memory.
      await yieldWork();
    }
    rows.push(row);
    characters += row.length;
    if (rows.length < CSV_CHUNK_ROWS && characters < CSV_CHUNK_CHARACTERS)
      continue;
    append();
    await yieldWork();
  }
  if (rows.length > 0) append();
  return new Blob(parts, { type: CSV_TYPE });
}

export async function downloadReport(
  report: ScanReport,
  titles: RecordTitles = NO_TITLES,
): Promise<void> {
  const blob = await reportBlob(report, titles);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `broken-links-${report.startedAt.slice(0, 10)}.csv`;
    anchor.click();
  } finally {
    // Clean up even if the browser prevents the download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
