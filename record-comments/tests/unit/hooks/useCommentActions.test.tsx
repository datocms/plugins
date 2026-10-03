// @vitest-environment jsdom

import { useCommentActions } from '@hooks/useCommentActions';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createBaseComment } from '../fixtures/comments';
import {
  createMentionSegment,
  createRecordMention,
} from '../fixtures/mentions';
import { renderHook } from '../testUtils/react';

describe('useCommentActions', () => {
  it('enqueues the editing-start baseline instead of newer subscription content', () => {
    const original = [
      { type: 'text' as const, content: 'Original at editing start' },
    ];
    const current = createBaseComment({
      id: 'comment-1',
      content: [{ type: 'text', content: 'Updated while editor was open' }],
    });
    const enqueue = vi.fn(() => true);
    const hook = renderHook(() =>
      useCommentActions({
        userId: 'user-1',
        comments: [current],
        setComments: vi.fn(),
        enqueue,
        composerSegments: [],
        setComposerSegments: vi.fn(),
        pendingNewReplies: { current: new Set<string>() },
      }),
    );

    act(() => {
      hook.result.current?.editComment(
        'comment-1',
        [{ type: 'text', content: 'My edit' }],
        undefined,
        original,
      );
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EDIT_COMMENT',
        expectedContent: original,
        newContent: [{ type: 'text', content: 'My edit' }],
      }),
    );
    hook.unmount();
  });

  it('does not apply optimistic state updates when enqueue rejects a new comment', () => {
    const setComments = vi.fn();
    const setComposerSegments = vi.fn();
    const enqueue = vi.fn(() => false);

    const { result, unmount } = renderHook(() =>
      useCommentActions({
        userId: 'user-1',
        comments: [],
        setComments,
        enqueue,
        composerSegments: [{ type: 'text', content: 'Hello world' }],
        setComposerSegments,
        pendingNewReplies: { current: new Set<string>() },
        ctx: {
          item: { id: 'record-1' },
          alert: vi.fn(),
        } as never,
      }),
    );

    let accepted = true;
    act(() => {
      const actions = result.current;
      if (!actions) throw new Error('Comment actions hook was not rendered');
      accepted = actions.submitNewComment();
    });

    expect(accepted).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(setComments).not.toHaveBeenCalled();
    expect(setComposerSegments).not.toHaveBeenCalled();
    unmount();
  });

  it('seeds mention data before enqueueing a new comment', () => {
    const setComments = vi.fn();
    const setComposerSegments = vi.fn();
    const events: string[] = [];
    const enqueue = vi.fn(() => {
      events.push('enqueue');
      return true;
    });
    const onBeforePersistSegments = vi.fn(() => {
      events.push('seed');
    });
    const composerSegments = [
      createMentionSegment(createRecordMention({ title: 'Mentioned record' })),
    ];

    const { result, unmount } = renderHook(() =>
      useCommentActions({
        userId: 'user-1',
        comments: [],
        setComments,
        enqueue,
        composerSegments,
        setComposerSegments,
        pendingNewReplies: { current: new Set<string>() },
        onBeforePersistSegments,
        ctx: {
          item: { id: 'record-1' },
          alert: vi.fn(),
        } as never,
      }),
    );

    let accepted = false;
    act(() => {
      accepted = result.current?.submitNewComment() ?? false;
    });

    expect(accepted).toBe(true);
    expect(onBeforePersistSegments).toHaveBeenCalledWith(composerSegments);
    expect(events).toEqual(['seed', 'enqueue']);
    unmount();
  });
});
