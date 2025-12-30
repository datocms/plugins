import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import ReactTimeAgo from 'react-time-ago';

// Components
import CommentContentRenderer from './CommentContentRenderer';
import CommentActions from './CommentActions';
import ComposerBox from './ComposerBox';
import ComposerToolbar from './ComposerToolbar';
import { TipTapComposer, type TipTapComposerRef } from './tiptap/TipTapComposer';
import { UpvoteIcon, ChevronDownIcon } from './Icons';

// Hooks
import type { UserInfo, FieldInfo, ModelInfo } from '@hooks/useMentions';
import { useCommentEditor } from '@hooks/useCommentEditor';

// Types and utilities
import type { CommentSegment } from '@ctypes/mentions';
import type { CommentType } from '@ctypes/comments';
import { isContentEmpty } from '@ctypes/comments';
import { getGravatarUrl } from '@/utils/helpers';
import {
  areSegmentsEqual,
  areUpvotersEqual,
  areRepliesEqual,
} from '@utils/comparisonHelpers';
import { isComposerEmpty } from '@utils/composerHelpers';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';
import {
  resolveUpvoterName,
  type TypedUserInfo,
} from '@utils/userDisplayResolver';

type CommentProps = {
  deleteComment: (id: string, parentCommentId?: string) => void;
  editComment: (
    id: string,
    newContent: CommentSegment[],
    parentCommentId?: string
  ) => void;
  upvoteComment: (
    id: string,
    userUpvotedThisComment: boolean,
    parentCommentId?: string
  ) => void;
  replyComment: (parentCommentId: string) => void;
  commentObject: CommentType;
  currentUserEmail: string;
  isReply?: boolean;
  modelFields?: FieldInfo[];
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  ctx?: RenderItemFormSidebarCtx | RenderPageCtx;
  canMentionFields?: boolean;
  // Picker request callback for asset/record mentions in edit mode
  onPickerRequest?: (
    type: 'asset' | 'record',
    composerRef: RefObject<TipTapComposerRef | null>
  ) => void;
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  /** When true, prevents empty comments from being auto-deleted on blur */
  isPickerActive?: boolean;
  /** Users with type information for upvoter name resolution */
  typedUsers?: TypedUserInfo[];
  /** Position of mention dropdowns: 'above' or 'below' the input */
  dropdownPosition?: 'above' | 'below';
};

function arePropsEqual(prev: CommentProps, next: CommentProps): boolean {
  const prevComment = prev.commentObject;
  const nextComment = next.commentObject;

  if (prevComment === nextComment) {
    return compareRemainingProps(prev, next);
  }

  if (prevComment.id !== nextComment.id) return false;
  if (!areSegmentsEqual(prevComment.content, nextComment.content)) return false;
  if (!areUpvotersEqual(prevComment.usersWhoUpvoted, nextComment.usersWhoUpvoted)) return false;
  if (!areRepliesEqual(prevComment.replies, nextComment.replies)) return false;

  return compareRemainingProps(prev, next);
}

// ctx excluded - recreated every render, only used in editing mode
function compareRemainingProps(prev: CommentProps, next: CommentProps): boolean {
  return (
    prev.currentUserEmail === next.currentUserEmail &&
    prev.isReply === next.isReply &&
    prev.canMentionFields === next.canMentionFields &&
    prev.canMentionAssets === next.canMentionAssets &&
    prev.canMentionModels === next.canMentionModels &&
    prev.isPickerActive === next.isPickerActive &&
    prev.dropdownPosition === next.dropdownPosition &&
    prev.modelFields === next.modelFields &&
    prev.projectUsers === next.projectUsers &&
    prev.projectModels === next.projectModels &&
    prev.deleteComment === next.deleteComment &&
    prev.editComment === next.editComment &&
    prev.upvoteComment === next.upvoteComment &&
    prev.replyComment === next.replyComment &&
    prev.onPickerRequest === next.onPickerRequest
  );
}

