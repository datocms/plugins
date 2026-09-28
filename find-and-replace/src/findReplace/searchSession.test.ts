import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatcherWorkerTimeoutError } from '../selection/matcher';
import type { FindReplaceSnapshot } from './contract';
import {
  acmeRecords,
  allMatches,
  createFakeCma,
  eventsOf,
  fakeWorkerSessions,
  inlineMatchField,
  manyRecords,
  searchFor,
  settle,
  setupController,
} from './findReplace.fixtures';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('search lifecycle', () => {
  it('keeps a one-character pattern idle until Enter', async () => {
    const harness = setupController();
    harness.controller.setPattern('A');
    expect(harness.snapshot().search.phase).toBe('idle');
    expect(harness.snapshot().body).toBe('idle');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.cma.rawList).not.toHaveBeenCalled();

    harness.controller.searchNow();
    await settle();
    expect(harness.cma.pageCalls().length).toBeGreaterThan(0);
    expect(harness.snapshot().search.phase).toBe('settled');
  });

  it('debounces typing by 1,000 ms and restarts the wait on every keystroke', async () => {
    const harness = setupController();
    harness.controller.setPattern('Ac');
    const pending = harness.snapshot();
    expect(pending.search.phase).toBe('pending');
    expect(pending.primary).toMatchObject({
      enabled: false,
      reason: 'search_running',
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(harness.cma.rawList).not.toHaveBeenCalled();
    harness.controller.setPattern('Acm');
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.cma.rawList).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.cma.rawList).toHaveBeenCalled();
    expect(harness.snapshot().search.phase).not.toBe('pending');
    expect(harness.snapshot().find.pattern).toBe('Acm');
  });

  it('emits input changes synchronously', () => {
    const harness = setupController();
    const before = harness.snapshot().version;
    harness.controller.setPattern('Acme');
    expect(harness.snapshot().version).toBe(before + 1);
    expect(harness.snapshot().find.pattern).toBe('Acme');
    expect(harness.snapshot().findRow.showClear).toBe(true);
    harness.controller.setReplacementText('Globex');
    expect(harness.snapshot().replace.text).toBe('Globex');
  });

  it('never trims the pattern', async () => {
    const harness = setupController();
    const settled = await searchFor(harness, ' acme ');
    expect(settled.find.pattern).toBe(' acme ');
    // Only "Try acme again" and "Use ACME carefully" have spaces on both sides.
    expect(allMatches(settled).map((match) => match.text)).toEqual([
      ' acme ',
      ' ACME ',
    ]);
  });

  it('cancels a running search at the first keystroke and keeps its results until the next start', async () => {
    const cma = createFakeCma(manyRecords(90));
    let release: () => void = () => undefined;
    cma.gatePages((query) =>
      query.page.offset >= 30
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined,
    );
    const harness = setupController({ cma });
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(0);

    // Running, but nothing shown yet: still `pending`.
    expect(harness.snapshot().search.phase).toBe('pending');
    await vi.advanceTimersByTimeAsync(300);
    const searching = harness.snapshot();
    expect(searching.search.phase).toBe('searching');
    expect(searching.records).toHaveLength(30);
    const { resultsId } = searching.search;
    const pagesBefore = cma.pageCalls().length;

    harness.controller.setPattern('Acm');
    release();
    await vi.advanceTimersByTimeAsync(500);

    const pending = harness.snapshot();
    expect(pending.search.phase).toBe('pending');
    expect(pending.search.resultsId).toBe(resultsId);
    expect(pending.records).toHaveLength(30);
    expect(pending.body).toBe('results');
    expect(cma.pageCalls().length).toBe(pagesBefore);

    await vi.advanceTimersByTimeAsync(500);
    // The next search started: the results stay until it ends or shows progress.
    expect(harness.cma.pageCalls().length).toBeGreaterThan(pagesBefore);
    expect(harness.snapshot().search.phase).toBe('pending');
    expect(harness.snapshot().search.resultsId).toBe(resultsId);
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.snapshot().search.resultsId).toBe(resultsId + 1);
  });

  it('restarts at once when an option changes, and clears to idle below the minimum length', async () => {
    const harness = setupController();
    harness.controller.setPattern('Acme');
    harness.controller.setOption('caseSensitive', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.cma.pageCalls().length).toBeGreaterThan(0);
    await settle();
    expect(harness.snapshot().find.caseSensitive).toBe(true);
    // "Acme" exactly: a1 title and body, p1, p2.
    expect(harness.snapshot().meta).toMatchObject({
      kind: 'found',
      matches: 4,
    });

    harness.controller.setPattern('A');
    harness.controller.setOption('wholeWord', true);
    const idle = harness.snapshot();
    expect(idle.search.phase).toBe('idle');
    expect(idle.records).toEqual([]);
    expect(idle.find.wholeWord).toBe(true);
  });

  it('shows progress only after 300 ms and hides it on settle', async () => {
    const cma = createFakeCma(manyRecords(40));
    const held: Array<() => void> = [];
    cma.gatePages(
      () =>
        new Promise<void>((resolve) => {
          held.push(resolve);
        }),
    );
    const harness = setupController({ cma });
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();

    await vi.advanceTimersByTimeAsync(299);
    expect(harness.snapshot().search.showProgress).toBe(false);
    // Nothing to show yet: the idle state stays rather than blanking.
    expect(harness.snapshot().body).toBe('idle');
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.snapshot().search.showProgress).toBe(true);
    expect(harness.snapshot().body).toBe('spinner');

    cma.gatePages(null);
    for (const resolve of held) resolve();
    await settle();
    expect(harness.snapshot().search.phase).toBe('settled');
    expect(harness.snapshot().search.showProgress).toBe(false);
    expect(harness.snapshot().search.progress).toEqual({
      searched: 40,
      total: 40,
    });
  });

  it('turns an invalid regex into `invalid` with its cause, clears the results and announces it', async () => {
    const harness = setupController();
    await searchFor(harness, 'Acme');
    expect(harness.snapshot().records.length).toBeGreaterThan(0);

    harness.controller.setOption('regex', true);
    harness.controller.setPattern('Acme(');
    harness.controller.searchNow();
    const invalid = harness.snapshot();
    expect(invalid.search.phase).toBe('invalid');
    expect(invalid.search.patternProblem).toEqual({
      code: 'invalid_regex',
      cause: 'unterminated group',
    });
    expect(invalid.records).toEqual([]);
    expect(invalid.body).toBe('invalid');
    expect(invalid.primary).toMatchObject({ reason: 'invalid_pattern' });
    expect(eventsOf(harness, 'patternInvalid')).toEqual([
      {
        type: 'patternInvalid',
        problem: { code: 'invalid_regex', cause: 'unterminated group' },
      },
    ]);

    // Typing again: the line goes away until the next search starts.
    harness.controller.setPattern('Acme(x');
    expect(harness.snapshot().search.patternProblem).toBeNull();
  });

  it('rejects zero-width patterns', () => {
    const harness = setupController();
    harness.controller.setOption('regex', true);
    harness.controller.setPattern('a*');
    harness.controller.searchNow();
    expect(harness.snapshot().search.patternProblem).toEqual({
      code: 'zero_width',
    });
  });

  it('ends the whole search as `too_slow` when the matcher worker times out', async () => {
    const harness = setupController({
      matchField: async () => {
        throw new MatcherWorkerTimeoutError(10_000);
      },
    });
    await searchFor(harness, 'Acme');
    const snapshot = harness.snapshot();
    expect(snapshot.search.phase).toBe('invalid');
    expect(snapshot.search.patternProblem).toEqual({ code: 'too_slow' });
    expect(snapshot.search.failedModels).toEqual([]);
    expect(snapshot.records).toEqual([]);
    expect(eventsOf(harness, 'patternInvalid')).toHaveLength(1);
  });

  it('fails as `network` when every model fails, and retries on "Try again"', async () => {
    const cma = createFakeCma(acmeRecords());
    for (const modelId of ['article', 'page', 'author']) {
      cma.failModel(modelId, new TypeError('Failed to fetch'));
    }
    const harness = setupController({ cma });
    const failed = await searchFor(harness, 'Acme');
    expect(failed.search.phase).toBe('failed');
    expect(failed.search.failure).toEqual({ cause: 'network' });
    expect(failed.body).toBe('searchFailed');
    expect(failed.records).toEqual([]);
    expect(failed.primary).toMatchObject({ reason: 'no_matches' });

    const pagesBefore = cma.pageCalls().length;
    harness.controller.retrySearch();
    await settle();
    expect(cma.pageCalls().length).toBeGreaterThan(pagesBefore);
  });

  it('stops at `maxMatches` with a cap note', async () => {
    const harness = setupController({
      records: manyRecords(10, 2),
      limits: { maxMatches: 5 },
    });
    const snapshot = await searchFor(harness, 'Acme');
    expect(snapshot.search).toMatchObject({ phase: 'settled', capped: true });
    expect(snapshot.note).toEqual({
      kind: 'capped',
      selfMatch: false,
      continued: false,
    });
    expect(snapshot.meta).toMatchObject({
      kind: 'found',
      matches: 5,
      capped: true,
    });
    expect(allMatches(snapshot)).toHaveLength(5);
    expect(snapshot.modelFilter.partial).toBe(true);
  });

  it.each([
    'stopSearch',
    'stopOrClear',
  ] as const)('%s while searching keeps what was found and settles as stopped', async (method) => {
    const cma = createFakeCma(manyRecords(90));
    cma.gatePages((query) =>
      query.page.offset >= 30 ? new Promise<void>(() => undefined) : undefined,
    );
    const harness = setupController({ cma });
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(300);

    const result =
      method === 'stopSearch'
        ? harness.controller.stopSearch()
        : harness.controller.stopOrClear();
    if (method === 'stopOrClear') expect(result).toBe('stopped');

    const stopped = harness.snapshot();
    expect(stopped.search).toMatchObject({ phase: 'settled', stopped: true });
    expect(stopped.records).toHaveLength(30);
    expect(stopped.note).toEqual({
      kind: 'searchStopped',
      searched: 30,
      total: 90,
    });
    expect(eventsOf(harness, 'searchSettled')).toEqual([
      {
        type: 'searchSettled',
        matches: 30,
        records: 30,
        capped: false,
        stopped: true,
      },
    ]);
  });

  it('clears the query on Esc unless an inclusion was changed by hand', async () => {
    const harness = setupController();
    await searchFor(harness, 'Acme');
    expect(harness.controller.stopOrClear()).toBe('cleared');
    expect(harness.snapshot().find.pattern).toBe('');
    expect(harness.snapshot().search.phase).toBe('idle');

    await searchFor(harness, 'Acme');
    harness.controller.setRecordIncluded('page:p1', false);
    const before = harness.snapshot();
    expect(before.hasManualSelection).toBe(true);
    expect(harness.controller.stopOrClear()).toBe('kept');
    expect(harness.snapshot()).toBe(before);

    // ✕ always clears.
    harness.controller.clearPattern();
    expect(harness.snapshot().find.pattern).toBe('');
  });

  it('lists failed models in a callout and retries only those, merging without duplicates', async () => {
    const cma = createFakeCma(acmeRecords());
    cma.failModel('page', new TypeError('Failed to fetch'));
    const harness = setupController({ cma });
    const partial = await searchFor(harness, 'Acme');
    expect(partial.search.failedModels).toEqual([{ id: 'page', name: 'Page' }]);
    expect(partial.callouts).toEqual([
      { kind: 'modelsFailed', modelNames: ['Page'], retryable: true },
    ]);
    expect(
      partial.modelFilter.options.find((option) => option.id === 'page'),
    ).toMatchObject({ matchCount: null });
    expect(allMatches(partial)).toHaveLength(5);

    cma.failModel('page', undefined);
    const articlePages = cma.pageCalls('article').length;
    harness.controller.retryFailedModels();
    expect(harness.snapshot().search.phase).toBe('pending');
    expect(harness.snapshot().primary).toMatchObject({
      enabled: false,
      reason: 'search_running',
    });
    expect(harness.snapshot().search.resultsId).toBe(partial.search.resultsId);
    await settle();

    const merged = harness.snapshot();
    expect(cma.pageCalls('article')).toHaveLength(articlePages);
    expect(merged.search.failedModels).toEqual([]);
    expect(merged.callouts).toEqual([]);
    expect(allMatches(merged)).toHaveLength(7);
    const keys = allMatches(merged).map((match) => match.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('throttles streaming emits to one per `emitIntervalMs`', async () => {
    const cma = createFakeCma(manyRecords(300));
    // Each page takes 40 ms.
    cma.gatePages(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 40);
        }),
    );
    const harness = setupController({
      cma,
      matchField: inlineMatchField,
    });
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    const startedAt = Date.now();
    const firstEmit = harness.emits.length;
    await settle();

    const streamed = harness.emits
      .slice(firstEmit)
      .filter((emit) => emit.at > startedAt);
    // 10 pages × 40 ms: without throttling there would be one emit per page and more.
    const windows = new Map<number, number>();
    for (const emit of streamed.slice(0, -1)) {
      const window = Math.floor((emit.at - startedAt) / 250);
      windows.set(window, (windows.get(window) ?? 0) + 1);
    }
    // The progress row (300 ms) is the only extra emit inside a window.
    for (const count of windows.values()) expect(count).toBeLessThanOrEqual(2);
    expect(harness.snapshot().records).toHaveLength(300);
  });
});

