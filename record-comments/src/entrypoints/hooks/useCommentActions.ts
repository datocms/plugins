import { useCallback, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentType } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';
import type { MentionStateOperation } from '@ctypes/mentionState';
import { ERROR_MESSAGES } from '@/constants';
import { segmentsToStoredSegments } from '@utils/tipTapSerializer';
import {
  buildMentionEntriesByUser,
  buildMentionEntryKey,
  extractMentionedUserIds,
} from '@utils/mentionState';
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
  comments: CommentType[];
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
  /** Optional override for reply insertion order. Defaults to insertPosition. */
  replyInsertPosition?: InsertPosition;
  /**
   * Sidebar context - only required when insertPosition is 'prepend'
   * and record needs to be saved before commenting.
   */
  ctx?: RenderItemFormSidebarCtx;
};

function findCommentById(
  comments: CommentType[],
  id: string,
  parentCommentId?: string
): CommentType | null {
  if (parentCommentId) {
    const parent = comments.find((comment) => comment.id === parentCommentId);
    return parent?.replies?.find((reply) => reply.id === id) ?? null;
  }

  return comments.find((comment) => comment.id === id) ?? null;
}

function flattenCommentTree(comment: CommentType): CommentType[] {
  const items: CommentType[] = [comment];

  for (const reply of comment.replies ?? []) {
    items.push(...flattenCommentTree(reply));
  }

  return items;
}

function getDeletedComments(
  comments: CommentType[],
  id: string,
  parentCommentId?: string
): CommentType[] {
  const target = findCommentById(comments, id, parentCommentId);
  if (!target) return [];

  if (parentCommentId) return [target];
  return flattenCommentTree(target);
}

function buildMentionRemovalsByUser(
  commentsToRemove: CommentType[]
): Map<string, string[]> {
  const removalsByUser = new Map<string, Set<string>>();

  for (const comment of commentsToRemove) {
    const mentionedUserIds = extractMentionedUserIds(comment.content);

    for (const mentionedUserId of mentionedUserIds) {
      let removals = removalsByUser.get(mentionedUserId);
      if (!removals) {
        removals = new Set<string>();
        removalsByUser.set(mentionedUserId, removals);
      }

      removals.add(buildMentionEntryKey(comment.id, mentionedUserId));
    }
  }

  return new Map(
    Array.from(removalsByUser.entries()).map(([mentionedUserId, removals]) => [
      mentionedUserId,
      Array.from(removals),
    ])
  );
}

function diffMentionedUsers(
  previousSegments: CommentType['content'],
  nextSegments: CommentSegment[]
): { additions: string[]; removals: string[] } {
  const previous = new Set(extractMentionedUserIds(previousSegments));
  const next = new Set(extractMentionedUserIds(nextSegments));

  const additions = Array.from(next).filter((userId) => !previous.has(userId));
  const removals = Array.from(previous).filter((userId) => !next.has(userId));

  return { additions, removals };
}

export function useCommentActions({
  userId,
  comments,
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
  replyInsertPosition = insertPosition,
  ctx,
}: UseCommentActionsParams): CommentActionsReturn {
  const enqueueMentionAdditions = useCallback(
    (
      comment: CommentType,
      isReply: boolean,
      mentionedUserIds: string[],
      parentCommentId?: string
    ) => {
      if (!enqueueMentionState || !mentionContext) return;
      if (!mentionContext.recordId) return;
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

  const enqueueMentionRemovals = useCallback(
    (removalsByUser: Map<string, string[]>) => {
      if (!enqueueMentionState) return;
      if (removalsByUser.size === 0) return;

      for (const [mentionedUserId, removals] of removalsByUser) {
        const uniqueRemovals = Array.from(new Set(removals));
        if (uniqueRemovals.length === 0) continue;

        enqueueMentionState({
          type: 'UPDATE_MENTION_STATE',
          userId: mentionedUserId,
          removals: uniqueRemovals,
        });
      }
    },
    [enqueueMentionState]
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

    const mentionedUserIds = extractMentionedUserIds(composerSegments);
    enqueue({ type: 'ADD_COMMENT', comment: newComment });
    enqueueMentionAdditions(newComment, false, mentionedUserIds);
    setComposerSegments([]);
  }, [
    composerSegments,
    ctx,
    userId,
    setComments,
    enqueue,
    setComposerSegments,
    insertPosition,
    enqueueMentionAdditions,
  ]);

  // Authorization is handled at UI layer (visibility) and server (validation)
  const deleteComment = useCallback(
    (id: string, parentCommentId?: string) => {
      const isUnsavedNewReply = pendingNewReplies.current?.has(id) ?? false;
      const commentsToRemove = isUnsavedNewReply
        ? []
        : getDeletedComments(comments, id, parentCommentId);

      setComments((prev) => applyDeleteToState(prev, id, parentCommentId));
      handlePendingReplyDelete(pendingNewReplies, id, parentCommentId, enqueue);

      if (commentsToRemove.length > 0) {
        enqueueMentionRemovals(buildMentionRemovalsByUser(commentsToRemove));
      }
    },
    [comments, setComments, enqueue, pendingNewReplies, enqueueMentionRemovals]
  );

  const editComment = useCallback(
    (id: string, newContent: CommentSegment[], parentCommentId?: string) => {
      const isNewReply = pendingNewReplies.current?.has(id) ?? false;
      const existingComment = findCommentById(comments, id, parentCommentId);
      setComments((prev) => applyEditToState(prev, id, newContent, parentCommentId));

      // Convert to slim format for storage
      const storedContent = segmentsToStoredSegments(newContent);

      if (isNewReply && parentCommentId) {
        pendingNewReplies.current?.delete(id);

        // Preserve original dateISO (creation time, not save time)
        const replyComment: CommentType = {
          id,
          dateISO: existingComment?.dateISO ?? new Date().toISOString(),
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

        const mentionedUserIds = extractMentionedUserIds(newContent);
        enqueueMentionAdditions(replyComment, true, mentionedUserIds, parentCommentId);
      } else {
        if (existingComment) {
          const { additions, removals } = diffMentionedUsers(existingComment.content, newContent);

          if (additions.length > 0) {
            const editedComment: CommentType = {
              ...existingComment,
              content: storedContent,
              // Mentions added via edit should surface as new mention events.
              dateISO: new Date().toISOString(),
            };

            enqueueMentionAdditions(
              editedComment,
              !!parentCommentId,
              additions,
              parentCommentId
            );
          }

          if (removals.length > 0) {
            enqueueMentionRemovals(
              new Map(
                removals.map((mentionedUserId) => [
                  mentionedUserId,
                  [buildMentionEntryKey(id, mentionedUserId)],
                ])
              )
            );
          }
        }

        enqueue({
          type: 'EDIT_COMMENT',
          id,
          newContent: storedContent,
          parentCommentId,
        });
      }
    },
    [
      userId,
      comments,
      setComments,
      enqueue,
      pendingNewReplies,
      enqueueMentionAdditions,
      enqueueMentionRemovals,
    ]
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

          if (replyInsertPosition === 'prepend') {
            return { ...c, replies: [newReply, ...(c.replies ?? [])] };
          } else {
            return { ...c, replies: [...(c.replies ?? []), newReply] };
          }
        })
      );
    },
    [userId, setComments, pendingNewReplies, replyInsertPosition]
  );

  return {
    submitNewComment,
    deleteComment,
    editComment,
    upvoteComment,
    replyComment,
  };
}
