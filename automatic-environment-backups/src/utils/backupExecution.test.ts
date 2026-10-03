import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupCadence, LambdaBackupStatus } from '../types/types';
import { executeBackupCadences } from './backupExecution';
import { LambdaBackupStatusError } from './fetchLambdaBackupStatus';
import {
  LambdaBackupNowError,
  type LambdaBackupNowResult,
} from './triggerLambdaBackupNow';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const OLD_BACKUP = '2026-10-01T02:05:00.000Z';
const CADENCES: BackupCadence[] = ['daily', 'weekly', 'biweekly', 'monthly'];
const OBSERVATION_LIMIT_MS = 30 * 60 * 1000;

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
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
    const readStatus = vi.fn(async () => status());
    const onProgress = vi.fn();
    const onCadence = vi.fn();
    const result = await executeBackupCadences({
      cadences: [...CADENCES, 'daily', 'monthly'],
      readStatus,
      trigger,
      onProgress,
      onCadence,
    });

    expect(result).toEqual({
      completed: CADENCES,
      failures: [],
      uncertain: false,
    });
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls.map(([cadence]) => cadence)).toEqual(CADENCES);
    expect(onCadence.mock.calls.map(([cadence]) => cadence)).toEqual(CADENCES);
    expect(maxInFlight).toBe(1);
    expect(onProgress).toHaveBeenLastCalledWith(
      '4/4 backup cadences completed.',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has no network work when there are no requested cadences', async () => {
    const readStatus = vi.fn(async () => status());
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const result = await executeBackupCadences({
      cadences: [],
      readStatus,
      trigger,
      onProgress: vi.fn(),
    });

    expect(result).toEqual({ completed: [], failures: [], uncertain: false });
    expect(readStatus).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('does not mutate any cadence when preflight status fails', async () => {
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
    expect(vi.getTimerCount()).toBe(0);
  });

  it('validates every requested status slot before starting the first backup', async () => {
    const incomplete = status();
    delete incomplete.slots.monthly;
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    await expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: async () => incomplete,
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
        readStatus: async () => status({ daily: 'invalid timestamp' }),
        trigger,
        onProgress: vi.fn(),
        onlyMissing: true,
      }),
    ).rejects.toThrow('Daily: backup status is missing or invalid');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('only creates missing cadences and excludes existing backups from completion counts', async () => {
    const timestamps: Partial<Record<BackupCadence, string | null>> = {
      daily: OLD_BACKUP,
      monthly: OLD_BACKUP,
    };
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      timestamps[cadence] = new Date().toISOString();
      return backup(cadence);
    });
    const confirmCompletion = vi.fn(async () => true);
    const onProgress = vi.fn();
    const result = await executeBackupCadences({
      cadences: CADENCES,
      readStatus: async () => status(timestamps),
      trigger,
      onProgress,
      confirmCompletion,
      onlyMissing: true,
    });

    expect(result.completed).toEqual(['weekly', 'biweekly']);
    expect(trigger.mock.calls.map(([cadence]) => cadence)).toEqual([
      'weekly',
      'biweekly',
    ]);
    expect(confirmCompletion).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith(
      '2/2 backup cadences completed.',
    );
  });

  it('treats 409 CADENCE_NOT_ENABLED as definitive and preserves partial failures', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      if (cadence === 'daily') {
        throw triggerError('HTTP', 409);
      }
      if (cadence === 'biweekly') {
        throw triggerError('HTTP', 403);
      }
      return backup(cadence);
    });
    const readStatus = vi.fn(async () => status());
    const result = await executeBackupCadences({
      cadences: CADENCES,
      readStatus,
      trigger,
      onProgress: vi.fn(),
    });

    expect(result.completed).toEqual(['weekly', 'monthly']);
    expect(result.failures).toEqual([
      'Daily: CADENCE_NOT_ENABLED',
      'Bi-weekly: Service error: HTTP',
    ]);
    expect(result.uncertain).toBe(false);
    expect(trigger).toHaveBeenCalledTimes(4);
    expect(readStatus).toHaveBeenCalledTimes(1);
  });

  it('monitors a 200,000-record/10,000-asset synthetic clone for over 60 seconds without duplicate mutations or overlap', async () => {
    // These counts describe the fixture; no records/assets are materialized or
    // transferred. The simulated duration is not a production speed claim.
    const project = { records: 200000, assets: 10000, readyAfterMs: 180000 };
    const timestamps: Partial<Record<BackupCadence, string | null>> = {};
    let cloneInProgress = false;
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      expect(cloneInProgress).toBe(false);
      if (cadence === 'daily') {
        timestamps.daily = NOW.toISOString();
        cloneInProgress = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 60000));
        throw triggerError('TIMEOUT');
      }
      timestamps[cadence] = new Date().toISOString();
      return backup(cadence);
    });
    const readStatus = vi.fn(async () => status(timestamps));
    const confirmCompletion = vi.fn(async () => {
      if (Date.now() - NOW.getTime() < project.readyAfterMs) {
        return false;
      }
      cloneInProgress = false;
      return true;
    });
    const onProgress = vi.fn();
    const onStatus = vi.fn();
    const resultPromise = executeBackupCadences({
      cadences: CADENCES,
      readStatus,
      trigger,
      onProgress,
      onStatus,
      confirmCompletion,
    });

    await vi.advanceTimersByTimeAsync(60000);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(
      'Waiting for daily backup confirmation (0/4 backup cadences completed)…',
    );
    await vi.advanceTimersByTimeAsync(110000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    const result = await resultPromise;

    expect(project).toMatchObject({ records: 200000, assets: 10000 });
    expect(result).toEqual({
      completed: CADENCES,
      failures: [],
      uncertain: false,
    });
    expect(trigger.mock.calls.map(([cadence]) => cadence)).toEqual(CADENCES);
    expect(onStatus.mock.calls.length).toBe(readStatus.mock.calls.length);
    expect(onProgress).toHaveBeenLastCalledWith(
      '4/4 backup cadences completed.',
    );
    expect(readStatus.mock.calls.length).toBeLessThan(12);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['NETWORK', undefined],
    ['HTTP', 500],
    ['HTTP', 503],
    ['INVALID_JSON', undefined],
    ['INVALID_RESPONSE', undefined],
  ] as const)(
    'observes ambiguous %s/%s responses without resending the POST',
    async (code, httpStatus) => {
      const readStatus = vi
        .fn(async () => status({ daily: NOW.toISOString() }))
        .mockResolvedValueOnce(status());
      const trigger = vi.fn().mockRejectedValue(triggerError(code, httpStatus));
      const resultPromise = executeBackupCadences({
        cadences: ['daily'],
        readStatus,
        trigger,
        onProgress: vi.fn(),
        confirmCompletion: async () => true,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await resultPromise).toEqual({
        completed: ['daily'],
        failures: [],
        uncertain: false,
      });
      expect(trigger).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps monitoring transient status failures with bounded concurrency and backoff', async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    let reads = 0;
    const readStatus = vi.fn(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      reads += 1;
      try {
        await Promise.resolve();
        if (reads === 2 || reads === 3) {
          throw new Error('HTTP 503: service temporarily unavailable');
        }
        return reads === 1 ? status() : status({ daily: NOW.toISOString() });
      } finally {
        activeReads -= 1;
      }
    });
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const onProgress = vi.fn();
    const resultPromise = executeBackupCadences({
      cadences: ['daily'],
      readStatus,
      trigger,
      onProgress,
      confirmCompletion: async () => true,
    });
    await vi.advanceTimersByTimeAsync(35000);

    expect((await resultPromise).completed).toEqual(['daily']);
    expect(maxActiveReads).toBe(1);
    expect(readStatus).toHaveBeenCalledTimes(4);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(
      onProgress.mock.calls.some(([message]) =>
        message.includes('Latest status unavailable: HTTP 503'),
      ),
    ).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(
      '1/1 backup cadences completed.',
    );
  });

  it('honors CMA ApiError Retry-After metadata before reading again', async () => {
    const failure = Object.assign(new Error('CMA API rate limited'), {
      retryAfterMs: 60000,
    });
    const readStatus = vi
      .fn(async () => status({ daily: NOW.toISOString() }))
      .mockResolvedValueOnce(status())
      .mockRejectedValueOnce(failure);
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const resultPromise = executeBackupCadences({
      cadences: ['daily'],
      readStatus,
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => true,
    });
    await vi.advanceTimersByTimeAsync(64999);
    expect(readStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    expect((await resultPromise).completed).toEqual(['daily']);
    expect(readStatus).toHaveBeenCalledTimes(3);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])(
    'respects a long Retry-After from status HTTP %s without the normal 30-second cap',
    async (httpStatus) => {
      const failure = new LambdaBackupStatusError({
        code: 'HTTP',
        endpoint: 'https://example.invalid/api/datocms/backup-status',
        httpStatus,
        retryAfterMs: 120000,
        message: 'Retry status after two minutes.',
      });
      const readStatus = vi
        .fn(async () => status({ daily: NOW.toISOString() }))
        .mockResolvedValueOnce(status())
        .mockRejectedValueOnce(failure);
      const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
      const resultPromise = executeBackupCadences({
        cadences: ['daily'],
        readStatus,
        trigger,
        onProgress: vi.fn(),
        confirmCompletion: async () => true,
      });
      await vi.advanceTimersByTimeAsync(124999);
      expect(readStatus).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);

      expect((await resultPromise).completed).toEqual(['daily']);
      expect(readStatus).toHaveBeenCalledTimes(3);
      expect(trigger).toHaveBeenCalledTimes(1);
    },
  );

  it('stops safely if the server Retry-After exceeds the remaining observation budget', async () => {
    const failure = new LambdaBackupStatusError({
      code: 'HTTP',
      endpoint: 'https://example.invalid/api/datocms/backup-status',
      httpStatus: 429,
      retryAfterMs: OBSERVATION_LIMIT_MS,
      message: 'Retry status after thirty minutes.',
    });
    const readStatus = vi
      .fn(async () => status())
      .mockResolvedValueOnce(status())
      .mockRejectedValueOnce(failure);
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const resultPromise = executeBackupCadences({
      cadences: CADENCES,
      readStatus,
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => true,
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect((await resultPromise).uncertain).toBe(true);
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never accepts a changed timestamp without an independent ready confirmation', async () => {
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const readStatus = vi
      .fn(async () => status({ daily: NOW.toISOString() }))
      .mockResolvedValueOnce(status());
    const resultPromise = executeBackupCadences({
      cadences: CADENCES,
      readStatus,
      trigger,
      onProgress: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_LIMIT_MS);
    const result = await resultPromise;

    expect(result.completed).toEqual([]);
    expect(result.uncertain).toBe(true);
    expect(result.failures[0]).toContain(
      'external backup may still be running',
    );
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(readStatus.mock.calls.length).toBeLessThan(65);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('requires timestamp advancement as well as readiness for an ambiguous rotation', async () => {
    const confirmCompletion = vi.fn(async () => true);
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const resultPromise = executeBackupCadences({
      cadences: ['daily', 'weekly'],
      readStatus: async () => status({ daily: OLD_BACKUP }),
      trigger,
      onProgress: vi.fn(),
      confirmCompletion,
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_LIMIT_MS);

    expect((await resultPromise).uncertain).toBe(true);
    expect(confirmCompletion).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('waits for an existing fork before creating another cadence, then skips it in onlyMissing mode', async () => {
    const timestamps: Partial<Record<BackupCadence, string | null>> = {
      daily: NOW.toISOString(),
    };
    const confirmCompletion = vi.fn(
      async () => Date.now() - NOW.getTime() >= 90000,
    );
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      timestamps[cadence] = new Date().toISOString();
      return backup(cadence);
    });
    const onProgress = vi.fn();
    const resultPromise = executeBackupCadences({
      cadences: ['weekly', 'daily'],
      readStatus: async () => status(timestamps),
      trigger,
      onProgress,
      confirmCompletion,
      onlyMissing: true,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(trigger).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(
      'Waiting for the existing daily backup environment to become ready before starting backups…',
    );
    await vi.advanceTimersByTimeAsync(60000);

    expect(await resultPromise).toEqual({
      completed: ['weekly'],
      failures: [],
      uncertain: false,
    });
    expect(trigger).toHaveBeenCalledExactlyOnceWith('weekly');
  });

  it('does not mutate any cadence if an existing fork cannot be confirmed ready', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const resultPromise = executeBackupCadences({
      cadences: ['weekly', 'daily'],
      readStatus: async () => status({ daily: NOW.toISOString() }),
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => false,
      onlyMissing: true,
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_LIMIT_MS);

    expect((await resultPromise).uncertain).toBe(true);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('waits for a scheduled fork from an unrequested cadence before a manual backup', async () => {
    const timestamps: Partial<Record<BackupCadence, string | null>> = {
      weekly: NOW.toISOString(),
    };
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      timestamps[cadence] = new Date().toISOString();
      return backup(cadence);
    });
    const confirmCompletion = vi.fn(
      async () => Date.now() - NOW.getTime() >= 60000,
    );
    const onCadence = vi.fn();
    const resultPromise = executeBackupCadences({
      cadences: ['daily'],
      readStatus: async () => status(timestamps),
      trigger,
      onProgress: vi.fn(),
      onCadence,
      confirmCompletion,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);

    expect((await resultPromise).completed).toEqual(['daily']);
    expect(trigger).toHaveBeenCalledExactlyOnceWith('daily');
    expect(onCadence.mock.calls.map(([cadence]) => cadence)).toEqual([
      'weekly',
      'daily',
    ]);
  });

  it('accepts legacy optional slots when only daily is requested', async () => {
    const legacy = status();
    delete legacy.slots.biweekly;
    delete legacy.slots.monthly;
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const result = await executeBackupCadences({
      cadences: ['daily'],
      readStatus: async () => legacy,
      trigger,
      onProgress: vi.fn(),
    });

    expect(result.completed).toEqual(['daily']);
    expect(trigger).toHaveBeenCalledExactlyOnceWith('daily');
  });

  it('revalidates requested slots when polling sees a changed deployment contract', async () => {
    const changedStatus = status({ daily: NOW.toISOString() });
    delete changedStatus.slots.monthly;
    const readStatus = vi
      .fn(async () => changedStatus)
      .mockResolvedValueOnce(status({ daily: NOW.toISOString() }));
    const confirmCompletion = vi
      .fn(async () => true)
      .mockResolvedValueOnce(false);
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const assertion = expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus,
        trigger,
        onProgress: vi.fn(),
        confirmCompletion,
      }),
    ).rejects.toThrow('Monthly: backup status is missing or invalid');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(trigger).not.toHaveBeenCalled();
  });

  it('preserves an earlier definitive failure when a later cadence remains uncertain', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      throw triggerError('HTTP', cadence === 'daily' ? 401 : 500);
    });
    const resultPromise = executeBackupCadences({
      cadences: CADENCES,
      readStatus: async () => status(),
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => true,
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_LIMIT_MS);
    const result = await resultPromise;

    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toBe('Daily: Service error: HTTP');
    expect(result.failures[1]).toContain('Weekly:');
    expect(result.uncertain).toBe(true);
    expect(trigger.mock.calls.map(([cadence]) => cadence)).toEqual([
      'daily',
      'weekly',
    ]);
  });

  it('ends monitoring at its deadline even when a status request never settles', async () => {
    const readStatus = vi
      .fn(() => new Promise<LambdaBackupStatus>(() => undefined))
      .mockResolvedValueOnce(status());
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const resultPromise = executeBackupCadences({
      cadences: CADENCES,
      readStatus,
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => true,
      continuousObservation: true,
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_LIMIT_MS);

    expect((await resultPromise).uncertain).toBe(true);
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled preflight read before any mutation', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const assertion = expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: () => new Promise<LambdaBackupStatus>(() => undefined),
        trigger,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('monitoring exceeded its time limit');
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    expect(trigger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled readiness check and never starts a mutation after expiry', async () => {
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const readStatus = vi.fn(async () => status({ daily: NOW.toISOString() }));
    const resultPromise = executeBackupCadences({
      cadences: CADENCES,
      readStatus,
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: () => new Promise<boolean>(() => undefined),
      continuousObservation: true,
    });
    await vi.advanceTimersByTimeAsync(OBSERVATION_LIMIT_MS);

    expect((await resultPromise).uncertain).toBe(true);
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues automatically past thirty minutes until the clone becomes ready', async () => {
    const readStatus = vi
      .fn(async () => status({ daily: NOW.toISOString() }))
      .mockResolvedValueOnce(status());
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const onProgress = vi.fn();
    const resultPromise = executeBackupCadences({
      cadences: ['daily'],
      readStatus,
      trigger,
      onProgress,
      confirmCompletion: async () => Date.now() - NOW.getTime() >= 31 * 60000,
      continuousObservation: true,
    });
    await vi.advanceTimersByTimeAsync(30 * 60000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60000);

    expect(await resultPromise).toEqual({
      completed: ['daily'],
      failures: [],
      uncertain: false,
    });
    expect(
      onProgress.mock.calls.some(([message]) =>
        message.startsWith('Still waiting'),
      ),
    ).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers automatically when transient status failures last longer than thirty minutes', async () => {
    let preflight = true;
    const readStatus = vi.fn(async () => {
      if (preflight) {
        preflight = false;
        return status();
      }
      if (Date.now() - NOW.getTime() < 32 * 60000) {
        throw new Error('HTTP 503: service temporarily unavailable');
      }
      return status({ daily: NOW.toISOString() });
    });
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const resultPromise = executeBackupCadences({
      cadences: ['daily'],
      readStatus,
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => true,
      continuousObservation: true,
    });
    await vi.advanceTimersByTimeAsync(33 * 60000);

    expect((await resultPromise).completed).toEqual(['daily']);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(readStatus.mock.calls.length).toBeLessThan(70);
  });

  it('waits an entire Retry-After longer than thirty minutes in continuous mode', async () => {
    const readStatus = vi
      .fn(async () => status({ daily: NOW.toISOString() }))
      .mockResolvedValueOnce(status())
      .mockRejectedValueOnce(
        new LambdaBackupStatusError({
          code: 'HTTP',
          endpoint: 'https://example.invalid/api/datocms/backup-status',
          httpStatus: 429,
          retryAfterMs: 31 * 60000,
          message: 'Retry status after thirty-one minutes.',
        }),
      );
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const resultPromise = executeBackupCadences({
      cadences: ['daily'],
      readStatus,
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => true,
      continuousObservation: true,
    });
    await vi.advanceTimersByTimeAsync(31 * 60000 + 4999);
    expect(readStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    expect((await resultPromise).completed).toEqual(['daily']);
    expect(readStatus).toHaveBeenCalledTimes(3);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('keeps observing a successful response until readiness before starting the next cadence', async () => {
    const timestamps: Partial<Record<BackupCadence, string | null>> = {};
    const trigger = vi.fn(async (cadence: BackupCadence) => {
      timestamps[cadence] = new Date().toISOString();
      return backup(cadence);
    });
    const resultPromise = executeBackupCadences({
      cadences: ['daily', 'weekly'],
      readStatus: async () => status(timestamps),
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => Date.now() - NOW.getTime() >= 90000,
      continuousObservation: true,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(trigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(40000);

    expect((await resultPromise).completed).toEqual(['daily', 'weekly']);
    expect(trigger.mock.calls.map(([cadence]) => cadence)).toEqual([
      'daily',
      'weekly',
    ]);
  });

  it('respects Retry-After when checking readiness immediately after a successful POST', async () => {
    const readStatus = vi
      .fn(async () => status({ daily: NOW.toISOString() }))
      .mockResolvedValueOnce(status())
      .mockRejectedValueOnce(
        new LambdaBackupStatusError({
          code: 'HTTP',
          endpoint: 'https://example.invalid/api/datocms/backup-status',
          httpStatus: 503,
          retryAfterMs: 120000,
          message: 'Retry status after two minutes.',
        }),
      );
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    const resultPromise = executeBackupCadences({
      cadences: ['daily'],
      readStatus,
      trigger,
      onProgress: vi.fn(),
      confirmCompletion: async () => true,
      continuousObservation: true,
    });
    await vi.advanceTimersByTimeAsync(119999);
    expect(readStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    expect((await resultPromise).completed).toEqual(['daily']);
    expect(readStatus).toHaveBeenCalledTimes(3);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('cancels continuous observation after thirty minutes without starting another cadence', async () => {
    const controller = new AbortController();
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const assertion = expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: async () => status(),
        trigger,
        onProgress: vi.fn(),
        confirmCompletion: async () => false,
        continuousObservation: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(31 * 60000);
    controller.abort();
    await assertion;

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels polling promptly and never sends the next mutation', async () => {
    const controller = new AbortController();
    const trigger = vi.fn().mockRejectedValue(triggerError('TIMEOUT'));
    const assertion = expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: async () => status(),
        trigger,
        onProgress: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(6000);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(60000);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an in-flight mutation observation without starting another mutation', async () => {
    const controller = new AbortController();
    const trigger = vi.fn(
      () => new Promise<LambdaBackupNowResult>(() => undefined),
    );
    const assertion = expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus: async () => status(),
        trigger,
        onProgress: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    expect(trigger).toHaveBeenCalledTimes(1);
    controller.abort();
    await assertion;
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('honors a pre-cancelled signal without any reads or mutations', async () => {
    const controller = new AbortController();
    controller.abort();
    const readStatus = vi.fn(async () => status());
    const trigger = vi.fn(async (cadence: BackupCadence) => backup(cadence));
    await expect(
      executeBackupCadences({
        cadences: CADENCES,
        readStatus,
        trigger,
        onProgress: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(readStatus).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});