describe('failed models', () => {
  it('keeps the results, inclusions and callout when the retried models fail again', async () => {
    const cma = createFakeCma(acmeRecords());
    cma.failModel('page', new TypeError('Failed to fetch'));
    const harness = setupController({ cma });
    const partial = await searchFor(harness, 'Acme');
    harness.controller.setReplacementText('Globex');
    harness.controller.setRecordIncluded('article:a2', false);
    const before = harness.snapshot();

    harness.controller.retryFailedModels();
    // The callout stays while the retry runs: nothing blinks.
    expect(harness.snapshot().callouts).toEqual(before.callouts);
    await settle();

    const after = harness.snapshot();
    expect(after.search).toMatchObject({
      phase: 'settled',
      resultsId: partial.search.resultsId,
      failedModels: [{ id: 'page', name: 'Page' }],
    });
    expect(after.body).toBe('results');
    expect(after.records.map((record) => record.key)).toEqual(
      before.records.map((record) => record.key),
    );
    expect(after.hasManualSelection).toBe(true);
    expect(
      after.records.find((record) => record.key === 'article:a2')?.inclusion,
    ).toBe('none');
    expect(after.callouts).toEqual([
      { kind: 'modelsFailed', modelNames: ['Page'], retryable: true },
    ]);
    expect(after.meta).toEqual(before.meta);
    expect(eventsOf(harness, 'searchSettled')).toHaveLength(2);
  });

  it('keeps a stopped run session when the retried models fail again', async () => {
    const cma = createFakeCma(acmeRecords());
    cma.failModel('page', new TypeError('Failed to fetch'));
    const harness = setupController({ cma });
    await searchFor(harness, 'Acme');
    harness.controller.setReplacementText('Globex');
    harness.controller.subscribeEvents((event) => {
      // Stop as soon as the first record is being written.
      if (event.type === 'runStarted') harness.controller.stopReplace();
    });
    const plan = harness.snapshot().plan;
    harness.controller.replace(plan?.token ?? '');
    await settle();
    const stopped = harness.snapshot();
    expect(stopped.run.phase).toBe('stopped');

    harness.controller.retryFailedModels();
    await settle();
    const after = harness.snapshot();
    expect(after.run.phase).toBe('stopped');
    expect(after.meta).toEqual(stopped.meta);
    expect(after.records).toHaveLength(stopped.records.length);
    expect(after.primary).toMatchObject({ kind: 'replace', enabled: true });
    expect(after.callouts).toEqual([
      { kind: 'modelsFailed', modelNames: ['Page'], retryable: true },
    ]);
  });

  it('keeps the results when the matcher times out on the retried model', async () => {
    let slowPages = false;
    const cma = createFakeCma(acmeRecords());
    cma.failModel('page', new TypeError('Failed to fetch'));
    const harness = setupController({
      cma,
      matchField: async (fieldValue, matcher, signal) => {
        if (slowPages && fieldValue.ref.rootModelId === 'page') {
          throw new MatcherWorkerTimeoutError(10_000);
        }
        return inlineMatchField(fieldValue, matcher, signal);
      },
    });
    const partial = await searchFor(harness, 'Acme');
    cma.failModel('page', undefined);
    slowPages = true;

    harness.controller.retryFailedModels();
    await settle();
    const after = harness.snapshot();
    expect(after.search).toMatchObject({
      phase: 'settled',
      patternProblem: null,
      resultsId: partial.search.resultsId,
      failedModels: [{ id: 'page', name: 'Page' }],
    });
    expect(allMatches(after)).toHaveLength(allMatches(partial).length);
  });

  it('keeps the models that already failed when the search is stopped', async () => {
    const cma = createFakeCma(acmeRecords());
    cma.failModel('page', new TypeError('Failed to fetch'));
    cma.gatePages((query) =>
      query.filter.type === 'article'
        ? new Promise<void>(() => undefined)
        : undefined,
    );
    const harness = setupController({ cma });
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(50);
    harness.controller.stopSearch();

    const stopped = harness.snapshot();
    expect(stopped.search).toMatchObject({
      phase: 'settled',
      stopped: true,
      failedModels: [{ id: 'page', name: 'Page' }],
    });
    expect(stopped.callouts).toEqual([
      { kind: 'modelsFailed', modelNames: ['Page'], retryable: true },
    ]);
    expect(
      stopped.modelFilter.options.find((option) => option.id === 'page'),
    ).toMatchObject({ matchCount: null });
  });
});

