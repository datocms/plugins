import { describe, expect, it, vi } from 'vitest';
import { MAX_BULK_ITEMS } from '../constants';
import { buildBatches, executeBulkOperation } from './execute';
import {
  buildBulkDestroyPayload,
  buildBulkMoveToStagePayload,
  buildBulkPublishPayload,
  buildBulkUnpublishPayload,
} from './payloads';
import {
  bulkErrorMessage,
  bulkResultMessage,
  isPartialBulkResult,
} from './results';
import type { BulkClient, BulkJobResult } from './types';

function job(successful: number, failed: number): BulkJobResult {
  return { data: [], meta: { successful, failed } };
}

function mockClient() {
  const rawBulkPublish = vi.fn().mockResolvedValue(job(2, 0));
  const rawBulkUnpublish = vi.fn().mockResolvedValue(job(1, 1));
  const rawBulkDestroy = vi.fn().mockResolvedValue(job(0, 2));
  const rawBulkMoveToStage = vi.fn().mockResolvedValue(job(2, 0));
  const client = {
    items: {
      rawBulkPublish,
      rawBulkUnpublish,
      rawBulkDestroy,
      rawBulkMoveToStage,
    },
  } as unknown as BulkClient;

  return {
    client,
    rawBulkPublish,
    rawBulkUnpublish,
    rawBulkDestroy,
    rawBulkMoveToStage,
  };
}

describe('bulk JSON:API payloads', () => {
  it('builds publish, unpublish, destroy, and move payloads', () => {
    const relationships = {
      items: {
        data: [
          { id: 'one', type: 'item' },
          { id: 'two', type: 'item' },
        ],
      },
    };

    expect(buildBulkPublishPayload(['one', 'two'])).toEqual({
      data: { type: 'item_bulk_publish_operation', relationships },
    });
    expect(buildBulkUnpublishPayload(['one', 'two'])).toEqual({
      data: { type: 'item_bulk_unpublish_operation', relationships },
    });
    expect(buildBulkDestroyPayload(['one', 'two'])).toEqual({
      data: { type: 'item_bulk_destroy_operation', relationships },
    });
    expect(buildBulkMoveToStagePayload(['one', 'two'], 'review')).toEqual({
      data: {
        type: 'item_bulk_move_to_stage_operation',
        attributes: { stage: 'review' },
        relationships,
      },
    });
  });

  it('deduplicates IDs and rejects empty, oversized, or stage-less requests', () => {
    expect(
      buildBulkPublishPayload(['one', 'one']).data.relationships.items.data,
    ).toEqual([{ id: 'one', type: 'item' }]);
    expect(() => buildBulkDestroyPayload([])).toThrow(
      'requires at least one record',
    );
    expect(() =>
      buildBulkDestroyPayload(
        Array.from(
          { length: MAX_BULK_ITEMS + 1 },
          (_, index) => `item-${index}`,
        ),
      ),
    ).toThrow('cannot contain more than 200 records');
    expect(() => buildBulkMoveToStagePayload(['one'], '  ')).toThrow(
      'destination stage is required',
    );
  });
});

describe('executeBulkOperation', () => {
  it('calls every raw CMA bulk method and exposes result counts', async () => {
    const mocks = mockClient();

    await expect(
      executeBulkOperation(mocks.client, {
        operation: 'publish',
        itemIds: ['one', 'two'],
      }),
    ).resolves.toMatchObject({
      operation: 'publish',
      requested: 2,
      successful: 2,
      failed: 0,
    });
    await executeBulkOperation(mocks.client, {
      operation: 'unpublish',
      itemIds: ['one', 'two'],
    });
    await executeBulkOperation(mocks.client, {
      operation: 'delete',
      itemIds: ['one', 'two'],
    });
    await executeBulkOperation(mocks.client, {
      operation: 'move_to_stage',
      itemIds: ['one', 'two'],
      stage: 'review',
    });

    expect(mocks.rawBulkPublish).toHaveBeenCalledWith(
      buildBulkPublishPayload(['one', 'two']),
    );
    expect(mocks.rawBulkUnpublish).toHaveBeenCalledWith(
      buildBulkUnpublishPayload(['one', 'two']),
    );
    expect(mocks.rawBulkDestroy).toHaveBeenCalledWith(
      buildBulkDestroyPayload(['one', 'two']),
    );
    expect(mocks.rawBulkMoveToStage).toHaveBeenCalledWith(
      buildBulkMoveToStagePayload(['one', 'two'], 'review'),
    );
  });
});

