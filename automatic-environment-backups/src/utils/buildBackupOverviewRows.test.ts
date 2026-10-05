import { describe, expect, it } from 'vitest';
import type { LambdaBackupStatus } from '../types/types';
import { buildBackupOverviewRows } from './buildBackupOverviewRows';

const baseScheduleConfig = {
  version: 1 as const,
  enabledCadences: ['daily', 'weekly'] as const,
  timezone: 'UTC',
  anchorLocalDate: '2026-02-26',
  updatedAt: '2026-02-26T08:00:00.000Z',
};

describe('buildBackupOverviewRows', () => {
  it('maps lambda status payload into overview rows for all enabled cadences', () => {
    const rows = buildBackupOverviewRows({
      scheduleConfig: {
        ...baseScheduleConfig,
        enabledCadences: ['daily', 'weekly', 'biweekly', 'monthly'],
      },
      lambdaStatus: {
        scheduler: {
          provider: 'vercel',
          cadence: 'daily',
        },
        slots: {
          daily: {
            scope: 'daily',
            executionMode: 'lambda_cron',
            lastBackupAt: '2026-02-26T02:05:00.000Z',
            nextBackupAt: '2026-02-27T02:05:00.000Z',
          },
          weekly: {
            scope: 'weekly',
            executionMode: 'lambda_cron',
            lastBackupAt: null,
            nextBackupAt: '2026-03-05T02:05:00.000Z',
            dueNow: true,
          },
          biweekly: {
            scope: 'biweekly',
            executionMode: 'lambda_cron',
            lastBackupAt: '2026-02-12T02:05:00.000Z',
            nextBackupAt: '2026-03-12T02:05:00.000Z',
          },
          monthly: {
            scope: 'monthly',
            executionMode: 'lambda_cron',
            lastBackupAt: null,
            nextBackupAt: '2026-03-26T02:05:00.000Z',
          },
        },
        checkedAt: '2026-02-26T12:00:00.000Z',
      },
      availableEnvironmentIds: [
        'backup-plugin-daily-2026-02-26',
        'backup-plugin-biweekly-2026-02-12',
      ],
      now: new Date('2026-02-26T08:10:00.000Z'),
    });

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      scope: 'daily',
      environmentName: 'backup-plugin-daily-2026-02-26',
      environmentLinked: true,
    });
    expect(rows[1]).toMatchObject({
      scope: 'weekly',
      lastBackup: 'Never',
      nextBackup: 'Due now',
      environmentName: 'Not yet created',
      environmentLinked: false,
    });
    expect(rows[2]).toMatchObject({
      scope: 'biweekly',
      environmentName: 'backup-plugin-biweekly-2026-02-12',
      environmentLinked: true,
    });
    expect(rows[3]).toMatchObject({
      scope: 'monthly',
      lastBackup: 'Never',
      environmentName: 'Not yet created',
      environmentLinked: false,
    });
  });

  it('marks missing environments as deleted or renamed when absent from CMA list', () => {
    const rows = buildBackupOverviewRows({
      scheduleConfig: {
        ...baseScheduleConfig,
        enabledCadences: ['daily'],
      },
      lambdaStatus: {
        scheduler: {
          provider: 'vercel',
          cadence: 'daily',
        },
        slots: {
          daily: {
            scope: 'daily',
            executionMode: 'lambda_cron',
            lastBackupAt: '2026-02-26T08:09:59.000Z',
            nextBackupAt: '2026-02-27T08:09:59.000Z',
          },
          weekly: {
            scope: 'weekly',
            executionMode: 'lambda_cron',
            lastBackupAt: null,
            nextBackupAt: '2026-03-05T08:09:59.000Z',
          },
        },
        checkedAt: '2026-02-26T08:10:00.000Z',
      },
      availableEnvironmentIds: ['main', 'staging'],
      now: new Date('2026-02-26T08:10:00.000Z'),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: 'daily',
      environmentName: 'backup-plugin-daily-2026-02-26',
      environmentLinked: false,
      environmentStatusNote:
        'Not found among ready environments (still creating, deleted or renamed).',
    });
  });

  const status: LambdaBackupStatus = {
    scheduler: { provider: 'vercel', cadence: 'daily' },
    slots: {
      daily: {
        scope: 'daily',
        executionMode: 'lambda_cron',
        lastBackupAt: '2026-02-27T00:05:00.000Z',
        nextBackupAt: '2026-02-28T02:05:00.000Z',
      },
      weekly: {
        scope: 'weekly',
        executionMode: 'lambda_cron',
        lastBackupAt: null,
        nextBackupAt: null,
      },
    },
    checkedAt: '2026-02-27T00:10:00.000Z',
  };

  it('uses the actual environment ID when its date differs from the status timestamp', () => {
    const environmentId = 'backup-plugin-daily-2026-02-26';
    const rows = buildBackupOverviewRows({
      scheduleConfig: { ...baseScheduleConfig, enabledCadences: ['daily'] },
      lambdaStatus: {
        ...status,
        slots: {
          ...status.slots,
          daily: {
            ...status.slots.daily,
            lastManagedEnvironmentId: environmentId,
          },
        },
      },
      availableEnvironmentIds: ['main', environmentId],
    });

    expect(rows[0]).toMatchObject({
      environmentName: environmentId,
      environmentLinked: true,
    });
  });

  it('does not substitute a different snapshot on the same date when the actual environment is not confirmed ready', () => {
    const rows = buildBackupOverviewRows({
      scheduleConfig: { ...baseScheduleConfig, enabledCadences: ['daily'] },
      lambdaStatus: {
        ...status,
        slots: {
          ...status.slots,
          daily: { ...status.slots.daily, lastManagedEnvironmentId: null },
        },
      },
      availableEnvironmentIds: ['backup-plugin-daily-2026-02-27'],
    });

    expect(rows[0]).toMatchObject({
      environmentName: 'Not confirmed ready',
      environmentLinked: false,
      environmentStatusNote: 'Backup environment is not confirmed ready.',
    });
  });

  it.each([{ ids: [] }, { ids: [' ', ''] }])(
    'treats a successfully fetched empty list as no ready environments: %j',
    ({ ids }) => {
      const rows = buildBackupOverviewRows({
        scheduleConfig: { ...baseScheduleConfig, enabledCadences: ['daily'] },
        lambdaStatus: status,
        availableEnvironmentIds: ids,
      });

      expect(rows[0].environmentLinked).toBe(false);
      expect(rows[0].environmentStatusNote).toContain(
        'Not found among ready environments',
      );
    },
  );

  it('does not claim an environment is verified when the environments request failed', () => {
    const rows = buildBackupOverviewRows({
      scheduleConfig: { ...baseScheduleConfig, enabledCadences: ['daily'] },
      lambdaStatus: status,
    });

    expect(rows[0]).toMatchObject({
      environmentLinked: false,
      environmentStatusNote:
        'Could not verify against the current environments list.',
    });
  });

  it.each([
    'invalid',
    '',
    '2026-13-27T02:05:00.000Z',
    '2026-02-30T02:05:00.000Z',
  ])('does not link an invalid backup timestamp: %j', (lastBackupAt) => {
    const rows = buildBackupOverviewRows({
      scheduleConfig: { ...baseScheduleConfig, enabledCadences: ['daily'] },
      lambdaStatus: {
        ...status,
        slots: {
          ...status.slots,
          daily: { ...status.slots.daily, lastBackupAt },
        },
      },
      availableEnvironmentIds: ['backup-plugin-daily-*'],
    });

    expect(rows[0]).toMatchObject({
      environmentName: 'Unavailable',
      lastBackup: 'Unavailable',
      environmentLinked: false,
    });
  });
});
