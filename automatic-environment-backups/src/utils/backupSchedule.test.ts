import { describe, expect, it } from 'vitest';
import {
  BACKUP_CADENCES,
  BACKUP_SCHEDULE_VERSION,
  getNextDueLocalDate,
  isCadenceDueNow,
  isValidBackupTimestamp,
  normalizeBackupScheduleConfig,
  toLocalDateKey,
  toUtcDateFromLocalDateKey,
} from './backupSchedule';

describe('normalizeBackupScheduleConfig', () => {
  const now = new Date('2026-02-26T08:10:00.000Z');

  it('returns cadence-only defaults when schedule is missing', () => {
    const { config, requiresMigration } = normalizeBackupScheduleConfig({
      value: undefined,
      timezoneFallback: 'UTC',
      now,
    });

    expect(requiresMigration).toBe(true);
    expect(config).toEqual({
      version: BACKUP_SCHEDULE_VERSION,
      enabledCadences: ['daily', 'weekly'],
      timezone: 'UTC',
      anchorLocalDate: '2026-02-26',
      updatedAt: '2026-02-26T08:10:00.000Z',
    });
    expect('legacyRunTime' in config).toBe(false);
  });

  it('migrates legacy schedule objects that include deprecated runtime keys', () => {
    const { config, requiresMigration } = normalizeBackupScheduleConfig({
      value: {
        version: 1,
        enabledCadences: ['daily', 'monthly'],
        timezone: 'UTC',
        legacyRunTime: '23:59',
        anchorLocalDate: '2026-02-26',
        updatedAt: '2026-02-25T07:00:00.000Z',
      },
      timezoneFallback: 'UTC',
      now,
    });

    expect(requiresMigration).toBe(true);
    expect(config).toEqual({
      version: BACKUP_SCHEDULE_VERSION,
      enabledCadences: ['daily', 'monthly'],
      timezone: 'UTC',
      anchorLocalDate: '2026-02-26',
      updatedAt: '2026-02-25T07:00:00.000Z',
    });
    expect('legacyRunTime' in config).toBe(false);
  });

  it('does not request migration for valid cadence-only schedule objects', () => {
    const { config, requiresMigration } = normalizeBackupScheduleConfig({
      value: {
        version: 1,
        enabledCadences: ['daily', 'biweekly', 'monthly'],
        timezone: 'America/New_York',
        anchorLocalDate: '2026-02-25',
        updatedAt: '2026-02-25T07:00:00.000Z',
      },
      timezoneFallback: 'UTC',
      now,
    });

    expect(requiresMigration).toBe(false);
    expect(config).toEqual({
      version: BACKUP_SCHEDULE_VERSION,
      enabledCadences: ['daily', 'biweekly', 'monthly'],
      timezone: 'America/New_York',
      anchorLocalDate: '2026-02-25',
      updatedAt: '2026-02-25T07:00:00.000Z',
    });
  });

  it.each([
    {
      timezone: 'Invalid/Timezone',
      timezoneFallback: 'America/New_York',
      expected: 'America/New_York',
    },
    {
      timezone: 'Invalid/Timezone',
      timezoneFallback: 'Also/Invalid',
      expected: 'UTC',
    },
  ])(
    'normalizes an invalid timezone without crashing the configuration screen: %j',
    ({ timezone, timezoneFallback, expected }) => {
      const { config, requiresMigration } = normalizeBackupScheduleConfig({
        value: {
          version: 1,
          enabledCadences: ['daily'],
          timezone,
          anchorLocalDate: '2026-02-26',
          updatedAt: now.toISOString(),
        },
        timezoneFallback,
        now,
      });

      expect(config.timezone).toBe(expected);
      expect(requiresMigration).toBe(true);
      expect(toLocalDateKey(now, 'Invalid/Timezone')).toBe('2026-02-26');
    },
  );

  it('migrates duplicate cadences, impossible anchors and invalid updated timestamps', () => {
    const { config, requiresMigration } = normalizeBackupScheduleConfig({
      value: {
        version: 1,
        enabledCadences: ['monthly', 'daily', 'daily'],
        timezone: 'UTC',
        anchorLocalDate: '2026-02-30',
        updatedAt: 'invalid',
      },
      timezoneFallback: 'UTC',
      now,
    });

    expect(config.enabledCadences).toEqual(['daily', 'monthly']);
    expect(config.anchorLocalDate).toBe('2026-02-26');
    expect(config.updatedAt).toBe(now.toISOString());
    expect(requiresMigration).toBe(true);
  });
});

