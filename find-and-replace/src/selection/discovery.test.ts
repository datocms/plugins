import type { Client } from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDiscoveryController,
  type DiscoveryRecordSource,
  type DiscoverySnapshot,
  type ModelRecordSource,
  networkRecordSource,
  REPLAY_BATCH_SIZE,
  replayRecordSource,
} from './discovery';
import { MatcherWorkerTimeoutError } from './matcher';
import type { DiscoveryModel, RawNestedItem } from './query';
import type { DiscoverySpec } from './types';

const spec: DiscoverySpec = {
  workflow: 'text',
  granularity: 'field_value',
  rootModelIds: ['a', 'b'],
  locales: ['en'],
  publicationStatuses: ['draft', 'published'],
  matcher: {
    kind: 'literal',
    pattern: 'hello',
    caseSensitive: false,
    wholeWord: false,
  },
};

const modelA: DiscoveryModel = { id: 'a', apiKey: 'a', name: 'A' };
const modelB: DiscoveryModel = { id: 'b', apiKey: 'b', name: 'B' };

function item(id: string, modelId: string) {
  return {
    id,
    type: 'item' as const,
    attributes: {},
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' as const } },
    },
    meta: {
      status: 'draft' as const,
      current_version: `${id}-v1`,
      created_at: '',
      updated_at: '',
      published_at: null,
      first_published_at: null,
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      is_valid: true,
      is_current_version_valid: true,
      is_published_version_valid: null,
      stage: null,
      has_children: null,
    },
  };
}

type ListQuery = {
  filter: { type?: string; ids?: string };
  page: { offset: number; limit: number };
  nested?: boolean;
};

function asListQuery(query: Record<string, unknown>): ListQuery {
  return query as unknown as ListQuery;
}

