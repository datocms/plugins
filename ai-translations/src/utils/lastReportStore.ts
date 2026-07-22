/**
 * Persists the most recent bulk-translation report (its rows + the RunState that
 * backs the machine-readable export) to `localStorage`, so the bulk screen can
 * re-show it after a page reload. Best-effort: any storage error is swallowed —
 * a lost report is a convenience miss, never a failure.
 */
import type { BulkReportRow } from './translation/bulkReport';

const KEY = 'datocms-plugin-ai-translations.lastReport';

export interface StoredReport {
  /** Report rows (each may carry its machine-readable token for re-export). */
  rows: BulkReportRow[];
}

/** Minimal `Storage` surface, so tests can inject an in-memory stub. */
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStorage = (): StorageLike | null => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

/** Saves the report as the "last run", overwriting any previous one. */
export function saveLastReport(
  report: StoredReport,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(report));
  } catch {
    // Quota/serialization failure — skip persistence.
  }
}

/** Loads the persisted last-run report, or null when absent/unreadable. */
export function loadLastReport(
  storage: StorageLike | null = defaultStorage(),
): StoredReport | null {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredReport) : null;
  } catch {
    return null;
  }
}

/** Clears the persisted last-run report. */
export function clearLastReport(
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}
