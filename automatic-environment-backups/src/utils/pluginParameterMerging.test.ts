import { describe, expect, it, vi } from 'vitest';
import {
  createPluginParameterPersister,
  mergePluginParameterUpdates,
} from './pluginParameterMerging';

const createGate = () => {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

describe('mergePluginParameterUpdates', () => {
  it('preserves unrelated automaticBackupsSchedule fields', () => {
    const latestParameters = {
      automaticBackupsSchedule: {
        lastErrorByCadence: {
          weekly: 'Backup failed',
        },
      },
    };

    const merged = mergePluginParameterUpdates(latestParameters, {
      backupSchedule: {
        version: 1,
        enabledCadences: ['daily', 'weekly'],
        timezone: 'UTC',
        anchorLocalDate: '2026-02-27',
        updatedAt: '2026-02-27T12:00:00.000Z',
      },
    });

    expect(merged.automaticBackupsSchedule).toEqual(
      latestParameters.automaticBackupsSchedule,
    );
  });
});

describe('createPluginParameterPersister', () => {
  it('serializes concurrent saves and reads newer external schedule state for each save', async () => {
    let parameters: Record<string, unknown> = {
      lambdaAuthSecret: 'initial',
      automaticBackupsSchedule: { lastErrorByCadence: { weekly: 'previous' } },
    };
    const firstWriteStarted = createGate();
    const finishFirstWrite = createGate();
    const readLatest = vi.fn(async () => ({ ...parameters }));
    let writeCount = 0;
    const write = vi.fn(async (merged: Record<string, unknown>) => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted.open();
        await finishFirstWrite.promise;
        parameters = {
          ...merged,
          automaticBackupsSchedule: { lastErrorByCadence: { weekly: 'newer' } },
        };
      } else {
        parameters = merged;
      }
    });
    const persist = createPluginParameterPersister({
      initialParameters: parameters,
      readLatest,
      write,
    });

    const firstSave = persist({ lambdaAuthSecret: 'saved' });
    const secondSave = persist({ debug: true });
    await firstWriteStarted.promise;
    expect(readLatest).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);

    finishFirstWrite.open();
    const [firstResult, secondResult] = await Promise.all([
      firstSave,
      secondSave,
    ]);
    expect(firstResult?.lambdaAuthSecret).toBe('saved');
    expect(secondResult).toEqual({
      lambdaAuthSecret: 'saved',
      lambdaConnection: null,
      connectionValidationMode: null,
      debug: true,
      automaticBackupsSchedule: { lastErrorByCadence: { weekly: 'newer' } },
    });
    expect(parameters).toEqual(secondResult);
    expect(readLatest).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('composes queued writes from successful saves when no authoritative read is available', async () => {
    const write = vi.fn(
      async (_parameters: Record<string, unknown>) => undefined,
    );
    const persist = createPluginParameterPersister({
      initialParameters: { lambdaAuthSecret: 'saved' },
      readLatest: async () => undefined,
      write,
    });

    const results = await Promise.all([
      persist({ deploymentURL: 'https://backup.example.test' }),
      persist({
        backupSchedule: { enabledCadences: ['daily', 'weekly', 'monthly'] },
      }),
      persist({ debug: true }),
    ]);

    expect(results[2]).toEqual({
      lambdaAuthSecret: 'saved',
      deploymentURL: 'https://backup.example.test',
      lambdaConnection: null,
      connectionValidationMode: null,
      backupSchedule: { enabledCadences: ['daily', 'weekly', 'monthly'] },
      debug: true,
    });
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('fails closed on an authoritative read error without writing stale parameters', async () => {
    const readError = new Error('Authoritative read unavailable');
    const readLatest = vi
      .fn<() => Promise<Record<string, unknown> | undefined>>()
      .mockRejectedValueOnce(readError)
      .mockResolvedValueOnce({ automaticBackupsSchedule: { generation: 2 } });
    const write = vi.fn(
      async (_parameters: Record<string, unknown>) => undefined,
    );
    const persist = createPluginParameterPersister({
      initialParameters: { automaticBackupsSchedule: { generation: 1 } },
      readLatest,
      write,
    });

    await expect(persist({ debug: true })).rejects.toBe(readError);
    expect(write).not.toHaveBeenCalled();
    expect(await persist({ lambdaAuthSecret: 'saved' })).toEqual({
      automaticBackupsSchedule: { generation: 2 },
      lambdaAuthSecret: 'saved',
      lambdaConnection: null,
      connectionValidationMode: null,
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate a failed write into a later credentialless save', async () => {
    const writeError = new Error('Write failed');
    const write = vi
      .fn<(parameters: Record<string, unknown>) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(writeError)
      .mockResolvedValueOnce(undefined);
    const persist = createPluginParameterPersister({
      initialParameters: { lambdaAuthSecret: 'initial' },
      readLatest: async () => undefined,
      write,
    });

    await persist({ lambdaAuthSecret: 'successful' });
    await expect(
      persist({ lambdaAuthSecret: 'failed', debug: true }),
    ).rejects.toBe(writeError);
    expect(
      await persist({ deploymentURL: 'https://backup.example.test' }),
    ).toEqual({
      lambdaAuthSecret: 'successful',
      lambdaConnection: null,
      connectionValidationMode: null,
      deploymentURL: 'https://backup.example.test',
    });
    expect(write).toHaveBeenLastCalledWith({
      lambdaAuthSecret: 'successful',
      lambdaConnection: null,
      connectionValidationMode: null,
      deploymentURL: 'https://backup.example.test',
    });
  });

  it('invalidates the connection when a secret save changes the authoritative secret', async () => {
    const healthyConnection = { status: 'connected' };
    const write = vi.fn(
      async (_parameters: Record<string, unknown>) => undefined,
    );
    const persist = createPluginParameterPersister({
      initialParameters: { lambdaAuthSecret: 'input' },
      readLatest: async () => ({
        lambdaAuthSecret: 'externally-changed',
        lambdaConnection: healthyConnection,
        connectionValidationMode: 'health',
        automaticBackupsSchedule: { generation: 2 },
      }),
      write,
    });

    const result = await persist({ lambdaAuthSecret: 'input' });
    expect(result).toEqual({
      lambdaAuthSecret: 'input',
      lambdaConnection: null,
      connectionValidationMode: null,
      automaticBackupsSchedule: { generation: 2 },
    });
    expect(write).toHaveBeenCalledWith(result);
  });

  it('preserves the connection when a secret save matches the authoritative secret', async () => {
    const parameters = {
      lambdaAuthSecret: 'saved',
      lambdaConnection: { status: 'connected' },
      connectionValidationMode: 'health',
    };
    const persist = createPluginParameterPersister({
      initialParameters: {},
      readLatest: async () => parameters,
      write: async () => undefined,
    });

    expect(await persist({ lambdaAuthSecret: 'saved' })).toEqual(parameters);
  });

  it('invalidates a deployment URL save against the current authoritative URL', async () => {
    const write = vi.fn(
      async (_parameters: Record<string, unknown>) => undefined,
    );
    const persist = createPluginParameterPersister({
      initialParameters: { deploymentURL: 'https://backup.example.test' },
      readLatest: async () => ({
        deploymentURL: 'https://changed.example.test',
        lambdaConnection: { status: 'connected' },
        connectionValidationMode: 'health',
        automaticBackupsSchedule: { generation: 2 },
      }),
      write,
    });

    expect(
      await persist({ deploymentURL: 'https://backup.example.test' }),
    ).toEqual({
      deploymentURL: 'https://backup.example.test',
      lambdaConnection: null,
      connectionValidationMode: null,
      automaticBackupsSchedule: { generation: 2 },
    });
  });

  it('preserves a verified connection when the deployment URL stays unchanged', async () => {
    const parameters = {
      deploymentURL: 'https://backup.example.test',
      lambdaConnection: { status: 'connected' },
      connectionValidationMode: 'health',
    };
    const persist = createPluginParameterPersister({
      initialParameters: {},
      readLatest: async () => parameters,
      write: async () => undefined,
    });

    expect(
      await persist({ deploymentURL: 'https://backup.example.test' }),
    ).toEqual(parameters);
  });

  it.each([
    {
      lambdaAuthSecret: 'different',
      deploymentURL: 'https://backup.example.test',
    },
    {
      lambdaAuthSecret: 'saved',
      deploymentURL: 'https://different.example.test',
    },
  ])(
    'discards a health result after credentials changed: %j',
    async (parameters) => {
      const write = vi.fn(
        async (_parameters: Record<string, unknown>) => undefined,
      );
      const persist = createPluginParameterPersister({
        initialParameters: parameters,
        readLatest: async () => parameters,
        write,
      });

      expect(
        await persist(
          { lambdaConnection: { status: 'connected' } },
          {
            secret: 'saved',
            url: 'https://backup.example.test',
          },
        ),
      ).toBeUndefined();
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('checks a queued health result against the preceding successful credential save', async () => {
    const write = vi.fn(
      async (_parameters: Record<string, unknown>) => undefined,
    );
    const persist = createPluginParameterPersister({
      initialParameters: {
        lambdaAuthSecret: 'initial',
        deploymentURL: 'https://backup.example.test',
      },
      readLatest: async () => undefined,
      write,
    });

    const secretSave = persist({ lambdaAuthSecret: 'rotated' });
    const healthSave = persist(
      { lambdaConnection: { status: 'connected' } },
      {
        secret: 'initial',
        url: 'https://backup.example.test',
      },
    );
    const [savedParameters, healthResult] = await Promise.all([
      secretSave,
      healthSave,
    ]);

    expect(savedParameters?.lambdaAuthSecret).toBe('rotated');
    expect(healthResult).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it.each(['deploymentURL', 'netlifyURL', 'vercelURL'])(
    'matches health credentials through the saved %s reader',
    async (urlKey) => {
      const parameters = {
        lambdaAuthSecret: ' saved ',
        [urlKey]: ' https://backup.example.test ',
      };
      const write = vi.fn(
        async (_parameters: Record<string, unknown>) => undefined,
      );
      const persist = createPluginParameterPersister({
        initialParameters: {},
        readLatest: async () => parameters,
        write,
      });

      const result = await persist(
        { lambdaConnection: { status: 'connected' } },
        {
          secret: 'saved',
          url: 'https://backup.example.test',
        },
      );
      expect(result).toEqual({
        ...parameters,
        lambdaConnection: { status: 'connected' },
      });
      expect(write).toHaveBeenCalledWith(result);
    },
  );

  it('returns the actual persisted merge for save-and-act handlers', async () => {
    const write = vi.fn(
      async (_parameters: Record<string, unknown>) => undefined,
    );
    const persist = createPluginParameterPersister({
      initialParameters: { lambdaAuthSecret: 'stale-initial' },
      readLatest: async () => ({
        lambdaAuthSecret: 'authoritative',
        debug: true,
      }),
      write,
    });

    const result = await persist({
      deploymentURL: 'https://backup.example.test',
    });
    expect(result).toEqual({
      lambdaAuthSecret: 'authoritative',
      deploymentURL: 'https://backup.example.test',
      lambdaConnection: null,
      connectionValidationMode: null,
      debug: true,
    });
    expect(write).toHaveBeenCalledWith(result);
    expect(write.mock.calls[0]?.[0]).toBe(result);
  });
});
