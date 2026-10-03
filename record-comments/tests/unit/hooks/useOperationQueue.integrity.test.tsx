// @vitest-environment jsdom

import { ApiError } from '@datocms/cma-client-browser';
import { useOperationQueue } from '@hooks/useOperationQueue';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBaseComment } from '../fixtures/comments';
import { createCommentStorageFields } from '../fixtures/commentsStorage';
import { flushPromises, renderHook } from '../testUtils/react';

const comment = createBaseComment({
  id: 'comment',
  content: [{ type: 'text', content: 'Original' }],
});
const addition = { type: 'ADD_COMMENT' as const, comment };

function apiFailure(status: number, headers: Record<string, string> = {}) {
  return new ApiError({
    request: {
      method: 'PUT',
      url: 'https://example.test/items/aggregate',
      headers: {},
    },
    response: {
      status,
      statusText: 'Test failure',
      headers,
      body: { data: [] },
    },
  });
}

function aggregate(
  content: unknown = JSON.stringify([comment]),
  version: string | undefined = 'v1',
) {
  return {
    id: 'aggregate',
    model_id: 'model',
    record_id: 'record',
    content,
    meta: { current_version: version },
  };
}

function mountQueue(
  client: object,
  commentRecordId: string | null = 'aggregate',
  storageFields = createCommentStorageFields(),
) {
  const ctx = {
    alert: vi.fn(),
    loadItemTypeFields: vi.fn().mockResolvedValue(
      storageFields.map(({ id, ...attributes }) => ({
        id,
        type: 'field',
        attributes,
      })),
    ),
  };
  const onRecordCreated = vi.fn();
  const hook = renderHook(() =>
    useOperationQueue({
      client: client as never,
      commentRecordId,
      commentsModelId: 'comments-model',
      modelId: 'model',
      recordId: 'record',
      ctx: ctx as never,
      onRecordCreated,
      resolveCommentsModelId: vi.fn().mockResolvedValue('comments-model'),
    }),
  );
  return { ...hook, ctx, onRecordCreated };
}

function enqueue(hook: ReturnType<typeof mountQueue>, op = addition) {
  act(() => {
    hook.result.current?.enqueue(op);
  });
}

async function settle() {
  await flushPromises();
  await flushPromises();
}

