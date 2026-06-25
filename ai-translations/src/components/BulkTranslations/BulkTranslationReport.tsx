/**
 * End-of-run bulk-translation report panel: a complete, scrollable table of
 * every flagged record/field/locale with its reason, plus copy + CSV/JSON
 * export. Replaces the previous one-shot alert that capped at 20 rows and was
 * discarded on dismiss — this is the customer's "report of which records failed
 * and why". Presentational and ctx-free: it operates purely on report rows.
 */

import { useMemo } from 'react';
import { downloadTextFile } from '../../utils/downloadTextFile';
import {
  type BulkReportRow,
  toBulkReportCsv,
  toBulkReportJson,
} from '../../utils/translation/bulkReport';
import s from './BulkTranslationReport.module.css';

type Props = {
  rows: BulkReportRow[];
  onClose: () => void;
  /** Optional toast/notice after a successful copy (e.g. `ctx.notice`). */
  onCopied?: (message: string) => void;
};

export function BulkTranslationReport({ rows, onClose, onCopied }: Props) {
  const csv = useMemo(() => toBulkReportCsv(rows), [rows]);
  const json = useMemo(() => toBulkReportJson(rows), [rows]);
  const recordCount = useMemo(
    () => new Set(rows.map((r) => r.recordId)).size,
    [rows],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(csv);
      onCopied?.('Report copied to clipboard');
    } catch {
      // Clipboard access can be blocked in the iframe; downloads still work.
    }
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
          <button type="button" className={s.btn} onClick={handleCopy}>
            Copy
          </button>
          <button
            type="button"
            className={s.btn}
            onClick={() =>
              downloadTextFile(
                'translation-report.csv',
                'text/csv;charset=utf-8',
                csv,
              )
            }
          >
            Download CSV
          </button>
          <button
            type="button"
            className={s.btn}
            onClick={() =>
              downloadTextFile(
                'translation-report.json',
                'application/json',
                json,
              )
            }
          >
            Download JSON
          </button>
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
                <td>{r.recordId}</td>
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
