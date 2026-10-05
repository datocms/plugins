import type { Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteUnusedAssets,
  discoverUnusedAssets,
  type UnusedAsset,
} from './unusedAssets';

function upload(id: string) {
  return {
    id,
    type: 'upload',
    attributes: {
      filename: `${id}.jpg`,
      url: `https://x.test/${id}`,
      size: 10,
    },
  };
}

function asset(id: string): UnusedAsset {
  return { id, filename: `${id}.jpg`, url: `https://x.test/${id}`, size: 10 };
}

type ListQuery = { filter?: { ids?: string }; page?: { offset?: number } };

// An API whose library holds `unused` assets; `used` ones fail the re-check.
function fakeClient(options: {
  unused: string[];
  used?: string[];
  destroy?: (ids: string[]) => { successful: number; failed: number };
}) {
  const rawList = vi.fn(async (query: ListQuery) => {
    const ids = query.filter?.ids?.split(',');
    const matching = ids
      ? ids.filter((id) => !options.used?.includes(id))
      : options.unused;
    const offset = query.page?.offset ?? 0;
    return {
      data: matching.slice(offset, offset + 500).map(upload),
      meta: { total_count: matching.length },
    };
  });
  const rawBulkDestroy = vi.fn(
    async (body: {
      data: { relationships: { uploads: { data: { id: string }[] } } };
    }) => {
      const ids = body.data.relationships.uploads.data.map(({ id }) => id);
      return {
        data: [],
        meta: options.destroy?.(ids) ?? { successful: ids.length, failed: 0 },
      };
    },
  );
  const client = { uploads: { rawList, rawBulkDestroy } } as unknown as Client;
  return { client, rawList, rawBulkDestroy };
}

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `a${index}`);

describe('discoverUnusedAssets', () => {
  it('pages through the unused assets and reports progress', async () => {
    const { client, rawList } = fakeClient({ unused: ids(501) });
    const onProgress = vi.fn();
    const assets = await discoverUnusedAssets(client, { onProgress });
    expect(assets).toHaveLength(501);
    expect(rawList).toHaveBeenCalledTimes(2);
    expect(rawList.mock.calls[1]?.[0]).toMatchObject({
      filter: { fields: { in_use: { eq: false } } },
      page: { offset: 500, limit: 500 },
    });
    expect(onProgress).toHaveBeenLastCalledWith({ found: 501, total: 501 });
  });

  it('handles an empty library', async () => {
    const { client } = fakeClient({ unused: [] });
    await expect(discoverUnusedAssets(client)).resolves.toEqual([]);
  });

  it('stops when cancelled', async () => {
    const { client, rawList } = fakeClient({ unused: ids(3) });
    const controller = new AbortController();
    controller.abort();
    await expect(
      discoverUnusedAssets(client, { signal: controller.signal }),
    ).rejects.toThrow('cancelled');
    expect(rawList).not.toHaveBeenCalled();
  });
});

describe('deleteUnusedAssets', () => {
  it('deletes in batches of 100 and adds up the freed storage', async () => {
    const { client, rawBulkDestroy } = fakeClient({ unused: ids(250) });
    const onProgress = vi.fn();
    const result = await deleteUnusedAssets(client, ids(250).map(asset), {
      onProgress,
    });
    expect(
      rawBulkDestroy.mock.calls.map(
        ([body]) => body.data.relationships.uploads.data.length,
      ),
    ).toEqual([100, 100, 50]);
    expect(result).toMatchObject({
      processed: 250,
      deleted: 250,
      skipped: 0,
      failed: 0,
      freedBytes: 2500,
      freedBytesEstimated: false,
      cancelled: false,
    });
    expect(onProgress).toHaveBeenCalledTimes(4);
  });

  it('keeps assets that are in use again when the batch is re-checked', async () => {
    const { client, rawBulkDestroy } = fakeClient({
      unused: ids(3),
      used: ['a1'],
    });
    const result = await deleteUnusedAssets(client, ids(3).map(asset));
    const deleted =
      rawBulkDestroy.mock.calls[0]?.[0].data.relationships.uploads.data;
    expect(deleted).toEqual([
      { type: 'upload', id: 'a0' },
      { type: 'upload', id: 'a2' },
    ]);
    expect(result).toMatchObject({ deleted: 2, skipped: 1, freedBytes: 20 });
  });

  it('estimates freed storage when part of a job fails', async () => {
    const { client } = fakeClient({
      unused: ids(4),
      destroy: () => ({ successful: 3, failed: 1 }),
    });
    const result = await deleteUnusedAssets(client, ids(4).map(asset));
    expect(result).toMatchObject({
      deleted: 3,
      failed: 1,
      freedBytes: 30,
      freedBytesEstimated: true,
    });
  });

  it('stops after the current batch when cancelled', async () => {
    const controller = new AbortController();
    const { client, rawBulkDestroy } = fakeClient({
      unused: ids(150),
      destroy: (batch) => {
        controller.abort();
        return { successful: batch.length, failed: 0 };
      },
    });
    const result = await deleteUnusedAssets(client, ids(150).map(asset), {
      signal: controller.signal,
    });
    expect(rawBulkDestroy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      processed: 100,
      deleted: 100,
      cancelled: true,
    });
  });

  it('stops on an API error without deleting further batches', async () => {
    const { client, rawBulkDestroy } = fakeClient({ unused: ids(150) });
    rawBulkDestroy.mockRejectedValueOnce(new Error('boom'));
    const result = await deleteUnusedAssets(client, ids(150).map(asset));
    expect(rawBulkDestroy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      processed: 0,
      deleted: 0,
      cancelled: false,
    });
    expect(result.error).toContain('No further assets were deleted');
  });
});