function isCount(query: Record<string, unknown>): boolean {
  return asListQuery(query).page.limit === 1;
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** A fake CMA where every model has `counts[model]` records, one page of `pageSize`. */
function pagedClient(
  counts: Record<string, number>,
  pageSize = 30,
): { client: Client; rawList: ReturnType<typeof vi.fn> } {
  const rawList = vi.fn(async (raw: Record<string, unknown>) => {
    const query = asListQuery(raw);
    const modelId = query.filter.type ?? 'unknown';
    const total = counts[modelId] ?? 0;
    if (isCount(raw)) return { data: [], meta: { total_count: total } };
    const size = Math.min(pageSize, query.page.limit);
    const data = Array.from(
      { length: Math.max(0, Math.min(size, total - query.page.offset)) },
      (_, index) =>
        item(`${modelId}-${query.page.offset + index + 1}`, modelId),
    );
    return { data, meta: { total_count: total } };
  });
  return { client: { items: { rawList } } as unknown as Client, rawList };
}

function last<T>(values: ReadonlyArray<T>): T | undefined {
  return values[values.length - 1];
}

function scanCalls(rawList: ReturnType<typeof vi.fn>): ListQuery[] {
  return rawList.mock.calls
    .map(([query]) => query as Record<string, unknown>)
    .filter((query) => !isCount(query))
    .map(asListQuery);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DiscoveryController', () => {
  it('pauses above the 5,000-record threshold without imposing a hard cap', async () => {
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const filter = query.filter as { type: string };
      return {
        data: [item(`${filter.type}-1`, filter.type)],
        meta: { total_count: filter.type === 'a' ? 2_501 : 2_500 },
      };
    });
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const awaitingConfirmation = await controller.run(spec);

    expect(awaitingConfirmation).toMatchObject({
      status: 'awaiting_confirmation',
      preflight: {
        estimatedRecords: 5_001,
        requiresConfirmation: true,
      },
      targets: [],
      complete: false,
    });
    expect(rawList).toHaveBeenCalledTimes(2);
  });

  it('keeps successful model partitions and retries failed models', async () => {
    let failModelB = true;
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const filter = query.filter as { type?: string };
      const modelId = filter.type ?? 'unknown';
      const page = query.page as { limit: number };
      if (page.limit === 1) {
        return {
          data: [item(`${modelId}-1`, modelId)],
          meta: { total_count: 1 },
        };
      }
      if (modelId === 'b' && failModelB) {
        throw new Error('B is temporarily unavailable');
      }
      return {
        data: [item(`${modelId}-1`, modelId)],
        meta: { total_count: 1 },
      };
    });
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const partial = await controller.run(spec, { confirmedLargeRun: true });
    expect(partial).toMatchObject({ status: 'partial', complete: false });
    expect(partial.targets).toEqual(['target:a-1']);
    expect(partial.issues).toEqual([
      expect.objectContaining({
        modelId: 'b',
        phase: 'scan',
        cause: 'unknown',
      }),
    ]);

    failModelB = false;
    const streamed: string[][] = [];
    const retried = await controller.retry(spec, partial, {
      onTargets: (added) => streamed.push([...added]),
    });
    expect(retried).toMatchObject({ status: 'completed', complete: true });
    expect(retried.targets).toEqual(['target:a-1', 'target:b-1']);
    // Seed targets are known to the caller: only new ones are streamed.
    expect(streamed).toEqual([['target:b-1']]);
  });

  it('ignores late page results after cancellation', async () => {
    let releaseScan: (() => void) | undefined;
    const scanGate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const page = query.page as { limit: number };
      if (page.limit === 1) {
        return { data: [item('a-1', 'a')], meta: { total_count: 1 } };
      }
      await scanGate;
      return { data: [item('a-1', 'a')], meta: { total_count: 1 } };
    });
    const snapshots: Array<DiscoverySnapshot<string>> = [];
    const onCancel = vi.fn();
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
      onCancel,
    });

    const running = controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        confirmedLargeRun: true,
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      },
    );
    await vi.waitFor(() => {
      expect(snapshots[snapshots.length - 1]?.status).toBe('running');
    });
    controller.cancel();
    controller.cancel();
    expect(controller.snapshot()).toMatchObject({
      status: 'cancelled',
      complete: false,
      targets: [],
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    releaseScan?.();

    const cancelled = await running;
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      complete: false,
      targets: [],
    });
  });

  it('resets completed results to a fresh idle snapshot', async () => {
    const { client } = pagedClient({ a: 1 });
    const listener = vi.fn();
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });
    controller.subscribe(listener);
    await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { confirmedLargeRun: true },
    );

    controller.reset();

    expect(controller.snapshot()).toEqual({
      runId: null,
      status: 'idle',
      spec: null,
      preflight: null,
      progress: {
        modelsTotal: 0,
        modelsCompleted: 0,
        recordsEstimated: null,
        recordsScanned: 0,
        targetsFound: 0,
      },
      targets: [],
      targetCount: 0,
      issues: [],
      complete: false,
      capped: false,
      positions: {},
      recheckLeft: {},
    });
    expect(listener).toHaveBeenCalled();
  });

  it('does not let a late discover callback from an old run mutate a new run', async () => {
    let releaseFirstDiscovery: (() => void) | undefined;
    let markFirstDiscoveryEntered: (() => void) | undefined;
    const firstDiscoveryGate = new Promise<void>((resolve) => {
      releaseFirstDiscovery = resolve;
    });
    const firstDiscoveryEntered = new Promise<void>((resolve) => {
      markFirstDiscoveryEntered = resolve;
    });
    const { client } = pagedClient({ a: 1 });
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecord: async (_record, context) => {
        if (context.runId === 'selection-1') {
          markFirstDiscoveryEntered?.();
          await firstDiscoveryGate;
        }
        return [`target:${context.runId}`];
      },
      targetKey: (target) => target,
    });

    const runA = controller.run(
      { ...spec, rootModelIds: ['a'] },
      { confirmedLargeRun: true },
    );
    await firstDiscoveryEntered;
    const runB = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { confirmedLargeRun: true },
    );
    releaseFirstDiscovery?.();
    await runA;

    expect(runB).toMatchObject({
      runId: 'selection-2',
      status: 'completed',
      targets: ['target:selection-2'],
    });
    expect(controller.snapshot()).toMatchObject({
      runId: 'selection-2',
      status: 'completed',
      targets: ['target:selection-2'],
    });
  });

  it('commits targets per record, in arrival order, across concurrent model scans', async () => {
    let releaseModelA: (() => void) | undefined;
    let releaseModelB: (() => void) | undefined;
    const modelAGate = new Promise<void>((resolve) => {
      releaseModelA = resolve;
    });
    const modelBGate = new Promise<void>((resolve) => {
      releaseModelB = resolve;
    });
    const { client } = pagedClient({ a: 2, b: 1 });
    const snapshots: Array<DiscoverySnapshot<string>> = [];
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA, modelB],
      discoverRecord: async (record) => {
        if (record.id === 'a-1') {
          return ['a:one', 'a:two', 'a:three'];
        }
        if (record.id === 'a-2') {
          await modelAGate;
          return [];
        }
        await modelBGate;
        return ['b:one'];
      },
      targetKey: (target) => target,
    });

    const run = controller.run(spec, {
      confirmedLargeRun: true,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    await vi.waitFor(() => {
      expect(snapshots.some((snapshot) => snapshot.targetCount === 3)).toBe(
        true,
      );
    });
    releaseModelB?.();
    await vi.waitFor(() => {
      expect(snapshots.some((snapshot) => snapshot.targetCount === 4)).toBe(
        true,
      );
    });
    releaseModelA?.();

    const completed = await run;
    const foundCounts = snapshots.map((snapshot) => snapshot.targetCount);
    expect(
      foundCounts.every(
        (count, index) => index === 0 || count >= foundCounts[index - 1],
      ),
    ).toBe(true);
    expect(completed).toMatchObject({
      status: 'completed',
      targetCount: 4,
      progress: { targetsFound: 4 },
      targets: ['a:one', 'a:two', 'a:three', 'b:one'],
    });
  });

  it('keeps intermediate snapshots cheap and materializes targets when settled', async () => {
    const { client } = pagedClient({ a: 3 }, 1);
    const snapshots: Array<DiscoverySnapshot<string>> = [];
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const completed = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        confirmedLargeRun: true,
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      },
    );

    const running = snapshots.filter(
      (snapshot) => snapshot.status === 'running',
    );
    expect(running.length).toBeGreaterThan(1);
    expect(running.every((snapshot) => snapshot.targets.length === 0)).toBe(
      true,
    );
    expect(running.map((snapshot) => snapshot.targetCount)).toContain(2);
    expect(last(snapshots)?.targets).toEqual([
      'target:a-1',
      'target:a-2',
      'target:a-3',
    ]);
    expect(completed.targets).toEqual(last(snapshots)?.targets);
  });

  it('clears a preflight estimate issue when that model scans successfully', async () => {
    let countFailed = false;
    const rawList = vi.fn(async (query: Record<string, unknown>) => {
      const page = query.page as { limit: number };
      if (page.limit === 1 && !countFailed) {
        countFailed = true;
        throw new Error('Count endpoint unavailable');
      }
      return {
        data: [item('a-1', 'a')],
        meta: { total_count: 1 },
      };
    });
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const completed = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { confirmedLargeRun: true },
    );

    expect(completed).toMatchObject({
      status: 'completed',
      complete: true,
      issues: [],
      targets: ['target:a-1'],
    });
    expect(completed.preflight?.issues).toEqual([
      expect.objectContaining({ modelId: 'a', phase: 'preflight' }),
    ]);
  });
});

