import { describe, expect, it, vi } from 'vitest';
import {
  confirmTranslationTitle,
  discoveryStatus,
  fieldCountHint,
  modelCount,
  recordCount,
  reportTranslationOutcome,
  runSummary,
  TRANSLATION_CANCELED_NOTICE,
  TRANSLATION_FAILED_ALERT,
  targetLocaleCount,
  translatedRecordsNotice,
  translateRecordsLabel,
} from './bulkCopy';

const n = (count: number) => count.toLocaleString();

describe('bulkCopy counts', () => {
  it('uses the singular only for exactly one', () => {
    expect(recordCount(1)).toBe('1 record');
    expect(recordCount(0)).toBe('0 records');
    expect(modelCount(1)).toBe('1 model');
    expect(modelCount(2)).toBe('2 models');
    expect(targetLocaleCount(1)).toBe('1 target locale');
    expect(targetLocaleCount(3)).toBe('3 target locales');
  });

  it('formats large counts with toLocaleString', () => {
    expect(recordCount(2882)).toBe(`${n(2882)} records`);
    expect(translateRecordsLabel(2882)).toBe(`Translate ${n(2882)} records`);
    expect(confirmTranslationTitle(2882)).toBe(`Translate ${n(2882)} records?`);
  });

  it('builds titles, labels and the toolbar summary', () => {
    expect(translateRecordsLabel(1)).toBe('Translate 1 record');
    expect(confirmTranslationTitle(1)).toBe('Translate 1 record?');
    expect(runSummary(2, 4)).toBe('2 models · 4 target locales');
    expect(runSummary(1, 1)).toBe('1 model · 1 target locale');
  });

  it('phrases the completion notice', () => {
    expect(translatedRecordsNotice(1)).toBe(
      'One record successfully translated!',
    );
    expect(translatedRecordsNotice(2882)).toBe(
      `${n(2882)} records successfully translated!`,
    );
  });

  it('builds the field count hint', () => {
    expect(fieldCountHint(5, 7)).toBe('5 of 7 translatable fields selected');
    expect(fieldCountHint(1, 1)).toBe('1 of 1 translatable field selected');
    expect(fieldCountHint(0, 1)).toBe('0 of 1 translatable field selected');
    expect(fieldCountHint(1200, 1500)).toBe(
      `${n(1200)} of ${n(1500)} translatable fields selected`,
    );
  });
});

describe('discoveryStatus', () => {
  it('counts while the total is unknown and nothing is loaded', () => {
    expect(discoveryStatus({ loaded: 0 })).toBe('Counting records…');
  });

  it('shows the running count while the total is unknown', () => {
    expect(discoveryStatus({ loaded: 1 })).toBe('1 record found…');
    expect(discoveryStatus({ loaded: 1500 })).toBe(`${n(1500)} records found…`);
  });

  it('shows loaded of total once the total is known', () => {
    expect(discoveryStatus({ loaded: 500, total: 2882 })).toBe(
      `${n(500)} of ${n(2882)} records found`,
    );
    expect(discoveryStatus({ loaded: 0, total: 0 })).toBe(
      '0 of 0 records found',
    );
  });
});

describe('reportTranslationOutcome', () => {
  function makeCtx() {
    // Never-resolving promises prove the reporter doesn't await them.
    return {
      notice: vi.fn(() => new Promise<void>(() => {})),
      alert: vi.fn(() => new Promise<void>(() => {})),
    };
  }

  it('notices a canceled run', () => {
    const ctx = makeCtx();
    expect(
      reportTranslationOutcome(ctx, { canceled: true, completed: true }, 3),
    ).toBeUndefined();
    expect(ctx.notice).toHaveBeenCalledWith(TRANSLATION_CANCELED_NOTICE);
    expect(ctx.alert).not.toHaveBeenCalled();
  });

  it('notices a completed run with the record count', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(ctx, { completed: true }, 2882);
    expect(ctx.notice).toHaveBeenCalledWith(
      `${n(2882)} records successfully translated!`,
    );
    expect(ctx.alert).not.toHaveBeenCalled();
  });

  it('reports partial failures and unprocessed records from cumulative counts', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(
      ctx,
      {
        summary: {
          totalRecords: 200000,
          processedCount: 125,
          successfulCount: 120,
          failedCount: 5,
          warningCount: 0,
          loadedCount: 150,
        },
      },
      200000,
    );
    expect(ctx.alert).toHaveBeenCalledWith(
      `120 records completed; 5 records failed; ${n(199875)} records were not processed.`,
    );
    expect(ctx.notice).not.toHaveBeenCalled();
  });

  it('retains the saved outcome when the user cancels a partial run', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(
      ctx,
      {
        canceled: true,
        summary: {
          totalRecords: 100,
          processedCount: 6,
          successfulCount: 5,
          failedCount: 1,
          warningCount: 0,
          loadedCount: 30,
        },
      },
      100,
    );
    expect(ctx.notice).toHaveBeenCalledWith(
      'Translation canceled. 5 records completed; 1 record failed. Saved changes were kept.',
    );
  });

  it('does not call records with skipped fields fully translated', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(
      ctx,
      {
        completed: true,
        summary: {
          totalRecords: 10,
          processedCount: 10,
          successfulCount: 10,
          failedCount: 0,
          warningCount: 3,
          loadedCount: 10,
        },
      },
      10,
    );
    expect(ctx.notice).toHaveBeenCalledWith(
      '10 records completed; 3 records need review.',
    );
  });

  it('distinguishes unchanged records from confirmed updates', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(
      ctx,
      {
        completed: true,
        summary: {
          totalRecords: 10,
          processedCount: 10,
          successfulCount: 10,
          failedCount: 0,
          warningCount: 0,
          loadedCount: 10,
          updatedCount: 2,
        },
      },
      10,
    );
    expect(ctx.notice).toHaveBeenCalledWith(
      '2 records updated; 8 records had no eligible fields to translate.',
    );
  });

  it('alerts when the run had errors or returned nothing', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(ctx, {}, 3);
    reportTranslationOutcome(ctx, undefined, 3);
    expect(ctx.alert).toHaveBeenCalledTimes(2);
    expect(ctx.alert).toHaveBeenCalledWith(TRANSLATION_FAILED_ALERT);
    expect(ctx.notice).not.toHaveBeenCalled();
  });
});
