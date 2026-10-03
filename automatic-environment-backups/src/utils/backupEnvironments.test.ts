import { describe, expect, it } from 'vitest';
import type { BackupCadence, LambdaBackupStatus } from '../types/types';
import {
  type BackupEnvironment,
  enrichBackupStatusWithEnvironments,
  getBackupEnvironmentProgress,
  getCreatingBackupCadences,
  getReadyBackupEnvironment,
} from './backupEnvironments';

const CREATED_AT = '2026-10-02T02:05:00.000Z';

const environment = (
  cadence: BackupCadence = 'daily',
  status: BackupEnvironment['meta']['status'] = 'ready',
): BackupEnvironment => ({
  id: `backup-plugin-${cadence}-snapshot`,
  meta: { primary: false, status, created_at: CREATED_AT },
});

const serviceStatus = (
  cadence: BackupCadence = 'daily',
  lastBackupAt: string | null = CREATED_AT,
): LambdaBackupStatus => ({
  scheduler: { provider: 'vercel', cadence: 'daily' },
  slots: {
    daily: {
      scope: 'daily',
      executionMode: 'lambda_cron',
      lastBackupAt: null,
      nextBackupAt: null,
    },
    weekly: {
      scope: 'weekly',
      executionMode: 'lambda_cron',
      lastBackupAt: null,
      nextBackupAt: null,
    },
    [cadence]: {
      scope: cadence,
      executionMode: 'lambda_cron',
      lastBackupAt,
      nextBackupAt: null,
    },
  },
  checkedAt: CREATED_AT,
});

describe('getReadyBackupEnvironment', () => {
  it.each(['daily', 'weekly', 'biweekly', 'monthly'] as const)(
    'confirms the actual %s ID from ready CMA metadata',
    (cadence) => {
      expect(
        getReadyBackupEnvironment(serviceStatus(cadence), cadence, [
          environment(cadence),
        ]),
      ).toBe(`backup-plugin-${cadence}-snapshot`);
    },
  );

  it('matches equivalent timestamps with different timezone offsets', () => {
    const backup = environment();
    backup.meta.created_at = '2026-10-01T23:05:00-03:00';
    expect(getReadyBackupEnvironment(serviceStatus(), 'daily', [backup])).toBe(
      backup.id,
    );
  });

  it.each(['creating', 'destroying'] as const)(
    'never confirms a %s environment reported as the latest backup by the service',
    (status) => {
      const backup = environment('daily', status);
      backup.meta.fork_completion_percentage = 100;
      expect(
        getReadyBackupEnvironment(serviceStatus(), 'daily', [backup]),
      ).toBeUndefined();
    },
  );

  it('does not link an older ready snapshot when the latest one is still creating', () => {
    const oldBackup = environment();
    oldBackup.meta.created_at = '2026-10-01T02:05:00.000Z';
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'daily', [
        oldBackup,
        environment('daily', 'creating'),
      ]),
    ).toBeUndefined();
  });

  it('rejects primary environments and other cadence prefixes', () => {
    const primary = environment();
    primary.meta.primary = true;
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'daily', [
        primary,
        environment('weekly'),
        { ...environment(), id: 'backup-plugin-dailyish-snapshot' },
        { ...environment(), id: 'backup-plugin-daily' },
        { ...environment(), id: 'custom-backup-plugin-daily-snapshot' },
      ]),
    ).toBeUndefined();
  });

  it.each([
    null,
    '',
    'invalid',
    '2026-02-30T02:05:00.000Z',
    '2026-10-02',
    '2026-10-01T24:00:00.000Z',
  ])('rejects invalid service timestamp %s', (lastBackupAt) => {
    expect(
      getReadyBackupEnvironment(serviceStatus('daily', lastBackupAt), 'daily', [
        environment(),
      ]),
    ).toBeUndefined();
  });

  it('rejects invalid or mismatched CMA creation timestamps', () => {
    for (const createdAt of [
      'invalid',
      '2026-02-30T02:05:00.000Z',
      '2026-10-02T02:05:01.000Z',
    ]) {
      const backup = environment();
      backup.meta.created_at = createdAt;
      expect(
        getReadyBackupEnvironment(serviceStatus(), 'daily', [backup]),
      ).toBeUndefined();
    }
  });

  it('handles an unavailable cadence slot and empty environments', () => {
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'biweekly', [
        environment('biweekly'),
      ]),
    ).toBeUndefined();
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'daily', []),
    ).toBeUndefined();
  });

  it('tolerates identical duplicates but rejects ambiguous IDs or metadata', () => {
    const backup = environment();
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'daily', [backup, backup]),
    ).toBe(backup.id);
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'daily', [
        backup,
        { ...backup, id: 'backup-plugin-daily-another-snapshot' },
      ]),
    ).toBeUndefined();
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'daily', [
        backup,
        environment('daily', 'creating'),
      ]),
    ).toBeUndefined();
    expect(
      getReadyBackupEnvironment(serviceStatus(), 'daily', [
        backup,
        {
          ...environment('daily', 'creating'),
          id: 'backup-plugin-daily-unfinished-copy',
        },
      ]),
    ).toBeUndefined();
  });
});

