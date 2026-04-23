// @vitest-environment jsdom

import { useAsyncOperation } from '@hooks/useAsyncOperation';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, renderHook } from '../testUtils/react';

describe('useAsyncOperation', () => {
  it('clears loading when the hook is disabled while work is in flight', async () => {
    let resolvePromise: ((value: string) => void) | null = null;
    let enabled = true;

    const asyncFn = () =>
      new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });

    const { result, rerender, unmount } = renderHook(() =>
      useAsyncOperation(asyncFn, [], {
        enabled,
        operationName: 'load data',
      }),
    );

    expect(result.current?.isLoading).toBe(true);

    enabled = false;
    rerender();

    expect(result.current?.isLoading).toBe(false);

    resolvePromise?.('done');
    await flushPromises();
    unmount();
  });

  it('does not rerun when option objects change identity', async () => {
    const asyncFn = vi.fn().mockResolvedValue('done');

    const { rerender, unmount } = renderHook(() =>
      useAsyncOperation(asyncFn, ['stable-dep'], {
        enabled: true,
        operationName: 'load data',
        errorContext: { source: 'rerender' },
        onSuccess: () => {},
      }),
    );

    await flushPromises();
    expect(asyncFn).toHaveBeenCalledTimes(1);

    rerender();
    await flushPromises();

    expect(asyncFn).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('reruns when declared dependencies change', async () => {
    const asyncFn = vi.fn().mockResolvedValue('done');
    let itemId = 'item-1';

    const { rerender, unmount } = renderHook(() =>
      useAsyncOperation(asyncFn, [itemId], {
        enabled: true,
        operationName: 'load data',
      }),
    );

    await flushPromises();
    expect(asyncFn).toHaveBeenCalledTimes(1);

    itemId = 'item-2';
    rerender();
    await flushPromises();

    expect(asyncFn).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('reruns when retry is requested', async () => {
    const asyncFn = vi.fn().mockResolvedValue('done');

    const { result, unmount } = renderHook(() =>
      useAsyncOperation(asyncFn, ['stable-dep'], {
        enabled: true,
        operationName: 'load data',
      }),
    );

    await flushPromises();
    expect(asyncFn).toHaveBeenCalledTimes(1);

    act(() => {
      result.current?.retry();
    });
    await flushPromises();

    expect(asyncFn).toHaveBeenCalledTimes(2);
    unmount();
  });
});
