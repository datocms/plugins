import { describe, expect, it } from 'vitest';
import { createCopy } from './copy';
import { makeTotals, runEndedEvent } from './testing/fixtures';
import { createMockCtx } from './testing/mockCtx';
import { runToast, showRunToast } from './toasts';

const copy = createCopy('en');

describe('runToast', () => {
  it('stopped: a warning with the matches replaced, as the meta counts them, no CTA', () => {
    expect(
      runToast(
        runEndedEvent({
          stopped: true,
          pass: makeTotals({
            replacedRecords: 3,
            plannedRecords: 10,
            replacedMatches: 17,
            plannedMatches: 36,
          }),
        }),
        copy,
      ),
    ).toEqual({
      kind: 'custom',
      toast: {
        type: 'warning',
        message: 'Replacement stopped: 17 of 36 matches replaced.',
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
    ).toEqual({ kind: 'notice', message: 'One match replaced' });
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
      message: '1,200 matches removed',
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
        "Couldn't replace the matches, as your role can't edit these records.",
    });
  });

  it('skipped only: a warning, without a button (the title bar has "Search again")', () => {
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
        message: 'One match replaced, 1 record skipped.',
        dismissOnPageChange: true,
      },
    });
    expect(skipped(0, 3, 3)).toMatchObject({
      toast: {
        message: 'No matches replaced, 3 records skipped.',
      },
    });
    expect(skipped(115, 3, 1)).toMatchObject({
      toast: { message: '115 matches replaced, 3 records skipped.' },
    });
  });

  it('failed only: an alert in the words of the meta, without a button', () => {
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
        message: '119 matches replaced, 2 records failed.',
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
        message: '4 matches replaced, 1 record failed.',
        dismissOnPageChange: true,
      },
    });
  });

  it('skipped and failed: an alert in the words of the meta, without a button', () => {
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
        message: '100 matches replaced, 3 records skipped, 2 failed.',
        dismissOnPageChange: true,
      },
    });
    expect(both(0)).toEqual(both(1));
  });
});

describe('showRunToast', () => {
  it('calls the matching host method once', async () => {
    const mock = createMockCtx();
    await showRunToast(mock.ctx, { kind: 'notice', message: 'Done!' });
    await showRunToast(mock.ctx, { kind: 'alert', message: 'No!' });
    await showRunToast(mock.ctx, {
      kind: 'custom',
      toast: { type: 'alert', message: 'Hm', dismissOnPageChange: true },
    });
    expect(mock.notice).toHaveBeenCalledTimes(1);
    expect(mock.alert).toHaveBeenCalledTimes(1);
    expect(mock.customToast).toHaveBeenCalledTimes(1);
  });

  it('ignores a host call that fails', async () => {
    const mock = createMockCtx();
    mock.customToast.mockRejectedValueOnce(new Error('gone'));
    await expect(
      showRunToast(mock.ctx, {
        kind: 'custom',
        toast: { type: 'warning', message: 'x' },
      }),
    ).resolves.toBeUndefined();
  });
});