describe('bulk result helpers', () => {
  it('formats success, partial, failure, and thrown errors', () => {
    expect(
      bulkResultMessage({
        operation: 'publish',
        requested: 2,
        successful: 2,
        failed: 0,
      }),
    ).toBe('2 records published.');

    const partial = {
      operation: 'unpublish' as const,
      requested: 2,
      successful: 1,
      failed: 1,
    };
    expect(isPartialBulkResult(partial)).toBe(true);
    expect(bulkResultMessage(partial)).toBe(
      '1 record unpublished; 1 record failed.',
    );
    expect(
      bulkResultMessage({
        operation: 'delete',
        requested: 2,
        successful: 0,
        failed: 2,
      }),
    ).toBe('No records were deleted; 2 records failed.');
    expect(bulkErrorMessage('move_to_stage', new Error('Network error'))).toBe(
      'Could not move the selected records: Network error',
    );
    expect(bulkErrorMessage('delete', null)).toBe(
      'Could not delete the selected records.',
    );
  });
});

describe('multi-batch bulk execution', () => {
  it('continues after a partial job but conservatively retains its IDs', async () => {
    const mocks = mockClient();
    mocks.rawBulkPublish
      .mockResolvedValueOnce(job(199, 1))
      .mockResolvedValueOnce(job(1, 0));
    const ids = Array.from({ length: 201 }, (_, index) => `id-${index}`);
    const result = await executeBulkOperation(mocks.client, {
      operation: 'publish',
      itemIds: ids,
    });
    expect(result).toMatchObject({
      successful: 200,
      failed: 1,
      remainingItemIds: ids.slice(0, 200),
    });
  });

  it('stops at a failed request, counting its batch as failed', async () => {
    const mocks = mockClient();
    mocks.rawBulkDestroy
      .mockResolvedValueOnce(job(200, 0))
      .mockRejectedValueOnce(new Error('Records no longer exist.'));
    const ids = Array.from({ length: 450 }, (_, index) => `id-${index}`);
    const result = await executeBulkOperation(mocks.client, {
      operation: 'delete',
      itemIds: ids,
    });
    expect(result).toMatchObject({
      successful: 200,
      failed: 200,
      unprocessed: 50,
      remainingItemIds: ids.slice(200),
    });
    expect(mocks.rawBulkDestroy).toHaveBeenCalledTimes(2);
    expect(bulkResultMessage(result)).toContain('Records no longer exist.');
  });

  it('awaits an accepted job before honoring cancellation of remaining batches', async () => {
    const mocks = mockClient();
    const controller = new AbortController();
    mocks.rawBulkMoveToStage.mockImplementation(async () => {
      controller.abort();
      return job(200, 0);
    });
    const result = await executeBulkOperation(
      mocks.client,
      {
        operation: 'move_to_stage',
        stage: 'review',
        itemIds: Array.from({ length: 201 }, (_, index) => `id-${index}`),
      },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      successful: 200,
      cancelled: true,
      unprocessed: 1,
      remainingItemIds: ['id-200'],
    });
    expect(mocks.rawBulkMoveToStage).toHaveBeenCalledTimes(1);
  });
});

describe('per-model move batches', () => {
  it('groups IDs by key in first-seen order, then caps each batch', () => {
    const ids = [
      ...Array.from({ length: 250 }, (_, i) => `a${i}`),
      'b0',
      'a250',
      'b1',
    ];
    const batches = buildBatches(ids, (id) => id[0]);
    expect(batches.map((batch) => batch.length)).toEqual([200, 51, 2]);
    expect(batches[2]).toEqual(['b0', 'b1']);
    expect(buildBatches(['x', 'y'])).toEqual([['x', 'y']]);
  });

  it('never mixes models in one move request', async () => {
    const mocks = mockClient();
    const modelOf: Record<string, string> = { a: 'post', b: 'page', c: 'post' };
    mocks.rawBulkMoveToStage.mockImplementation(async (payload) =>
      job(payload.data.relationships.items.data.length, 0),
    );

    const result = await executeBulkOperation(
      mocks.client,
      { operation: 'move_to_stage', itemIds: ['a', 'b', 'c'], stage: 'review' },
      { batchKey: (id) => modelOf[id] },
    );

    const sent = mocks.rawBulkMoveToStage.mock.calls.map(([payload]) =>
      payload.data.relationships.items.data.map(({ id }: { id: string }) => id),
    );
    expect(sent).toEqual([['a', 'c'], ['b']]);
    expect(result).toMatchObject({ successful: 3, failed: 0 });
  });
});
