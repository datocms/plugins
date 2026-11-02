import { describe, expect, it, vi } from 'vitest';
import {
  confirmTranslationTitle,
  discoveryStatus,
  fieldCountHint,
  formatCount,
  localeCount,
  modelCount,
  PICK_FIELD_ERROR,
  PICK_LOCALE_ERROR,
  PICK_MODEL_ERROR,
  recordCount,
  recordCountWas,
  reportTranslationOutcome,
  TRANSLATION_CANCELED_NOTICE,
  TRANSLATION_FAILED_ALERT,
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
    expect(localeCount(1)).toBe('1 locale');
    expect(localeCount(3)).toBe('3 locales');
  });

  it('formats large counts with toLocaleString', () => {
    expect(recordCount(2882)).toBe(`${n(2882)} records`);
    expect(translateRecordsLabel(2882)).toBe(`Translate ${n(2882)} records`);
    expect(confirmTranslationTitle(2882)).toBe(`Translate ${n(2882)} records?`);
  });

  it('formats counts in the given UI locale, like the kit', () => {
    expect(formatCount(2882, 'de')).toBe('2.882');
    expect(recordCount(2882, 'de')).toBe('2.882 records');
    expect(translateRecordsLabel(1200, 'de')).toBe('Translate 1.200 records');
    expect(modelCount(1200, 'de')).toBe('1.200 models');
    expect(fieldCountHint(1200, 1500, 'de')).toBe(
      '1.200 of 1.500 translatable fields selected',
    );
    expect(discoveryStatus({ loaded: 1200, total: 1500 }, 'de')).toBe(
      '1.200 of 1.500 records found',
    );
    // The texts are English: the singular is for exactly one.
    expect(recordCount(1, 'fr')).toBe('1 record');
    expect(recordCount(0, 'fr')).toBe('0 records');
  });

  it('falls back to the default locale for an invalid language tag', () => {
    expect(formatCount(2882, 'not a locale')).toBe(n(2882));
  });

  it('builds titles and labels', () => {
    expect(translateRecordsLabel(1)).toBe('Translate 1 record');
    expect(confirmTranslationTitle(1)).toBe('Translate 1 record?');
  });

  it('phrases the completion notice', () => {
    expect(translatedRecordsNotice(1)).toBe('1 record translated.');
    expect(translatedRecordsNotice(2882)).toBe(
      `${n(2882)} records translated.`,
    );
    expect(translatedRecordsNotice(2882, 'de')).toBe(
      '2.882 records translated.',
    );
  });

  it('agrees the verb with a count of records', () => {
    expect(recordCountWas(1)).toBe('1 record was');
    expect(recordCountWas(0)).toBe('0 records were');
    expect(recordCountWas(1500, 'de')).toBe('1.500 records were');
  });

  it('builds the field count hint', () => {
    expect(fieldCountHint(5, 7)).toBe('5 of 7 translatable fields selected');
    expect(fieldCountHint(1, 1)).toBe('1 of 1 translatable field selected');
    expect(fieldCountHint(0, 1)).toBe('0 of 1 translatable field selected');
    expect(fieldCountHint(1200, 1500)).toBe(
      `${n(1200)} of ${n(1500)} translatable fields selected`,
    );
  });

  it('names what to pick in the validation errors', () => {
    expect(PICK_LOCALE_ERROR).toBe('Pick at least one locale');
    expect(PICK_MODEL_ERROR).toBe('Pick at least one model');
    expect(PICK_FIELD_ERROR).toBe('Pick at least one field');
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
      customToast: vi.fn(() => new Promise<unknown>(() => {})),
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
    expect(ctx.notice).toHaveBeenCalledWith(`${n(2882)} records translated.`);
    expect(ctx.alert).not.toHaveBeenCalled();
  });

  it('formats the counts in the given UI locale', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(ctx, { completed: true }, 2882, 'de');
    expect(ctx.notice).toHaveBeenCalledWith('2.882 records translated.');
    reportTranslationOutcome(
      ctx,
      {
        summary: {
          totalRecords: 200000,
          processedCount: 1500,
          successfulCount: 1499,
          failedCount: 1,
          warningCount: 0,
          loadedCount: 1500,
        },
      },
      200000,
      'de',
    );
    expect(ctx.alert).toHaveBeenCalledWith(
      '1.499 records translated. 1 failed. The translation stopped before the other 198.500.',
    );
  });

  it('agrees the verbs at a count of one', () => {
    const ctx = makeCtx();
    reportTranslationOutcome(
      ctx,
      {
        summary: {
          totalRecords: 3,
          processedCount: 2,
          successfulCount: 2,
          failedCount: 0,
          warningCount: 0,
          loadedCount: 3,
        },
      },
      3,
    );
    // The count of zero stays out of the toast.
    expect(ctx.alert).toHaveBeenCalledWith(
      '2 records translated. The translation stopped before the last one.',
    );
    // A run that stopped before any record says how many it never reached.
    reportTranslationOutcome(
      ctx,
      {
        summary: {
          totalRecords: 12,
          processedCount: 0,
          successfulCount: 0,
          failedCount: 0,
          warningCount: 0,
          loadedCount: 0,
        },
      },
      12,
    );
    expect(ctx.alert).toHaveBeenCalledWith(
      'The translation stopped before translating 12 records.',
    );
    reportTranslationOutcome(
      ctx,
      {
        completed: true,
        summary: {
          totalRecords: 3,
          processedCount: 3,
          successfulCount: 3,
          failedCount: 0,
          warningCount: 1,
          loadedCount: 3,
        },
      },
      3,
    );
    expect(ctx.customToast).toHaveBeenCalledWith({
      type: 'warning',
      message: '3 records translated, 1 with warnings.',
      dismissOnPageChange: true,
    });
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
      `120 records translated. 5 failed. The translation stopped before the other ${n(199875)}.`,
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
      'Translation cancelled. 5 records were translated and saved.',
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
    expect(ctx.customToast).toHaveBeenCalledWith({
      type: 'warning',
      message: '10 records translated, 3 with warnings.',
      dismissOnPageChange: true,
    });
    expect(ctx.notice).not.toHaveBeenCalled();
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
      '2 records translated. 8 had nothing to translate.',
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