const Comment = memo(function Comment({
  deleteComment,
  editComment,
  upvoteComment,
  replyComment,
  commentObject,
  currentUserEmail,
  isReply = false,
  modelFields = [],
  projectUsers,
  projectModels,
  ctx,
  canMentionFields = true,
  onPickerRequest,
  canMentionAssets = false,
  canMentionModels = true,
  isPickerActive = false,
  typedUsers = [],
  dropdownPosition = 'below',
}: CommentProps) {
  const userUpvotedThisComment = commentObject.usersWhoUpvoted.some(
    (upvoter) => upvoter.email === currentUserEmail
  );

  const isNewComment = isContentEmpty(commentObject.content);
  const isTopLevel = 'replies' in commentObject;
  const userIsAuthor = commentObject.author.email === currentUserEmail;

  const replies = isTopLevel ? commentObject.replies ?? [] : [];
  const replyCount = replies.length;
  const hasNewReply = replies.some((r) => isContentEmpty(r.content));

  const avatarSize = isReply ? 24 : 32;

  const userLookupMaps = useMemo(() => {
    const byEmail = new Map<string, number>();
    const byName = new Map<string, number>();

    for (let i = 0; i < typedUsers.length; i++) {
      const user = typedUsers[i].user;
      const email = user.email?.toLowerCase().trim();
      const name = user.name?.toLowerCase().trim();

      if (email && !byEmail.has(email)) {
        byEmail.set(email, i);
      }
      if (name && !byName.has(name)) {
        byName.set(name, i);
      }
    }

    return { byEmail, byName };
  }, [typedUsers]);

  const resolvedAuthor = useMemo(() => {
    const fallbackAvatarUrl = getGravatarUrl(commentObject.author.email || '', avatarSize * 2);
    const authorEmail = commentObject.author.email?.toLowerCase().trim();
    const authorNameLower = commentObject.author.name?.toLowerCase().trim();

    let matchedIndex = -1;
    if (authorEmail) {
      matchedIndex = userLookupMaps.byEmail.get(authorEmail) ?? -1;
    }
    if (matchedIndex === -1 && authorNameLower) {
      matchedIndex = userLookupMaps.byName.get(authorNameLower) ?? -1;
    }

    if (matchedIndex !== -1 && matchedIndex < projectUsers.length) {
      const userWithOverrides = projectUsers[matchedIndex];
      return {
        name: userWithOverrides.name,
        avatarUrl: userWithOverrides.avatarUrl ?? fallbackAvatarUrl,
      };
    }

    return {
      name: commentObject.author.name,
      avatarUrl: fallbackAvatarUrl,
    };
  }, [commentObject.author, projectUsers, userLookupMaps, avatarSize]);

  const avatarUrl = resolvedAuthor.avatarUrl;
  const authorName = resolvedAuthor.name;

  const [repliesExpanded, setRepliesExpanded] = useState(false);

  const isPickerActiveRef = useRef(isPickerActive);
  isPickerActiveRef.current = isPickerActive;

  // Refs to track current values for blur handler (avoids stale closure issues)
  const isSegmentsEmptyRef = useRef(true);
  const isNewCommentRef = useRef(isNewComment);

  const {
    isEditing,
    setIsEditing,
    segments,
    setSegments,
    composerRef,
    handleStartEditing,
    resetToOriginal,
  } = useCommentEditor({
    commentContent: commentObject.content,
    isNewComment,
  });

  useEffect(() => {
    if (hasNewReply && !repliesExpanded) {
      setRepliesExpanded(true);
    }
  }, [hasNewReply, repliesExpanded]);

  const upvoterNames = useMemo(
    () =>
      commentObject.usersWhoUpvoted
        .map((upvoter) => resolveUpvoterName(upvoter, typedUsers))
        .join(', '),
    [commentObject.usersWhoUpvoted, typedUsers]
  );

  const isSegmentsEmpty = useMemo(
    () => isComposerEmpty(segments),
    [segments]
  );

  // Keep refs updated synchronously to avoid stale closures in blur handler
  isSegmentsEmptyRef.current = isSegmentsEmpty;
  isNewCommentRef.current = isNewComment;

  const handleSave = () => {
    if (isSegmentsEmpty) {
      if (isTopLevel) {
        deleteComment(commentObject.id);
      } else {
        deleteComment(commentObject.id, commentObject.parentCommentId);
      }
      return;
    }

    setIsEditing(false);
    if (isTopLevel) {
      editComment(commentObject.id, segments);
    } else {
      editComment(commentObject.id, segments, commentObject.parentCommentId);
    }
  };

  const handleDelete = async () => {
    const confirmed = await ctx?.openConfirm({
      title: 'Delete comment',
      content: 'Are you sure you want to delete this comment?',
      choices: [{ label: 'Delete', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });

    if (!confirmed) return;

    if (isTopLevel) {
      deleteComment(commentObject.id);
    } else {
      deleteComment(commentObject.id, commentObject.parentCommentId);
    }
  };

  const handleUpvote = () => {
    if (isTopLevel) {
      upvoteComment(commentObject.id, userUpvotedThisComment);
    } else {
      upvoteComment(commentObject.id, userUpvotedThisComment, commentObject.parentCommentId);
    }
  };

  const commentRef = useRef<HTMLDivElement>(null);

  const handleReply = () => {
    setRepliesExpanded(true);
    replyComment(commentObject.id);

    // Scroll to ensure the new reply composer is visible
    // Uses setTimeout to wait for React to render the new reply
    setTimeout(() => {
      if (commentRef.current) {
        // Find the last reply element (the newly created one)
        const repliesContainer = commentRef.current.querySelector('[class*="replies"]');
        if (repliesContainer) {
          const lastReply = repliesContainer.lastElementChild;
          if (lastReply) {
            lastReply.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
        }
        // Fallback: scroll the whole comment into view
        commentRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 100);
  };

  const handleEscape = () => {
    if (isNewComment) {
      // For new comments, just delete without confirmation
      if (isTopLevel) {
        deleteComment(commentObject.id);
      } else {
        deleteComment(commentObject.id, commentObject.parentCommentId);
      }
    } else {
      resetToOriginal();
    }
  };

  // 150ms delay allows button clicks to register before blur
  // Uses refs to check current values, avoiding stale closure issues when
  // the user types quickly after blur fires
  const handleBlur = () => {
    setTimeout(() => {
      if (isSegmentsEmptyRef.current && isNewCommentRef.current && !isPickerActiveRef.current) {
        // For empty new comments, just delete without confirmation
        if (isTopLevel) {
          deleteComment(commentObject.id);
        } else {
          deleteComment(commentObject.id, commentObject.parentCommentId);
        }
      }
    }, 150);
  };

  const toggleReplies = () => {
    setRepliesExpanded(!repliesExpanded);
  };

  const handleUserToolbarClick = useCallback(() => {
    composerRef.current?.insertText('@');
  }, [composerRef]);

  const handleFieldToolbarClick = useCallback(() => {
    composerRef.current?.insertText('#');
  }, [composerRef]);

  const handleModelToolbarClick = useCallback(() => {
    composerRef.current?.insertText('$');
  }, [composerRef]);

  const handleAssetToolbarClick = useCallback(() => {
    if (onPickerRequest) {
      onPickerRequest('asset', composerRef);
    }
  }, [onPickerRequest, composerRef]);

  const handleRecordToolbarClick = useCallback(() => {
    if (onPickerRequest) {
      onPickerRequest('record', composerRef);
    }
  }, [onPickerRequest, composerRef]);

  return (
    <div ref={commentRef} className={cn(styles.comment, isReply && styles.reply, userIsAuthor && styles.ownComment)}>
      {!isEditing && (
        <CommentActions
          onUpvote={handleUpvote}
          onReply={isTopLevel ? handleReply : undefined}
          onEdit={handleStartEditing}
          onDelete={handleDelete}
          userUpvoted={userUpvotedThisComment}
          userIsAuthor={userIsAuthor}
          isTopLevel={isTopLevel}
          hasUpvotes={commentObject.usersWhoUpvoted.length > 0}
        />
      )}

      <div className={styles.commentBody} style={{ gridTemplateColumns: `${avatarSize}px 1fr` }}>
        <div className={styles.avatarContainer}>
          <img
            className={styles.avatar}
            src={avatarUrl}
            alt={authorName}
            style={{ width: avatarSize, height: avatarSize }}
            onError={(e) => {
              const target = e.currentTarget;
              target.onerror = null; // Prevent infinite loop
              target.src = getGravatarUrl(commentObject.author.email || '', avatarSize * 2);
            }}
          />
        </div>

        <div className={styles.content}>
          <div className={styles.header}>
            <span className={styles.authorName}>{authorName}</span>
            <span className={styles.timestamp}>
              <ReactTimeAgo date={new Date(commentObject.dateISO)} />
            </span>
          </div>

          {isEditing ? (
            <div className={styles.editContainer}>
              <ComposerBox compact>
{/* ctx is only passed for sidebar context because TipTapComposer uses it
    for field mention navigation, which requires sidebar-specific APIs like
    formValues. The dashboard (RenderPageCtx) doesn't support field mentions. */}
                <TipTapComposer
                  ref={composerRef}
                  segments={segments}
                  onSegmentsChange={setSegments}
                  onSubmit={handleSave}
                  onCancel={handleEscape}
                  onBlur={handleBlur}
                  placeholder="Write a comment..."
                  projectUsers={projectUsers}
                  modelFields={modelFields}
                  projectModels={projectModels}
                  canMentionAssets={canMentionAssets}
                  canMentionModels={canMentionModels}
                  canMentionFields={canMentionFields}
                  onAssetTrigger={handleAssetToolbarClick}
                  onRecordTrigger={handleRecordToolbarClick}
                  autoFocus
                  dropdownPosition={dropdownPosition}
                  ctx={ctx?.mode === 'renderItemFormSidebar' ? ctx : undefined}
                />
                <ComposerToolbar
                  onUserClick={handleUserToolbarClick}
                  onFieldClick={handleFieldToolbarClick}
                  onRecordClick={handleRecordToolbarClick}
                  onAssetClick={handleAssetToolbarClick}
                  onModelClick={handleModelToolbarClick}
                  onSendClick={handleSave}
                  isSendDisabled={isSegmentsEmpty}
                  canMentionAssets={canMentionAssets && !!onPickerRequest}
                  canMentionModels={canMentionModels}
                  canMentionFields={canMentionFields}
                />
              </ComposerBox>
            </div>
          ) : (
            <div className={styles.text}>
              <CommentContentRenderer
                segments={commentObject.content}
              />
            </div>
          )}

          <div className={styles.footer}>
            {commentObject.usersWhoUpvoted.length > 0 && !isEditing && (
              <div className={styles.reactionWrapper}>
                <button
                  type="button"
                  className={cn(styles.reaction, userUpvotedThisComment && styles.reactionActive)}
                  onClick={handleUpvote}
                >
                  <UpvoteIcon role="img" aria-labelledby="upvoteIconTitle" />
                  <title id="upvoteIconTitle">Upvote</title>
                  <span>{commentObject.usersWhoUpvoted.length}</span>
                </button>
                <div className={styles.tooltip}>
                  {upvoterNames}
                  <div className={styles.tooltipArrow} />
                </div>
              </div>
            )}

            {isTopLevel && replyCount > 0 && !isEditing && (
              <button
                type="button"
                className={styles.replyToggle}
                onClick={toggleReplies}
                aria-expanded={repliesExpanded}
                aria-label={`${repliesExpanded ? 'Collapse' : 'Expand'} ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
              >
                <div className={styles.replyAvatars}>
                  {(() => {
                    const seenUsers = new Set<string>();
                    const uniqueRepliers: typeof replies = [];

                    for (const reply of replies) {
                      const userKey = reply.author.email?.toLowerCase().trim()
                        || reply.author.name?.toLowerCase().trim()
                        || reply.id;

                      if (!seenUsers.has(userKey)) {
                        seenUsers.add(userKey);
                        uniqueRepliers.push(reply);
                        if (uniqueRepliers.length >= 3) break;
                      }
                    }

                    return uniqueRepliers.map((reply, idx) => {
                      const fallbackUrl = getGravatarUrl(reply.author.email || '', 40);
                      const replyEmail = reply.author.email?.toLowerCase().trim();
                      const replyNameLower = reply.author.name?.toLowerCase().trim();

                      let replyMatchIndex = -1;
                      if (replyEmail) {
                        replyMatchIndex = userLookupMaps.byEmail.get(replyEmail) ?? -1;
                      }
                      if (replyMatchIndex === -1 && replyNameLower) {
                        replyMatchIndex = userLookupMaps.byName.get(replyNameLower) ?? -1;
                      }

                      const matchedReplyUser = replyMatchIndex !== -1 ? projectUsers[replyMatchIndex] : null;
                      const displayAvatarUrl = matchedReplyUser?.avatarUrl ?? fallbackUrl;
                      const displayName = matchedReplyUser?.name ?? reply.author.name;
                      const replyFallbackUrl = getGravatarUrl(reply.author.email || '', 40);
                      return (
                        <img
                          key={reply.id}
                          src={displayAvatarUrl}
                          alt={displayName}
                          className={styles.replyAvatar}
                          style={{ zIndex: 3 - idx }}
                          onError={(e) => {
                            const target = e.currentTarget;
                            target.onerror = null; // Prevent infinite loop
                            target.src = replyFallbackUrl;
                          }}
                        />
                      );
                    });
                  })()}
                </div>
                <div className={styles.replyMeta}>
                  <span className={styles.replyText}>
                    {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                </div>
                <ChevronDownIcon
                  className={cn(styles.chevron, repliesExpanded && styles.chevronExpanded)}
                  role="img"
                  aria-labelledby="chevronTitle"
                />
                <title id="chevronTitle">{repliesExpanded ? 'Collapse' : 'Expand'}</title>
              </button>
            )}
          </div>
        </div>
      </div>

      {isTopLevel && replyCount > 0 && repliesExpanded && (
        <div className={styles.replies}>
          {replies.map((reply) => (
            <Comment
              key={reply.id}
              deleteComment={deleteComment}
              editComment={editComment}
              upvoteComment={upvoteComment}
              replyComment={replyComment}
              commentObject={reply}
              currentUserEmail={currentUserEmail}
              isReply
              modelFields={modelFields}
              projectUsers={projectUsers}
              projectModels={projectModels}
              ctx={ctx}
              canMentionFields={canMentionFields}
              onPickerRequest={onPickerRequest}
              canMentionAssets={canMentionAssets}
              canMentionModels={canMentionModels}
              isPickerActive={isPickerActive}
              typedUsers={typedUsers}
              dropdownPosition={dropdownPosition}
            />
          ))}
        </div>
      )}
    </div>
  );
}, arePropsEqual);

export default Comment;
