// @vitest-environment jsdom

import { useAsyncOperation } from '@hooks/useAsyncOperation';
import { describe, expect, it } from 'vitest';
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
});
