import type { CommentType } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentOperation } from '@ctypes/operations';
import { segmentsToStoredSegments } from '@utils/tipTapSerializer';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { type RefObject, useCallback } from 'react';
import { ERROR_MESSAGES } from '@/constants';
import {
  applyDeleteToState,
  applyEditToState,
  applyUpvoteToState,
  type CommentActionsReturn,
  createComment,
  isAuthorValid,
  isSegmentsEmpty,
} from './commentActionHelpers';

type InsertPosition = 'prepend' | 'append';

type UseCommentActionsParams = {
  userId: string;
  comments: CommentType[];
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  enqueue: (operation: CommentOperation) => boolean;
  composerSegments: CommentSegment[];
  setComposerSegments: (segments: CommentSegment[]) => void;
  pendingNewReplies: RefObject<Set<string> | null>;
  /**
   * Where to insert new comments/replies:
   * - 'prepend': newest at top (sidebar behavior)
   * - 'append': chronological order, newest at bottom
   */
  insertPosition?: InsertPosition;
  /** Optional override for reply insertion order. Defaults to insertPosition. */
  replyInsertPosition?: InsertPosition;
  onBeforePersistSegments?: (segments: CommentSegment[]) => void;
  /**
   * Sidebar context - only required when insertPosition is 'prepend'
   * and record needs to be saved before commenting.
   */
  ctx?: RenderItemFormSidebarCtx;
};

function findCommentById(
  comments: CommentType[],
  id: string,
  parentCommentId?: string,
): CommentType | null {
  if (parentCommentId) {
    const parent = comments.find((comment) => comment.id === parentCommentId);
    return parent?.replies?.find((reply) => reply.id === id) ?? null;
  }

  return comments.find((comment) => comment.id === id) ?? null;
}

export function useCommentActions({
  userId,
  comments,
  setComments,
  enqueue,
  composerSegments,
  setComposerSegments,
  pendingNewReplies,
  insertPosition = 'prepend',
  replyInsertPosition = insertPosition,
  onBeforePersistSegments,
  ctx,
}: UseCommentActionsParams): CommentActionsReturn {
  const submitNewComment = useCallback(() => {
    if (isSegmentsEmpty(composerSegments)) return false;

    if (!isAuthorValid(userId)) {
      ctx?.alert(ERROR_MESSAGES.MISSING_USER_INFO);
      return false;
    }

    // Sidebar context requires a saved record
    if (ctx && !ctx.item?.id) {
      ctx.alert(ERROR_MESSAGES.SAVE_RECORD_FIRST);
      return false;
    }

    onBeforePersistSegments?.(composerSegments);

    const newComment = createComment(composerSegments, userId);
    const didEnqueue = enqueue({ type: 'ADD_COMMENT', comment: newComment });

    if (!didEnqueue) {
      return false;
    }

    if (insertPosition === 'prepend') {
      setComments((prev) => [newComment, ...prev]);
    } else {
      setComments((prev) => [...prev, newComment]);
    }

    setComposerSegments([]);
    return true;
  }, [
    composerSegments,
    ctx,
    userId,
    setComments,
    enqueue,
    setComposerSegments,
    insertPosition,
    onBeforePersistSegments,
  ]);

  // Authorization is handled at UI layer (visibility) and server (validation)
  const deleteComment = useCallback(
    (id: string, parentCommentId?: string) => {
      const isUnsavedNewReply = pendingNewReplies.current?.has(id) ?? false;

      if (isUnsavedNewReply) {
        pendingNewReplies.current?.delete(id);
        setComments((prev) => applyDeleteToState(prev, id, parentCommentId));
        return true;
      }

      const didEnqueue = enqueue({
        type: 'DELETE_COMMENT',
        id,
        parentCommentId,
      });

      if (!didEnqueue) {
        return false;
      }

      setComments((prev) => applyDeleteToState(prev, id, parentCommentId));
      return true;
    },
    [setComments, enqueue, pendingNewReplies],
  );

  const editComment = useCallback(
    (id: string, newContent: CommentSegment[], parentCommentId?: string) => {
      const isNewReply = pendingNewReplies.current?.has(id) ?? false;
      const existingComment = findCommentById(comments, id, parentCommentId);

      onBeforePersistSegments?.(newContent);

      // Convert to slim format for storage
      const storedContent = segmentsToStoredSegments(newContent);

      if (isNewReply && parentCommentId) {
        // Preserve original dateISO (creation time, not save time)
        const replyComment: CommentType = {
          id,
          dateISO: existingComment?.dateISO ?? new Date().toISOString(),
          content: storedContent,
          authorId: userId,
          upvoterIds: [],
          parentCommentId,
        };

        const didEnqueue = enqueue({
          type: 'ADD_REPLY',
          parentCommentId,
          reply: replyComment,
        });

        if (!didEnqueue) {
          return false;
        }

        pendingNewReplies.current?.delete(id);
      } else {
        const didEnqueue = enqueue({
          type: 'EDIT_COMMENT',
          id,
          newContent: storedContent,
          parentCommentId,
        });

        if (!didEnqueue) {
          return false;
        }
      }

      setComments((prev) =>
        applyEditToState(prev, id, newContent, parentCommentId),
      );
      return true;
    },
    [
      userId,
      comments,
      setComments,
      enqueue,
      pendingNewReplies,
      onBeforePersistSegments,
    ],
  );

  const upvoteComment = useCallback(
    (id: string, userUpvoted: boolean, parentCommentId?: string) => {
      const didEnqueue = enqueue({
        type: 'UPVOTE_COMMENT',
        id,
        action: userUpvoted ? 'remove' : 'add',
        userId,
        parentCommentId,
      });

      if (!didEnqueue) {
        return false;
      }

      setComments((prev) =>
        applyUpvoteToState(prev, id, userId, userUpvoted, parentCommentId),
      );
      return true;
    },
    [userId, setComments, enqueue],
  );

  const replyComment = useCallback(
    (parentCommentId: string) => {
      const newReply = createComment([], userId, parentCommentId);
      pendingNewReplies.current?.add(newReply.id);

      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== parentCommentId) return c;

          if (replyInsertPosition === 'prepend') {
            return { ...c, replies: [newReply, ...(c.replies ?? [])] };
          } else {
            return { ...c, replies: [...(c.replies ?? []), newReply] };
          }
        }),
      );
      return true;
    },
    [userId, setComments, pendingNewReplies, replyInsertPosition],
  );

  return {
    submitNewComment,
    deleteComment,
    editComment,
    upvoteComment,
    replyComment,
  };
}
