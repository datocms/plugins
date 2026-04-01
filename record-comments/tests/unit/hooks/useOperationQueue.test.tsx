// @vitest-environment jsdom

import { useOperationQueue } from '@hooks/useOperationQueue';
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, render, renderHook } from '../testUtils/react';

function createCtx() {
  return {
    alert: vi.fn(),
  } as never;
}

describe('useOperationQueue', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
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
