/**
 * Pure projections of a RunState for the resume UI (persistence spec §5): a
 * per-model progress summary ("8 of 20 translated, 12 remaining") and the
 * selection needed to repopulate the bulk picker. Both are derived, no I/O.
 */
import type { RunState } from './runState';

/** Per-model rollup of a run's progress. */
export interface ModelResumeSummary {
  itemTypeId: string;
  totalRecords: number;
  /** Records with no unfinished unit (every unit is `written`). */
  completedRecords: number;
  totalUnits: number;
  writtenUnits: number;
  remainingUnits: number;
}

/** Whole-run resume summary: per-model rollups plus totals and the resume point. */
export interface RunResumeSummary {
  models: ModelResumeSummary[];
  totalUnits: number;
  writtenUnits: number;
  remainingUnits: number;
  /** First record (in run order) still carrying unfinished work; absent when done. */
  resumeFromRecordId?: string;
}

const UNKNOWN_MODEL = 'unknown';

/**
 * Rolls a RunState up per model. A unit counts as done only when its bucket is
 * `written`; everything else (`blocked`, `not-attempted`, `written-unverified`)
 * is remaining — matching what a resume actually re-runs.
 */
export function summarizeRunByModel(state: RunState): RunResumeSummary {
  const byModel = new Map<string, ModelResumeSummary>();
  let totalUnits = 0;
  let writtenUnits = 0;
  let resumeFromRecordId: string | undefined;

  for (const record of state.records) {
    const key = record.itemTypeId ?? UNKNOWN_MODEL;
    const model =
      byModel.get(key) ??
      {
        itemTypeId: key,
        totalRecords: 0,
        completedRecords: 0,
        totalUnits: 0,
        writtenUnits: 0,
        remainingUnits: 0,
      };

    const recordWritten = record.units.filter((u) => u.bucket === 'written').length;
    const recordRemaining = record.units.length - recordWritten;

    model.totalRecords += 1;
    model.totalUnits += record.units.length;
    model.writtenUnits += recordWritten;
    model.remainingUnits += recordRemaining;
    if (recordRemaining === 0) model.completedRecords += 1;
    byModel.set(key, model);

    totalUnits += record.units.length;
    writtenUnits += recordWritten;
    if (recordRemaining > 0 && resumeFromRecordId === undefined) {
      resumeFromRecordId = record.recordId;
    }
  }

  return {
    models: [...byModel.values()],
    totalUnits,
    writtenUnits,
    remainingUnits: totalUnits - writtenUnits,
    resumeFromRecordId,
  };
}

/** The bulk-picker selection a run was launched with, for a faithful restore. */
export interface RestoredSelection {
  fromLocale: string;
  toLocales: string[];
  itemIds: string[];
  selectedFieldsByModel: Record<string, string[]>;
}

/**
 * Projects a RunState back into the picker's selection state. The record set is
 * the full original selection (every seeded record, done or not), NOT just the
 * resumable units — the run narrows to those separately. Legacy artifacts with
 * no persisted field allowlist fall back to an empty map (⇒ "all fields").
 */
export function restoreSelectionFromRunState(state: RunState): RestoredSelection {
  return {
    fromLocale: state.fromLocale,
    toLocales: state.toLocales,
    itemIds: state.records.map((r) => r.recordId),
    selectedFieldsByModel: state.selectedFieldsByModel ?? {},
  };
}
