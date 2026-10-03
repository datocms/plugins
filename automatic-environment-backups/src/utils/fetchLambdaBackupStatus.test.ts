import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLambdaBackupStatus,
  LambdaBackupStatusError,
} from './fetchLambdaBackupStatus';

const expectRejected = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    return error;
  }
};

const statusPayload = () => ({
  ok: true,
  mpi: {
    message: 'DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_STATUS',
    version: '2026-02-26',
  },
  service: 'datocms-backups-scheduled-function',
  status: 'ready',
  scheduler: { provider: 'vercel', cadence: 'daily' },
  slots: {
    daily: {
      scope: 'daily',
      executionMode: 'lambda_cron',
      lastBackupAt: '2026-10-03T00:20:00.000Z',
      nextBackupAt: '2026-10-03T02:05:00.000Z',
    },
    weekly: {
      scope: 'weekly',
      executionMode: 'lambda_cron',
      lastBackupAt: null,
      nextBackupAt: null,
    },
  },
  checkedAt: '2026-10-03T00:25:00.000Z',
});

const statusInput = {
  baseUrl: 'https://backups.example.test',
  environment: 'main',
  lambdaAuthSecret: 'shared-secret',
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchLambdaBackupStatus', () => {
  it('returns parsed status when endpoint responds with a valid contract', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            mpi: {
              message: 'DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_STATUS',
              version: '2026-02-26',
            },
            service: 'datocms-backups-scheduled-function',
            status: 'ready',
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
                dueNow: true,
              },
              weekly: {
                scope: 'weekly',
                executionMode: 'lambda_cron',
                lastBackupAt: '2026-02-20T02:35:00.000Z',
                nextBackupAt: '2026-02-27T02:35:00.000Z',
              },
              biweekly: {
                scope: 'biweekly',
                executionMode: 'lambda_cron',
                lastBackupAt: '2026-02-12T02:35:00.000Z',
                nextBackupAt: '2026-03-12T02:35:00.000Z',
              },
              monthly: {
                scope: 'monthly',
                executionMode: 'lambda_cron',
                lastBackupAt: null,
                nextBackupAt: '2026-03-26T02:35:00.000Z',
              },
            },
            checkedAt: '2026-02-26T12:00:00.000Z',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await fetchLambdaBackupStatus({
      baseUrl: 'backups.netlify.app',
      environment: 'main',
      lambdaAuthSecret: 'shared-secret',
    });

    expect(result.scheduler.provider).toBe('vercel');
    expect(result.slots.daily.executionMode).toBe('lambda_cron');
    expect(result.slots.daily.dueNow).toBe(true);
    expect(result.slots.weekly.dueNow).toBe(false);
    expect(result.slots.biweekly?.scope).toBe('biweekly');
    expect(result.slots.monthly?.scope).toBe('monthly');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const typedCalls = fetchMock.mock.calls as unknown as Array<
      [unknown, RequestInit | undefined]
    >;
    expect(typedCalls[0]?.[0]).toBe(
      'https://backups.netlify.app/api/datocms/backup-status',
    );
    expect(typedCalls[0]?.[1]?.headers).toMatchObject({
      'X-Datocms-Backups-Auth': 'shared-secret',
    });
  });

  it('throws INVALID_RESPONSE when payload contract is malformed', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      fetchLambdaBackupStatus({
        baseUrl: 'https://backups.vercel.app',
        environment: 'main',
        lambdaAuthSecret: 'shared-secret',
      }),
    )) as LambdaBackupStatusError;

    expect(error).toBeInstanceOf(LambdaBackupStatusError);
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  it('throws HTTP error details when endpoint responds with non-2xx', async () => {
    const fetchMock = vi.fn(
      async () => new Response('failed', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      fetchLambdaBackupStatus({
        baseUrl: 'https://backups.vercel.app',
        environment: 'main',
        lambdaAuthSecret: 'shared-secret',
      }),
    )) as LambdaBackupStatusError;

    expect(error).toBeInstanceOf(LambdaBackupStatusError);
    expect(error.code).toBe('HTTP');
    expect(error.httpStatus).toBe(500);
  });

  it('fails when lambda auth secret is missing', async () => {
    const error = (await expectRejected(
      fetchLambdaBackupStatus({
        baseUrl: 'https://backups.vercel.app',
        environment: 'main',
        lambdaAuthSecret: '',
      }),
    )) as LambdaBackupStatusError;

    expect(error.code).toBe('MISSING_AUTH_SECRET');
  });

  it('preserves the actual environment ID for a clone crossing UTC midnight', async () => {
    const payload = statusPayload();
    const id = 'backup-plugin-daily-2026-10-02';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...payload,
              slots: {
                ...payload.slots,
                daily: { ...payload.slots.daily, lastManagedEnvironmentId: id },
              },
            }),
          ),
      ),
    );
    const result = await fetchLambdaBackupStatus(statusInput);
    expect(result.slots.daily.lastManagedEnvironmentId).toBe(id);
    expect(result.slots.daily.lastBackupAt).toBe('2026-10-03T00:20:00.000Z');
  });

  it('keeps old deployments compatible when lastManagedEnvironmentId is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(statusPayload()))),
    );
    const result = await fetchLambdaBackupStatus(statusInput);
    expect(result.slots.daily).not.toHaveProperty('lastManagedEnvironmentId');
    expect(result.slots).not.toHaveProperty('biweekly');
  });

  it('preserves an explicit null lastManagedEnvironmentId', async () => {
    const payload = statusPayload();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...payload,
              slots: {
                ...payload.slots,
                weekly: {
                  ...payload.slots.weekly,
                  lastManagedEnvironmentId: null,
                },
              },
            }),
          ),
      ),
    );
    const result = await fetchLambdaBackupStatus(statusInput);
    expect(result.slots.weekly.lastManagedEnvironmentId).toBeNull();
  });

  it.each(['invalid', '', '2026-02-30T02:05:00.000Z'])(
    'rejects invalid backup timestamp %s',
    async (lastBackupAt) => {
      const payload = statusPayload();
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...payload,
              slots: {
                ...payload.slots,
                daily: { ...payload.slots.daily, lastBackupAt },
              },
            }),
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(fetchLambdaBackupStatus(statusInput)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects malformed optional cadence instead of silently omitting it', async () => {
    const payload = statusPayload();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...payload,
              slots: {
                ...payload.slots,
                biweekly: {
                  ...payload.slots.daily,
                  scope: 'biweekly',
                  nextBackupAt: 'invalid',
                },
              },
            }),
          ),
      ),
    );
    await expect(fetchLambdaBackupStatus(statusInput)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects invalid checkedAt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...statusPayload(),
              checkedAt: '',
            }),
          ),
      ),
    );
    await expect(fetchLambdaBackupStatus(statusInput)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it.each([429, 503])(
    'exposes Retry-After for continuous polling on HTTP %s',
    async (status) => {
      const fetchMock = vi.fn(
        async () =>
          new Response('busy', {
            status,
            headers: { 'Retry-After': '30' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(fetchLambdaBackupStatus(statusInput)).rejects.toMatchObject({
        code: 'HTTP',
        httpStatus: status,
        retryAfterMs: 30000,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
