import { useCallback, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentType } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';
import { ERROR_MESSAGES } from '@/constants';
import {
  isSegmentsEmpty,
  isAuthorValid,
  applyDeleteToState,
  applyEditToState,
  applyUpvoteToState,
  createComment,
  handlePendingReplyDelete,
  type CommentActionsReturn,
} from './commentActionHelpers';

export type InsertPosition = 'prepend' | 'append';

type UseCommentActionsParams = {
  userEmail: string;
  userName: string;
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  enqueue: (operation: CommentOperation) => void;
  composerSegments: CommentSegment[];
  setComposerSegments: (segments: CommentSegment[]) => void;
  pendingNewReplies: RefObject<Set<string> | null>;
  /**
   * Where to insert new comments/replies:
   * - 'prepend': newest at top (sidebar behavior)
   * - 'append': chronological order, newest at bottom (page/dashboard behavior)
   */
  insertPosition?: InsertPosition;
  /**
   * Sidebar context - only required when insertPosition is 'prepend'
   * and record needs to be saved before commenting.
   */
  ctx?: RenderItemFormSidebarCtx;
};

/**
 * Hook for comment mutation operations.
 * Handles optimistic UI updates and queues operations for persistence.
 *
 * Supports both sidebar and page contexts:
 * - Sidebar (insertPosition='prepend'): requires ctx, checks for saved record
 * - Page (insertPosition='append'): no ctx required, global comments
 */
export function useCommentActions({
  userEmail,
  userName,
  setComments,
  enqueue,
  composerSegments,
  setComposerSegments,
  pendingNewReplies,
  insertPosition = 'prepend',
  ctx,
}: UseCommentActionsParams): CommentActionsReturn {
  const submitNewComment = useCallback(() => {
    if (isSegmentsEmpty(composerSegments)) return;

    if (!isAuthorValid(userName, userEmail)) {
      ctx?.alert(ERROR_MESSAGES.MISSING_USER_INFO);
      return;
    }

    // Sidebar context requires a saved record
    if (ctx && !ctx.item?.id) {
      ctx.alert(ERROR_MESSAGES.SAVE_RECORD_FIRST);
      return;
    }

    const newComment = createComment(composerSegments, userName, userEmail);

    // Optimistic UI update
    if (insertPosition === 'prepend') {
      setComments((prev) => [newComment, ...prev]);
    } else {
      setComments((prev) => [...prev, newComment]);
    }

    // Queue operation for persistent save with retry
    enqueue({ type: 'ADD_COMMENT', comment: newComment });

    // Clear composer
    setComposerSegments([]);
  }, [
    composerSegments,
    ctx,
    userEmail,
    userName,
    setComments,
    enqueue,
    setComposerSegments,
    insertPosition,
  ]);

  /**
   * Delete a comment or reply.
   *
   * AUTHORIZATION NOTE:
   * -------------------
   * This function does NOT validate that the current user is the comment author.
   * This is intentional and not a security issue for the following reasons:
   *
   * 1. UI-LEVEL PROTECTION: The CommentActions component only renders delete/edit
   *    buttons when `userIsAuthor` is true. Users cannot click what they cannot see.
   *
   * 2. SERVER-SIDE VALIDATION: DatoCMS validates permissions on the server when
   *    the operation is persisted. Unauthorized changes will be rejected.
   *
   * 3. SEPARATION OF CONCERNS: This hook handles state management and operation
   *    queuing. Authorization is handled at the UI layer (visibility) and
   *    persistence layer (server validation).
   *
   * 4. AVOIDING REDUNDANCY: Adding authorization here would require:
   *    - Passing comments array to find the comment and check author
   *    - Duplicating logic that already exists in CommentActions
   *    - Error handling for a case that cannot occur in normal usage
   *
   * If a different UI allows calling these functions for non-authors, add
   * authorization checks there rather than in this hook.
   */
  const deleteComment = useCallback(
    (id: string, parentCommentId?: string) => {
      // Optimistic UI update
      setComments((prev) => applyDeleteToState(prev, id, parentCommentId));

      // Handle pending reply tracking and enqueue operation if needed
      handlePendingReplyDelete(pendingNewReplies, id, parentCommentId, enqueue);
    },
    [setComments, enqueue, pendingNewReplies]
  );

  const editComment = useCallback(
    (id: string, newContent: CommentSegment[], parentCommentId?: string) => {
      // Check if this is a pending new reply (first save, not an edit)
      const isNewReply = pendingNewReplies.current?.has(id) ?? false;

      // Optimistic UI update
      setComments((prev) => applyEditToState(prev, id, newContent, parentCommentId));

      // Queue operation for persistent save with retry
      if (isNewReply && parentCommentId) {
        // This is a new reply being saved for the first time
        pendingNewReplies.current?.delete(id);

        // Find the reply in the current state to preserve its original dateISO.
        // The dateISO represents when the reply was created, NOT when it was saved.
        // We use setComments with a callback to access the current state safely.
        setComments((currentComments) => {
          const parentComment = currentComments.find((c) => c.id === parentCommentId);
          const reply = parentComment?.replies?.find((r) => r.id === id);

          // Use the reply's original dateISO, or fallback to now if not found
          // (shouldn't happen in normal flow, but provides safety)
          const originalDateISO = reply?.dateISO ?? new Date().toISOString();

          enqueue({
            type: 'ADD_REPLY',
            parentCommentId,
            reply: {
              id,
              dateISO: originalDateISO,
              content: newContent,
              author: { name: userName, email: userEmail },
              usersWhoUpvoted: [],
              parentCommentId,
            },
          });

          // Return unchanged - we already updated via applyEditToState above
          return currentComments;
        });
      } else {
        // This is an edit of an existing comment
        enqueue({
          type: 'EDIT_COMMENT',
          id,
          newContent,
          parentCommentId,
        });
      }
    },
    [userName, userEmail, setComments, enqueue, pendingNewReplies]
  );

  const upvoteComment = useCallback(
    (id: string, userUpvoted: boolean, parentCommentId?: string) => {
      const user = { name: userName, email: userEmail };

      // Optimistic UI update
      setComments((prev) =>
        applyUpvoteToState(prev, id, user, userUpvoted, parentCommentId)
      );

      // Queue operation for persistent save with retry
      // Use explicit 'add' or 'remove' for idempotency
      enqueue({
        type: 'UPVOTE_COMMENT',
        id,
        action: userUpvoted ? 'remove' : 'add',
        user,
        parentCommentId,
      });
    },
    [userEmail, userName, setComments, enqueue]
  );

  const replyComment = useCallback(
    (parentCommentId: string) => {
      const newReply = createComment([], userName, userEmail, parentCommentId);

      // Track this as a pending new reply (not yet saved to server)
      pendingNewReplies.current?.add(newReply.id);

      // Add empty reply to local state
      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== parentCommentId) return c;

          if (insertPosition === 'prepend') {
            // Prepend for sidebar (newest at top)
            return { ...c, replies: [newReply, ...(c.replies ?? [])] };
          } else {
            // Append for page (chronological, newest at bottom)
            return { ...c, replies: [...(c.replies ?? []), newReply] };
          }
        })
      );
    },
    [userEmail, userName, setComments, pendingNewReplies, insertPosition]
  );

  return {
    submitNewComment,
    deleteComment,
    editComment,
    upvoteComment,
    replyComment,
  };
}
