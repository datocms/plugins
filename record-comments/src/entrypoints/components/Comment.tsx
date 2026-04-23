import type { ResolvedCommentType } from '@ctypes/comments';
import { isContentEmpty } from '@ctypes/comments';
// Types and utilities
import type { CommentSegment } from '@ctypes/mentions';
import { useCommentEditor } from '@hooks/useCommentEditor';
// Hooks
import type { FieldInfo, ModelInfo, UserInfo } from '@hooks/useMentions';
import styles from '@styles/comment.module.css';
import { areRepliesEqual, areSegmentsEqual } from '@utils/comparisonHelpers';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactTimeAgo from 'react-time-ago';
import { TIMING, UI } from '@/constants';
import { cn } from '@/utils/cn';
import { getGravatarUrl, normalizeForComparison } from '@/utils/helpers';
import CommentActions from './CommentActions';
// Components
import CommentContentRenderer from './CommentContentRenderer';
import ComposerBox from './ComposerBox';
import ComposerToolbar from './ComposerToolbar';
import { ChevronDownIcon, UpvoteIcon } from './Icons';
import RecordModelSelectorDropdown from './RecordModelSelectorDropdown';
import {
  TipTapComposer,
  type TipTapComposerRef,
} from './tiptap/TipTapComposer';

type CommentProps = {
  deleteComment: (id: string, parentCommentId?: string) => boolean;
  editComment: (
    id: string,
    newContent: CommentSegment[],
    parentCommentId?: string,
  ) => boolean;
  upvoteComment: (
    id: string,
    userUpvotedThisComment: boolean,
    parentCommentId?: string,
  ) => boolean;
  replyComment: (parentCommentId: string) => boolean;
  commentObject: ResolvedCommentType;
  currentUserId: string;
  isReply?: boolean;
  modelFields?: FieldInfo[];
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  ctx: RenderItemFormSidebarCtx;
  canMentionFields?: boolean;
  fieldMentionsLoading?: boolean;
  fieldMentionsError?: string | null;
  onFieldMentionIntent?: () => void;
  onFieldMentionsRetry?: () => void;
  // Picker request callback for asset mentions in edit mode
  onPickerRequest?: (
    type: 'asset' | 'record',
    composerRef: RefObject<TipTapComposerRef | null>,
  ) => void;
  /** Callback when a model is selected for record mention - opens record picker */
  onRecordModelSelect?: (
    model: ModelInfo,
    composerRef: RefObject<TipTapComposerRef | null>,
  ) => void;
  /** Models available for record mentions */
  readableModels?: ModelInfo[];
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  /** When true, prevents empty comments from being auto-deleted on blur */
  isPickerActive?: boolean;
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
  if (
    !prevComment.upvoters.every(
      (u, i) => u.email === nextComment.upvoters[i].email,
    )
  )
    return false;
  if (!areRepliesEqual(prevComment.replies, nextComment.replies)) return false;

  return compareRemainingProps(prev, next);
}

// ctx excluded - recreated every render, only used in editing mode
function compareRemainingProps(
  prev: CommentProps,
  next: CommentProps,
): boolean {
  return (
    prev.currentUserId === next.currentUserId &&
    prev.isReply === next.isReply &&
    prev.canMentionFields === next.canMentionFields &&
    prev.fieldMentionsLoading === next.fieldMentionsLoading &&
    prev.fieldMentionsError === next.fieldMentionsError &&
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
    prev.onFieldMentionIntent === next.onFieldMentionIntent &&
    prev.onFieldMentionsRetry === next.onFieldMentionsRetry &&
    prev.onPickerRequest === next.onPickerRequest &&
    prev.onRecordModelSelect === next.onRecordModelSelect
  );
}

