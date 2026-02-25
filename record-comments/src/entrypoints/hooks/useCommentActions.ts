import { useCallback, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentType } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';
import type { MentionStateOperation } from '@ctypes/mentionState';
import { ERROR_MESSAGES } from '@/constants';
import { segmentsToStoredSegments } from '@utils/tipTapSerializer';
import { buildMentionEntriesByUser, extractMentionedUserIds } from '@utils/mentionState';
import { sendMentionNotifications } from '@utils/mentionNotifications';
import type { UserInfo } from '@utils/userTransformers';
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

type InsertPosition = 'prepend' | 'append';

type UseCommentActionsParams = {
  userId: string;
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  enqueue: (operation: CommentOperation) => void;
  enqueueMentionState?: (operation: MentionStateOperation) => void;
  mentionContext?: { modelId: string; recordId: string };
  notificationsEndpoint?: string;
  currentUserAccessToken?: string | null;
  projectUsers?: UserInfo[];
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

export function useCommentActions({
  userId,
  setComments,
  enqueue,
  enqueueMentionState,
  mentionContext,
  notificationsEndpoint,
  currentUserAccessToken,
  projectUsers,
  composerSegments,
  setComposerSegments,
  pendingNewReplies,
  insertPosition = 'prepend',
  ctx,
}: UseCommentActionsParams): CommentActionsReturn {
  const enqueueMentionUpdates = useCallback(
    (
      comment: CommentType,
      segments: CommentSegment[],
      isReply: boolean,
      parentCommentId?: string
    ) => {
      if (!enqueueMentionState || !mentionContext) return;
      if (!mentionContext.recordId) return;

      const mentionedUserIds = extractMentionedUserIds(segments);
      if (mentionedUserIds.length === 0) return;

      const entriesByUser = buildMentionEntriesByUser(
        comment,
        {
          modelId: mentionContext.modelId,
          recordId: mentionContext.recordId,
          isReply,
          parentCommentId,
        },
        mentionedUserIds
      );

      void sendMentionNotifications({
        endpoint: notificationsEndpoint,
        accessToken: currentUserAccessToken,
        mentionedUserIds,
        users: projectUsers ?? [],
        currentUserId: userId,
      });

      for (const [mentionedUserId, entries] of entriesByUser) {
        enqueueMentionState({
          type: 'UPDATE_MENTION_STATE',
          userId: mentionedUserId,
          additions: entries,
        });
      }
    },
    [
      enqueueMentionState,
      mentionContext,
      notificationsEndpoint,
      currentUserAccessToken,
      projectUsers,
      userId,
    ]
  );

  const submitNewComment = useCallback(() => {
    if (isSegmentsEmpty(composerSegments)) return;

    if (!isAuthorValid(userId)) {
      ctx?.alert(ERROR_MESSAGES.MISSING_USER_INFO);
      return;
    }

    // Sidebar context requires a saved record
    if (ctx && !ctx.item?.id) {
      ctx.alert(ERROR_MESSAGES.SAVE_RECORD_FIRST);
      return;
    }

    const newComment = createComment(composerSegments, userId);

    if (insertPosition === 'prepend') {
      setComments((prev) => [newComment, ...prev]);
    } else {
      setComments((prev) => [...prev, newComment]);
    }

    enqueue({ type: 'ADD_COMMENT', comment: newComment });
    enqueueMentionUpdates(newComment, composerSegments, false);
    setComposerSegments([]);
  }, [
    composerSegments,
    ctx,
    userId,
    setComments,
    enqueue,
    setComposerSegments,
    insertPosition,
    enqueueMentionUpdates,
  ]);

  // Authorization is handled at UI layer (visibility) and server (validation)
  const deleteComment = useCallback(
    (id: string, parentCommentId?: string) => {
      setComments((prev) => applyDeleteToState(prev, id, parentCommentId));
      handlePendingReplyDelete(pendingNewReplies, id, parentCommentId, enqueue);
    },
    [setComments, enqueue, pendingNewReplies]
  );

  const editComment = useCallback(
    (id: string, newContent: CommentSegment[], parentCommentId?: string) => {
      const isNewReply = pendingNewReplies.current?.has(id) ?? false;
      setComments((prev) => applyEditToState(prev, id, newContent, parentCommentId));

      // Convert to slim format for storage
      const storedContent = segmentsToStoredSegments(newContent);

      if (isNewReply && parentCommentId) {
        pendingNewReplies.current?.delete(id);

        // Preserve original dateISO (creation time, not save time)
        setComments((currentComments) => {
          const parentComment = currentComments.find((c) => c.id === parentCommentId);
          const reply = parentComment?.replies?.find((r) => r.id === id);
          const originalDateISO = reply?.dateISO ?? new Date().toISOString();

          const replyComment: CommentType = {
            id,
            dateISO: originalDateISO,
            content: storedContent,
            authorId: userId,
            upvoterIds: [],
            parentCommentId,
          };

          enqueue({
            type: 'ADD_REPLY',
            parentCommentId,
            reply: replyComment,
          });

          enqueueMentionUpdates(replyComment, newContent, true, parentCommentId);

          return currentComments;
        });
      } else {
        enqueue({
          type: 'EDIT_COMMENT',
          id,
          newContent: storedContent,
          parentCommentId,
        });
      }
    },
    [userId, setComments, enqueue, pendingNewReplies, enqueueMentionUpdates]
  );

  const upvoteComment = useCallback(
    (id: string, userUpvoted: boolean, parentCommentId?: string) => {
      setComments((prev) =>
        applyUpvoteToState(prev, id, userId, userUpvoted, parentCommentId)
      );

      enqueue({
        type: 'UPVOTE_COMMENT',
        id,
        action: userUpvoted ? 'remove' : 'add',
        userId,
        parentCommentId,
      });
    },
    [userId, setComments, enqueue]
  );

  const replyComment = useCallback(
    (parentCommentId: string) => {
      const newReply = createComment([], userId, parentCommentId);
      pendingNewReplies.current?.add(newReply.id);

      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== parentCommentId) return c;

          if (insertPosition === 'prepend') {
            return { ...c, replies: [newReply, ...(c.replies ?? [])] };
          } else {
            return { ...c, replies: [...(c.replies ?? []), newReply] };
          }
        })
      );
    },
    [userId, setComments, pendingNewReplies, insertPosition]
  );

  return {
    submitNewComment,
    deleteComment,
    editComment,
    upvoteComment,
    replyComment,
  };
}
