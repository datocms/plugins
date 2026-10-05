import { describe, expect, it, vi } from 'vitest';
import type { BackupCadence, LambdaBackupStatus } from '../types/types';
import { executeBackupCadences } from './backupExecution';
import {
  LambdaBackupNowError,
  type LambdaBackupNowResult,
} from './triggerLambdaBackupNow';

const OLD_BACKUP = '2026-10-01T02:05:00.000Z';
const CADENCES: BackupCadence[] = ['daily', 'weekly', 'biweekly', 'monthly'];

const status = (
  timestamps: Partial<Record<BackupCadence, string | null>> = {},
): LambdaBackupStatus => {
  const slot = (scope: BackupCadence) => ({
    scope,
    executionMode: 'lambda_cron' as const,
    lastBackupAt: timestamps[scope] ?? null,
    nextBackupAt: null,
  });
  return {
    scheduler: { provider: 'vercel', cadence: 'daily' },
    slots: {
      daily: slot('daily'),
      weekly: slot('weekly'),
      biweekly: slot('biweekly'),
      monthly: slot('monthly'),
    },
    checkedAt: new Date().toISOString(),
  };
};

const state = (value: LambdaBackupStatus, creating: BackupCadence[] = []) => ({
  status: value,
  creating,
});

const backup = (scope: BackupCadence): LambdaBackupNowResult => ({
  scope,
  executionMode: 'lambda_cron',
  createdEnvironmentId: `backup-plugin-${scope}-2026-10-02`,
  deletedEnvironmentId: null,
  completedAt: new Date().toISOString(),
  checkedAt: new Date().toISOString(),
});

const triggerError = (
  code: LambdaBackupNowError['code'],
  httpStatus?: number,
) =>
  new LambdaBackupNowError({
    code,
    httpStatus,
    endpoint: 'https://example.invalid/api/datocms/backup-now',
    message:
      httpStatus === 409 ? 'CADENCE_NOT_ENABLED' : `Service error: ${code}`,
  });

describe('executeBackupCadences', () => {
  it('runs all four cadences sequentially and deduplicates requested cadences', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      inFlight += 1;
      maxInFlight = Math.max(inFlight, maxInFlight);
      await Promise.resolve();
      inFlight -= 1;
      return backup(cadence);
    });
    const readStatus = vi.fn(async () => state(status()));
    const onCadence = vi.fn();
    const result = await executeBackupCadences({
      cadences: [...CADENCES, 'daily', 'monthly'],
      readStatus,
      trigger,
      onProgress: vi.fn(),
      onCadence,
    });

    expect(result).toEqual({ completed: CADENCES, failures: [] });
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls.map(([cadence]) => cadence)).toEqual(CADENCES);
    expect(onCadence.mock.calls.map(([cadence]) => cadence)).toEqual(CADENCES);
    expect(maxInFlight).toBe(1);
  });

  it('has no network work when there are no requested cadences', async () => {
    const readStatus = vi.fn(async () => state(status()));
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const result = await executeBackupCadences({
      cadences: [],
      readStatus,
      trigger,
      onProgress: vi.fn(),
    });

    expect(result).toEqual({ completed: [], failures: [] });
    expect(readStatus).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('does not start any cadence when the status read fails', async () => {
    const failure = new Error('HTTP 503: unavailable');
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    await expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: vi.fn().mockRejectedValue(failure),
        trigger,
        onProgress: vi.fn(),
      }),
    ).rejects.toBe(failure);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('validates every requested status slot before starting the first backup', async () => {
    const incomplete = status();
    delete incomplete.slots.monthly;
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    await expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: async () => state(incomplete),
        trigger,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('Monthly: backup status is missing or invalid');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('rejects invalid saved timestamps rather than treating them as missing backups', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    await expect(
      executeBackupCadences({
        cadences: ['daily'],
        readStatus: async () => state(status({ daily: 'invalid timestamp' })),
        trigger,
        onProgress: vi.fn(),
        onlyMissing: true,
      }),
    ).rejects.toThrow('Daily: backup status is missing or invalid');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('accepts legacy optional slots when only daily is requested', async () => {
    const legacy = status();
    delete legacy.slots.biweekly;
    delete legacy.slots.monthly;
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const result = await executeBackupCadences({
      cadences: ['daily'],
      readStatus: async () => state(legacy),
      trigger,
      onProgress: vi.fn(),
    });

    expect(result.completed).toEqual(['daily']);
    expect(trigger).toHaveBeenCalledExactlyOnceWith('daily');
  });

  it('only creates missing cadences in onlyMissing mode', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const result = await executeBackupCadences({
      cadences: CADENCES,
      readStatus: async () =>
        state(status({ daily: OLD_BACKUP, monthly: OLD_BACKUP })),
      trigger,
      onProgress: vi.fn(),
      onlyMissing: true,
    });

    expect(result.completed).toEqual(['weekly', 'biweekly']);
    expect(trigger.mock.calls.map(([cadence]) => cadence)).toEqual([
      'weekly',
      'biweekly',
    ]);
  });

  it('does not start a backup while another backup environment is being created', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const result = await executeBackupCadences({
      cadences: ['daily'],
      readStatus: async () => state(status(), ['weekly']),
      trigger,
      onProgress: vi.fn(),
    });

    expect(result.completed).toEqual([]);
    expect(result.failures).toEqual([
      'Weekly: a backup environment is still being created. No backups were started; try again once it is ready.',
    ]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('reports every failed backup-now response, including HTTP 5xx, and keeps going', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      if (cadence === 'daily') {
        throw triggerError('HTTP', 409);
      }
      if (cadence === 'biweekly') {
        throw triggerError('HTTP', 500);
      }
      return backup(cadence);
    });
    const result = await executeBackupCadences({
      cadences: CADENCES,
      readStatus: async () => state(status()),
      trigger,
      onProgress: vi.fn(),
    });

    expect(result.completed).toEqual(['weekly', 'monthly']);
    expect(result.failures).toEqual([
      'Daily: CADENCE_NOT_ENABLED',
      'Bi-weekly: Service error: HTTP',
    ]);
    expect(trigger).toHaveBeenCalledTimes(4);
  });

  it('stops without reporting a failure when the run is cancelled', async () => {
    const abort = new DOMException('Cancelled', 'AbortError');
    const trigger = vi.fn().mockRejectedValue(abort);
    await expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: async () => state(status()),
        trigger,
        onProgress: vi.fn(),
      }),
    ).rejects.toBe(abort);
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