describe('DiscoveryController for find and replace', () => {
  it('stops at maxTargets: drops the excess and requests no further page', async () => {
    const { client, rawList } = pagedClient({ a: 3 }, 1);
    const streamed: string[] = [];
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecord: (record) => [1, 2, 3].map((n) => `${record.id}:${n}`),
      targetKey: (target) => target,
    });

    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        maxTargets: 5,
        onTargets: (added) => streamed.push(...added),
      },
    );

    expect(snapshot).toMatchObject({
      status: 'completed',
      capped: true,
      complete: false,
      targetCount: 5,
      issues: [],
    });
    expect(snapshot.targets).toEqual([
      'a-1:1',
      'a-1:2',
      'a-1:3',
      'a-2:1',
      'a-2:2',
    ]);
    expect(streamed).toEqual(snapshot.targets);
    expect(scanCalls(rawList).map((query) => query.page.offset)).toEqual([
      0, 1,
    ]);
  });

  it('settles partial and capped when another model had failed', async () => {
    const rawList = vi.fn(async (raw: Record<string, unknown>) => {
      const query = asListQuery(raw);
      if (isCount(raw)) return { data: [], meta: { total_count: 2 } };
      if (query.filter.type === 'a') throw new TypeError('Failed to fetch');
      await Promise.resolve();
      return {
        data: [item(`b-${query.page.offset + 1}`, 'b')],
        meta: { total_count: 2 },
      };
    });
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`${record.id}:1`, `${record.id}:2`],
      targetKey: (target) => target,
    });

    const snapshot = await controller.run(spec, {
      counts: 'background',
      maxTargets: 3,
    });

    expect(snapshot).toMatchObject({
      status: 'partial',
      capped: true,
      targets: ['b-1:1', 'b-1:2', 'b-2:1'],
      issues: [expect.objectContaining({ modelId: 'a', cause: 'network' })],
    });
  });

  it('counts in the background: the scan starts at once and the total arrives last', async () => {
    const countGates = { a: deferred<number>(), b: deferred<number>() };
    const scanGate = deferred();
    const rawList = vi.fn(async (raw: Record<string, unknown>) => {
      const query = asListQuery(raw);
      const modelId = (query.filter.type ?? 'a') as 'a' | 'b';
      if (isCount(raw)) {
        return {
          data: [],
          meta: { total_count: await countGates[modelId].promise },
        };
      }
      await scanGate.promise;
      return {
        data: [item(`${modelId}-1`, modelId)],
        meta: { total_count: 1 },
      };
    });
    const snapshots: Array<DiscoverySnapshot<string>> = [];
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const run = controller.run(spec, {
      counts: 'background',
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    await vi.waitFor(() =>
      expect(scanCalls(rawList).length).toBeGreaterThan(0),
    );
    expect(last(snapshots)).toMatchObject({
      status: 'running',
      preflight: null,
      progress: { recordsEstimated: null },
    });

    countGates.a.resolve(40);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(last(snapshots)?.progress.recordsEstimated).toBeNull();

    countGates.b.resolve(2);
    await vi.waitFor(() =>
      expect(last(snapshots)?.progress.recordsEstimated).toBe(42),
    );

    scanGate.resolve();
    const completed = await run;
    expect(completed).toMatchObject({
      status: 'completed',
      progress: { recordsEstimated: 42, recordsScanned: 2 },
      issues: [],
    });
  });

  it('leaves the total unknown when a background count fails, without an issue', async () => {
    const rawList = vi.fn(async (raw: Record<string, unknown>) => {
      const query = asListQuery(raw);
      const modelId = query.filter.type ?? 'a';
      if (isCount(raw)) {
        if (modelId === 'b') throw new Error('Count failed');
        return { data: [], meta: { total_count: 1 } };
      }
      return {
        data: [item(`${modelId}-1`, modelId)],
        meta: { total_count: 1 },
      };
    });
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const completed = await controller.run(spec, { counts: 'background' });

    expect(completed).toMatchObject({
      status: 'completed',
      complete: true,
      issues: [],
      progress: { recordsEstimated: null },
    });
    expect(completed.targets).toEqual(['target:a-1', 'target:b-1']);
  });

  it('streams targets at most every emitIntervalMs, in arrival order, plus a final flush', async () => {
    vi.useFakeTimers();
    const records = Array.from({ length: 10 }, (_, index) =>
      item(`a-${index + 1}`, 'a'),
    );
    const slowSource: ModelRecordSource = {
      count: async () => records.length,
      scan: async ({ onRecords }) => {
        for (const record of records) {
          // biome-ignore lint/performance/noAwaitInLoops: records arrive one at a time, 100 ms apart.
          await new Promise((resolve) => setTimeout(resolve, 100));
          await onRecords([record]);
        }
      },
    };
    const batches: Array<{ at: number; added: string[] }> = [];
    const controller = createDiscoveryController<string>({
      client: {} as Client,
      models: [modelA],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });
    const start = Date.now();

    const run = controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        recordSource: () => slowSource,
        emitIntervalMs: 250,
        onTargets: (added) =>
          batches.push({ at: Date.now() - start, added: [...added] }),
      },
    );
    await vi.advanceTimersByTimeAsync(1_100);
    const completed = await run;

    const times = batches.map(({ at }) => at);
    expect(times).toEqual([100, 350, 600, 850, 1_000]);
    for (let index = 1; index < times.length - 1; index += 1) {
      expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(250);
    }
    expect(batches.flatMap(({ added }) => added)).toEqual(completed.targets);
    expect(completed.targets).toEqual(
      records.map((record) => `target:${record.id}`),
    );
  });

  it('keeps the targets of a model that fails after its first page', async () => {
    const rawList = vi.fn(async (raw: Record<string, unknown>) => {
      const query = asListQuery(raw);
      const modelId = query.filter.type ?? 'a';
      if (isCount(raw)) return { data: [], meta: { total_count: 2 } };
      if (modelId === 'a' && query.page.offset > 0) {
        throw new Error('Page 2 failed');
      }
      return {
        data: [item(`${modelId}-${query.page.offset + 1}`, modelId)],
        meta: { total_count: modelId === 'a' ? 2 : 1 },
      };
    });
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const partial = await controller.run(spec, { counts: 'background' });

    expect(partial).toMatchObject({
      status: 'partial',
      issues: [expect.objectContaining({ modelId: 'a', phase: 'scan' })],
    });
    expect(partial.targets).toEqual(
      expect.arrayContaining(['target:a-1', 'target:b-1']),
    );
    expect(partial.targets).toHaveLength(2);
  });

  it('fails the whole run once when the matcher worker times out', async () => {
    const { client, rawList } = pagedClient({ a: 3, b: 1 }, 1);
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA, modelB],
      discoverRecord: async (record) => {
        if (record.id === 'b-1') throw new MatcherWorkerTimeoutError(10_000);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [`target:${record.id}`];
      },
      targetKey: (target) => target,
    });

    const failed = await controller.run(spec, { counts: 'background' });

    expect(failed).toMatchObject({
      status: 'failed',
      failureCode: 'pattern_timeout',
      issues: [],
      complete: false,
      capped: false,
    });
    // Model A stopped with the run: its later pages were never requested.
    expect(
      scanCalls(rawList).filter((query) => query.filter.type === 'a').length,
    ).toBeLessThan(3);
  });

  it('requests no page after cancel()', async () => {
    const discoveryEntered = deferred();
    const discoveryGate = deferred();
    const { client, rawList } = pagedClient({ a: 90 });
    const streamed: string[][] = [];
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecord: async (record) => {
        if (record.id === 'a-3') {
          discoveryEntered.resolve();
          await discoveryGate.promise;
        }
        return [`target:${record.id}`];
      },
      targetKey: (target) => target,
    });

    const run = controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        emitIntervalMs: 60_000,
        onTargets: (added) => streamed.push([...added]),
      },
    );
    await discoveryEntered.promise;
    const callsBeforeCancel = rawList.mock.calls.length;
    // a-1 went out at once; a-2 waits for the (long) interval.
    expect(streamed).toEqual([['target:a-1']]);
    controller.cancel();
    // Pending targets are flushed synchronously with the cancellation.
    expect(streamed).toEqual([['target:a-1'], ['target:a-2']]);
    discoveryGate.resolve();
    const cancelled = await run;

    expect(cancelled.status).toBe('cancelled');
    expect(rawList.mock.calls.length).toBe(callsBeforeCancel);
    // Later pages were asked for ahead, while the first one was matched.
    expect(scanCalls(rawList).map((query) => query.page.offset)).toEqual([
      0, 30, 60,
    ]);
    expect(streamed.flat()).toEqual(['target:a-1', 'target:a-2']);
  });

  it('lists the models that already failed in the snapshot cancel() emits', async () => {
    const gate = deferred();
    const entered = deferred();
    const rawList = vi.fn(async (raw: Record<string, unknown>) => {
      const query = asListQuery(raw);
      if (isCount(raw)) return { data: [], meta: { total_count: 1 } };
      if (query.filter.type === 'b') throw new TypeError('Failed to fetch');
      entered.resolve();
      await gate.promise;
      return { data: [item('a-1', 'a')], meta: { total_count: 1 } };
    });
    const snapshots: DiscoverySnapshot<string>[] = [];
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const run = controller.run(spec, {
      counts: 'background',
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    await entered.promise;
    await vi.waitFor(() =>
      expect(
        snapshots.some((snapshot) => snapshot.progress.modelsCompleted === 1),
      ).toBe(true),
    );
    controller.cancel();
    gate.resolve();
    const cancelled = await run;

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.issues).toEqual([
      expect.objectContaining({
        modelId: 'b',
        phase: 'scan',
        cause: 'network',
      }),
    ]);
    expect(last(snapshots)?.issues).toEqual(cancelled.issues);
  });

  it('scans models in the order given, not alphabetically', async () => {
    const { client, rawList } = pagedClient({ a: 1, b: 1, c: 1 });
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA, modelB, { id: 'c', apiKey: 'c', name: 'C' }],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const completed = await controller.run(
      { ...spec, rootModelIds: ['c', 'a', 'b'] },
      { counts: 'background' },
    );

    expect(scanCalls(rawList).map((query) => query.filter.type)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(completed.targets).toEqual([
      'target:c-1',
      'target:a-1',
      'target:b-1',
    ]);
  });

  it('matches one network page per discoverRecords call', async () => {
    const { client } = pagedClient({ a: 45 });
    const discoverRecords = vi.fn(
      async (records: ReadonlyArray<RawNestedItem>) =>
        records.map((record) => [`target:${record.id}`]),
    );
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecords,
      targetKey: (target) => target,
    });

    const completed = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { counts: 'background' },
    );

    expect(
      discoverRecords.mock.calls.map(([records]) => records.length),
    ).toEqual([30, 15]);
    expect(completed.targets).toHaveLength(45);
    expect(completed.progress.recordsScanned).toBe(45);
  });
});

