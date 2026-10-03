import { describe, expect, it, vi } from 'vitest';
import {
  ASSET_PAGE_SIZE,
  type AssetApi,
  AssetOperationRejectedError,
  type AssetPage,
  DELETE_BATCH_SIZE,
  type DeletionProgress,
  type DiscoveryProgress,
  deleteUnusedAssets,
  discoverUnusedAssets,
  type UnusedAsset,
} from './unusedAssets';

type AssetQuery = Parameters<AssetApi['list']>[0];

function asset(index: number): UnusedAsset {
  return {
    id: `asset-${String(index).padStart(5, '0')}`,
    filename: `image-${index}.jpg`,
    url: `https://www.datocms-assets.com/project/image-${index}.jpg`,
    size: 1_000,
  };
}

function assets(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => asset(start + index));
}

/** Only the requested page is materialized; no record payloads are created. */
function fakeServer(
  assetCount: number,
  usage: (index: number) => boolean = () => false,
) {
  const removed = new Set<string>();
  const used = new Set<string>();
  const reads: AssetQuery[] = [];
  let activeJobs = 0;
  let maximumActiveJobs = 0;

  function exists(id: string) {
    const index = Number(id.slice('asset-'.length));
    return (
      id === asset(index).id &&
      index >= 0 &&
      index < assetCount &&
      !removed.has(id)
    );
  }

  function readLibraryPage(offset: number, limit: number): AssetPage {
    const page: UnusedAsset[] = [];
    let count = 0;
    for (let index = 0; index < assetCount; index++) {
      const id = `asset-${String(index).padStart(5, '0')}`;
      if (removed.has(id)) continue;
      if (count >= offset && page.length < limit) page.push(asset(index));
      count++;
    }
    return { assets: page, total: count };
  }

  const list = vi.fn<AssetApi['list']>(async (query, signal) => {
    if (signal?.aborted) throw new Error('Read aborted.');
    reads.push(query);
    const selected = query.filter?.ids?.split(',');
    const unusedOnly = query.filter?.fields !== undefined;
    const offset = query.page?.offset ?? 0;
    const limit = query.page?.limit ?? 30;
    if (!selected) return readLibraryPage(offset, limit);
    const matching = selected.filter((id) => {
      const index = Number(id.slice('asset-'.length));
      return exists(id) && (!unusedOnly || (!used.has(id) && !usage(index)));
    });
    return {
      assets: matching
        .slice(offset, offset + limit)
        .map((id) => asset(Number(id.slice('asset-'.length)))),
      total: matching.length,
    };
  });

  const destroy = vi.fn<AssetApi['destroy']>(async (ids) => {
    activeJobs++;
    maximumActiveJobs = Math.max(maximumActiveJobs, activeJobs);
    await Promise.resolve();
    let successful = 0;
    for (const id of ids) {
      const index = Number(id.slice('asset-'.length));
      if (exists(id) && !used.has(id) && !usage(index)) {
        removed.add(id);
        successful++;
      }
    }
    activeJobs--;
    return { successful, failed: ids.length - successful };
  });

  return {
    api: { list, destroy },
    list,
    destroy,
    reads,
    removed,
    used,
    maximumActiveJobs: () => maximumActiveJobs,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized.');
  };
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function expectMonotonicProgress(progress: DeletionProgress[], total: number) {
  expect(progress[0]).toMatchObject({
    total,
    processed: 0,
    deleted: 0,
    skipped: 0,
    missing: 0,
    failed: 0,
  });
  let previous = 0;
  for (const current of progress) {
    expect(current.total).toBe(total);
    expect(current.processed).toBe(
      current.deleted + current.skipped + current.missing + current.failed,
    );
    expect(current.processed).toBeGreaterThanOrEqual(previous);
    expect(current.processed).toBeLessThanOrEqual(total);
    previous = current.processed;
  }
}

describe('discoverUnusedAssets', () => {
  it('discovers all 10,000 assets through bounded complete-library pages and server-side usage checks', async () => {
    // This fixture models a large project without generating its 200,000 records.
    // Each nonzero bucket is an authoritative in_use reference from one source.
    const project = {
      recordCount: 200_000,
      models: 800,
      locales: 75,
      referenceSources: [
        'current',
        'published',
        'localized',
        'nested blocks',
        'reusable blocks',
        'site assets',
      ],
    };
    const server = fakeServer(
      10_000,
      (index) => index % (project.referenceSources.length + 1) !== 0,
    );
    const progress: DiscoveryProgress[] = [];
    const found = await discoverUnusedAssets(server.api, {
      onProgress: (value) => progress.push(value),
    });

    expect(project.recordCount).toBe(200_000);
    expect(found.map(({ id }) => id)).toEqual(
      Array.from(
        { length: Math.ceil(10_000 / 7) },
        (_, index) => asset(index * 7).id,
      ),
    );
    const libraryReads = server.reads.filter((query) => !query.filter);
    expect(libraryReads).toEqual(
      Array.from({ length: 20 }, (_, index) => ({
        order_by: 'id_ASC',
        page: { offset: index * 500, limit: 500 },
      })),
    );
    const usageReads = server.reads.filter((query) => query.filter);
    expect(usageReads).toHaveLength(100);
    for (const query of usageReads) {
      expect(query.filter?.fields).toEqual({ in_use: { eq: false } });
      expect(query.filter?.ids?.split(',')).toHaveLength(100);
      expect(query.page).toEqual({ offset: 0, limit: 100 });
      expect(query.locale).toBeUndefined();
    }
    expect(progress).toHaveLength(100);
    for (const [index, current] of progress.entries()) {
      expect(current).toEqual({
        scanned: (index + 1) * 100,
        found: Math.ceil(((index + 1) * 100) / 7),
        total: 10_000,
      });
    }
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('handles an empty library without writes or usage requests', async () => {
    const server = fakeServer(0);
    const onProgress = vi.fn();
    expect(await discoverUnusedAssets(server.api, { onProgress })).toEqual([]);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({
      scanned: 0,
      found: 0,
      total: 0,
    });
    expect(server.list).toHaveBeenCalledTimes(1);
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('loads a short final page and a short final classification group', async () => {
    const server = fakeServer(551);
    expect(await discoverUnusedAssets(server.api)).toEqual(assets(0, 551));
    expect(
      server.reads
        .filter((query) => !query.filter)
        .map((query) => query.page?.offset),
    ).toEqual([0, 500]);
    expect(
      server.reads
        .filter((query) => query.filter)
        .map((query) => query.filter?.ids?.split(',').length),
    ).toEqual([100, 100, 100, 100, 100, 51]);
  });

  it('does not shift library offsets when assets become used during classification', async () => {
    const server = fakeServer(1_001);
    const selected = await discoverUnusedAssets(server.api, {
      onProgress: ({ scanned }) => {
        if (scanned === 100) {
          server.used.add(asset(0).id);
          server.used.add(asset(100).id);
        }
      },
    });
    expect(selected).toEqual(
      assets(0, 1_001).filter(({ id }) => id !== asset(100).id),
    );
    expect(
      server.reads
        .filter((query) => !query.filter)
        .map((query) => query.page?.offset),
    ).toEqual([0, 500, 1_000]);
    const result = await deleteUnusedAssets(server.api, selected);
    expect(result).toMatchObject({
      total: 1_000,
      processed: 1_000,
      deleted: 999,
      skipped: 1,
    });
  });

  it.each([
    ['changed library count', { assets: assets(500, 1), total: 502 }],
    ['short library page', { assets: [], total: 501 }],
    ['duplicate ID across pages', { assets: [asset(0)], total: 501 }],
  ])('rejects %s after three continuous scans without deleting anything', async (_label, secondPage) => {
    const server = fakeServer(501);
    const originalList = server.list.getMockImplementation();
    server.list.mockImplementation(async (query, signal) => {
      if (query.page?.offset === 500) return secondPage;
      if (!originalList) throw new Error('Missing list implementation.');
      return originalList(query, signal);
    });
    await expect(discoverUnusedAssets(server.api)).rejects.toThrow(
      'changed during discovery',
    );
    expect(
      server.list.mock.calls
        .filter(([query]) => !query.filter)
        .map(([query]) => query.page?.offset),
    ).toEqual([0, 500, 0, 500, 0, 500]);
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('automatically recovers a complete fresh selection after one structural library change', async () => {
    const initial = fakeServer(501);
    const stable = fakeServer(502);
    let scans = 0;
    const list = vi.fn<AssetApi['list']>(async (query, signal) => {
      if (!query.filter && query.page?.offset === 0) scans++;
      if (scans === 1 && !query.filter && query.page?.offset === 500) {
        return { assets: [asset(500)], total: 502 };
      }
      return (scans === 1 ? initial : stable).list(query, signal);
    });
    const progress: DiscoveryProgress[] = [];
    const found = await discoverUnusedAssets(
      { list, destroy: stable.destroy },
      {
        onProgress: (value) => progress.push(value),
      },
    );
    expect(scans).toBe(2);
    expect(found).toEqual(assets(0, 502));
    expect(new Set(found.map(({ id }) => id)).size).toBe(502);
    expect(
      progress.filter(({ attempt }) => attempt === undefined),
    ).toHaveLength(5);
    expect(progress.filter(({ attempt }) => attempt === 2)).toEqual([
      ...Array.from({ length: 5 }, (_, index) => ({
        scanned: (index + 1) * 100,
        found: (index + 1) * 100,
        total: 502,
        attempt: 2,
      })),
      { scanned: 502, found: 502, total: 502, attempt: 2 },
    ]);
    expect(stable.destroy).not.toHaveBeenCalled();
    expect(initial.destroy).not.toHaveBeenCalled();
  });

  it('stops after three unstable scans and never returns a partial selection', async () => {
    const server = fakeServer(501);
    const originalList = server.list.getMockImplementation();
    server.list.mockImplementation(async (query, signal) => {
      if (!query.filter && query.page?.offset === 500)
        return { assets: [], total: 501 };
      if (!originalList) throw new Error('Missing list implementation.');
      return originalList(query, signal);
    });
    const progress: DiscoveryProgress[] = [];
    await expect(
      discoverUnusedAssets(server.api, {
        onProgress: (value) => progress.push(value),
      }),
    ).rejects.toThrow('changed during discovery');
    expect(
      server.list.mock.calls.filter(([query]) => !query.filter),
    ).toHaveLength(6);
    expect(progress.map(({ attempt }) => attempt ?? 1)).toEqual([
      ...Array.from({ length: 5 }, () => 1),
      ...Array.from({ length: 5 }, () => 2),
      ...Array.from({ length: 5 }, () => 3),
    ]);
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('does not restart a scan after an API permission or transport error', async () => {
    const server = fakeServer(501);
    server.list.mockRejectedValueOnce(new Error('Permission denied.'));
    await expect(discoverUnusedAssets(server.api)).rejects.toThrow(
      'Permission denied.',
    );
    expect(server.list).toHaveBeenCalledTimes(1);
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['negative count', { assets: [], total: -1 }],
    ['fractional count', { assets: [], total: 0.5 }],
    ['unsafe count', { assets: [], total: Number.MAX_SAFE_INTEGER + 1 }],
    ['nonfinite count', { assets: [], total: Number.NaN }],
    [
      'oversized page',
      { assets: assets(0, ASSET_PAGE_SIZE + 1), total: ASSET_PAGE_SIZE + 1 },
    ],
    ['empty asset ID', { assets: [{ ...asset(0), id: '' }], total: 1 }],
  ])('rejects malformed discovery data: %s', async (_label, page) => {
    const server = fakeServer(1);
    server.list.mockResolvedValueOnce(page);
    await expect(discoverUnusedAssets(server.api)).rejects.toThrow(
      'invalid asset page',
    );
    expect(server.list).toHaveBeenCalledTimes(1);
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['unexpected ID', { assets: [asset(999)], total: 1 }],
    ['duplicate classified ID', { assets: [asset(0), asset(0)], total: 2 }],
    ['incomplete classification', { assets: [asset(0)], total: 2 }],
  ])('rejects %s from a usage response', async (_label, page) => {
    const server = fakeServer(2);
    server.list
      .mockResolvedValueOnce({ assets: assets(0, 2), total: 2 })
      .mockResolvedValueOnce(page);
    await expect(discoverUnusedAssets(server.api)).rejects.toThrow(
      'incomplete or unexpected',
    );
    expect(server.list).toHaveBeenCalledTimes(2);
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('cancels before any request', async () => {
    const server = fakeServer(10_000);
    const controller = new AbortController();
    controller.abort();
    await expect(
      discoverUnusedAssets(server.api, { signal: controller.signal }),
    ).rejects.toThrow('cancelled');
    expect(server.list).not.toHaveBeenCalled();
  });

  it('cancels after an in-flight page read without classifying it', async () => {
    const server = fakeServer(10_000);
    const controller = new AbortController();
    const read = deferred<AssetPage>();
    server.list.mockReturnValueOnce(read.promise);
    const scan = discoverUnusedAssets(server.api, {
      signal: controller.signal,
    });
    controller.abort();
    read.resolve({ assets: assets(0, 500), total: 10_000 });
    await expect(scan).rejects.toThrow('cancelled');
    expect(server.list).toHaveBeenCalledTimes(1);
    expect(server.destroy).not.toHaveBeenCalled();
  });
});

describe('deleteUnusedAssets', () => {
  it('deletes all 10,000 selected IDs exactly once with bounded sequential jobs and exact progress', async () => {
    const server = fakeServer(10_000);
    const selected = await discoverUnusedAssets(server.api);
    expect(selected).toHaveLength(10_000);
    const progress: DeletionProgress[] = [];
    const result = await deleteUnusedAssets(server.api, selected, {
      onProgress: (value) => progress.push(value),
    });

    expect(DELETE_BATCH_SIZE).toBeLessThanOrEqual(200);
    expect(server.destroy).toHaveBeenCalledTimes(100);
    expect(server.destroy.mock.calls.flatMap(([ids]) => ids)).toEqual(
      assets(0, 10_000).map(({ id }) => id),
    );
    for (const [ids] of server.destroy.mock.calls)
      expect(ids).toHaveLength(100);
    expect(server.maximumActiveJobs()).toBe(1);
    expect(result).toEqual({
      total: 10_000,
      processed: 10_000,
      deleted: 10_000,
      skipped: 0,
      missing: 0,
      failed: 0,
      uncertain: 0,
      freedBytes: 10_000_000,
      freedBytesEstimated: false,
      cancelled: false,
    });
    expectMonotonicProgress(progress, 10_000);
    expect(progress.map(({ processed }) => processed)).toEqual(
      Array.from({ length: 101 }, (_, index) => index * 100),
    );
  });

  it('deletes only the discovered snapshot, even when another unused asset appears', async () => {
    const server = fakeServer(2);
    const selected = await discoverUnusedAssets(server.api);
    const expandedServer = fakeServer(3);
    const result = await deleteUnusedAssets(expandedServer.api, selected);
    expect(result.deleted).toBe(2);
    expect(expandedServer.destroy).toHaveBeenCalledExactlyOnceWith([
      asset(0).id,
      asset(1).id,
    ]);
    expect(expandedServer.removed.has(asset(2).id)).toBe(false);
  });

  it('deduplicates a repeated selection before writing and counts a partial final batch', async () => {
    const server = fakeServer(101);
    const selected = [...assets(0, 101), asset(0), asset(100)];
    const result = await deleteUnusedAssets(server.api, selected);
    expect(result).toMatchObject({ total: 101, processed: 101, deleted: 101 });
    expect(server.destroy.mock.calls.map(([ids]) => ids.length)).toEqual([
      100, 1,
    ]);
  });

  it('rechecks usage changes and assets deleted externally before the first write', async () => {
    const server = fakeServer(3);
    const selected = await discoverUnusedAssets(server.api);
    server.used.add(asset(1).id);
    server.removed.add(asset(2).id);
    const result = await deleteUnusedAssets(server.api, selected);
    expect(result).toEqual({
      total: 3,
      processed: 3,
      deleted: 1,
      skipped: 1,
      missing: 1,
      failed: 0,
      uncertain: 0,
      freedBytes: 1_000,
      freedBytesEstimated: false,
      cancelled: false,
    });
    expect(server.destroy).toHaveBeenCalledExactlyOnceWith([asset(0).id]);
  });

  it('adds up the sizes of the assets each job actually removed', async () => {
    const server = fakeServer(3);
    const selected = [
      { ...asset(0), size: 1_536 },
      { ...asset(1), size: 4_096 },
      { ...asset(2), size: 10 },
    ];
    server.used.add(asset(1).id);
    const result = await deleteUnusedAssets(server.api, selected);
    expect(result).toMatchObject({
      deleted: 2,
      skipped: 1,
      freedBytes: 1_546,
      freedBytesEstimated: false,
    });
  });

  it('estimates freed storage when another removal hides which assets the job deleted', async () => {
    const server = fakeServer(2);
    server.destroy.mockImplementationOnce(async (ids) => {
      for (const id of ids) server.removed.add(id);
      return { successful: 1, failed: 0 };
    });
    const selected = [
      { ...asset(0), size: 1_000 },
      { ...asset(1), size: 3_000 },
    ];
    const result = await deleteUnusedAssets(server.api, selected);
    expect(result).toMatchObject({
      deleted: 1,
      missing: 1,
      freedBytes: 2_000,
      freedBytesEstimated: true,
    });
  });

  it('skips an asset reused between revalidation and the write after the API rejects that subset', async () => {
    const server = fakeServer(3);
    server.destroy.mockImplementationOnce(async (ids) => {
      server.used.add(asset(1).id);
      for (const id of ids) if (id !== asset(1).id) server.removed.add(id);
      return { successful: 2, failed: 1 };
    });
    const result = await deleteUnusedAssets(server.api, assets(0, 3));
    expect(result).toMatchObject({
      processed: 3,
      deleted: 2,
      skipped: 1,
      failed: 0,
      uncertain: 0,
    });
    expect(server.destroy).toHaveBeenCalledTimes(1);
  });

  it('automatically retries only the remaining IDs of confirmed partial jobs up to three attempts', async () => {
    const server = fakeServer(4);
    server.destroy
      .mockImplementationOnce(async () => {
        server.removed.add(asset(0).id);
        server.removed.add(asset(1).id);
        return { successful: 2, failed: 2 };
      })
      .mockImplementationOnce(async () => {
        server.removed.add(asset(2).id);
        return { successful: 1, failed: 1 };
      });
    const result = await deleteUnusedAssets(server.api, assets(0, 4));
    expect(server.destroy.mock.calls.map(([ids]) => ids)).toEqual([
      assets(0, 4).map(({ id }) => id),
      [asset(2).id, asset(3).id],
      [asset(3).id],
    ]);
    expect(result).toMatchObject({
      processed: 4,
      deleted: 4,
      failed: 0,
      uncertain: 0,
    });
  });

  it('counts exhausted failures while continuously processing subsequent batches', async () => {
    const server = fakeServer(101);
    server.destroy
      .mockResolvedValueOnce({ successful: 0, failed: 100 })
      .mockResolvedValueOnce({ successful: 0, failed: 100 })
      .mockResolvedValueOnce({ successful: 0, failed: 100 });
    const progress: DeletionProgress[] = [];
    const result = await deleteUnusedAssets(server.api, assets(0, 101), {
      onProgress: (value) => progress.push(value),
    });
    expect(result).toMatchObject({
      processed: 101,
      deleted: 1,
      failed: 100,
      uncertain: 0,
    });
    expect(server.destroy.mock.calls.map(([ids]) => ids.length)).toEqual([
      100, 100, 100, 1,
    ]);
    expectMonotonicProgress(progress, 101);
  });

  it('does not write when cancelled before starting', async () => {
    const server = fakeServer(10_000);
    const controller = new AbortController();
    controller.abort();
    const result = await deleteUnusedAssets(server.api, assets(0, 10_000), {
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      total: 10_000,
      processed: 0,
      cancelled: true,
    });
    expect(server.list).not.toHaveBeenCalled();
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('does not write when cancelled during a revalidation read', async () => {
    const server = fakeServer(10_000);
    const controller = new AbortController();
    const read = deferred<AssetPage>();
    server.list.mockReturnValueOnce(read.promise);
    const deletion = deleteUnusedAssets(server.api, assets(0, 10_000), {
      signal: controller.signal,
    });
    controller.abort();
    read.resolve({ assets: assets(0, 100), total: 100 });
    const result = await deletion;
    expect(result).toMatchObject({ processed: 0, cancelled: true });
    expect(result.error).toBeUndefined();
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('finishes accounting for the in-flight job after cancellation without launching the next batch', async () => {
    const server = fakeServer(201);
    const controller = new AbortController();
    const started = deferred<void>();
    const job = deferred<{ successful: number; failed: number }>();
    server.destroy.mockImplementationOnce(async (ids) => {
      started.resolve();
      const outcome = await job.promise;
      for (const id of ids) server.removed.add(id);
      return outcome;
    });
    const progress: DeletionProgress[] = [];
    const deletion = deleteUnusedAssets(server.api, assets(0, 201), {
      signal: controller.signal,
      onProgress: (value) => progress.push(value),
    });
    await started.promise;
    controller.abort();
    job.resolve({ successful: 100, failed: 0 });
    const result = await deletion;
    expect(result).toMatchObject({
      total: 201,
      processed: 100,
      deleted: 100,
      cancelled: true,
    });
    expect(server.destroy).toHaveBeenCalledTimes(1);
    expect(
      server.list.mock.calls[server.list.mock.calls.length - 1]?.[1],
    ).toBeUndefined();
    expectMonotonicProgress(progress, 201);
  });

  it('counts a definitive pre-job HTTP rejection as failed and stops without reconciliation or later writes', async () => {
    const server = fakeServer(201);
    const safeMessage = 'HTTP 403: The asset deletion request was rejected.';
    server.destroy.mockRejectedValueOnce(
      new AssetOperationRejectedError(safeMessage),
    );
    const progress: DeletionProgress[] = [];
    const result = await deleteUnusedAssets(server.api, assets(0, 201), {
      onProgress: (value) => progress.push(value),
    });
    expect(result).toEqual({
      total: 201,
      processed: 100,
      deleted: 0,
      skipped: 0,
      missing: 0,
      failed: 100,
      uncertain: 0,
      freedBytes: 0,
      freedBytesEstimated: false,
      cancelled: false,
      error: safeMessage,
    });
    expect(server.destroy).toHaveBeenCalledExactlyOnceWith(
      assets(0, 100).map(({ id }) => id),
    );
    expect(server.list).toHaveBeenCalledTimes(1);
    expect(server.list.mock.calls[0]?.[0].filter?.fields).toEqual({
      in_use: { eq: false },
    });
    expect(server.removed.size).toBe(0);
    expectMonotonicProgress(progress, 201);
    expect(progress.map(({ processed }) => processed)).toEqual([0, 100]);
  });

  it('never replays an ambiguous mutation timeout, reconciles proven deletions, and stops', async () => {
    const server = fakeServer(201);
    server.destroy.mockImplementationOnce(async () => {
      server.removed.add(asset(0).id);
      server.removed.add(asset(1).id);
      throw new Error('Mutation timed out.');
    });
    const result = await deleteUnusedAssets(server.api, assets(0, 201));
    expect(result).toMatchObject({
      total: 201,
      processed: 2,
      deleted: 0,
      missing: 2,
      uncertain: 98,
      failed: 0,
    });
    expect(result.error).toBeTruthy();
    expect(server.destroy).toHaveBeenCalledTimes(1);
    expect(
      server.list.mock.calls[server.list.mock.calls.length - 1]?.[1],
    ).toBeUndefined();
  });

  it('leaves the entire ambiguous batch uncertain if reconciliation also fails', async () => {
    const server = fakeServer(101);
    server.list
      .mockResolvedValueOnce({ assets: assets(0, 100), total: 100 })
      .mockRejectedValueOnce(new Error('Reconciliation failed.'));
    server.destroy.mockRejectedValueOnce(new Error('Mutation timed out.'));
    const result = await deleteUnusedAssets(server.api, assets(0, 101));
    expect(result).toMatchObject({
      processed: 0,
      deleted: 0,
      failed: 0,
      uncertain: 100,
    });
    expect(server.destroy).toHaveBeenCalledTimes(1);
    expect(server.list).toHaveBeenCalledTimes(2);
  });

  it('stops without writes when pre-deletion revalidation fails', async () => {
    const server = fakeServer(101);
    server.list.mockRejectedValueOnce(new Error('Read failed.'));
    const result = await deleteUnusedAssets(server.api, assets(0, 101));
    expect(result).toMatchObject({
      total: 101,
      processed: 0,
      deleted: 0,
      uncertain: 0,
    });
    expect(result.error).toBeTruthy();
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it('does not write when revalidation returns an asset outside the confirmed selection', async () => {
    const server = fakeServer(101);
    server.list.mockResolvedValueOnce({ assets: [asset(999)], total: 1 });
    const result = await deleteUnusedAssets(server.api, assets(0, 101));
    expect(result).toMatchObject({ processed: 0, deleted: 0, uncertain: 0 });
    expect(result.error).toMatch(/incomplete or unexpected/);
    expect(server.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['sum exceeds submitted batch', { successful: 2, failed: 1 }],
    ['negative count', { successful: -1, failed: 3 }],
    ['fractional count', { successful: 0.5, failed: 1.5 }],
    ['nonfinite count', { successful: Number.NaN, failed: 0 }],
    ['unsafe count', { successful: Number.MAX_SAFE_INTEGER + 1, failed: 0 }],
  ])('never retries an invalid terminal mutation result: %s', async (_label, outcome) => {
    const server = fakeServer(2);
    server.destroy.mockResolvedValueOnce(outcome);
    const result = await deleteUnusedAssets(server.api, assets(0, 2));
    expect(result).toMatchObject({
      processed: 0,
      deleted: 0,
      failed: 0,
      uncertain: 2,
    });
    expect(result.error).toBeTruthy();
    expect(server.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses authoritative terminal counters if the post-job reconciliation read fails', async () => {
    const server = fakeServer(101);
    server.list
      .mockResolvedValueOnce({ assets: assets(0, 100), total: 100 })
      .mockRejectedValueOnce(new Error('Reconciliation failed.'));
    server.destroy.mockResolvedValueOnce({ successful: 70, failed: 30 });
    const result = await deleteUnusedAssets(server.api, assets(0, 101));
    expect(result).toMatchObject({
      total: 101,
      processed: 100,
      deleted: 70,
      failed: 30,
      uncertain: 0,
    });
    expect(result.error).toBeTruthy();
    expect(server.destroy).toHaveBeenCalledTimes(1);
    expect(server.list).toHaveBeenCalledTimes(2);
  });

  it('marks unaccounted IDs uncertain when incomplete terminal counters cannot be reconciled', async () => {
    const server = fakeServer(4);
    server.list
      .mockResolvedValueOnce({ assets: assets(0, 4), total: 4 })
      .mockRejectedValueOnce(new Error('Reconciliation failed.'));
    server.destroy.mockResolvedValueOnce({ successful: 1, failed: 1 });

    const result = await deleteUnusedAssets(server.api, assets(0, 4));

    expect(result).toMatchObject({
      total: 4,
      processed: 2,
      deleted: 1,
      failed: 1,
      uncertain: 2,
    });
    expect(result.error).toBeTruthy();
    expect(server.destroy).toHaveBeenCalledTimes(1);
    expect(server.list).toHaveBeenCalledTimes(2);
  });

  it('accepts terminal counts below the batch size when another actor removed an asset', async () => {
    const server = fakeServer(3);
    server.destroy.mockImplementationOnce(async () => {
      server.removed.add(asset(0).id);
      server.removed.add(asset(1).id);
      return { successful: 1, failed: 1 };
    });
    const result = await deleteUnusedAssets(server.api, assets(0, 3));
    expect(server.destroy.mock.calls.map(([ids]) => ids)).toEqual([
      assets(0, 3).map(({ id }) => id),
      [asset(2).id],
    ]);
    expect(result).toMatchObject({
      total: 3,
      processed: 3,
      deleted: 2,
      missing: 1,
      failed: 0,
      uncertain: 0,
    });
    expect(result.error).toBeUndefined();
  });

  it('stops without replay when completed counters claim more deletions than the read confirms', async () => {
    const server = fakeServer(101);
    server.destroy.mockResolvedValueOnce({ successful: 70, failed: 30 });
    const result = await deleteUnusedAssets(server.api, assets(0, 101));
    expect(result).toMatchObject({
      total: 101,
      processed: 70,
      deleted: 70,
      failed: 0,
      uncertain: 30,
    });
    expect(result.error).toMatch(/inconsistent deletion counts/);
    expect(server.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    'list',
    'destroy',
  ] as const)('does not expose token or raw HTTP payloads from %s errors', async (method) => {
    const server = fakeServer(2);
    server[method].mockRejectedValueOnce(
      new Error(
        'Authorization: Bearer secret-token; payload={"private":"record-data"}',
      ),
    );
    const result = await deleteUnusedAssets(server.api, assets(0, 2));
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(
      /secret-token|Authorization|record-data|payload=/,
    );
  });
});
