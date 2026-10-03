// @vitest-environment jsdom

import { buildClient, TimeoutError } from '@datocms/cma-client-browser';
import { useCommentsSubscription } from '@hooks/useCommentsSubscription';
import { CMA_READ_LIMITS } from '@utils/cmaFallbackRead';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, renderHook } from '../testUtils/react';

vi.mock('react-datocms/use-query-subscription', () => ({
  useQuerySubscription: () => ({ data: null, status: 'closed', error: null }),
}));

vi.mock('@/utils/errorLogger', () => ({ logDebug: vi.fn(), logError: vi.fn() }));

function jsonResponse(data: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function renderFallback(
  fetchFn: typeof fetch,
  options: { requestTimeout?: number; recordId?: () => string } = {},
) {
  const client = buildClient({
    apiToken: 'unit-test-placeholder',
    environment: 'branch-env',
    baseUrl: 'https://unit-test.invalid',
    fetchFn,
    requestTimeout: options.requestTimeout,
  });

  return renderHook(() => {
    const recordId = options.recordId?.() ?? 'record-1';
    return useCommentsSubscription({
      ctx: {
        environment: 'branch-env',
        item: { id: recordId },
        itemType: { id: 'model-1' },
        itemTypes: {},
        formValues: {},
        site: { attributes: { internal_domain: 'unit-test.invalid' } },
      } as unknown as RenderItemFormSidebarCtx,
      realTimeEnabled: false,
      cdaToken: '',
      client,
      commentsModelId: 'comments-model',
      isSyncAllowed: true,
      query: 'query',
      variables: { modelId: 'model-1', recordId },
      filterParams: { modelId: 'model-1', recordId },
      subscriptionEnabled: true,
      currentUserId: 'user-1',
    });
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('CMA fallback with the installed SDK retry contract', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not abandon an active SDK read at the former outer 30s timeout', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn<typeof fetch>(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    const { result, unmount } = renderFallback(fetchFn, { requestTimeout: 100000 });

    await advance(35000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current?.isLoading).toBe(true);
    expect(result.current?.error).toBeNull();
    await act(async () => { resolveFetch?.(jsonResponse([])); });
    expect(result.current?.isLoading).toBe(false);
    expect(result.current?.error).toBeNull();
    unmount();
  });

  it('lets the SDK make five timeout attempts and aborts each abandoned transport', async () => {
    const signals: AbortSignal[] = [];
    let active = 0;
    let maximumActive = 0;
    const fetchFn = vi.fn<typeof fetch>((_, init) => new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Missing request signal');
      signals.push(signal);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      signal.addEventListener('abort', () => {
        active -= 1;
        reject(signal.reason);
      }, { once: true });
    }));
    const { result, unmount } = renderFallback(fetchFn, { requestTimeout: 10 });

    await advance(12000);
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(maximumActive).toBe(1);
    expect(active).toBe(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(result.current?.error).toBeInstanceOf(TimeoutError);
    expect(result.current?.isLoading).toBe(false);
    await advance(120000);
    expect(fetchFn).toHaveBeenCalledTimes(5);
    unmount();
  });

  it('uses the SDK rate-limit delay without a second hook retry chain', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([], 429, { 'X-RateLimit-Reset': '2' }))
      .mockResolvedValueOnce(jsonResponse([]));
    const { result, unmount } = renderFallback(fetchFn);
    await advance(1999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current?.isLoading).toBe(false);
    expect(result.current?.error).toBeNull();
    await advance(120000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    unmount();
  });

  it.each(['rate-limit', 'transient'])('bounds the SDK %s loop to five transports', async (kind) => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () =>
      kind === 'rate-limit'
        ? jsonResponse([], 429, { 'X-RateLimit-Reset': '1' })
        : jsonResponse([{ id: 'temporary', type: 'api_error', attributes: {
          code: 'TEMPORARY_ERROR', transient: true, details: {},
        } }], 503),
    );
    const { result, unmount } = renderFallback(fetchFn);
    await advance(16000);
    expect(fetchFn).toHaveBeenCalledTimes(CMA_READ_LIMITS.MAX_REQUESTS);
    expect(result.current?.error?.message).toContain('request limit');
    expect(result.current?.isLoading).toBe(false);
    await advance(120000);
    expect(fetchFn).toHaveBeenCalledTimes(5);
    unmount();
  });

  it('surfaces a permanent SDK error once and retains explicit manual retry', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: 'forbidden', type: 'api_error',
        attributes: { code: 'INSUFFICIENT_PERMISSIONS', details: {} },
      }], 403))
      .mockResolvedValueOnce(jsonResponse([]));
    const { result, unmount } = renderFallback(fetchFn);
    await flushPromises();
    expect(result.current?.error).not.toBeNull();
    expect(result.current?.isLoading).toBe(false);
    await advance(120000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current?.retry(); });
    await flushPromises();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current?.error).toBeNull();
    unmount();
  });

  it('aborts an active fetch when unmounted without starting more attempts', async () => {
    let signal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<typeof fetch>((_, init) => new Promise((_, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
    }));
    const { unmount } = renderFallback(fetchFn);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(Error);
    await advance(120000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('blocks the next transport after cleanup during SDK backoff', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([], 429, { 'X-RateLimit-Reset': '10' }),
    );
    const { unmount } = renderFallback(fetchFn);
    await flushPromises();
    unmount();
    await advance(20000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('ends loading at the total deadline even during a long SDK backoff', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([], 429, { 'X-RateLimit-Reset': '600' }),
    );
    const { result, unmount } = renderFallback(fetchFn);
    await flushPromises();
    await advance(CMA_READ_LIMITS.MAX_DURATION_MS);
    expect(result.current?.isLoading).toBe(false);
    expect(result.current?.error?.message).toContain('120 seconds');
    await advance(600000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current?.error?.message).toContain('120 seconds');
    unmount();
  });

  it('aborts the previous record read and ignores its late response', async () => {
    let recordId = 'record-1';
    let oldSignal: AbortSignal | null | undefined;
    let resolveOld: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn<typeof fetch>()
      .mockImplementationOnce((_, init) => {
        oldSignal = init?.signal;
        return new Promise((resolve) => { resolveOld = resolve; });
      })
      .mockResolvedValueOnce(jsonResponse([]));
    const { result, rerender, unmount } = renderFallback(fetchFn, {
      recordId: () => recordId,
    });
    recordId = 'record-2';
    rerender();
    await flushPromises();
    expect(oldSignal?.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current?.isLoading).toBe(false);
    await act(async () => {
      resolveOld?.(jsonResponse([{ id: 'old-aggregate', type: 'item',
        attributes: { content: '[]' },
        relationships: { item_type: { data: { id: 'comments-model', type: 'item_type' } } },
      }]));
    });
    expect(result.current?.commentRecordId).toBeNull();
    expect(result.current?.comments).toEqual([]);
    expect(result.current?.error).toBeNull();
    unmount();
  });
});
