import { describe, expect, it } from 'vitest';
import { createCopy } from './copy';
import { makeTotals, runEndedEvent } from './testing/fixtures';
import { createMockCtx } from './testing/renderPage';
import { runToast, showRunToast } from './toasts';

const copy = createCopy('en');

describe('runToast', () => {
  it('stopped: a warning with the records updated, no CTA', () => {
    expect(
      runToast(
        runEndedEvent({
          stopped: true,
          pass: makeTotals({ replacedRecords: 18, plannedRecords: 37 }),
        }),
        copy,
      ),
    ).toEqual({
      kind: 'custom',
      toast: {
        type: 'warning',
        message: 'Replacement stopped: 18 of 37 records updated.',
        dismissOnPageChange: true,
      },
    });
  });

  it('everything written: a notice', () => {
    expect(
      runToast(
        runEndedEvent({ pass: makeTotals({ replacedMatches: 1 }) }),
        copy,
      ),
    ).toEqual({ kind: 'notice', message: 'One match successfully replaced!' });
    expect(
      runToast(
        runEndedEvent({
          verb: 'remove',
          pass: makeTotals({ replacedMatches: 1200 }),
        }),
        copy,
      ),
    ).toEqual({
      kind: 'notice',
      message: '1,200 matches successfully removed!',
    });
  });

  it('nothing written because of permissions: an alert', () => {
    expect(
      runToast(
        runEndedEvent({
          allFailedCause: 'permission',
          pass: makeTotals({ failedRecords: 3 }),
        }),
        copy,
      ),
    ).toEqual({
      kind: 'alert',
      message:
        "Couldn't replace the matches, as your role can't edit these records!",
    });
  });

  it('skipped only: a warning with "Search again"', () => {
    const skipped = (
      replacedMatches: number,
      skippedRecords: number,
      staleSkippedRecords: number,
    ) =>
      runToast(
        runEndedEvent({
          pass: makeTotals({
            replacedMatches,
            skippedRecords,
            staleSkippedRecords,
          }),
        }),
        copy,
      );
    expect(skipped(1, 1, 1)).toEqual({
      kind: 'custom',
      toast: {
        type: 'warning',
        message:
          'One match replaced, 1 record skipped as it changed after the search.',
        cta: { label: 'Search again', value: 'searchAgain' },
        dismissOnPageChange: true,
      },
    });
    expect(skipped(0, 3, 3)).toMatchObject({
      toast: {
        message:
          'No matches replaced, 3 records skipped as they changed after the search.',
      },
    });
    expect(skipped(115, 3, 1)).toMatchObject({
      toast: { message: '115 matches replaced, 3 records skipped.' },
    });
  });

  it('failed only: an alert with "Try again" when a failure is retryable', () => {
    expect(
      runToast(
        runEndedEvent({
          pass: makeTotals({
            replacedMatches: 119,
            failedRecords: 2,
            retryableFailedRecords: 1,
          }),
        }),
        copy,
      ),
    ).toEqual({
      kind: 'custom',
      toast: {
        type: 'alert',
        message: "119 matches replaced, 2 records couldn't be updated.",
        cta: { label: 'Try again', value: 'retry' },
        dismissOnPageChange: true,
      },
    });
    expect(
      runToast(
        runEndedEvent({
          pass: makeTotals({ replacedMatches: 4, failedRecords: 1 }),
        }),
        copy,
      ),
    ).toEqual({
      kind: 'custom',
      toast: {
        type: 'alert',
        message: "4 matches replaced, 1 record couldn't be updated.",
        dismissOnPageChange: true,
      },
    });
  });

  it('skipped and failed: "Try again" when retryable, else "Search again"', () => {
    const both = (retryableFailedRecords: number) =>
      runToast(
        runEndedEvent({
          pass: makeTotals({
            replacedMatches: 100,
            skippedRecords: 3,
            failedRecords: 2,
            retryableFailedRecords,
          }),
        }),
        copy,
      );
    expect(both(1)).toEqual({
      kind: 'custom',
      toast: {
        type: 'alert',
        message: "100 matches replaced, 5 records weren't updated.",
        cta: { label: 'Try again', value: 'retry' },
        dismissOnPageChange: true,
      },
    });
    expect(both(0)).toMatchObject({
      toast: { cta: { label: 'Search again', value: 'searchAgain' } },
    });
  });
});

describe('showRunToast', () => {
  it('calls the matching host method once and resolves the CTA', async () => {
    const mock = createMockCtx();
    mock.customToast.mockResolvedValueOnce('retry');
    await expect(
      showRunToast(mock.ctx, { kind: 'notice', message: 'Done!' }),
    ).resolves.toBeNull();
    await expect(
      showRunToast(mock.ctx, { kind: 'alert', message: 'No!' }),
    ).resolves.toBeNull();
    await expect(
      showRunToast(mock.ctx, {
        kind: 'custom',
        toast: { type: 'alert', message: 'Hm', dismissOnPageChange: true },
      }),
    ).resolves.toBe('retry');
    expect(mock.notice).toHaveBeenCalledTimes(1);
    expect(mock.alert).toHaveBeenCalledTimes(1);
    expect(mock.customToast).toHaveBeenCalledTimes(1);
  });

  it('resolves null when the host call fails', async () => {
    const mock = createMockCtx();
    mock.customToast.mockRejectedValueOnce(new Error('gone'));
    await expect(
      showRunToast(mock.ctx, {
        kind: 'custom',
        toast: { type: 'warning', message: 'x' },
      }),
    ).resolves.toBeNull();
  });
});