describe('record sources', () => {
  function records(modelId: string, count: number): RawNestedItem[] {
    return Array.from(
      { length: count },
      (_, index) =>
        item(`${modelId}-${index + 1}`, modelId) as unknown as RawNestedItem,
    );
  }

  it('replays cached records through the same matching path without any request', async () => {
    const cached = records('a', 450);
    const rawList = vi.fn();
    const yieldToEventLoop = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
    const discoverRecords = vi.fn(async (batch: ReadonlyArray<RawNestedItem>) =>
      batch.map((record) => [`target:${record.id}`]),
    );
    const controller = createDiscoveryController<string>({
      client: { items: { rawList } } as unknown as Client,
      models: [modelA],
      discoverRecords,
      targetKey: (target) => target,
    });
    const snapshots: Array<DiscoverySnapshot<string>> = [];

    const completed = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        recordSource: () => replayRecordSource(cached, { yieldToEventLoop }),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      },
    );

    expect(rawList).not.toHaveBeenCalled();
    expect(discoverRecords.mock.calls.map(([batch]) => batch.length)).toEqual([
      REPLAY_BATCH_SIZE,
      REPLAY_BATCH_SIZE,
      50,
    ]);
    expect(yieldToEventLoop).toHaveBeenCalledTimes(2);
    expect(completed).toMatchObject({
      status: 'completed',
      progress: { recordsEstimated: 450, recordsScanned: 450 },
    });
    expect(completed.targets).toEqual(
      cached.map((record) => `target:${record.id}`),
    );
    expect(
      snapshots.some(
        (snapshot) =>
          snapshot.status === 'running' &&
          snapshot.progress.recordsScanned === 200,
      ),
    ).toBe(true);
  });

  it('mixes cached and network models, keeping the given model order', async () => {
    const { client, rawList } = pagedClient({ b: 2 });
    const cachedA = records('a', 2);
    const recordSource: DiscoveryRecordSource = (model) =>
      model.id === 'a' ? replayRecordSource(cachedA) : networkRecordSource;
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA, modelB],
      discoverRecord: (record) => [`target:${record.id}`],
      targetKey: (target) => target,
    });

    const completed = await controller.run(spec, {
      counts: 'background',
      recordSource,
    });

    expect(
      rawList.mock.calls.every(
        ([query]) => asListQuery(query).filter.type === 'b',
      ),
    ).toBe(true);
    expect(completed.status).toBe('completed');
    expect([...completed.targets].sort()).toEqual([
      'target:a-1',
      'target:a-2',
      'target:b-1',
      'target:b-2',
    ]);
  });

  it('resolves a scan only when every record of the model was processed', async () => {
    const outcomes: Record<string, 'resolved' | 'rejected'> = {};
    const observed: DiscoveryRecordSource = (model) => ({
      count: networkRecordSource.count,
      scan: async (context) => {
        try {
          await networkRecordSource.scan(context);
          outcomes[model.id] = 'resolved';
        } catch (error) {
          outcomes[model.id] = 'rejected';
          throw error;
        }
      },
    });
    const { client } = pagedClient({ a: 1, b: 3 }, 1);
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA, modelB],
      discoverRecord: async (record) => {
        if (record.id.startsWith('b-')) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return [`target:${record.id}`];
      },
      targetKey: (target) => target,
    });

    const capped = await controller.run(spec, {
      counts: 'background',
      recordSource: observed,
      maxTargets: 2,
    });

    expect(capped.capped).toBe(true);
    expect(outcomes).toEqual({ a: 'resolved', b: 'rejected' });
  });

  it('rejects a scan capped on the last page of its model', async () => {
    const outcomes: Record<string, 'resolved' | 'rejected'> = {};
    const observed =
      (source: ModelRecordSource): DiscoveryRecordSource =>
      (model) => ({
        count: source.count,
        scan: async (context) => {
          try {
            await source.scan(context);
            outcomes[model.id] = 'resolved';
          } catch (error) {
            outcomes[model.id] = 'rejected';
            throw error;
          }
        },
      });
    const { client } = pagedClient({ a: 2 });
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecords: async (records) =>
        records.map((record) => [`target:${record.id}`]),
      targetKey: (target) => target,
    });

    const network = await controller.run(spec, {
      recordSource: observed(networkRecordSource),
      maxTargets: 2,
    });
    expect(network.capped).toBe(true);
    expect(outcomes).toEqual({ a: 'rejected' });

    const cached = [item('a-1', 'a'), item('a-2', 'a')] as RawNestedItem[];
    const replay = await controller.run(spec, {
      recordSource: observed(replayRecordSource(cached)),
      maxTargets: 2,
    });
    expect(replay.capped).toBe(true);
    expect(outcomes).toEqual({ a: 'rejected' });
  });
});

