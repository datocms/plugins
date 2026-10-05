import { describe, expect, it, vi } from 'vitest';
import { changeCreators, type CreatorClient } from './bulkChangeCreator';

const creator = { id: 'new-user', type: 'user' as const };

function apiError(status: number) {
  return {
    response: {
      status,
      body: { data: [{ attributes: { code: 'SIMULATED_ERROR' } }] },
    },
  };
}

function clientWithUpdate(
  update: CreatorClient['items']['update'],
): CreatorClient {
  return { items: { update } };
}

describe('changeCreators', () => {
  it('updates each selected record once', async () => {
    const update = vi.fn(async () => {});
    const result = await changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'a'],
      creator,
    );
    expect(result).toEqual({
      total: 2,
      succeeded: 2,
      failed: 0,
      unprocessed: 0,
      failureSamples: [],
      stopped: false,
    });
    expect(update).toHaveBeenCalledWith('a', { creator });
    expect(update).toHaveBeenCalledWith('b', { creator });
  });

  it('continues after record-specific failures and keeps a short summary', async () => {
    const update = vi.fn(async (id: string) => {
      if (id !== 'ok') throw apiError(422);
    });
    const ids = [
      'ok',
      ...Array.from({ length: 8 }, (_, index) => `bad-${index}`),
    ];
    const result = await changeCreators(clientWithUpdate(update), ids, creator);
    expect(result).toMatchObject({ succeeded: 1, failed: 8, stopped: false });
    expect(result.failureSamples).toHaveLength(5);
    expect(result.failureSamples[0].error).toBe('HTTP 422 (SIMULATED_ERROR)');
  });

  it('stops starting new updates after an authentication error', async () => {
    const update = vi.fn(async () => {
      throw apiError(401);
    });
    const result = await changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'c'],
      creator,
      { concurrency: 1 },
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ failed: 1, unprocessed: 2, stopped: true });
  });

  it('stops scheduling when cancelled and lets started updates finish', async () => {
    const controller = new AbortController();
    const update = vi.fn(async () => {
      controller.abort();
    });
    const result = await changeCreators(
      clientWithUpdate(update),
      ['a', 'b', 'c'],
      creator,
      { concurrency: 1, signal: controller.signal },
    );
    expect(result).toMatchObject({
      succeeded: 1,
      unprocessed: 2,
      stopped: true,
    });
  });

  it('does not interrupt updates when a progress observer fails', async () => {
    const update = vi.fn(async () => {});
    const result = await changeCreators(
      clientWithUpdate(update),
      ['a', 'b'],
      creator,
      {
        onProgress: () => {
          throw new Error('Reporting failed');
        },
      },
    );
    expect(result).toMatchObject({ succeeded: 2, failed: 0 });
  });
});
