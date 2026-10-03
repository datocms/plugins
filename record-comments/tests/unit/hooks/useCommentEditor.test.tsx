// @vitest-environment jsdom

import type { CommentSegment, StoredCommentSegment } from '@ctypes/mentions';
import { useCommentEditor } from '@hooks/useCommentEditor';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '../testUtils/react';

describe('comment editor baseline', () => {
  it('retains exact stored content from editing start across subscription updates', () => {
    const original: StoredCommentSegment[] = [
      { type: 'text', content: 'Original' },
      {
        type: 'mention',
        mention: {
          type: 'field',
          modelId: 'model-1',
          fieldPath: 'title.pt',
          locale: 'pt',
        },
      },
    ];
    let storedContent = original;
    let commentContent: CommentSegment[] = [
      { type: 'text', content: 'Original' },
    ];
    const hook = renderHook(() =>
      useCommentEditor({
        commentContent,
        storedCommentContent: storedContent,
        isNewComment: false,
      }),
    );

    act(() => hook.result.current?.handleStartEditing());
    act(() =>
      hook.result.current?.setSegments([{ type: 'text', content: 'My draft' }]),
    );
    storedContent = [{ type: 'text', content: 'Other user saved this' }];
    commentContent = [{ type: 'text', content: 'Other user saved this' }];
    hook.rerender();

    expect(hook.result.current?.segments).toEqual([
      { type: 'text', content: 'My draft' },
    ]);
    expect(hook.result.current?.editBaselineContent).toBe(original);

    act(() => hook.result.current?.resetToOriginal());
    act(() => hook.result.current?.handleStartEditing());
    expect(hook.result.current?.editBaselineContent).toBe(storedContent);
    hook.unmount();
  });

  it('captures the latest content at editing start rather than the initial render', () => {
    let commentContent: CommentSegment[] = [{ type: 'text', content: 'Old' }];
    const hook = renderHook(() =>
      useCommentEditor({ commentContent, isNewComment: false }),
    );
    commentContent = [{ type: 'text', content: 'Current' }];
    hook.rerender();
    act(() => hook.result.current?.handleStartEditing());

    expect(hook.result.current?.editBaselineContent).toEqual(commentContent);
    hook.unmount();
  });
});