/** `pagedClient`, plus reads by id (`filter[ids]`): ids are `${model}-${n}`. */
function resumableClient(counts: Record<string, number>): {
  client: Client;
  rawList: ReturnType<typeof vi.fn>;
} {
  const paged = pagedClient(counts);
  const rawList = vi.fn(async (raw: Record<string, unknown>) => {
    const query = asListQuery(raw);
    if (!query.filter.ids) {
      return (paged.rawList as (query: Record<string, unknown>) => unknown)(
        raw,
      );
    }
    const data = query.filter.ids.split(',').flatMap((id) => {
      const [modelId = '', n] = id.split('-');
      return Number(n) <= (counts[modelId] ?? 0) ? [item(id, modelId)] : [];
    });
    return { data, meta: { total_count: data.length } };
  });
  return { client: { items: { rawList } } as unknown as Client, rawList };
}

function oneTargetPerRecord(client: Client, models: DiscoveryModel[]) {
  return createDiscoveryController<string>({
    client,
    models,
    discoverRecord: (record) => [record.id],
    targetKey: (target) => target,
  });
}

describe('DiscoveryController: reading on after the cap', () => {
  it('reports where each model got to; the record that reaches the cap is read again', async () => {
    const { client } = resumableClient({ a: 90 });
    const controller = oneTargetPerRecord(client, [modelA]);

    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { counts: 'background', maxTargets: 45 },
    );

    expect(snapshot).toMatchObject({ capped: true, targetCount: 45 });
    // a-45 (offset 44) reached the cap: it counts as not fully read.
    expect(snapshot.positions).toEqual({ a: 44 });
    expect(snapshot.recheckLeft).toEqual({});
  });

  it('resumes a little before the position, and reports the model done', async () => {
    const { client, rawList } = resumableClient({ a: 90 });
    const controller = oneTargetPerRecord(client, [modelA]);

    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        maxTargets: 1000,
        resume: { positions: { a: 44 } },
      },
    );

    expect(scanCalls(rawList).map((query) => query.page.offset)).toEqual([
      14, 44, 74,
    ]);
    expect(snapshot.targets[0]).toBe('a-15');
    expect(snapshot.targets).toHaveLength(76);
    expect(snapshot.positions).toEqual({ a: 'done' });
    expect(snapshot.complete).toBe(true);
  });

  it('skips done models, re-reads the rechecks by id first, and drops ids that are gone', async () => {
    const { client, rawList } = resumableClient({ a: 50, b: 3 });
    const controller = oneTargetPerRecord(client, [modelA, modelB]);

    const snapshot = await controller.run(spec, {
      counts: 'background',
      maxTargets: 1000,
      resume: {
        positions: { a: 'done' },
        recheck: new Map([['a', ['a-2', 'a-5', 'a-99']]]),
      },
    });

    expect(
      scanCalls(rawList)
        .filter((query) => !query.filter.ids)
        .map((query) => query.filter.type),
    ).toEqual(['b']);
    expect([...snapshot.targets].sort()).toEqual([
      'a-2',
      'a-5',
      'b-1',
      'b-2',
      'b-3',
    ]);
    expect(snapshot.positions).toEqual({ a: 'done', b: 'done' });
    expect(snapshot.recheckLeft).toEqual({});
  });

  it('keeps the rechecks it did not get to, and the position it was resumed from', async () => {
    const { client } = resumableClient({ a: 50 });
    const controller = oneTargetPerRecord(client, [modelA]);

    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        maxTargets: 2,
        resume: {
          positions: { a: 40 },
          recheck: new Map([['a', ['a-1', 'a-2', 'a-3']]]),
        },
      },
    );

    expect(snapshot).toMatchObject({ capped: true, targets: ['a-1', 'a-2'] });
    // a-2 reached the cap: it is looked at again, like a-3.
    expect(snapshot.recheckLeft).toEqual({ a: ['a-2', 'a-3'] });
    expect(snapshot.positions).toEqual({ a: 40 });
  });

  it('reads past the records it was told to skip, counting them as read', async () => {
    const { client } = resumableClient({ a: 90 });
    const controller = oneTargetPerRecord(client, [modelA]);
    const handled = new Set(
      Array.from({ length: 30 }, (_, index) => `a-${15 + index}`),
    );

    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        maxTargets: 10,
        resume: { positions: { a: 44 }, skip: handled },
      },
    );

    // a-15 to a-44 (the overlap) were dealt with: the first match is a-45.
    expect(snapshot.targets[0]).toBe('a-45');
    expect(snapshot.positions).toEqual({ a: 53 });
  });

  it('never goes back before the position it resumed from', async () => {
    const { client } = resumableClient({ a: 90 });
    const controller = oneTargetPerRecord(client, [modelA]);

    // Capped again inside the overlap (records 15 to 44 read again).
    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { counts: 'background', maxTargets: 5, resume: { positions: { a: 44 } } },
    );

    expect(snapshot.targets).toEqual(['a-15', 'a-16', 'a-17', 'a-18', 'a-19']);
    expect(snapshot.positions).toEqual({ a: 44 });
  });

  it('estimates only what a resumed run reads', async () => {
    const { client } = resumableClient({ a: 50, b: 90 });
    const controller = oneTargetPerRecord(client, [modelA, modelB]);
    const estimates: Array<number | null> = [];

    await controller.run(spec, {
      counts: 'background',
      maxTargets: 1000,
      resume: {
        positions: { a: 'done', b: 44 },
        recheck: new Map([['a', ['a-1', 'a-2']]]),
      },
      onSnapshot: (snapshot) =>
        estimates.push(snapshot.progress.recordsEstimated),
    });

    // a: its 2 rechecks; b: 90 records from offset 14 on.
    expect(estimates.filter((value) => value !== null)).toContain(2 + 76);
  });

  it('starts a replayed (cached) model at the resumed offset too', async () => {
    const records = Array.from({ length: 60 }, (_, index) =>
      item(`a-${index + 1}`, 'a'),
    );
    const controller = oneTargetPerRecord(pagedClient({}).client, [modelA]);

    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        resume: { positions: { a: 50 } },
        recordSource: () =>
          replayRecordSource(records as unknown as RawNestedItem[]),
      },
    );

    expect(snapshot.targets[0]).toBe('a-21');
    expect(snapshot.targets).toHaveLength(40);
  });
});

