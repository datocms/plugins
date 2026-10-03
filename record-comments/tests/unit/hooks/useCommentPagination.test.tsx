// @vitest-environment jsdom

import { useCommentPagination } from '@hooks/useCommentPagination';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { createCommentList } from '../fixtures/comments';
import { renderHook } from '../testUtils/react';

describe('record comment pagination', () => {
  it('resets pagination when navigating large and small records', () => {
    let comments = createCommentList(400);
    let contextKey = 'environment/model/record-a';
    const { result, rerender, unmount } = renderHook(() =>
      useCommentPagination(comments, contextKey),
    );
    expect(result.current?.visibleStoredComments).toHaveLength(30);
    act(() => result.current?.loadMore());
    expect(result.current?.visibleStoredComments).toHaveLength(60);
    comments = createCommentList(2);
    contextKey = 'environment/model/record-b';
    rerender();
    expect(result.current?.visibleStoredComments).toHaveLength(2);
    expect(result.current?.hasMoreComments).toBe(false);
    comments = createCommentList(300);
    contextKey = 'environment/model/record-c';
    rerender();
    expect(result.current?.visibleStoredComments).toHaveLength(30);
    expect(result.current?.hasMoreComments).toBe(true);
    unmount();
  });

  it('keeps new comments visible and clamps the slice after large deletions', () => {
    let comments = createCommentList(300);
    const { result, rerender, unmount } = renderHook(() =>
      useCommentPagination(comments, 'same-record'),
    );
    comments = [...createCommentList(1), ...comments];
    rerender();
    expect(result.current?.visibleStoredComments).toHaveLength(31);
    comments = comments.slice(0, 10);
    rerender();
    expect(result.current?.visibleStoredComments).toHaveLength(10);
    expect(result.current?.hasMoreComments).toBe(false);
    unmount();
  });
});
