// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentsSubscription } from '@hooks/useCommentsSubscription';
import { renderHook, flushPromises } from '../testUtils/react';

const useQuerySubscriptionMock = vi.fn();

vi.mock('react-datocms/use-query-subscription', () => ({
  useQuerySubscription: (...args: unknown[]) => useQuerySubscriptionMock(...args),
}));

function createSidebarCtx(recordId: string | null, includeCommentsModel = true) {
  return {
    item: recordId ? { id: recordId } : null,
    itemType: { id: 'model-1' },
    itemTypes: includeCommentsModel
      ? {
          'comments-model': {
            id: 'comments-model',
            attributes: { api_key: 'project_comment' },
          },
        }
      : {},
    site: { attributes: { internal_domain: 'example.admin.datocms.com' } },
  } as never;
}

describe('useCommentsSubscription', () => {
  beforeEach(() => {
    useQuerySubscriptionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears any pending auto-reconnect timer before manual retry', async () => {
    vi.useFakeTimers();
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'closed',
      error: null,
    });

    const { result, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1'),
        realTimeEnabled: true,
        cdaToken: 'token-1',
        client: null,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      })
    );

    const initialCallCount = useQuerySubscriptionMock.mock.calls.length;

    await act(async () => {
      await result.current?.retry();
    });

    const afterRetryCallCount = useQuerySubscriptionMock.mock.calls.length;
    expect(afterRetryCallCount).toBeGreaterThan(initialCallCount);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(useQuerySubscriptionMock.mock.calls.length).toBe(afterRetryCallCount);
    unmount();
  });

  it('clears stale comments when fallback fetching becomes unavailable', async () => {
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'closed',
      error: null,
    });

    const client = {
      items: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'comment-record-1',
            content: JSON.stringify([
              {
                id: 'comment-1',
                dateISO: '2024-01-01T00:00:00.000Z',
                content: [{ type: 'text', content: 'Hello' }],
                authorId: 'user-1',
                upvoterIds: [],
                replies: [],
              },
            ]),
          },
        ]),
      },
    } as never;

    let recordId: string | null = 'record-1';

    const { result, rerender, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx(recordId),
        realTimeEnabled: false,
        cdaToken: '',
        client,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: recordId ?? '' },
        filterParams: { modelId: 'model-1', recordId: recordId ?? '' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      })
    );

    await flushPromises();
    await flushPromises();

    expect(result.current?.comments).toHaveLength(1);
    expect(result.current?.commentRecordId).toBe('comment-record-1');

    recordId = null;
    rerender();
    await flushPromises();

    expect(result.current?.comments).toEqual([]);
    expect(result.current?.commentRecordId).toBeNull();
    unmount();
  });

  it('uses the provided comments model ID when the context has not loaded the model yet', async () => {
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'closed',
      error: null,
    });

    const client = {
      items: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'comment-record-1',
            content: JSON.stringify([
              {
                id: 'comment-1',
                dateISO: '2024-01-01T00:00:00.000Z',
                content: [{ type: 'text', content: 'Recovered' }],
                authorId: 'user-1',
                upvoterIds: [],
                replies: [],
              },
            ]),
          },
        ]),
      },
    } as never;

    const { result, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1', false),
        realTimeEnabled: false,
        cdaToken: '',
        client,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      })
    );

    await flushPromises();
    await flushPromises();

    expect(client.items.list).toHaveBeenCalledTimes(1);
    expect(result.current?.comments).toHaveLength(1);
    expect(result.current?.commentsModelId).toBe('comments-model');
    unmount();
  });
});
