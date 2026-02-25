import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import ReactTimeAgo from 'react-time-ago';

// Components
import CommentContentRenderer from './CommentContentRenderer';
import CommentActions from './CommentActions';
import ComposerBox from './ComposerBox';
import ComposerToolbar from './ComposerToolbar';
import RecordModelSelectorDropdown from './RecordModelSelectorDropdown';
import { TipTapComposer, type TipTapComposerRef } from './tiptap/TipTapComposer';
import { UpvoteIcon, ChevronDownIcon } from './Icons';

// Hooks
import type { UserInfo, FieldInfo, ModelInfo } from '@hooks/useMentions';
import { useCommentEditor } from '@hooks/useCommentEditor';

// Types and utilities
import type { CommentSegment } from '@ctypes/mentions';
import type { ResolvedCommentType } from '@ctypes/comments';
import { isContentEmpty } from '@ctypes/comments';
import { getGravatarUrl, normalizeForComparison } from '@/utils/helpers';
import {
  areSegmentsEqual,
  areRepliesEqual,
} from '@utils/comparisonHelpers';
import { cn } from '@/utils/cn';
import { TIMING, UI } from '@/constants';
import styles from '@styles/comment.module.css';
import type { TypedUserInfo } from '@utils/userDisplayResolver';

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
  commentObject: ResolvedCommentType;
  currentUserId: string;
  isReply?: boolean;
  modelFields?: FieldInfo[];
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  ctx?: RenderItemFormSidebarCtx | RenderPageCtx;
  canMentionFields?: boolean;
  // Picker request callback for asset mentions in edit mode
  onPickerRequest?: (
    type: 'asset' | 'record',
    composerRef: RefObject<TipTapComposerRef | null>
  ) => void;
  /** Callback when a model is selected for record mention - opens record picker */
  onRecordModelSelect?: (
    model: ModelInfo,
    composerRef: RefObject<TipTapComposerRef | null>
  ) => void;
  /** Models available for record mentions */
  readableModels?: ModelInfo[];
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
  // Compare upvoters arrays (resolved authors)
  if (prevComment.upvoters.length !== nextComment.upvoters.length) return false;
  if (!prevComment.upvoters.every((u, i) => u.email === nextComment.upvoters[i].email)) return false;
  if (!areRepliesEqual(prevComment.replies, nextComment.replies)) return false;

  return compareRemainingProps(prev, next);
}

// ctx excluded - recreated every render, only used in editing mode
function compareRemainingProps(prev: CommentProps, next: CommentProps): boolean {
  return (
    prev.currentUserId === next.currentUserId &&
    prev.isReply === next.isReply &&
    prev.canMentionFields === next.canMentionFields &&
    prev.canMentionAssets === next.canMentionAssets &&
    prev.canMentionModels === next.canMentionModels &&
    prev.isPickerActive === next.isPickerActive &&
    prev.dropdownPosition === next.dropdownPosition &&
    prev.modelFields === next.modelFields &&
    prev.projectUsers === next.projectUsers &&
    prev.projectModels === next.projectModels &&
    prev.readableModels === next.readableModels &&
    prev.deleteComment === next.deleteComment &&
    prev.editComment === next.editComment &&
    prev.upvoteComment === next.upvoteComment &&
    prev.replyComment === next.replyComment &&
    prev.onPickerRequest === next.onPickerRequest &&
    prev.onRecordModelSelect === next.onRecordModelSelect
  );
}

