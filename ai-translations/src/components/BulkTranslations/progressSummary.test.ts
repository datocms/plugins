import { describe, expect, it } from 'vitest';
import type { ProgressUpdate } from '../../utils/translation/ItemsDropdownUtils';
import { summarizeBulkProgress } from './progressSummary';

/** Minimal ProgressUpdate factory for the counting tests. */
const u = (
  recordIndex: number,
  status: ProgressUpdate['status'],
): ProgressUpdate => ({ recordIndex, recordId: `r${recordIndex}`, status });

describe('summarizeBulkProgress', () => {
  it('splits finished records into three mutually-exclusive status buckets', () => {
    const summary = summarizeBulkProgress(
      [
        u(0, 'completed'),
        u(1, 'completed'),
        u(2, 'completed-with-warnings'),
        u(3, 'error'),
      ],
      4,
    );
    expect(summary.successfulCount).toBe(2);
    expect(summary.withWarningsCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    // completedCount is exactly the sum of the buckets — counters and percent
    // can never disagree.
    expect(summary.completedCount).toBe(4);
    expect(summary.percentComplete).toBe(100);
  });

  it('does not count in-progress records as finished', () => {
    const summary = summarizeBulkProgress(
      [u(0, 'completed'), u(1, 'processing')],
      2,
    );
    expect(summary.completedCount).toBe(1);
    expect(summary.percentComplete).toBe(50);
  });

  it('excludes the synthetic fatal-error entry (recordIndex -1) from counts', () => {
    // A whole-run failure emits an error entry at recordIndex -1. It must not be
    // counted, or the percent would exceed 100% and the modal would falsely flip
    // to "completed".
    const summary = summarizeBulkProgress(
      [u(0, 'completed'), u(1, 'completed'), u(-1, 'error')],
      2,
    );
    expect(summary.failedCount).toBe(0);
    expect(summary.completedCount).toBe(2);
    expect(summary.percentComplete).toBe(100);
  });

  it('clamps percent to 100 even if extra updates slip in', () => {
    const summary = summarizeBulkProgress(
      [u(0, 'completed'), u(1, 'completed'), u(2, 'error')],
      2,
    );
    expect(summary.completedCount).toBe(3);
    expect(summary.percentComplete).toBe(100);
  });

  it('returns 0% when there are no records to translate', () => {
    expect(summarizeBulkProgress([], 0)).toMatchObject({
      completedCount: 0,
      percentComplete: 0,
    });
  });
});
