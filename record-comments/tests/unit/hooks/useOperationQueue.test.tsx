// @vitest-environment jsdom

import { useOperationQueue } from '@hooks/useOperationQueue';
import { ApiError } from '@datocms/cma-client-browser';
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, render, renderHook } from '../testUtils/react';

function createCtx() {
  return {
    alert: vi.fn(),
  } as never;
}

function createStaleItemVersionError() {
  return new ApiError({
    request: {
      method: 'PUT',
      url: 'https://example.com/items/comment-record-1',
    },
    response: {
      status: 422,
      statusText: 'Unprocessable Entity',
      body: {
        data: [
          {
            id: 'stale-version',
            type: 'api_error',
            attributes: {
              code: 'STALE_ITEM_VERSION',
              details: {},
            },
          },
        ],
      },
    },
  } as never);
}

describe('useOperationQueue', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects enqueue when persistence prerequisites are missing', () => {
    const ctx = createCtx();
    const { result, unmount } = renderHook(() =>
      useOperationQueue({
        client: null,
        commentRecordId: null,
        commentsModelId: null,
        modelId: 'model-1',
        recordId: 'record-1',
        ctx,
        onRecordCreated: vi.fn(),
        resolveCommentsModelId: vi.fn().mockResolvedValue(null),
      }),
    );

    let didEnqueue = false;
    act(() => {
      didEnqueue = result.current?.enqueue({
        type: 'ADD_COMMENT',
        comment: {
          id: 'comment-1',
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [{ type: 'text', content: 'Hello' }],
          authorId: 'user-1',
          upvoterIds: [],
          replies: [],
        },
      });
    });

    expect(didEnqueue).toBe(false);
    expect(result.current?.pendingCount).toBe(0);
    expect(ctx.alert).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not alert after unmount when an in-flight save fails', async () => {
    const ctx = createCtx();
    const client = {
      items: {
        find: vi.fn().mockRejectedValue(new Error('boom')),
        update: vi.fn(),
        list: vi.fn(),
        create: vi.fn(),
      },
    } as never;

    const { result, unmount } = renderHook(() =>
      useOperationQueue({
        client,
        commentRecordId: 'comment-record-1',
        commentsModelId: 'comments-model',
        modelId: 'model-1',
        recordId: 'record-1',
        ctx,
        onRecordCreated: vi.fn(),
        resolveCommentsModelId: vi.fn().mockResolvedValue('comments-model'),
      }),
    );

    act(() => {
      result.current?.enqueue({
        type: 'EDIT_COMMENT',
        id: 'comment-1',
        newContent: [{ type: 'text', content: 'Updated' }],
      });
    });

    unmount();
    await flushPromises();

    expect(ctx.alert).not.toHaveBeenCalled();
  });

  it('resolves the comments model ID lazily before creating the first comment record', async () => {
    const ctx = createCtx();
    const resolveCommentsModelId = vi.fn().mockResolvedValue('comments-model');
    const onRecordCreated = vi.fn();
    const client = {
      items: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({
          id: 'comment-record-1',
        }),
        update: vi.fn(),
        find: vi.fn(),
      },
    } as never;

    const { result, unmount } = renderHook(() =>
      useOperationQueue({
        client,
        commentRecordId: null,
        commentsModelId: null,
        modelId: 'model-1',
        recordId: 'record-1',
        ctx,
        onRecordCreated,
        resolveCommentsModelId,
      }),
    );

    act(() => {
      result.current?.enqueue({
        type: 'ADD_COMMENT',
        comment: {
          id: 'comment-1',
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [{ type: 'text', content: 'Hello' }],
          authorId: 'user-1',
          upvoterIds: [],
          replies: [],
        },
      });
    });

    await flushPromises();

    expect(resolveCommentsModelId).toHaveBeenCalledTimes(1);
    expect(client.items.list).toHaveBeenCalledWith({
      filter: {
        type: 'comments-model',
        fields: {
          model_id: { eq: 'model-1' },
          record_id: { eq: 'record-1' },
        },
      },
      page: { limit: 1 },
    });
    expect(client.items.create).toHaveBeenCalledWith({
      item_type: { type: 'item_type', id: 'comments-model' },
      model_id: 'model-1',
      record_id: 'record-1',
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
    });
    expect(onRecordCreated).toHaveBeenCalledWith('comment-record-1');
    unmount();
  });

  it('recovers when another user creates the first aggregate record first', async () => {
    const ctx = createCtx();
    const onRecordCreated = vi.fn();
    const existingRecord = {
      id: 'comment-record-1',
      content: JSON.stringify([
        {
          id: 'comment-2',
          dateISO: '2024-01-02T00:00:00.000Z',
          content: [{ type: 'text', content: 'Existing' }],
          authorId: 'user-2',
          upvoterIds: [],
          replies: [],
        },
      ]),
      meta: { current_version: 'v1' },
    };
    const client = {
      items: {
        list: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([existingRecord]),
        create: vi.fn().mockRejectedValue(new Error('duplicate record')),
        update: vi.fn().mockResolvedValue({}),
        find: vi.fn(),
      },
    } as never;

    const { result, unmount } = renderHook(() =>
      useOperationQueue({
        client,
        commentRecordId: null,
        commentsModelId: 'comments-model',
        modelId: 'model-1',
        recordId: 'record-1',
        ctx,
        onRecordCreated,
        resolveCommentsModelId: vi.fn().mockResolvedValue('comments-model'),
      }),
    );

    act(() => {
      result.current?.enqueue({
        type: 'ADD_COMMENT',
        comment: {
          id: 'comment-1',
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [{ type: 'text', content: 'Hello' }],
          authorId: 'user-1',
          upvoterIds: [],
          replies: [],
        },
      });
    });

    await flushPromises();
    await flushPromises();

    expect(client.items.create).toHaveBeenCalledTimes(1);
    expect(client.items.update).toHaveBeenCalledWith(
      'comment-record-1',
      expect.objectContaining({
        meta: { current_version: 'v1' },
        content: expect.stringContaining('comment-1'),
      }),
    );
    expect(onRecordCreated).toHaveBeenCalledWith('comment-record-1');
    unmount();
  });

  it('refetches the aggregate record and retries after a stale version conflict', async () => {
    vi.useFakeTimers();

    const ctx = createCtx();
    const firstRecord = {
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
      meta: { current_version: 'v1' },
    };
    const latestRecord = {
      ...firstRecord,
      content: JSON.stringify([
        {
          id: 'comment-1',
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [{ type: 'text', content: 'Hello' }],
          authorId: 'user-1',
          upvoterIds: ['user-2'],
          replies: [],
        },
      ]),
      meta: { current_version: 'v2' },
    };
    const client = {
      items: {
        find: vi
          .fn()
          .mockResolvedValueOnce(firstRecord)
          .mockResolvedValueOnce(latestRecord),
        update: vi
          .fn()
          .mockRejectedValueOnce(createStaleItemVersionError())
          .mockResolvedValueOnce({}),
        list: vi.fn(),
        create: vi.fn(),
      },
    } as never;

    const { result, unmount } = renderHook(() =>
      useOperationQueue({
        client,
        commentRecordId: 'comment-record-1',
        commentsModelId: 'comments-model',
        modelId: 'model-1',
        recordId: 'record-1',
        ctx,
        onRecordCreated: vi.fn(),
        resolveCommentsModelId: vi.fn().mockResolvedValue('comments-model'),
      }),
    );

    act(() => {
      result.current?.enqueue({
        type: 'UPVOTE_COMMENT',
        id: 'comment-1',
        action: 'add',
        userId: 'user-1',
      });
    });

    await flushPromises();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await flushPromises();
    await flushPromises();

    expect(client.items.find).toHaveBeenCalledTimes(2);
    expect(client.items.update).toHaveBeenCalledTimes(2);
    expect(client.items.update).toHaveBeenLastCalledWith(
      'comment-record-1',
      expect.objectContaining({
        content: expect.stringContaining('user-1'),
        meta: { current_version: 'v2' },
      }),
    );
    unmount();
  });

  it('keeps the queue mounted in StrictMode development renders', async () => {
    const ctx = createCtx();
    const client = {
      items: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({
          id: 'comment-record-1',
        }),
        update: vi.fn(),
        find: vi.fn(),
      },
    } as never;

    let latestHook: ReturnType<typeof useOperationQueue> | null = null;

    function HookHarness() {
      latestHook = useOperationQueue({
        client,
        commentRecordId: null,
        commentsModelId: 'comments-model',
        modelId: 'model-1',
        recordId: 'record-1',
        ctx,
        onRecordCreated: vi.fn(),
        resolveCommentsModelId: vi.fn().mockResolvedValue('comments-model'),
      });

      return null;
    }

    const view = render(
      <StrictMode>
        <HookHarness />
      </StrictMode>,
    );

    act(() => {
      latestHook?.enqueue({
        type: 'ADD_COMMENT',
        comment: {
          id: 'comment-1',
          dateISO: '2024-01-01T00:00:00.000Z',
          content: [{ type: 'text', content: 'Hello' }],
          authorId: 'user-1',
          upvoterIds: [],
          replies: [],
        },
      });
    });

    await flushPromises();

    expect(client.items.create).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
