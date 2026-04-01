import { describe, expect, it } from 'vitest';
import { toAutomaticBackupsScheduleState } from './automaticBackupsScheduleState';

describe('toAutomaticBackupsScheduleState', () => {
  it('returns empty state when value is not an object', () => {
    expect(toAutomaticBackupsScheduleState(undefined)).toEqual({});
    expect(toAutomaticBackupsScheduleState(null)).toEqual({});
    expect(toAutomaticBackupsScheduleState('invalid')).toEqual({});
  });

  it('normalizes and trims cadence maps and error fields', () => {
    const parsed = toAutomaticBackupsScheduleState({
      lastRunLocalDateByCadence: {
        daily: ' 2026-02-27 ',
        weekly: '   ',
        invalid: '2026-02-27',
      },
      lastRunAtByCadence: {
        daily: ' 2026-02-27T02:05:00.000Z ',
      },
      lastDailyError: ' failed ',
    });

    expect(parsed.lastRunLocalDateByCadence).toEqual({
      daily: '2026-02-27',
    });
    expect(parsed.lastRunAtByCadence).toEqual({
      daily: '2026-02-27T02:05:00.000Z',
    });
    expect(parsed.lastDailyError).toBe('failed');
  });
});
