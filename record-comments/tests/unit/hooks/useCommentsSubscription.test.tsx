// @vitest-environment jsdom

import type { CommentType } from '@ctypes/comments';
import type { Client } from '@datocms/cma-client-browser';
import { useCommentsSubscription } from '@hooks/useCommentsSubscription';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, renderHook } from '../testUtils/react';

const useQuerySubscriptionMock = vi.fn();

vi.mock('react-datocms/use-query-subscription', () => ({
  useQuerySubscription: (...args: unknown[]) =>
    useQuerySubscriptionMock(...args),
}));

function createSidebarCtx(
  recordId: string | null,
  includeCommentsModel = true,
  formValues: Record<string, unknown> = {},
) {
  return {
    environment: 'branch-env',
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
    formValues,
    site: { attributes: { internal_domain: 'example.admin.datocms.com' } },
  } as unknown as RenderItemFormSidebarCtx;
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
      }),
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

    expect(useQuerySubscriptionMock.mock.calls.length).toBe(
      afterRetryCallCount,
    );
    unmount();
  });

  it('passes the current environment to the realtime subscription', () => {
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'connecting',
      error: null,
    });

    const { unmount } = renderHook(() =>
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
      }),
    );

    expect(useQuerySubscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'branch-env',
      }),
    );

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
    };

    let recordId: string | null = 'record-1';

    const { result, rerender, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx(recordId),
        realTimeEnabled: false,
        cdaToken: '',
        client: client as unknown as Client,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: recordId ?? '' },
        filterParams: { modelId: 'model-1', recordId: recordId ?? '' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
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
    };

    const { result, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1', false),
        realTimeEnabled: false,
        cdaToken: '',
        client: client as unknown as Client,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
    );

    await flushPromises();
    await flushPromises();

    expect(client.items.list).toHaveBeenCalledTimes(1);
    expect(client.items.list).toHaveBeenCalledWith({
      filter: {
        type: 'project_comment',
        fields: {
          model_id: { eq: 'model-1' },
          record_id: { eq: 'record-1' },
        },
      },
      page: { limit: 2 },
    });
    expect(result.current?.comments).toHaveLength(1);
    expect(result.current?.commentsModelId).toBe('comments-model');
    unmount();
  });

  it('reports migration-required when only old field comments exist', async () => {
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'closed',
      error: null,
    });

    const client = {
      items: {
        list: vi.fn().mockResolvedValue([]),
      },
    };

    const { result, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1', true, {
          comment_log: JSON.stringify([
            { dateISO: '2024-01-01T00:00:00.000Z' },
          ]),
        }),
        realTimeEnabled: false,
        cdaToken: '',
        client: client as unknown as Client,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
    );

    await flushPromises();
    await flushPromises();

    expect(result.current?.comments).toEqual([]);
    expect(result.current?.storageProblem?.type).toBe('migration_required');
    unmount();
  });

  it('reports malformed aggregate storage without rendering comments', async () => {
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
            content: '[{"bad": true}]',
          },
        ]),
      },
    };

    const { result, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1'),
        realTimeEnabled: false,
        cdaToken: '',
        client: client as unknown as Client,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
    );

    await flushPromises();
    await flushPromises();

    expect(result.current?.comments).toEqual([]);
    expect(result.current?.storageProblem?.type).toBe('malformed_aggregate');
    unmount();
  });
});

describe('useCommentsSubscription integrity at scale', () => {
  const stored = (id = 'comment-1', text = 'Stored'): CommentType[] => [
    {
      id,
      dateISO: '2024-01-01T00:00:00.000Z',
      content: [{ type: 'text', content: text }],
      authorId: 'user-1',
      upvoterIds: [],
      replies: [],
    },
  ];

  it('blocks duplicate aggregate records instead of hiding later comments', async () => {
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'closed',
      error: null,
    });
    const client = {
      items: {
        list: vi.fn().mockResolvedValue([
          { id: 'aggregate-1', content: stored() },
          { id: 'aggregate-2', content: stored('other-comment') },
        ]),
      },
    };
    const { result, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1'),
        realTimeEnabled: false,
        cdaToken: '',
        client: client as unknown as Client,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
    );
    await flushPromises();
    expect(client.items.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: { limit: 2 } }),
    );
    expect(result.current?.storageProblem).toMatchObject({
      type: 'malformed_aggregate',
    });
    expect(result.current?.commentRecordId).toBeNull();
    expect(result.current?.comments).toEqual([]);
    unmount();
  });

  it('does not overwrite optimistic comments with a fallback fetch during writes', async () => {
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'closed',
      error: null,
    });
    let resolveFetch: ((value: unknown) => void) | undefined;
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      )
      .mockResolvedValue([
        { id: 'aggregate-1', content: stored('local-comment', 'Confirmed') },
      ]);
    const client = { items: { list } };
    let isSyncAllowed = true;
    const { result, rerender, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1'),
        realTimeEnabled: false,
        cdaToken: '',
        client: client as unknown as Client,
        commentsModelId: 'comments-model',
        isSyncAllowed,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
    );
    act(() =>
      result.current?.setComments(stored('local-comment', 'Optimistic')),
    );
    isSyncAllowed = false;
    rerender();
    await act(async () => {
      resolveFetch?.([
        { id: 'aggregate-1', content: stored('old-comment', 'Old') },
      ]);
    });
    expect(result.current?.comments[0]?.id).toBe('local-comment');
    expect(list).toHaveBeenCalledTimes(1);
    isSyncAllowed = true;
    rerender();
    await flushPromises();
    expect(result.current?.comments[0]?.content[0]).toMatchObject({
      content: 'Confirmed',
    });
    expect(list).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('keeps legacy detection pending until realtime data actually arrives', () => {
    useQuerySubscriptionMock.mockReturnValue({
      data: null,
      status: 'connecting',
      error: null,
    });
    const { result, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx('record-1', true, {
          comment_log: '[{"legacy":true}]',
        }),
        realTimeEnabled: true,
        cdaToken: 'token',
        client: null,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId: 'record-1' },
        filterParams: { modelId: 'model-1', recordId: 'record-1' },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
    );
    expect(result.current?.isLoading).toBe(true);
    expect(result.current?.storageProblem).toBeNull();
    unmount();
  });

  it('rejects cached realtime responses belonging to a previous record', () => {
    let recordId = 'record-1';
    let data = {
      allProjectComments: [
        {
          id: 'aggregate-1',
          modelId: 'model-1',
          recordId: 'record-1',
          content: stored(),
        },
      ],
    };
    useQuerySubscriptionMock.mockImplementation(() => ({
      data,
      status: 'connected',
      error: null,
    }));
    const { result, rerender, unmount } = renderHook(() =>
      useCommentsSubscription({
        ctx: createSidebarCtx(recordId),
        realTimeEnabled: true,
        cdaToken: 'token',
        client: null,
        commentsModelId: 'comments-model',
        isSyncAllowed: true,
        query: 'query',
        variables: { modelId: 'model-1', recordId },
        filterParams: { modelId: 'model-1', recordId },
        subscriptionEnabled: true,
        currentUserId: 'user-1',
      }),
    );
    expect(result.current?.comments).toHaveLength(1);
    recordId = 'record-2';
    rerender();
    expect(result.current?.comments).toEqual([]);
    expect(result.current?.commentRecordId).toBeNull();
    data = {
      allProjectComments: [
        {
          id: 'aggregate-2',
          modelId: 'model-1',
          recordId: 'record-2',
          content: stored('new-comment'),
        },
      ],
    };
    rerender();
    expect(result.current?.comments[0]?.id).toBe('new-comment');
    unmount();
  });
});