describe('enrichBackupStatusWithEnvironments', () => {
  it('reveals a clone started by cron after the service reported no backup', () => {
    const status = enrichBackupStatusWithEnvironments(
      serviceStatus('daily', null),
      [environment('daily', 'creating')],
    );
    expect(status.slots.daily).toMatchObject({
      lastBackupAt: CREATED_AT,
      lastManagedEnvironmentId: null,
    });
  });

  it.each(['creating', 'destroying'] as const)(
    'replaces an older ready service snapshot with the latest %s metadata',
    (state) => {
      const oldBackup = environment();
      oldBackup.id = 'backup-plugin-daily-previous';
      oldBackup.meta.created_at = '2026-10-01T02:05:00.000Z';
      const status = enrichBackupStatusWithEnvironments(
        serviceStatus('daily', oldBackup.meta.created_at),
        [environment('daily', state), oldBackup],
      );
      expect(status.slots.daily).toMatchObject({
        lastBackupAt: CREATED_AT,
        lastManagedEnvironmentId: null,
      });
    },
  );

  it('confirms a ready environment at the same instant without replacing the service timestamp', () => {
    const backup = environment();
    backup.meta.created_at = '2026-10-01T23:05:00-03:00';
    const status = enrichBackupStatusWithEnvironments(serviceStatus(), [
      backup,
    ]);
    expect(status.slots.daily).toMatchObject({
      lastBackupAt: CREATED_AT,
      lastManagedEnvironmentId: backup.id,
    });
  });

  it('preserves a newer service timestamp while CMA still has an older snapshot', () => {
    const backup = environment();
    backup.meta.created_at = '2026-10-01T02:05:00.000Z';
    const status = enrichBackupStatusWithEnvironments(serviceStatus(), [
      backup,
    ]);
    expect(status.slots.daily).toMatchObject({
      lastBackupAt: CREATED_AT,
      lastManagedEnvironmentId: null,
    });
  });

  it('normalizes a newer CMA timestamp with timezone and extra fractional precision', () => {
    const backup = environment('daily', 'creating');
    backup.meta.created_at = '2026-10-01T23:05:00.123456-03:00';
    const status = enrichBackupStatusWithEnvironments(
      serviceStatus('daily', null),
      [backup],
    );
    expect(status.slots.daily).toMatchObject({
      lastBackupAt: '2026-10-02T02:05:00.123Z',
      lastManagedEnvironmentId: null,
    });
  });

  it('ignores invalid metadata, primary environments and unrelated prefixes', () => {
    const primary = environment();
    primary.meta.primary = true;
    const invalid = environment();
    invalid.meta.created_at = '2026-02-30T02:05:00.000Z';
    const status = enrichBackupStatusWithEnvironments(
      serviceStatus('daily', null),
      [
        primary,
        invalid,
        { ...environment(), id: 'backup-plugin-dailyish-snapshot' },
        environment('biweekly', 'creating'),
      ],
    );
    expect(status.slots.daily).toMatchObject({
      lastBackupAt: null,
      lastManagedEnvironmentId: null,
    });
    expect(status.slots.biweekly).toBeUndefined();
  });

  it('keeps invalid service timestamps invalid instead of silently repairing the contract', () => {
    const status = enrichBackupStatusWithEnvironments(
      serviceStatus('daily', 'invalid'),
      [environment()],
    );
    expect(status.slots.daily).toMatchObject({
      lastBackupAt: 'invalid',
      lastManagedEnvironmentId: null,
    });
  });

  it('preserves ambiguity between multiple environments at the latest timestamp', () => {
    const backup = environment();
    const status = enrichBackupStatusWithEnvironments(
      serviceStatus('daily', null),
      [backup, { ...backup, id: 'backup-plugin-daily-another-snapshot' }],
    );
    expect(status.slots.daily).toMatchObject({
      lastBackupAt: CREATED_AT,
      lastManagedEnvironmentId: null,
    });
  });

  it('copies every existing slot without mutating the service response', () => {
    const original = serviceStatus('daily', null);
    original.slots.daily.lastManagedEnvironmentId = 'unverified-service-id';
    const snapshot = JSON.stringify(original);
    Object.freeze(original.slots.daily);
    Object.freeze(original.slots.weekly);
    Object.freeze(original.slots);
    Object.freeze(original);
    const enriched = enrichBackupStatusWithEnvironments(original, [
      environment(),
    ]);

    expect(JSON.stringify(original)).toBe(snapshot);
    expect(enriched).not.toBe(original);
    expect(enriched.slots).not.toBe(original.slots);
    expect(enriched.slots.daily).not.toBe(original.slots.daily);
    expect(enriched.slots.weekly).not.toBe(original.slots.weekly);
    expect(enriched.slots.daily.lastManagedEnvironmentId).toBe(
      'backup-plugin-daily-snapshot',
    );
    expect(enriched.checkedAt).toBe(original.checkedAt);
  });
});

