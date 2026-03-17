// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useCommentActions } from '@hooks/useCommentActions';
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
      })
    );

    let accepted = true;
    act(() => {
      accepted = result.current!.submitNewComment();
    });

    expect(accepted).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(setComments).not.toHaveBeenCalled();
    expect(setComposerSegments).not.toHaveBeenCalled();
    unmount();
  });
});