describe('DiscoveryController: what reading on must not lose', () => {
  it('keeps the rechecks of a model the capped run never reached', async () => {
    const { client } = resumableClient({ a: 90, b: 90, c: 90, d: 90, e: 10 });
    const models = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id,
      apiKey: id,
      name: id.toUpperCase(),
    }));
    const controller = oneTargetPerRecord(client, models);

    const snapshot = await controller.run(
      { ...spec, rootModelIds: models.map((model) => model.id) },
      {
        counts: 'background',
        maxTargets: 5,
        resume: {
          positions: { a: 40, b: 40, c: 40, d: 40, e: 'done' },
          recheck: new Map([['e', ['e-3', 'e-7']]]),
        },
      },
    );

    expect(snapshot.capped).toBe(true);
    expect(snapshot.recheckLeft).toEqual({ e: ['e-3', 'e-7'] });
  });

  it('rechecks the record the cap cut short, even though it will be skipped', async () => {
    const { client } = resumableClient({ a: 10 });
    const controller = createDiscoveryController<string>({
      client,
      models: [modelA],
      discoverRecord: (record) =>
        record.id === 'a-5' ? ['a-5#1', 'a-5#2', 'a-5#3'] : [`${record.id}#1`],
      targetKey: (target) => target,
    });

    const first = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { counts: 'background', maxTargets: 6 },
    );
    expect(first.targets.slice(-2)).toEqual(['a-5#1', 'a-5#2']);
    expect(first.recheckLeft).toEqual({ a: ['a-5'] });

    const second = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      {
        counts: 'background',
        maxTargets: 100,
        resume: {
          positions: first.positions,
          recheck: new Map(Object.entries(first.recheckLeft)),
          skip: new Set(['a-1', 'a-2', 'a-3', 'a-4', 'a-5']),
        },
      },
    );
    expect(second.targets).toContain('a-5#3');
  });

  it("rechecks nothing when the cap lands on a record's last match", async () => {
    const { client } = resumableClient({ a: 10 });
    const controller = oneTargetPerRecord(client, [modelA]);
    const snapshot = await controller.run(
      { ...spec, rootModelIds: ['a'] },
      { counts: 'background', maxTargets: 4 },
    );
    expect(snapshot.recheckLeft).toEqual({});
  });
});
