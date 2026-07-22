/**
 * End-of-run bulk-translation report panel: a complete, scrollable table of
 * every flagged record/field/locale with its reason, plus copy + CSV/JSON
 * export. Replaces the previous one-shot alert that capped at 20 rows and was
 * discarded on dismiss — this is the customer's "report of which records failed
 * and why". Presentational and ctx-free: it operates purely on report rows.
 */

import {
  Button,
  CaretDownIcon,
  CaretUpIcon,
  Dropdown,
  DropdownMenu,
  DropdownOption,
} from 'datocms-react-ui';
import { useMemo } from 'react';
import { downloadTextFile } from '../../utils/downloadTextFile';
import {
  type BulkReportRow,
  toBulkReportCsv,
  toBulkReportJson,
  toBulkReportPlaintext,
} from '../../utils/translation/bulkReport';
import s from './BulkTranslationReport.module.css';

type Props = {
  /**
   * Report rows, each optionally carrying a `machineReadableStatus` token
   * (filled by `withMachineTokens` from the run's RunState) — the CSV and JSON
   * exports carry it as the machine-readable column.
   */
  rows: BulkReportRow[];
  onClose: () => void;
  /** Optional toast/notice after a successful copy (e.g. `ctx.notice`). */
  onCopied?: (message: string) => void;
};

type ReportFormat = 'plaintext' | 'csv' | 'json';

const FORMAT_META: Record<
  ReportFormat,
  { label: string; filename: string; mime: string }
> = {
  plaintext: {
    label: 'Plaintext',
    filename: 'translation-report.txt',
    mime: 'text/plain;charset=utf-8',
  },
  csv: {
    label: 'CSV',
    filename: 'translation-report.csv',
    mime: 'text/csv;charset=utf-8',
  },
  json: {
    label: 'JSON',
    filename: 'translation-report.json',
    mime: 'application/json',
  },
};

const FORMAT_ORDER: ReportFormat[] = ['plaintext', 'csv', 'json'];

/**
 * Renders the "Record" cell: the editor-friendly title (falling back to the
 * record id) as an editor link when one is available, with the short record id
 * shown muted underneath so it stays visible and copyable.
 */
function RecordCell({ row }: { row: BulkReportRow }) {
  const label = row.recordTitle || row.recordId;
  return (
    <div className={s.recordCell}>
      {row.editUrl ? (
        <a
          className={s.recordLink}
          href={row.editUrl}
          target="_blank"
          rel="noreferrer"
          title={row.recordId}
        >
          {label}
        </a>
      ) : (
        <span className={s.recordLabel} title={row.recordId}>
          {label}
        </span>
      )}
      {row.recordTitle ? (
        <span className={s.recordId}>{row.recordId}</span>
      ) : null}
    </div>
  );
}

export function BulkTranslationReport({ rows, onClose, onCopied }: Props) {
  // CSV/JSON carry the human report plus each row's machine-readable token
  // (already on the rows); Plaintext is the human summary.
  const contentFor = useMemo(() => {
    const csv = toBulkReportCsv(rows);
    const json = toBulkReportJson(rows);
    const plaintext = toBulkReportPlaintext(rows);
    return (format: ReportFormat): string =>
      format === 'plaintext' ? plaintext : format === 'csv' ? csv : json;
  }, [rows]);

  const recordCount = useMemo(
    () => new Set(rows.map((r) => r.recordId)).size,
    [rows],
  );

  const handleCopy = async (format: ReportFormat) => {
    try {
      await navigator.clipboard?.writeText(contentFor(format));
      onCopied?.(`Report copied as ${FORMAT_META[format].label}`);
    } catch {
      // Clipboard access can be blocked in the iframe; the Export menu still works.
    }
  };

  const handleExport = (format: ReportFormat) => {
    const { filename, mime } = FORMAT_META[format];
    downloadTextFile(filename, mime, contentFor(format));
  };

  return (
    <div className={s.report} role="region" aria-label="Bulk translation report">
      <div className={s.header}>
        <div className={s.title}>
          {rows.length} issue{rows.length === 1 ? '' : 's'} across {recordCount}{' '}
          record{recordCount === 1 ? '' : 's'} — review before relying on these
          translations
        </div>
        <div className={s.actions}>
          <Dropdown
            renderTrigger={({ open, onClick }) => (
              <Button
                type="button"
                buttonSize="s"
                onClick={onClick}
                rightIcon={open ? <CaretUpIcon /> : <CaretDownIcon />}
              >
                Copy report as
              </Button>
            )}
          >
            <DropdownMenu>
              {FORMAT_ORDER.map((format) => (
                <DropdownOption
                  key={format}
                  onClick={() => void handleCopy(format)}
                >
                  {FORMAT_META[format].label}
                </DropdownOption>
              ))}
            </DropdownMenu>
          </Dropdown>
          <Dropdown
            renderTrigger={({ open, onClick }) => (
              <Button
                type="button"
                buttonSize="s"
                onClick={onClick}
                rightIcon={open ? <CaretUpIcon /> : <CaretDownIcon />}
              >
                Export report as
              </Button>
            )}
          >
            <DropdownMenu>
              {FORMAT_ORDER.map((format) => (
                <DropdownOption key={format} onClick={() => handleExport(format)}>
                  {FORMAT_META[format].label}
                </DropdownOption>
              ))}
            </DropdownMenu>
          </Dropdown>
          <button
            type="button"
            className={s.btnGhost}
            onClick={onClose}
            aria-label="Close report"
          >
            Close
          </button>
        </div>
      </div>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Record</th>
              <th>Field</th>
              <th>Locale</th>
              <th>Severity</th>
              <th>Check</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are append-only and never reordered; the index disambiguates duplicate (record, field, check) tuples.
                key={`${r.recordId}-${r.fieldPath}-${r.checkId}-${i}`}
                className={r.severity === 'error' ? s.rowError : s.rowWarning}
              >
                <td>
                  <RecordCell row={r} />
                </td>
                <td>{r.fieldPath || '—'}</td>
                <td>{r.locale || '—'}</td>
                <td>{r.severity || '—'}</td>
                <td>{r.checkId || '—'}</td>
                <td className={s.reason}>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
