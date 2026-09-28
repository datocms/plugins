import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionResult, LinkGroup } from '../types';
import { useScan } from './useScan';

function record(
  url = 'https://example.com/article',
  recordId = 'record-1',
): ExtractionResult {
  return {
    warnings: [],
    occurrences: [
      {
        id: `${recordId}:link`,
        recordId,
        recordTitle: recordId,
        modelId: 'articles',
        modelName: 'Articles',
        fieldPath: 'body',
        fieldLabel: 'Body',
        locale: 'en',
        blockPath: [],
        url,
      },
    ],
  };
}

function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (value: T) => complete?.(value) };
}

function workingFetch() {
  const fetchRequest = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchRequest);
  return fetchRequest;
}

function requireGroup(groups: LinkGroup[] | undefined): LinkGroup {
  const group = groups?.[0];
  if (!group) throw new Error('The test expected a discovered link.');
  return group;
}

afterEach(() => vi.unstubAllGlobals());

describe('useScan', () => {
  it('keeps the groups a session reuses between reports', async () => {
    const gate = deferred<void>();
    const { result } = renderHook(() => useScan('main:user-1'));
    let scan: Promise<void> | undefined;
    await act(async () => {
      scan = result.current.start('Records', async (session) => {
        session.addRecord(record('/one', 'record-1'));
        session.addRecord(record('/two', 'record-2'));
        session.flush();
        await gate.promise;
        session.addRecord(record('/one', 'record-3'));
      });
    });
    const [one, two] = result.current.report?.groups ?? [];
    await act(async () => {
      gate.resolve();
      await scan;
    });
    const [grown, unchanged] = result.current.report?.groups ?? [];
    expect(result.current.report?.state).toBe('complete');
    expect(unchanged).toBe(two);
    expect(grown).not.toBe(one);
    expect(grown.occurrences).toHaveLength(2);
  });

  it('marks empty reports stale and resets the flag only on a fresh scan', async () => {
    const { result } = renderHook(() => useScan('main:user-1'));
    await act(async () => {
      await result.current.start('Empty record', async (session) => {
        session.addRecord({ occurrences: [], warnings: [] });
      });
    });
    expect(result.current.report).toMatchObject({
      state: 'complete',
      stale: false,
      groups: [],
    });
    act(() => result.current.markStale('record-with-new-link'));
    expect(result.current.report).toMatchObject({ stale: true, groups: [] });
    await act(async () => {
      await result.current.start('Fresh empty record', async (session) => {
        session.addRecord({ occurrences: [], warnings: [] });
      });
    });
    expect(result.current.report?.stale).toBe(false);
  });

  it('retains staleness through later scan callbacks and URL rechecks', async () => {
    const pending = deferred<Response>();
    const fetchRequest = workingFetch().mockImplementationOnce(
      () => pending.promise,
    );
    const { result } = renderHook(() => useScan('main:user-1'));
    let scan: Promise<void> | undefined;
    await act(async () => {
      scan = result.current.start('Article', async (session) =>
        session.addRecord(record()),
      );
    });
    await waitFor(() => expect(fetchRequest).toHaveBeenCalledOnce());
    act(() => result.current.markStale('record-1'));
    await act(async () => {
      pending.resolve(new Response(null, { status: 200 }));
      await scan;
    });
    expect(result.current.report?.stale).toBe(true);
    expect(requireGroup(result.current.report?.groups).stale).toBe(true);
    await act(async () =>
      result.current.recheck(requireGroup(result.current.report?.groups)),
    );
    expect(result.current.report).toMatchObject({
      state: 'complete',
      stale: true,
    });
    expect(requireGroup(result.current.report?.groups).stale).toBe(true);
    await act(async () =>
      result.current.start('New scan', async (session) =>
        session.addRecord(record()),
      ),
    );
    expect(result.current.report?.stale).toBe(false);
    expect(requireGroup(result.current.report?.groups).stale).toBe(false);
  });

  it('finishes cancellation during stalled discovery and keeps that incomplete origin after recheck', async () => {
    workingFetch();
    const pendingProducer = deferred<void>();
    const { result } = renderHook(() => useScan('main:user-1'));
    let scan: Promise<void> | undefined;
    await act(async () => {
      scan = result.current.start('Many articles', async (session) => {
        session.addRecord(record());
        await pendingProducer.promise;
        session.addRecord(record('https://other.example/late', 'late-record'));
        session.warn('This late callback must not change the report.');
      });
    });
    await waitFor(() =>
      expect(requireGroup(result.current.report?.groups).result.status).toBe(
        'reachable',
      ),
    );
    await act(async () => {
      result.current.cancel();
      await scan;
    });
    expect(result.current.report).toMatchObject({
      state: 'cancelled',
      recordsScanned: 1,
    });
    await act(async () =>
      result.current.recheck(requireGroup(result.current.report?.groups)),
    );
    expect(result.current.report?.state).toBe('cancelled');
    await act(async () => pendingProducer.resolve());
    expect(result.current.report?.groups).toHaveLength(1);
    expect(result.current.report?.warnings).toEqual([]);
  });

  it('retains partial content-reading errors after successful URL rechecks', async () => {
    workingFetch();
    const { result } = renderHook(() => useScan('main:user-1'));
    await act(async () => {
      await result.current.start('Articles', async (session) => {
        session.addRecord(record());
        throw new Error('The next record page could not be read.');
      });
    });
    expect(result.current.report?.state).toBe('partial');
    await act(async () =>
      result.current.recheck(requireGroup(result.current.report?.groups)),
    );
    expect(result.current.report?.state).toBe('partial');
    expect(result.current.report?.warnings).toEqual([
      'The next record page could not be read.',
    ]);
  });

  it('cancels a URL recheck and permits a later retry to complete an originally complete scan', async () => {
    const fetchRequest = workingFetch();
    const { result } = renderHook(() => useScan('main:user-1'));
    await act(async () =>
      result.current.start('Article', async (session) =>
        session.addRecord(record()),
      ),
    );
    fetchRequest.mockImplementationOnce(() => new Promise(() => {}));
    let recheck: Promise<void> | undefined;
    await act(async () => {
      recheck = result.current.recheck(
        requireGroup(result.current.report?.groups),
      );
    });
    expect(result.current.report).toMatchObject({
      state: 'running',
      finishedAt: undefined,
    });
    await act(async () => {
      result.current.cancel();
      await recheck;
    });
    expect(result.current.report?.state).toBe('cancelled');
    expect(requireGroup(result.current.report?.groups).result.status).toBe(
      'cancelled',
    );
    await act(async () =>
      result.current.recheck(requireGroup(result.current.report?.groups)),
    );
    expect(result.current.report?.state).toBe('complete');
  });

  it('clears a recheck on context change and ignores its late response', async () => {
    const fetchRequest = workingFetch();
    const { result, rerender } = renderHook(({ context }) => useScan(context), {
      initialProps: { context: 'main:user-1' },
    });
    await act(async () =>
      result.current.start('Article', async (session) =>
        session.addRecord(record()),
      ),
    );
    const oldGroup = requireGroup(result.current.report?.groups);
    const lateResponse = deferred<Response>();
    fetchRequest.mockImplementationOnce(() => lateResponse.promise);
    let recheck: Promise<void> | undefined;
    await act(async () => {
      recheck = result.current.recheck(oldGroup);
    });
    rerender({ context: 'sandbox:user-2' });
    await act(async () => {
      await recheck;
    });
    expect(result.current.report).toBeUndefined();
    await act(async () =>
      result.current.start('New context', async (session) =>
        session.addRecord(record('https://new.example/', 'new-record')),
      ),
    );
    await act(async () =>
      lateResponse.resolve(new Response(null, { status: 404 })),
    );
    expect(result.current.report).toMatchObject({
      scope: 'New context',
      state: 'complete',
    });
    expect(requireGroup(result.current.report?.groups).result.url).toBe(
      'https://new.example/',
    );
  });

  it('disposes old discovery on context change and prevents stale callbacks from replacing a new scan', async () => {
    workingFetch();
    const pendingProducer = deferred<void>();
    const { result, rerender } = renderHook(({ context }) => useScan(context), {
      initialProps: { context: 'main:user-1' },
    });
    let oldScan: Promise<void> | undefined;
    await act(async () => {
      oldScan = result.current.start('Old context', async (session) => {
        await pendingProducer.promise;
        session.addRecord(record('https://old.example/', 'old-record'));
      });
    });
    act(() => result.current.markStale());
    rerender({ context: 'sandbox:user-2' });
    await act(async () => {
      await oldScan;
    });
    expect(result.current.report).toBeUndefined();
    await act(async () =>
      result.current.start('New context', async (session) =>
        session.addRecord(record('https://new.example/', 'new-record')),
      ),
    );
    await act(async () => pendingProducer.resolve());
    expect(result.current.report).toMatchObject({
      scope: 'New context',
      state: 'complete',
      stale: false,
      recordsScanned: 1,
    });
    expect(requireGroup(result.current.report?.groups).result.url).toBe(
      'https://new.example/',
    );
  });

  it('finishes pending work on unmount without processing later producer callbacks', async () => {
    const fetchRequest = workingFetch();
    const pendingProducer = deferred<void>();
    const { result, unmount } = renderHook(() => useScan('main:user-1'));
    let scan: Promise<void> | undefined;
    await act(async () => {
      scan = result.current.start('Article', async (session) => {
        await pendingProducer.promise;
        session.addRecord(record());
      });
    });
    unmount();
    await scan;
    pendingProducer.resolve();
    await Promise.resolve();
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});