describe('getCreatingBackupCadences', () => {
  it('returns each creating cadence once in schedule order', () => {
    const monthly = environment('monthly', 'creating');
    expect(
      getCreatingBackupCadences([
        monthly,
        environment('biweekly', 'creating'),
        environment('daily', 'creating'),
        environment('weekly', 'creating'),
        monthly,
      ]),
    ).toEqual(['daily', 'weekly', 'biweekly', 'monthly']);
  });

  it('ignores ready, destroying, primary and unrelated environments', () => {
    const primary = environment('daily', 'creating');
    primary.meta.primary = true;
    expect(
      getCreatingBackupCadences([
        environment(),
        environment('weekly', 'destroying'),
        primary,
        {
          ...environment('daily', 'creating'),
          id: 'backup-plugin-dailyish-copy',
        },
      ]),
    ).toEqual([]);
    expect(getCreatingBackupCadences([])).toEqual([]);
  });
});

describe('getBackupEnvironmentProgress', () => {
  it.each([
    [0, 0],
    [42.5, 42.5],
    [100, 100],
    [-10, 0],
    [150, 100],
  ])('normalizes progress %s to %s', (percentage, expected) => {
    const backup = environment('daily', 'creating');
    backup.meta.fork_completion_percentage = percentage;
    expect(getBackupEnvironmentProgress('daily', [backup])).toBe(expected);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not invent progress for an invalid percentage %s',
    (percentage) => {
      const backup = environment('daily', 'creating');
      backup.meta.fork_completion_percentage = percentage;
      expect(getBackupEnvironmentProgress('daily', [backup])).toBeUndefined();
    },
  );

  it('uses the least complete creating backup and preserves unknown progress', () => {
    const early = environment('daily', 'creating');
    early.meta.fork_completion_percentage = 10;
    const late = {
      ...environment('daily', 'creating'),
      id: 'backup-plugin-daily-new',
    };
    late.meta.fork_completion_percentage = 90;
    expect(getBackupEnvironmentProgress('daily', [early, late])).toBe(10);
    expect(
      getBackupEnvironmentProgress('daily', [
        early,
        environment('daily', 'creating'),
      ]),
    ).toBeUndefined();
  });

  it('ignores percentages on ready, destroying, primary and unrelated backups', () => {
    const primary = environment('daily', 'creating');
    primary.meta.primary = true;
    primary.meta.fork_completion_percentage = 1;
    const weekly = environment('weekly', 'creating');
    weekly.meta.fork_completion_percentage = 2;
    const ready = environment();
    ready.meta.fork_completion_percentage = 100;
    expect(
      getBackupEnvironmentProgress('daily', [
        primary,
        weekly,
        ready,
        environment('daily', 'destroying'),
      ]),
    ).toBeUndefined();
    expect(getBackupEnvironmentProgress('daily', [])).toBeUndefined();
  });
});

describe('massive project metadata envelope', () => {
  it('checks snapshots and clone progress without accessing 200k records or 10k assets', () => {
    const massiveProject = Object.freeze({
      counts: Object.freeze({
        records: 200_000,
        assets: 10_000,
        models: 300,
        locales: 80,
      }),
      get records(): never {
        throw new Error('Record payloads must not be loaded');
      },
      get assets(): never {
        throw new Error('Asset payloads must not be loaded');
      },
      environments: Object.freeze([
        Object.freeze({
          ...environment(),
          meta: Object.freeze(environment().meta),
        }),
        Object.freeze({
          ...environment('monthly', 'creating'),
          meta: Object.freeze({
            ...environment('monthly', 'creating').meta,
            fork_completion_percentage: 25,
          }),
        }),
      ]),
    });

    expect(massiveProject.counts).toMatchObject({
      records: 200_000,
      assets: 10_000,
    });
    expect(
      getReadyBackupEnvironment(
        serviceStatus(),
        'daily',
        massiveProject.environments,
      ),
    ).toBe('backup-plugin-daily-snapshot');
    expect(
      enrichBackupStatusWithEnvironments(
        serviceStatus('monthly', null),
        massiveProject.environments,
      ).slots.monthly,
    ).toMatchObject({
      lastBackupAt: CREATED_AT,
      lastManagedEnvironmentId: null,
    });
    expect(getCreatingBackupCadences(massiveProject.environments)).toEqual([
      'monthly',
    ]);
    expect(
      getBackupEnvironmentProgress('monthly', massiveProject.environments),
    ).toBe(25);
  });
});