const Comment = memo(function Comment({
  deleteComment,
  editComment,
  upvoteComment,
  replyComment,
  commentObject,
  currentUserId,
  isReply = false,
  modelFields = [],
  projectUsers,
  projectModels,
  ctx,
  canMentionFields = true,
  onPickerRequest,
  onRecordModelSelect,
  readableModels = [],
  canMentionAssets = false,
  canMentionModels = true,
  isPickerActive = false,
  typedUsers = [],
  dropdownPosition = 'below',
}: CommentProps) {
  const [isRecordSelectorOpen, setIsRecordSelectorOpen] = useState(false);
  const userUpvotedThisComment = commentObject.upvoters.some(
    (u) => u.id === currentUserId
  );

  const isNewComment = isContentEmpty(commentObject.content);
  const isTopLevel = 'replies' in commentObject;
  const parentId = isTopLevel ? undefined : commentObject.parentCommentId;
  const userIsAuthor = commentObject.author.id === currentUserId;

  const replies = isTopLevel ? commentObject.replies ?? [] : [];
  const replyCount = replies.length;
  const hasNewReply = replies.some((r) => isContentEmpty(r.content));

  const avatarSize = isReply ? UI.AVATAR_SIZE_REPLY : UI.AVATAR_SIZE_COMMENT;

  // Author data is pre-resolved - use directly with fallback for avatar
  const avatarUrl =
    commentObject.author.avatarUrl ??
    getGravatarUrl(commentObject.author.email, avatarSize * 2);
  const authorName = commentObject.author.name;

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

  // Upvoter names are pre-resolved
  const upvoterNames = useMemo(
    () => commentObject.upvoters.map((u) => u.name).join(', '),
    [commentObject.upvoters]
  );

  const isSegmentsEmpty = useMemo(
    () => isContentEmpty(segments),
    [segments]
  );

  // Extract unique repliers for collapsed reply preview (max 3 avatars)
  // Reply authors are pre-resolved
  const uniqueReplierAvatars = useMemo(() => {
    if (!isTopLevel || replies.length === 0) return [];

    const seenUsers = new Set<string>();
    const result: Array<{
      id: string;
      avatarUrl: string;
      name: string;
      fallbackUrl: string;
    }> = [];

    for (const reply of replies) {
      const userKey = normalizeForComparison(reply.author.email) || reply.id;

      if (seenUsers.has(userKey)) continue;
      seenUsers.add(userKey);

      const fallbackUrl = getGravatarUrl(reply.author.email, UI.AVATAR_SIZE_THUMBNAIL);

      result.push({
        id: reply.id,
        avatarUrl: reply.author.avatarUrl ?? fallbackUrl,
        name: reply.author.name,
        fallbackUrl,
      });

      if (result.length >= UI.MAX_VISIBLE_REPLIER_AVATARS) break;
    }

    return result;
  }, [isTopLevel, replies]);

  // Keep refs updated synchronously to avoid stale closures in blur handler
  isSegmentsEmptyRef.current = isSegmentsEmpty;
  isNewCommentRef.current = isNewComment;

  const handleSave = () => {
    if (isSegmentsEmpty) {
      deleteComment(commentObject.id, parentId);
      return;
    }

    setIsEditing(false);
    editComment(commentObject.id, segments, parentId);
  };

  const handleDelete = async () => {
    const confirmed = await ctx?.openConfirm({
      title: 'Delete comment',
      content: 'Are you sure you want to delete this comment?',
      choices: [{ label: 'Delete', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });

    if (!confirmed) return;

    deleteComment(commentObject.id, parentId);
  };

  const handleUpvote = () => {
    upvoteComment(commentObject.id, userUpvotedThisComment, parentId);
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
    }, TIMING.SCROLL_AFTER_REPLY_DELAY_MS);
  };

  const handleEscape = () => {
    if (isNewComment) {
      // For new comments, just delete without confirmation
      deleteComment(commentObject.id, parentId);
    } else {
      resetToOriginal();
    }
  };

  // Delay allows button clicks to register before blur
  // Uses refs to check current values, avoiding stale closure issues when
  // the user types quickly after blur fires
  const handleBlur = () => {
    setTimeout(() => {
      if (isSegmentsEmptyRef.current && isNewCommentRef.current && !isPickerActiveRef.current) {
        // For empty new comments, just delete without confirmation
        deleteComment(commentObject.id, parentId);
      }
    }, TIMING.COMMENT_BLUR_DELAY_MS);
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
    setIsRecordSelectorOpen(true);
  }, []);

  const handleRecordModelSelected = useCallback((model: ModelInfo) => {
    setIsRecordSelectorOpen(false);
    if (onRecordModelSelect) {
      onRecordModelSelect(model, composerRef);
    }
  }, [onRecordModelSelect, composerRef]);

  const handleRecordSelectorClose = useCallback(() => {
    setIsRecordSelectorOpen(false);
    composerRef.current?.focus();
  }, [composerRef]);

  return (
    <div
      ref={commentRef}
      className={cn(styles.comment, isReply && styles.reply, userIsAuthor && styles.ownComment)}
      data-comment-id={commentObject.id}
    >
      {!isEditing && (
        <CommentActions
          onUpvote={handleUpvote}
          onReply={isTopLevel ? handleReply : undefined}
          onEdit={handleStartEditing}
          onDelete={handleDelete}
          userUpvoted={userUpvotedThisComment}
          userIsAuthor={userIsAuthor}
          isTopLevel={isTopLevel}
          hasUpvotes={commentObject.upvoters.length > 0}
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
              target.src = getGravatarUrl(commentObject.author.email, avatarSize * 2);
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
                {isRecordSelectorOpen && readableModels.length > 0 && (
                  <RecordModelSelectorDropdown
                    models={readableModels}
                    onSelect={handleRecordModelSelected}
                    onClose={handleRecordSelectorClose}
                    position={dropdownPosition}
                  />
                )}
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
            {commentObject.upvoters.length > 0 && !isEditing && (
              <div className={styles.reactionWrapper}>
                <button
                  type="button"
                  className={cn(styles.reaction, userUpvotedThisComment && styles.reactionActive)}
                  onClick={handleUpvote}
                >
                  <UpvoteIcon role="img" aria-labelledby="upvoteIconTitle" />
                  <title id="upvoteIconTitle">Upvote</title>
                  <span>{commentObject.upvoters.length}</span>
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
                  {uniqueReplierAvatars.map((replier, idx) => (
                    <img
                      key={replier.id}
                      src={replier.avatarUrl}
                      alt={replier.name}
                      className={styles.replyAvatar}
                      style={{ zIndex: UI.MAX_VISIBLE_REPLIER_AVATARS - idx }}
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.onerror = null;
                        target.src = replier.fallbackUrl;
                      }}
                    />
                  ))}
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
              currentUserId={currentUserId}
              isReply
              modelFields={modelFields}
              projectUsers={projectUsers}
              projectModels={projectModels}
              ctx={ctx}
              canMentionFields={canMentionFields}
              onPickerRequest={onPickerRequest}
              onRecordModelSelect={onRecordModelSelect}
              readableModels={readableModels}
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