describe('cadence date boundaries', () => {
  it.each([
    { timestamp: '2028-02-29T02:05:00.000Z', valid: true },
    { timestamp: '2026-02-26T22:05:00-03:00', valid: true },
    { timestamp: '2026-02-30T02:05:00.000Z', valid: false },
    { timestamp: '2026-02-26T25:00:00.000Z', valid: false },
    { timestamp: '2026-02-26T02:05:00', valid: false },
    { timestamp: '2026-02-26', valid: false },
  ])(
    'validates timestamp calendar and explicit timezone: %j',
    ({ timestamp, valid }) => {
      expect(isValidBackupTimestamp(timestamp)).toBe(valid);
    },
  );

  it.each(BACKUP_CADENCES)(
    'does not schedule %s before a future anchor',
    (cadence) => {
      expect(
        getNextDueLocalDate({
          cadence,
          anchorLocalDate: '2026-12-31',
          currentLocalDate: '2026-02-26',
        }),
      ).toBe('2026-12-31');
      expect(
        isCadenceDueNow({
          cadence,
          anchorLocalDate: '2026-12-31',
          currentLocalDate: '2026-02-26',
        }),
      ).toBe(false);
    },
  );

  it.each([
    { current: '2026-02-27', next: '2026-02-28' },
    { current: '2026-02-28', next: '2026-03-31' },
    { current: '2028-02-28', next: '2028-02-29' },
    { current: '2028-02-29', next: '2028-03-31' },
  ])(
    'clamps monthly scheduling at month boundaries: %j',
    ({ current, next }) => {
      expect(
        getNextDueLocalDate({
          cadence: 'monthly',
          anchorLocalDate: '2026-01-31',
          currentLocalDate: current,
          lastRunLocalDate: current,
        }),
      ).toBe(next);
    },
  );

  it('does not duplicate a completed run and advances all cadences continuously across a synthetic year', () => {
    const start = new Date('2026-01-31T00:00:00.000Z');
    const invalidDates: string[] = [];
    for (let day = 0; day < 366; day += 1) {
      const date = new Date(start.getTime() + day * 86400000);
      const currentLocalDate = date.toISOString().slice(0, 10);
      for (const cadence of BACKUP_CADENCES) {
        const repeatsCompletedRun = isCadenceDueNow({
          cadence,
          anchorLocalDate: '2026-01-31',
          currentLocalDate,
          lastRunLocalDate: currentLocalDate,
        });
        const next = getNextDueLocalDate({
          cadence,
          anchorLocalDate: '2026-01-31',
          currentLocalDate,
          lastRunLocalDate: currentLocalDate,
        });
        const nextIsScheduled = isCadenceDueNow({
          cadence,
          anchorLocalDate: '2026-01-31',
          currentLocalDate: next,
        });
        if (
          repeatsCompletedRun ||
          next <= currentLocalDate ||
          !nextIsScheduled
        ) {
          invalidDates.push(`${cadence}: ${currentLocalDate} -> ${next}`);
        }
      }
    }
    expect(invalidDates).toEqual([]);
  });

  it('preserves a four-digit year below 100 in UTC date conversion', () => {
    expect(toUtcDateFromLocalDateKey('0099-12-31')?.toISOString()).toBe(
      '0099-12-31T00:00:00.000Z',
    );
    expect(
      getNextDueLocalDate({
        cadence: 'daily',
        anchorLocalDate: '0099-01-01',
        currentLocalDate: '0099-12-31',
        lastRunLocalDate: '0099-12-31',
      }),
    ).toBe('0100-01-01');
  });
});
