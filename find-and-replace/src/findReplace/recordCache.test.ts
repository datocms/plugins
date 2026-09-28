import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatcherWorkerTimeoutError } from '../selection/matcher';
import type { DiscoveryModel } from '../selection/query';
import {
  acmeRecords,
  allMatches,
  createFakeCma,
  type FakeCma,
  httpError,
  inlineMatchField,
  manyRecords,
  type RawNestedItem,
  rawRecord,
  replaceAll,
  searchFor,
  settle,
  setupController,
} from './findReplace.fixtures';
import { RecordCache, recordSize } from './recordCache';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const ARTICLE: DiscoveryModel = {
  id: 'article',
  apiKey: 'article',
  name: 'Article',
};

function articles(count: number): RawNestedItem[] {
  return manyRecords(count).map((record) => rawRecord(record));
}

async function scanWith(
  cache: RecordCache,
  cma: FakeCma,
  options: Parameters<RecordCache['recordSource']>[0] = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<RawNestedItem[]> {
  const delivered: RawNestedItem[] = [];
  const source = cache.recordSource(options)(ARTICLE);
  await source.scan({
    client: cma.client,
    model: ARTICLE,
    scope: { publicationStatuses: [], locales: ['en'] },
    signal,
    onRecords: async (records) => {
      delivered.push(...records);
    },
  });
  return delivered;
}

describe('RecordCache', () => {
  it('keeps entries for the TTL', () => {
    let now = 1_000;
    const cache = new RecordCache({
      maxRecords: 100,
      ttlMs: 500,
      now: () => now,
    });
    expect(cache.store('article', articles(3))).toBe(true);
    expect(cache.fresh('article')).toHaveLength(3);
    expect(cache.covers(['article'])).toBe(true);
    expect(cache.covers(['article', 'page'])).toBe(false);

    now += 499;
    expect(cache.fresh('article')).toHaveLength(3);
    now += 1;
    expect(cache.fresh('article')).toBeNull();
    expect(cache.covers(['article'])).toBe(false);
  });

  it('never goes over `maxRecords`', () => {
    const cache = new RecordCache({ maxRecords: 5, ttlMs: 60_000 });
    expect(cache.store('article', articles(3))).toBe(true);
    expect(cache.store('page', articles(3))).toBe(false);
    expect(cache.fresh('page')).toBeNull();
    // Replacing a model's own entry only counts the others.
    expect(cache.store('article', articles(5))).toBe(true);
    expect(cache.size).toBe(5);
    // A model that no longer fits loses its older entry too.
    expect(cache.store('article', articles(6))).toBe(false);
    expect(cache.has('article')).toBe(false);
  });

  it('never goes over `maxBytes` either, measured as JSON', async () => {
    const three = articles(3);
    const threeBytes = three.reduce(
      (sum, record) => sum + recordSize(record),
      0,
    );
    const cache = new RecordCache({
      maxRecords: 100,
      maxBytes: threeBytes + 10,
      ttlMs: 60_000,
    });
    expect(cache.store('article', three)).toBe(true);
    expect(cache.bytes).toBe(threeBytes);
    expect(cache.store('page', articles(1))).toBe(false);
    expect(cache.has('page')).toBe(false);

    // A re-read that makes the entry too big drops it.
    const grown = {
      ...three[0],
      attributes: { body: 'Globex '.repeat(20) },
    } as RawNestedItem;
    cache.replaceRecords('article', [grown.id], [grown]);
    expect(cache.has('article')).toBe(false);

    // A network scan that doesn't fit keeps nothing.
    const cma = createFakeCma(manyRecords(40));
    const small = new RecordCache({
      maxRecords: 100,
      maxBytes: threeBytes,
      ttlMs: 60_000,
    });
    expect(await scanWith(small, cma)).toHaveLength(40);
    expect(small.has('article')).toBe(false);
    expect(small.bytes).toBe(0);
  });

  it('releases expired entries when a search starts', () => {
    let now = 0;
    const cache = new RecordCache({
      maxRecords: 100,
      ttlMs: 500,
      now: () => now,
    });
    cache.store('article', articles(3));
    now = 500;
    expect(cache.has('article')).toBe(true);
    cache.recordSource();
    expect(cache.has('article')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('replaces re-read records in place and drops deleted ones', () => {
    const cache = new RecordCache({ maxRecords: 100, ttlMs: 60_000 });
    const records = articles(3);
    cache.store('article', records);
    const updated = { ...records[1], id: 'm0002' } as RawNestedItem;
    cache.replaceRecords('article', ['m0002', 'm0003'], [updated]);
    const fresh = cache.fresh('article');
    expect(fresh?.map((record) => record.id)).toEqual(['m0001', 'm0002']);
    expect(fresh?.[1]).toBe(updated);
  });

  it('replays fresh entries without a request, and caches complete network scans', async () => {
    const cma = createFakeCma(manyRecords(40));
    const cache = new RecordCache({ maxRecords: 100, ttlMs: 60_000 });

    const scanned = await scanWith(cache, cma);
    expect(scanned).toHaveLength(40);
    expect(cma.pageCalls()).toHaveLength(2);
    expect(cache.fresh('article')).toHaveLength(40);

    cma.rawList.mockClear();
    const source = cache.recordSource({
      yieldToEventLoop: () => Promise.resolve(),
    })(ARTICLE);
    const context = {
      client: cma.client,
      model: ARTICLE,
      scope: { publicationStatuses: [], locales: ['en'] },
      signal: new AbortController().signal,
    };
    expect(await source.count(context)).toBe(40);
    const replayed = await scanWith(cache, cma, {
      yieldToEventLoop: () => Promise.resolve(),
    });
    expect(replayed.map((record) => record.id)).toEqual(
      scanned.map((record) => record.id),
    );
    expect(cma.rawList).not.toHaveBeenCalled();

    await scanWith(cache, cma, { network: new Set(['article']) });
    expect(cma.pageCalls()).toHaveLength(2);
    await scanWith(cache, cma, { network: 'all' });
    expect(cma.pageCalls()).toHaveLength(4);
  });

  it('caches nothing from a scan that did not finish, went over budget, or outlived `clear()`', async () => {
    const cma = createFakeCma(manyRecords(40));

    const aborted = new RecordCache({ maxRecords: 100, ttlMs: 60_000 });
    const controller = new AbortController();
    const source = aborted.recordSource()(ARTICLE);
    await expect(
      source.scan({
        client: cma.client,
        model: ARTICLE,
        scope: { publicationStatuses: [], locales: ['en'] },
        signal: controller.signal,
        onRecords: async () => {
          controller.abort();
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
    expect(aborted.has('article')).toBe(false);

    const small = new RecordCache({ maxRecords: 35, ttlMs: 60_000 });
    await scanWith(small, cma);
    expect(small.has('article')).toBe(false);

    const cleared = new RecordCache({ maxRecords: 100, ttlMs: 60_000 });
    const pending = scanWith(cleared, cma);
    cleared.clear();
    await pending;
    expect(cleared.has('article')).toBe(false);
  });

  it('re-reads records by id after a run, and searches wait for it', async () => {
    const cma = createFakeCma(manyRecords(3));
    const cache = new RecordCache({ maxRecords: 100, ttlMs: 60_000 });
    cache.store('article', articles(3));
    cma.edit('m0002', { body: 'Globex' });
    cma.remove('m0003');

    let waited = false;
    const refresh = cache.refresh(
      cma.client,
      () => ARTICLE,
      new Map([
        ['article', ['m0002', 'm0003']],
        ['page', ['p1']],
      ]),
    );
    const search = cache.whenRefreshed().then(() => {
      waited = true;
    });
    expect(waited).toBe(false);
    await refresh;
    await search;
    expect(waited).toBe(true);

    expect(cma.idCalls()).toHaveLength(1);
    const records = cache.fresh('article');
    expect(records?.map((record) => record.id)).toEqual(['m0001', 'm0002']);
    expect(records?.[1]?.attributes).toMatchObject({ body: 'Globex' });

    cma.rawList.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await cache.refresh(
      cma.client,
      () => ARTICLE,
      new Map([['article', ['m0001']]]),
    );
    expect(cache.has('article')).toBe(false);
  });
});

describe('the controller with the record cache', () => {
  it('re-matches cached models locally: no list request on the next search', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.cma.rawList.mockClear();

    harness.controller.setPattern('widget');
    // Every model is cached: the short debounce applies.
    await vi.advanceTimersByTimeAsync(149);
    expect(harness.snapshot().search.phase).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.snapshot().search.phase).not.toBe('pending');
    await settle();

    expect(harness.cma.rawList).not.toHaveBeenCalled();
    const snapshot = harness.snapshot();
    expect(allMatches(snapshot).map((match) => match.text)).toEqual([
      'widget',
      'widget',
    ]);
    expect(snapshot.search.progress).toEqual({ searched: 5, total: 5 });
    expect(snapshot.search.showProgress).toBe(false);
  });

  it('uses the full debounce while any model is not cached', async () => {
    const harness = setupController();
    harness.controller.setPattern('acme');
    await vi.advanceTimersByTimeAsync(150);
    expect(harness.snapshot().search.phase).toBe('pending');
  });

  it('leaves the models of a capped search that did not finish uncached', async () => {
    const harness = setupController({
      records: [...manyRecords(10), ...acmeRecords().slice(4)],
      limits: { maxMatches: 3 },
    });
    await searchFor(harness, 'Acme');
    expect(harness.snapshot().search.capped).toBe(true);

    harness.cma.rawList.mockClear();
    await searchFor(harness, 'Note');
    expect(harness.cma.pageCalls('article').length).toBeGreaterThan(0);
    // Author finished before the cap: it is cached.
    expect(harness.cma.pageCalls('author')).toEqual([]);
  });

  it('leaves a stopped model uncached', async () => {
    const cma = createFakeCma(manyRecords(60));
    const held: Array<() => void> = [];
    cma.gatePages((query) =>
      query.page.offset >= 30
        ? new Promise<void>((resolve) => {
            held.push(resolve);
          })
        : undefined,
    );
    const harness = setupController({ cma });
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(300);
    harness.controller.stopSearch();
    for (const resolve of held) resolve();
    cma.gatePages(null);
    await settle();

    cma.rawList.mockClear();
    await searchFor(harness, 'Note');
    expect(cma.pageCalls('article').length).toBeGreaterThan(0);
    expect(cma.pageCalls('page')).toEqual([]);
  });

  it('downloads entries older than the TTL again', async () => {
    const harness = setupController({ limits: { cacheTtlMs: 60_000 } });
    await searchFor(harness, 'acme');
    harness.cma.rawList.mockClear();
    await searchFor(harness, 'widget');
    expect(harness.cma.pageCalls()).toEqual([]);

    await vi.advanceTimersByTimeAsync(60_000);
    await searchFor(harness, 'acme');
    expect(harness.cma.pageCalls('article').length).toBeGreaterThan(0);
    expect(harness.cma.pageCalls('page').length).toBeGreaterThan(0);
  });

  it('downloads the model that does not fit in the budget on every search', async () => {
    // Article (2) and Author (1) fit in 3 records; Page (2) doesn't.
    const harness = setupController({ limits: { cacheMaxRecords: 3 } });
    await searchFor(harness, 'acme');
    for (const pattern of ['widget', 'legal']) {
      harness.cma.rawList.mockClear();
      // biome-ignore lint/performance/noAwaitInLoops: searches run one after another.
      await searchFor(harness, pattern);
      expect(harness.cma.pageCalls('page').length).toBeGreaterThan(0);
      expect(harness.cma.pageCalls('article')).toEqual([]);
      expect(harness.cma.pageCalls('author')).toEqual([]);
    }
  });

  it('re-reads what a pass attempted, so "Search again" shows the result without downloading', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    harness.controller.setAllIncluded(true);
    // Search again as soon as the pass ends: it waits for the re-read.
    harness.controller.subscribeEvents((event) => {
      if (event.type === 'runEnded') {
        harness.cma.rawList.mockClear();
        harness.controller.searchAgain();
      }
    });
    await replaceAll(harness);

    const idReads = harness.cma.idCalls().map((query) => query.filter.ids);
    expect(idReads).toEqual(['a1,a2', 'p1,p2']);
    expect(harness.cma.pageCalls()).toEqual([]);
    const again = harness.snapshot();
    expect(again.search.phase).toBe('settled');
    expect(again.search.followsRun).toBe(true);
    expect(again.records).toEqual([]);
    expect(again.body).toBe('noResults');
  });

  it('re-reads in pass order: "Search again" after an immediate "Try again" sees the retried record', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    harness.cma.failUpdates('a2', [httpError(503)]);
    const list = harness.cma.rawList.getMockImplementation();
    let releaseFirstRead: () => void = () => undefined;
    let reads = 0;
    harness.cma.rawList.mockImplementation(
      async (raw: Record<string, unknown>) => {
        const query = raw as { filter: { ids?: string } };
        if (query.filter.ids?.includes('a2')) reads += 1;
        if (reads === 1 && query.filter.ids?.includes('a2')) {
          // The first pass's re-read answers late, with what a2 held then.
          const early = await list?.(raw);
          await new Promise<void>((resolve) => {
            releaseFirstRead = resolve;
          });
          return early;
        }
        return list?.(raw);
      },
    );
    let passes = 0;
    harness.controller.subscribeEvents((event) => {
      if (event.type !== 'runEnded') return;
      passes += 1;
      if (passes === 1) {
        harness.controller.retryFailedRecords();
      } else {
        harness.controller.searchAgain();
        releaseFirstRead();
      }
    });
    await replaceAll(harness);

    expect(passes).toBe(2);
    expect(reads).toBe(2);
    expect(harness.cma.records.get('a2')?.attributes).toMatchObject({
      body: 'Use Globex carefully',
    });
    const again = harness.snapshot();
    expect(again.search).toMatchObject({ phase: 'settled', followsRun: true });
    expect(again.records.map((record) => record.key)).toEqual(['article:a1']);
    expect(harness.cma.pageCalls()).toHaveLength(3);
  });

  it('writes nothing into the cache from a re-read still in flight at dispose', async () => {
    const replaceRecords = vi.spyOn(RecordCache.prototype, 'replaceRecords');
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    const list = harness.cma.rawList.getMockImplementation();
    harness.cma.rawList.mockImplementation(
      async (raw: Record<string, unknown>) => {
        const query = raw as { filter: { ids?: string } };
        // The page is closed while the re-read is on its way.
        if (query.filter.ids) harness.controller.dispose();
        return list?.(raw);
      },
    );
    await replaceAll(harness);
    expect(harness.cma.idCalls()).toHaveLength(1);
    expect(replaceRecords).not.toHaveBeenCalled();
    replaceRecords.mockRestore();
  });

  it('keeps the cache when the matcher worker times out', async () => {
    const harness = setupController({
      matchField: async (fieldValue, matcher, signal) => {
        if (matcher.pattern === 'slow') {
          throw new MatcherWorkerTimeoutError(10_000);
        }
        return inlineMatchField(fieldValue, matcher, signal);
      },
    });
    await searchFor(harness, 'acme');
    await searchFor(harness, 'slow');
    expect(harness.snapshot().search.patternProblem).toEqual({
      code: 'too_slow',
    });

    harness.cma.rawList.mockClear();
    await searchFor(harness, 'widget');
    expect(harness.cma.rawList).not.toHaveBeenCalled();
    expect(allMatches(harness.snapshot())).toHaveLength(2);
  });

  it('reads every model from the network on "Try again" after a failed search', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.cma.rawList.mockClear();
    harness.controller.retrySearch();
    await settle();
    for (const modelId of ['article', 'page', 'author']) {
      expect(harness.cma.pageCalls(modelId).length).toBeGreaterThan(0);
    }
  });

  it('drops the cache on dispose', async () => {
    const clear = vi.spyOn(RecordCache.prototype, 'clear');
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.dispose();
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });
});