describe('re-searching', () => {
  function watch(
    harness: ReturnType<typeof setupController>,
  ): FindReplaceSnapshot[] {
    const frames: FindReplaceSnapshot[] = [];
    harness.controller.subscribe(() => frames.push(harness.snapshot()));
    return frames;
  }

  it('keeps what is on screen until a cached search ends, then swaps it at once', async () => {
    const harness = setupController();
    await searchFor(harness, 'zzqq');
    expect(harness.snapshot().body).toBe('noResults');
    const frames = watch(harness);

    harness.controller.setPattern('zzq');
    await settle();
    expect(harness.cma.pageCalls()).toHaveLength(3);
    expect(frames.map((frame) => frame.body)).not.toContain('blank');
    expect(frames.map((frame) => frame.meta.kind)).not.toContain('none');
    expect(harness.snapshot().body).toBe('noResults');

    // From results to other results: never an empty list in between.
    await searchFor(harness, 'acme');
    frames.length = 0;
    harness.controller.setPattern('widget');
    await settle();
    const ids = new Set(frames.map((frame) => frame.search.resultsId));
    expect(frames.every((frame) => frame.records.length > 0)).toBe(true);
    expect(ids.size).toBe(2);
    expect(harness.snapshot().records.map((record) => record.key)).toEqual([
      'article:a1',
    ]);
  });

  it('replaces what is on screen with the spinner once a slow search passes the progress delay', async () => {
    const harness = setupController({ records: manyRecords(40) });
    const first = await searchFor(harness, 'Acme');
    await vi.advanceTimersByTimeAsync(60_000 * 11);
    harness.cma.gatePages(() => new Promise<void>(() => undefined));

    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(299);
    expect(harness.snapshot().body).toBe('results');
    expect(harness.snapshot().search.resultsId).toBe(first.search.resultsId);
    expect(harness.snapshot().meta).toEqual(first.meta);
    await vi.advanceTimersByTimeAsync(1);
    const slow = harness.snapshot();
    expect(slow.body).toBe('spinner');
    expect(slow.search.resultsId).toBe(first.search.resultsId + 1);
    expect(slow.records).toEqual([]);
  });

  it('keeps the results on screen (and their inclusions) when a search that showed nothing is cancelled', async () => {
    const harness = setupController({ records: manyRecords(40) });
    const first = await searchFor(harness, 'Acme');
    harness.controller.setReplacementText('Globex');
    harness.controller.setRecordIncluded('article:m0001', false);
    await vi.advanceTimersByTimeAsync(60_000 * 11);
    harness.cma.gatePages(() => new Promise<void>(() => undefined));

    harness.controller.setPattern('Acmex');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.cma.pageCalls('article').length).toBeGreaterThan(0);
    expect(harness.snapshot().search.phase).toBe('pending');
    harness.controller.setPattern('Acme');
    const back = harness.snapshot();
    expect(back.search.resultsId).toBe(first.search.resultsId);
    expect(back.records.map((record) => record.key)).toEqual(
      first.records.map((record) => record.key),
    );

    harness.cma.gatePages(null);
    await settle();
    const again = harness.snapshot();
    expect(again.search.phase).toBe('settled');
    expect(
      again.records.find((record) => record.key === 'article:m0001')?.inclusion,
    ).toBe('none');
  });

  it('clears on Esc while a search shows nothing yet (as while pending); Stop still stops it', async () => {
    const harness = setupController({ records: manyRecords(40) });
    await searchFor(harness, 'Acme');
    await vi.advanceTimersByTimeAsync(60_000 * 11);
    harness.cma.gatePages(() => new Promise<void>(() => undefined));
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.controller.stopOrClear()).toBe('cleared');
    expect(harness.snapshot().search.phase).toBe('idle');

    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(100);
    harness.controller.stopSearch();
    const stopped = harness.snapshot();
    expect(stopped.search).toMatchObject({ phase: 'settled', stopped: true });
    expect(stopped.body).toBe('noResults');
    expect(stopped.note).toMatchObject({ kind: 'searchStopped', searched: 0 });
  });
});