function CommentUpvoteButton({
  upvoterCount,
  userUpvoted,
  upvoterNames,
  onUpvote,
  styles: s,
}: {
  upvoterCount: number;
  userUpvoted: boolean;
  upvoterNames: string;
  onUpvote: () => void;
  styles: Record<string, string>;
}) {
  if (upvoterCount === 0) return null;

  return (
    <div className={s.reactionWrapper}>
      <button
        type="button"
        className={cn(s.reaction, userUpvoted && s.reactionActive)}
        onClick={onUpvote}
        aria-label={
          userUpvoted
            ? `Remove upvote from comment. ${upvoterCount} upvote${upvoterCount === 1 ? '' : 's'}`
            : `Upvote comment. ${upvoterCount} upvote${upvoterCount === 1 ? '' : 's'}`
        }
      >
        <UpvoteIcon aria-hidden="true" />
        <span>{upvoterCount}</span>
      </button>
      <div className={s.tooltip}>
        {upvoterNames}
        <div className={s.tooltipArrow} />
      </div>
    </div>
  );
}

function CommentReplyToggle({
  replyCount,
  repliesExpanded,
  uniqueReplierAvatars,
  onToggle,
  styles: s,
}: {
  replyCount: number;
  repliesExpanded: boolean;
  uniqueReplierAvatars: Array<{
    id: string;
    avatarUrl: string;
    name: string;
    fallbackUrl: string;
  }>;
  onToggle: () => void;
  styles: Record<string, string>;
}) {
  if (replyCount === 0) return null;

  return (
    <button
      type="button"
      className={s.replyToggle}
      onClick={onToggle}
      aria-expanded={repliesExpanded}
      aria-label={`${repliesExpanded ? 'Collapse' : 'Expand'} ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
    >
      <div className={s.replyAvatars}>
        {uniqueReplierAvatars.map((replier, idx) => (
          <img
            key={replier.id}
            src={replier.avatarUrl}
            alt={replier.name}
            className={s.replyAvatar}
            style={{ zIndex: UI.MAX_VISIBLE_REPLIER_AVATARS - idx }}
            onError={(e) => {
              const target = e.currentTarget;
              target.onerror = null;
              target.src = replier.fallbackUrl;
            }}
          />
        ))}
      </div>
      <div className={s.replyMeta}>
        <span className={s.replyText}>
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </span>
      </div>
      <ChevronDownIcon
        className={cn(s.chevron, repliesExpanded && s.chevronExpanded)}
        aria-hidden="true"
      />
    </button>
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
  fieldMentionsLoading = false,
  fieldMentionsError = null,
  onFieldMentionIntent,
  onFieldMentionsRetry,
  onPickerRequest,
  onRecordModelSelect,
  readableModels = [],
  canMentionAssets = false,
  canMentionModels = true,
  isPickerActive = false,
  dropdownPosition = 'below',
}: CommentProps) {
  const [isRecordSelectorOpen, setIsRecordSelectorOpen] = useState(false);
  const userUpvotedThisComment = commentObject.upvoters.some(
    (u) => u.id === currentUserId,
  );

  const isNewComment = isContentEmpty(commentObject.content);
  const isTopLevel = commentObject.parentCommentId == null;
  const parentId = isTopLevel ? undefined : commentObject.parentCommentId;
  const userIsAuthor = commentObject.author.id === currentUserId;

  const replies = isTopLevel ? (commentObject.replies ?? []) : [];
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
    [commentObject.upvoters],
  );

  const isSegmentsEmpty = useMemo(() => isContentEmpty(segments), [segments]);

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

      const fallbackUrl = getGravatarUrl(
        reply.author.email,
        UI.AVATAR_SIZE_THUMBNAIL,
      );

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

    const didSave = editComment(commentObject.id, segments, parentId);
    if (didSave) {
      setIsEditing(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await ctx.openConfirm({
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
  const repliesRef = useRef<HTMLDivElement>(null);
  const replyScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (replyScrollTimeoutRef.current) {
        clearTimeout(replyScrollTimeoutRef.current);
      }
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleReply = () => {
    setRepliesExpanded(true);
    replyComment(commentObject.id);

    // Scroll to ensure the new reply composer is visible
    // Uses setTimeout to wait for React to render the new reply
    if (replyScrollTimeoutRef.current) {
      clearTimeout(replyScrollTimeoutRef.current);
    }

    replyScrollTimeoutRef.current = setTimeout(() => {
      if (commentRef.current) {
        // Find the last reply element (the newly created one)
        const repliesContainer = repliesRef.current;
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
      replyScrollTimeoutRef.current = null;
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
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }

    blurTimeoutRef.current = setTimeout(() => {
      if (
        isSegmentsEmptyRef.current &&
        isNewCommentRef.current &&
        !isPickerActiveRef.current
      ) {
        // For empty new comments, just delete without confirmation
        deleteComment(commentObject.id, parentId);
      }
      blurTimeoutRef.current = null;
    }, TIMING.COMMENT_BLUR_DELAY_MS);
  };

  const toggleReplies = () => {
    setRepliesExpanded(!repliesExpanded);
  };

  const handleUserToolbarClick = useCallback(() => {
    composerRef.current?.triggerMentionType('user');
  }, [composerRef]);

  const handleFieldToolbarClick = useCallback(() => {
    composerRef.current?.triggerMentionType('field');
  }, [composerRef]);

  const handleModelToolbarClick = useCallback(() => {
    composerRef.current?.triggerMentionType('model');
  }, [composerRef]);

  const handleAssetToolbarClick = useCallback(() => {
    if (onPickerRequest) {
      onPickerRequest('asset', composerRef);
    }
  }, [onPickerRequest, composerRef]);

  const handleRecordToolbarClick = useCallback(() => {
    setIsRecordSelectorOpen(true);
  }, []);

  const handleRecordModelSelected = useCallback(
    (model: ModelInfo) => {
      setIsRecordSelectorOpen(false);
      if (onRecordModelSelect) {
        onRecordModelSelect(model, composerRef);
      }
    },
    [onRecordModelSelect, composerRef],
  );

  const handleRecordSelectorClose = useCallback(() => {
    setIsRecordSelectorOpen(false);
    composerRef.current?.focus();
  }, [composerRef]);

  return (
    <div
      ref={commentRef}
      className={cn(
        styles.comment,
        isReply && styles.reply,
        userIsAuthor && styles.ownComment,
      )}
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

      <div
        className={styles.commentBody}
        style={{ gridTemplateColumns: `${avatarSize}px 1fr` }}
      >
        <div className={styles.avatarContainer}>
          <img
            className={styles.avatar}
            src={avatarUrl}
            alt={authorName}
            style={{ width: avatarSize, height: avatarSize }}
            onError={(e) => {
              const target = e.currentTarget;
              target.onerror = null; // Prevent infinite loop
              target.src = getGravatarUrl(
                commentObject.author.email,
                avatarSize * 2,
              );
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
                  fieldMentionsLoading={fieldMentionsLoading}
                  fieldMentionsError={fieldMentionsError}
                  onFieldMentionIntent={onFieldMentionIntent}
                  onFieldMentionsRetry={onFieldMentionsRetry}
                  onAssetTrigger={handleAssetToolbarClick}
                  onRecordTrigger={handleRecordToolbarClick}
                  autoFocus
                  dropdownPosition={dropdownPosition}
                  ctx={ctx}
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
              <CommentContentRenderer segments={commentObject.content} />
            </div>
          )}

          <div className={styles.footer}>
            {!isEditing && (
              <CommentUpvoteButton
                upvoterCount={commentObject.upvoters.length}
                userUpvoted={userUpvotedThisComment}
                upvoterNames={upvoterNames}
                onUpvote={handleUpvote}
                styles={styles}
              />
            )}

            {isTopLevel && !isEditing && (
              <CommentReplyToggle
                replyCount={replyCount}
                repliesExpanded={repliesExpanded}
                uniqueReplierAvatars={uniqueReplierAvatars}
                onToggle={toggleReplies}
                styles={styles}
              />
            )}
          </div>
        </div>
      </div>

      {isTopLevel && replyCount > 0 && repliesExpanded && (
        <div ref={repliesRef} className={styles.replies}>
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
              fieldMentionsLoading={fieldMentionsLoading}
              fieldMentionsError={fieldMentionsError}
              onFieldMentionIntent={onFieldMentionIntent}
              onFieldMentionsRetry={onFieldMentionsRetry}
              onPickerRequest={onPickerRequest}
              onRecordModelSelect={onRecordModelSelect}
              readableModels={readableModels}
              canMentionAssets={canMentionAssets}
              canMentionModels={canMentionModels}
              isPickerActive={isPickerActive}
              dropdownPosition={dropdownPosition}
            />
          ))}
        </div>
      )}
    </div>
  );
}, arePropsEqual);

export default Comment;
