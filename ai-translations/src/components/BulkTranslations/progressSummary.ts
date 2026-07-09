import type { ProgressUpdate } from '../../utils/translation/ItemsDropdownUtils';

/** Counters + percent driving the bulk progress modal's header. */
export interface BulkProgressSummary {
  /** Terminal (finished) real records: successful + with-warnings + failed. */
  completedCount: number;
  /** Clean successes (`completed`). */
  successfulCount: number;
  /** Successes flagged with warnings (`completed-with-warnings`). */
  withWarningsCount: number;
  /** Failures (`error`), including records escalated by an error-severity QC flag. */
  failedCount: number;
  /** `completedCount / totalRecords`, rounded and clamped to [0, 100]. */
  percentComplete: number;
}

/**
 * Derives the modal's three mutually-exclusive status buckets and the progress
 * percent from the per-record updates.
 *
 * The synthetic fatal-error entry (recordIndex `-1`, emitted when the whole run
 * throws) is excluded from every count: it would otherwise push the processed
 * total past `totalRecords`, flip the percent past 100%, and falsely flip the
 * modal to "completed". `completedCount` is the sum of the three buckets, so the
 * counters and the percent can never disagree.
 *
 * @param updates - Deduped per-record progress updates.
 * @param totalRecords - The number of records the run set out to translate.
 * @returns The counters and clamped percent for the header.
 */
export function summarizeBulkProgress(
  updates: ProgressUpdate[],
  totalRecords: number,
): BulkProgressSummary {
  const realRecords = updates.filter((update) => update.recordIndex >= 0);
  const successfulCount = realRecords.filter(
    (update) => update.status === 'completed',
  ).length;
  const withWarningsCount = realRecords.filter(
    (update) => update.status === 'completed-with-warnings',
  ).length;
  const failedCount = realRecords.filter(
    (update) => update.status === 'error',
  ).length;
  const completedCount = successfulCount + withWarningsCount + failedCount;
  const percentComplete =
    totalRecords > 0
      ? Math.min(100, Math.round((completedCount / totalRecords) * 100))
      : 0;

  return {
    completedCount,
    successfulCount,
    withWarningsCount,
    failedCount,
    percentComplete,
  };
}
