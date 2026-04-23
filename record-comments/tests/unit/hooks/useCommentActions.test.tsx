// @vitest-environment jsdom

import { useCommentActions } from '@hooks/useCommentActions';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createRecordMention, createMentionSegment } from '../fixtures/mentions';
import { renderHook } from '../testUtils/react';

describe('useCommentActions', () => {
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
      accepted = result.current?.submitNewComment();
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