describe('comment persistence integrity', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects incompatible cached storage before reading or writing the aggregate', async () => {
    const fields = createCommentStorageFields().map((field) =>
      field.api_key === 'content' ? { ...field, localized: true } : field,
    );
    const items = { find: vi.fn(), update: vi.fn(), create: vi.fn() };
    const hook = mountQueue({ items }, 'aggregate', fields);
    enqueue(hook);
    await settle();

    expect(hook.ctx.loadItemTypeFields).toHaveBeenCalledWith('comments-model');
    expect(items.find).not.toHaveBeenCalled();
    expect(items.update).not.toHaveBeenCalled();
    expect(items.create).not.toHaveBeenCalled();
    expect(hook.ctx.alert).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('loads storage schema once for sequential operations using the same client and model', async () => {
    const items = {
      find: vi.fn().mockResolvedValue(aggregate('[]')),
      update: vi.fn().mockResolvedValue({}),
    };
    const hook = mountQueue({ items });
    act(() => {
      hook.result.current?.enqueue(addition);
      hook.result.current?.enqueue({
        type: 'ADD_COMMENT',
        comment: { ...comment, id: 'second-comment' },
      });
    });
    await settle();

    expect(items.update).toHaveBeenCalledTimes(2);
    expect(hook.ctx.loadItemTypeFields).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it.each(['{"invalid":true}', '[{"id":"broken"}]', false, 42])(
    'refuses to overwrite malformed storage %s',
    async (content) => {
      const items = {
        find: vi.fn().mockResolvedValue(aggregate(content)),
        update: vi.fn(),
      };
      const hook = mountQueue({ items });
      enqueue(hook);
      await settle();
      expect(items.update).not.toHaveBeenCalled();
      expect(hook.ctx.alert).toHaveBeenCalledTimes(1);
      hook.unmount();
    },
  );

  it('accepts whitespace inside an empty JSON array', async () => {
    const items = {
      find: vi.fn().mockResolvedValue(aggregate('[ ]')),
      update: vi.fn().mockResolvedValue({}),
    };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    expect(items.update).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('confirms an already persisted operation without another write', async () => {
    const items = {
      find: vi.fn().mockResolvedValue(aggregate()),
      update: vi.fn(),
    };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    expect(items.update).not.toHaveBeenCalled();
    expect(hook.result.current?.pendingCount).toBe(0);
    hook.unmount();
  });

  it('refuses duplicate aggregate records', async () => {
    const items = {
      list: vi
        .fn()
        .mockResolvedValue([aggregate(), { ...aggregate(), id: 'duplicate' }]),
      create: vi.fn(),
      update: vi.fn(),
    };
    const hook = mountQueue({ items }, null);
    enqueue(hook);
    await settle();
    expect(items.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: { limit: 2 } }),
    );
    expect(items.update).not.toHaveBeenCalled();
    expect(items.create).not.toHaveBeenCalled();
    hook.unmount();
  });

  it.each([
    { ...aggregate('[]'), meta: {} },
    { ...aggregate('[]'), record_id: 'different-record' },
    { ...aggregate('[]'), model_id: 'different-model' },
  ])('refuses a versionless or mismatched aggregate', async (record) => {
    const items = { find: vi.fn().mockResolvedValue(record), update: vi.fn() };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    expect(items.update).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('rereads after response loss and avoids duplicating the successful update', async () => {
    vi.useFakeTimers();
    const items = {
      find: vi
        .fn()
        .mockResolvedValueOnce(aggregate('[]'))
        .mockResolvedValueOnce(aggregate()),
      update: vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')),
    };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await settle();
    expect(items.find).toHaveBeenCalledTimes(2);
    expect(items.update).toHaveBeenCalledTimes(1);
    expect(hook.ctx.alert).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('preserves a concurrent edit after an ambiguous write result', async () => {
    vi.useFakeTimers();
    const changedComment = {
      ...comment,
      content: [{ type: 'text', content: 'Other user edit' }],
    };
    const items = {
      find: vi
        .fn()
        .mockResolvedValueOnce(aggregate())
        .mockResolvedValueOnce(
          aggregate(JSON.stringify([changedComment]), 'v2'),
        ),
      update: vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Network request failed')),
    };
    const hook = mountQueue({ items });
    act(() => {
      hook.result.current?.enqueue({
        type: 'EDIT_COMMENT',
        id: comment.id,
        newContent: [{ type: 'text', content: 'My edit' }],
      });
    });
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await settle();
    expect(items.update).toHaveBeenCalledTimes(1);
    expect(hook.ctx.alert).toHaveBeenCalledWith(
      expect.stringContaining('another user changed'),
    );
    hook.unmount();
  });

  it('preserves an edit made before the first read when the editor baseline is stale', async () => {
    const current = {
      ...comment,
      content: [{ type: 'text', content: 'Already changed by another user' }],
    };
    const items = {
      find: vi
        .fn()
        .mockResolvedValue(aggregate(JSON.stringify([current]), 'v2')),
      update: vi.fn(),
    };
    const hook = mountQueue({ items });
    act(() => {
      hook.result.current?.enqueue({
        type: 'EDIT_COMMENT',
        id: comment.id,
        expectedContent: comment.content,
        newContent: [{ type: 'text', content: 'My edit from the old version' }],
      });
    });
    await settle();

    expect(items.find).toHaveBeenCalledTimes(1);
    expect(items.update).not.toHaveBeenCalled();
    expect(hook.ctx.alert).toHaveBeenCalledWith(
      expect.stringContaining('another user changed'),
    );
    expect(hook.result.current?.pendingCount).toBe(0);
    hook.unmount();
  });

  it('confirms an edit after response loss even when its baseline differs from the saved result', async () => {
    vi.useFakeTimers();
    const newContent = [{ type: 'text' as const, content: 'My committed edit' }];
    const items = {
      find: vi
        .fn()
        .mockResolvedValueOnce(aggregate())
        .mockResolvedValueOnce(
          aggregate(JSON.stringify([{ ...comment, content: newContent }]), 'v2'),
        ),
      update: vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')),
    };
    const hook = mountQueue({ items });
    act(() => {
      hook.result.current?.enqueue({
        type: 'EDIT_COMMENT',
        id: comment.id,
        expectedContent: comment.content,
        newContent,
      });
    });
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await settle();

    expect(items.find).toHaveBeenCalledTimes(2);
    expect(items.update).toHaveBeenCalledTimes(1);
    expect(hook.ctx.alert).not.toHaveBeenCalled();
    expect(hook.result.current?.pendingCount).toBe(0);
    hook.unmount();
  });

  it('preserves newer votes when comment content still matches the editor baseline', async () => {
    const items = {
      find: vi.fn().mockResolvedValue(
        aggregate(
          JSON.stringify([{ ...comment, upvoterIds: ['other-user'] }]),
          'v2',
        ),
      ),
      update: vi.fn().mockResolvedValue({}),
    };
    const hook = mountQueue({ items });
    act(() => {
      hook.result.current?.enqueue({
        type: 'EDIT_COMMENT',
        id: comment.id,
        expectedContent: comment.content,
        newContent: [{ type: 'text', content: 'My safe edit' }],
      });
    });
    await settle();

    expect(JSON.parse(items.update.mock.calls[0][1].content)[0]).toMatchObject({
      content: [{ type: 'text', content: 'My safe edit' }],
      upvoterIds: ['other-user'],
    });
    expect(hook.ctx.alert).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('reuses its creation ID across ambiguous create retries', async () => {
    vi.useFakeTimers();
    const items = {
      list: vi.fn().mockResolvedValue([]),
      create: vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ id: 'aggregate' }),
    };
    const hook = mountQueue({ items }, null);
    enqueue(hook);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await settle();
    expect(items.create).toHaveBeenCalledTimes(2);
    expect(items.create.mock.calls[0][0].id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(items.create.mock.calls[1][0].id).toBe(
      items.create.mock.calls[0][0].id,
    );
    hook.unmount();
  });

  it('respects rate-limit delay before retrying', async () => {
    vi.useFakeTimers();
    const items = {
      find: vi
        .fn()
        .mockRejectedValueOnce(apiFailure(429, { 'Retry-After': '2' }))
        .mockResolvedValueOnce(aggregate()),
      update: vi.fn(),
    };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(items.find).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();
    expect(items.find).toHaveBeenCalledTimes(2);
    expect(hook.ctx.alert).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('ends the operation budget without another request when Retry-After exceeds it', async () => {
    vi.useFakeTimers();
    const items = {
      find: vi
        .fn()
        .mockRejectedValue(apiFailure(429, { 'Retry-After': '300' })),
      update: vi.fn(),
    };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    await settle();
    expect(items.find).toHaveBeenCalledTimes(1);
    expect(hook.result.current?.retryState.terminationReason).toBe('timeout');
    hook.unmount();
  });

  it('does not retry permission failures', async () => {
    const items = {
      find: vi.fn().mockRejectedValue(apiFailure(403)),
      update: vi.fn(),
    };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    expect(items.find).toHaveBeenCalledTimes(1);
    expect(hook.result.current?.pendingCount).toBe(0);
    hook.unmount();
  });

  it('does not begin a write if unmounted while reading', async () => {
    let resolve: (record: ReturnType<typeof aggregate>) => void = () => {};
    const items = {
      find: vi.fn().mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      ),
      update: vi.fn(),
    };
    const hook = mountQueue({ items });
    enqueue(hook);
    await settle();
    hook.unmount();
    resolve(aggregate('[]'));
    await settle();
    expect(items.update).not.toHaveBeenCalled();
  });
});