describe('matching in the worker (the production path)', () => {
  it('finds what inline matching finds, with one worker per search, terminated when it settles', async () => {
    const inline = await searchFor(setupController(), 'acme');
    const sessions = fakeWorkerSessions();
    const harness = setupController({ workerSessionFactory: sessions.factory });

    const found = await searchFor(harness, 'acme');
    expect(allMatches(found).map((match) => match.key)).toEqual(
      allMatches(inline).map((match) => match.key),
    );
    expect(found.meta).toEqual(inline.meta);
    expect(sessions.workers).toHaveLength(1);
    expect(sessions.workers[0]?.terminated).toBe(true);

    // A cached search matches in a new worker too.
    const cached = await searchFor(harness, 'widget');
    expect(allMatches(cached)).toHaveLength(2);
    expect(sessions.workers).toHaveLength(2);
    expect(sessions.workers[1]?.terminated).toBe(true);
  });

  it('terminates the running worker when typing cancels the search', async () => {
    const sessions = fakeWorkerSessions(() => 1_000);
    const harness = setupController({ workerSessionFactory: sessions.factory });
    harness.controller.setPattern('acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(10);
    expect(sessions.workers).toHaveLength(1);
    expect(sessions.workers[0]?.terminated).toBe(false);

    harness.controller.setPattern('acm');
    expect(sessions.workers[0]?.terminated).toBe(true);
    await settle();
    expect(harness.snapshot().search.phase).toBe('settled');
    expect(sessions.workers[sessions.workers.length - 1]?.terminated).toBe(
      true,
    );
  });

  it("never times out a model for the time its chunk waits behind the other model's", async () => {
    // Article and Author are scanned at once and share the run's worker: a
    // 7 s chunk, then a 4 s one. Neither takes 10 s by itself.
    const sessions = fakeWorkerSessions((request) => {
      if (request.texts.includes('Jane Doe')) return 4_000;
      return request.texts.includes('Acme launches a widget') ? 7_000 : 0;
    });
    const harness = setupController({ workerSessionFactory: sessions.factory });
    const found = await searchFor(harness, 'acme');
    expect(found.search).toMatchObject({
      phase: 'settled',
      patternProblem: null,
    });
    expect(allMatches(found)).toHaveLength(7);
    expect(sessions.workers).toHaveLength(1);
  });

  it('caps and stops through the worker too, terminating it', async () => {
    const capped = fakeWorkerSessions();
    const capHarness = setupController({
      records: manyRecords(10, 2),
      limits: { maxMatches: 5 },
      workerSessionFactory: capped.factory,
    });
    const found = await searchFor(capHarness, 'Acme');
    expect(found.search).toMatchObject({ phase: 'settled', capped: true });
    expect(allMatches(found)).toHaveLength(5);
    expect(capped.workers.every((worker) => worker.terminated)).toBe(true);

    const stopped = fakeWorkerSessions(() => 100);
    const cma = createFakeCma(manyRecords(90));
    cma.gatePages((query) =>
      query.page.offset >= 30 ? new Promise<void>(() => undefined) : undefined,
    );
    const stopHarness = setupController({
      cma,
      workerSessionFactory: stopped.factory,
    });
    stopHarness.controller.setPattern('Acme');
    stopHarness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(400);
    expect(stopHarness.snapshot().records).toHaveLength(30);
    stopHarness.controller.stopSearch();
    expect(stopHarness.snapshot().search).toMatchObject({
      phase: 'settled',
      stopped: true,
    });
    expect(stopped.workers).toHaveLength(1);
    expect(stopped.workers[0]?.terminated).toBe(true);
  });

  it('ends a cached search as too slow when a chunk takes over 10 s, and keeps the cache', async () => {
    const sessions = fakeWorkerSessions((request) =>
      request.matcher.pattern === 'slow' ? 20_000 : 0,
    );
    const harness = setupController({ workerSessionFactory: sessions.factory });
    await searchFor(harness, 'acme');
    harness.cma.rawList.mockClear();

    const slow = await searchFor(harness, 'slow');
    expect(slow.search.patternProblem).toEqual({ code: 'too_slow' });
    expect(sessions.workers[sessions.workers.length - 1]?.terminated).toBe(
      true,
    );

    const after = await searchFor(harness, 'widget');
    expect(allMatches(after)).toHaveLength(2);
    expect(harness.cma.rawList).not.toHaveBeenCalled();
  });
});
