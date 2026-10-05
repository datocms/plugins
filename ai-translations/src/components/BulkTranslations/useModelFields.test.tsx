import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SdkField } from '../../utils/translation/BulkTranslationHelpers';
import { useModelFields } from './useModelFields';

const fields: SdkField[] = [
  {
    id: 'title',
    attributes: {
      api_key: 'title',
      label: 'Title',
      localized: true,
      position: 0,
      appearance: { editor: 'single_line' },
    },
  },
];

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function props(
  modelIds: string[],
  loadFields: (id: string) => Promise<unknown>,
) {
  return {
    modelIds,
    loadFields,
    scopeKey: 'main',
    translationFields: ['single_line'],
    excludedApiKeys: [],
  };
}

describe('useModelFields', () => {
  afterEach(cleanup);

  it('reserves in-flight calls synchronously across rerenders and StrictMode effect replay', async () => {
    const request = deferred<SdkField[]>();
    const load = vi.fn(() => request.promise);
    const { result, rerender } = renderHook(useModelFields, {
      initialProps: props(['article', 'article'], load),
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    });
    rerender(props(['article'], load));
    rerender(props(['article', 'article'], load));
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => request.resolve(fields));
    expect(result.current.selectedFieldsByModel).toEqual({
      article: ['title'],
    });
    act(() => result.current.setModelFields('article', []));
    expect(result.current.selectedFieldsByModel).toEqual({ article: [] });
    rerender(props(['article'], load));
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.selectedFieldsByModel).toEqual({ article: [] });
  });

  it('does not resurrect removed models or start their queued requests', async () => {
    const requests: ReturnType<typeof deferred<SdkField[]>>[] = [];
    const load = vi.fn(() => {
      const request = deferred<SdkField[]>();
      requests.push(request);
      return request.promise;
    });
    const { result, rerender } = renderHook(useModelFields, {
      initialProps: props(['a', 'b', 'c', 'd', 'removed-queued'], load),
    });
    expect(load).toHaveBeenCalledTimes(4);
    rerender(props(['b'], load));
    await act(async () => {
      for (const request of requests) request.resolve(fields);
    });
    expect(load).toHaveBeenCalledTimes(4);
    expect(result.current.fieldsByModel).toEqual({ b: expect.any(Array) });
    expect(result.current.selectedFieldsByModel).toEqual({ b: ['title'] });
  });

  it('ignores old scope responses and keeps old calls inside the concurrency bound', async () => {
    const requests: ReturnType<typeof deferred<SdkField[]>>[] = [];
    const load = vi.fn(() => {
      const request = deferred<SdkField[]>();
      requests.push(request);
      return request.promise;
    });
    const { result, rerender } = renderHook(useModelFields, {
      initialProps: props(['a', 'b', 'c', 'd'], load),
    });
    rerender({ ...props(['new'], load), scopeKey: 'sandbox' });
    expect(load).toHaveBeenCalledTimes(4);
    await act(async () => requests[0].resolve(fields));
    expect(load).toHaveBeenCalledTimes(5);
    await act(async () => requests[4].resolve(fields));
    await act(async () => {
      for (const request of requests.slice(1, 4)) request.resolve(fields);
    });
    expect(result.current.fieldsByModel).toEqual({ new: expect.any(Array) });
    expect(result.current.selectedFieldsByModel).toEqual({ new: ['title'] });
  });

  it('retries only a failed model and stops queued work on unmount', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockResolvedValue(fields);
    const { result, unmount } = renderHook(useModelFields, {
      initialProps: props(['a'], load),
    });
    await waitFor(() =>
      expect(result.current.failedFieldModels.has('a')).toBe(true),
    );
    expect(load).toHaveBeenCalledTimes(1);
    act(() => result.current.retryFields('a'));
    await waitFor(() =>
      expect(result.current.selectedFieldsByModel.a).toEqual(['title']),
    );
    expect(load).toHaveBeenCalledTimes(2);
    unmount();
    errorLog.mockRestore();

    const pending = deferred<SdkField[]>();
    const pendingLoad = vi.fn(() => pending.promise);
    const view = renderHook(useModelFields, {
      initialProps: props(
        Array.from({ length: 100 }, (_, index) => `${index}`),
        pendingLoad,
      ),
    });
    view.unmount();
    await act(async () => pending.resolve(fields));
    expect(pendingLoad).toHaveBeenCalledTimes(4);
  });
});
