import { describe, expect, it } from 'vitest';
import { toAutomaticBackupsScheduleState } from './automaticBackupsScheduleState';

describe('toAutomaticBackupsScheduleState', () => {
  it('returns empty state when value is not an object', () => {
    expect(toAutomaticBackupsScheduleState(undefined)).toEqual({});
    expect(toAutomaticBackupsScheduleState(null)).toEqual({});
    expect(toAutomaticBackupsScheduleState('invalid')).toEqual({});
    expect(toAutomaticBackupsScheduleState(['invalid'])).toEqual({});
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

  it('drops invalid dates, timestamps, maps and execution modes while preserving valid legacy fields', () => {
    const parsed = toAutomaticBackupsScheduleState({
      lastRunLocalDateByCadence: { daily: '2026-02-30', monthly: '2028-02-29' },
      lastRunAtByCadence: {
        daily: 'invalid',
        weekly: '2026-02-27T02:05:00.000Z',
      },
      lastManagedEnvironmentIdByCadence: ['main'],
      lastExecutionModeByCadence: { daily: 'browser', weekly: ' lambda_cron ' },
      dailyLastRunDate: '2026-13-01',
      lastDailyRunAt: 'invalid',
      lastWeeklyRunAt: ' 2026-02-27T02:05:00.000Z ',
      lastDailyManagedEnvironmentId: ' backup-plugin-daily-2026-02-27 ',
      futureCompatibleKey: { preserve: true },
    });

    expect(parsed.lastRunLocalDateByCadence).toEqual({ monthly: '2028-02-29' });
    expect(parsed.lastRunAtByCadence).toEqual({
      weekly: '2026-02-27T02:05:00.000Z',
    });
    expect(parsed.lastManagedEnvironmentIdByCadence).toBeUndefined();
    expect(parsed.lastExecutionModeByCadence).toEqual({
      weekly: 'lambda_cron',
    });
    expect(parsed.dailyLastRunDate).toBeUndefined();
    expect(parsed.lastDailyRunAt).toBeUndefined();
    expect(parsed.lastWeeklyRunAt).toBe('2026-02-27T02:05:00.000Z');
    expect(parsed.lastDailyManagedEnvironmentId).toBe(
      'backup-plugin-daily-2026-02-27',
    );
    expect(parsed.futureCompatibleKey).toEqual({ preserve: true });
  });

  it('reads only the four supported cadence keys without enumerating an unbounded synthetic map', () => {
    const reads: PropertyKey[] = [];
    const map = new Proxy(
      { daily: 'backup-plugin-daily-2026-02-27' },
      {
        ownKeys() {
          throw new Error('Cadence maps must not enumerate arbitrary keys');
        },
        get(target, key, receiver) {
          reads.push(key);
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const parsed = toAutomaticBackupsScheduleState({
      lastManagedEnvironmentIdByCadence: map,
    });

    expect(parsed.lastManagedEnvironmentIdByCadence).toEqual({
      daily: 'backup-plugin-daily-2026-02-27',
    });
    expect(reads).toEqual(['daily', 'weekly', 'biweekly', 'monthly']);
  });
});
