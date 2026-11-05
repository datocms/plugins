import type { ResolvedCommentType } from '@ctypes/comments';
import { isContentEmpty } from '@ctypes/comments';
// Types and utilities
import type { CommentSegment, StoredCommentSegment } from '@ctypes/mentions';
import { useCommentEditor } from '@hooks/useCommentEditor';
// Hooks
import type { FieldInfo, ModelInfo, UserInfo } from '@hooks/useMentions';
import { getAvatarImage } from '@utils/avatarImage';
import {
  areRepliesEqual,
  areSegmentsEqual,
  areStoredSegmentsEqual,
} from '@utils/comparisonHelpers';
import { getRecordMentionModels } from '@utils/permissions';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import Avatar, {
  AVATAR_SIZE_IN_PIXELS,
  type AvatarSize,
} from 'datocms-react-ui/Avatar';
import Button from 'datocms-react-ui/Button';
import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import RawButton from 'datocms-react-ui/RawButton';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  type CSSProperties,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TIMING, UI } from '@/constants';
import { formatCount, formatNumber } from '@/utils/format';
import { normalizeForComparison } from '@/utils/helpers';
import styles from './Comment.module.css';
import CommentActions from './CommentActions';
// Components
import CommentContentRenderer from './CommentContentRenderer';
import {
  CommentComposer,
  type CommentComposerVariant,
} from './composer/CommentComposer';
import { ReplyIcon, UpvoteIcon } from './Icons';
import { LoadMoreButton } from './shared/LoadMoreButton';
import { RelativeTime } from './shared/RelativeTime';
import type { TipTapComposerRef } from './tiptap/TipTapComposer';

type CommentProps = {
  deleteComment: (id: string, parentCommentId?: string) => boolean;
  editComment: (
    id: string,
    newContent: CommentSegment[],
    parentCommentId?: string,
    expectedContent?: StoredCommentSegment[],
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
  /** The collaborators did not load yet */
  usersLoading?: boolean;
  /** The collaborators did not load */
  usersLoadFailed?: boolean;
  onUsersRetry?: () => void;
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
  if (
    !areStoredSegmentsEqual(
      prevComment.storedContent,
      nextComment.storedContent,
    )
  )
    return false;
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
    prev.usersLoading === next.usersLoading &&
    prev.usersLoadFailed === next.usersLoadFailed &&
    prev.onUsersRetry === next.onUsersRetry &&
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

type Replier = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  removed?: boolean;
};

/**
 * The name that gives the initials of an avatar. A person who left the
 * project has none: the avatar shows a person on a neutral surface, not the
 * initials of "Removed collaborator".
 */
function avatarName(person: { name: string; removed?: boolean }): string {
  return person.removed ? '' : person.name;
}

/** Who upvoted, for the tooltip: "You" first, then the others */
function formatUpvoterNames(
  upvoters: { id: string; name: string }[],
  currentUserId: string,
): string {
  const others = upvoters
    .filter((upvoter) => upvoter.id !== currentUserId)
    .map((upvoter) => upvoter.name);
  const names = others.length < upvoters.length ? ['You', ...others] : others;
  return names.join(', ');
}

/** The text of the delete confirm: the replies of a comment go with it */
function getDeleteConfirmContent(replyCount: number, locale: string): string {
  if (replyCount === 0) return 'This cannot be undone.';
  const replies =
    replyCount === 1
      ? 'Its reply is'
      : `Its ${formatCount(replyCount, 'reply', 'replies', locale)} are`;
  return `${replies} deleted too. This cannot be undone.`;
}

/**
 * The upvote of a comment. Without upvotes it is a quiet icon; with some, it
 * has the count, and who upvoted in the tooltip.
 */
function CommentUpvoteButton({
  upvoterCount,
  userUpvoted,
  upvoterNames,
  onUpvote,
  locale,
}: {
  upvoterCount: number;
  userUpvoted: boolean;
  upvoterNames: string;
  onUpvote: () => void;
  locale: string;
}) {
  if (upvoterCount === 0) {
    return (
      <Button
        tone="ghost"
        size="micro"
        iconOnly
        icon={UpvoteIcon}
        label="Upvote"
        pressed={false}
        onClick={onUpvote}
      />
    );
  }

  return (
    <Tooltip label={upvoterNames}>
      <Button
        tone="ghost"
        icon={UpvoteIcon}
        pressed={userUpvoted}
        label={
          <>
            {formatNumber(upvoterCount, locale)}
            <span className="visually-hidden">
              {upvoterCount === 1 ? ' upvote' : ' upvotes'}
            </span>
          </>
        }
        onClick={onUpvote}
      />
    </Tooltip>
  );
}

/** Opens and closes the replies, with the faces of the first repliers */
function CommentReplyToggle({
  replyCount,
  repliesExpanded,
  repliesId,
  uniqueRepliers,
  onToggle,
  locale,
}: {
  replyCount: number;
  repliesExpanded: boolean;
  repliesId: string;
  uniqueRepliers: Replier[];
  onToggle: () => void;
  locale: string;
}) {
  if (replyCount === 0) return null;

  return (
    <RawButton
      className={styles.repliesToggle}
      expandable={{ open: repliesExpanded, controls: repliesId }}
      onClick={onToggle}
    >
      <DisclosureChevron open={repliesExpanded} />
      <span className={styles.repliers}>
        {uniqueRepliers.map((replier) => (
          <Avatar
            key={replier.id}
            size="small"
            name={avatarName(replier)}
            email={replier.email || null}
            {...getAvatarImage(replier)}
          />
        ))}
      </span>
      {formatCount(replyCount, 'reply', 'replies', locale)}
    </RawButton>
  );
}

/**
 * Under the text: the upvote, Reply (a reply has no replies of its own) and
 * the replies toggle, always in sight
 */
function CommentFooter({
  upvoterCount,
  userUpvoted,
  upvoterNames,
  onUpvote,
  onReply,
  replyCount,
  repliesExpanded,
  repliesId,
  uniqueRepliers,
  onToggleReplies,
  locale,
}: {
  upvoterCount: number;
  userUpvoted: boolean;
  upvoterNames: string;
  onUpvote: () => void;
  /** Only on a comment of the record, not on a reply */
  onReply?: () => void;
  replyCount: number;
  repliesExpanded: boolean;
  repliesId: string;
  uniqueRepliers: Replier[];
  onToggleReplies: () => void;
  /** The language of the user, for the separators of the counts */
  locale: string;
}) {
  return (
    <div className={styles.footer}>
      <CommentUpvoteButton
        upvoterCount={upvoterCount}
        userUpvoted={userUpvoted}
        upvoterNames={upvoterNames}
        onUpvote={onUpvote}
        locale={locale}
      />
      {onReply && (
        <Button tone="ghost" icon={ReplyIcon} label="Reply" onClick={onReply} />
      )}
      <CommentReplyToggle
        replyCount={replyCount}
        repliesExpanded={repliesExpanded}
        repliesId={repliesId}
        uniqueRepliers={uniqueRepliers}
        onToggle={onToggleReplies}
        locale={locale}
      />
    </div>
  );
}

/** The side of the avatar, for the CSS that lines the replies up with it */
function avatarSizeStyle(size: AvatarSize): CSSProperties {
  return {
    '--comment-avatar-size': `${AVATAR_SIZE_IN_PIXELS[size]}px`,
  } as CSSProperties;
}

/**
 * The composer of the edit mode: a draft reply, or the change of a comment.
 * The reason tells why it cannot be saved yet (null when it can).
 */
function getEditComposer(
  isNewReply: boolean,
  isEmpty: boolean,
): { variant: CommentComposerVariant; disabledReason: string | null } {
  if (isNewReply) {
    return {
      variant: 'reply',
      disabledReason: isEmpty ? 'Write a reply first.' : null,
    };
  }
  return {
    variant: 'edit',
    disabledReason: isEmpty ? 'Write a comment first.' : null,
  };
}

function LoadMoreReplies({
  hiddenCount,
  onLoadMore,
}: {
  hiddenCount: number;
  onLoadMore: () => void;
}) {
  if (hiddenCount === 0) return null;
  return <LoadMoreButton label="Load more replies" onClick={onLoadMore} />;
}

/**
 * The replies of a comment. The toggle of the comment controls this block,
 * thus it is always in the page (hidden while closed); the replies render
 * only while it is open.
 */
function CommentReplies({
  id,
  open,
  listRef,
  hiddenCount,
  onLoadMore,
  children,
}: {
  id: string;
  open: boolean;
  listRef: RefObject<HTMLUListElement | null>;
  hiddenCount: number;
  onLoadMore: () => void;
  /** The replies, one list item each */
  children: ReactNode;
}) {
  return (
    <div id={id} className={styles.replies} hidden={!open}>
      {open && (
        <>
          <LoadMoreReplies hiddenCount={hiddenCount} onLoadMore={onLoadMore} />
          <ul ref={listRef} aria-label="Replies" className={styles.replyList}>
            {children}
          </ul>
        </>
      )}
    </div>
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
  usersLoading = false,
  usersLoadFailed = false,
  onUsersRetry,
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
  // A draft reply is not a reply yet: the count and the faces leave it out
  const sentReplies = replies.filter((r) => !isContentEmpty(r.content));
  const replyCount = sentReplies.length;
  const hasNewReply = sentReplies.length < replies.length;
  const [hiddenReplyIds, setHiddenReplyIds] = useState(() =>
    replies.slice(100).map((reply) => reply.id),
  );
  const hiddenReplyIdSet = useMemo(
    () => new Set(hiddenReplyIds),
    [hiddenReplyIds],
  );
  const hiddenReplies = replies.filter(
    (reply) => hiddenReplyIdSet.has(reply.id) && !isContentEmpty(reply.content),
  );
  const effectiveHiddenReplyCount = hiddenReplies.length;
  const visibleReplies = replies.filter(
    (reply) => !hiddenReplyIdSet.has(reply.id) || isContentEmpty(reply.content),
  );

  // Author data is pre-resolved
  const { author } = commentObject;
  const avatarSize: AvatarSize = isReply ? 'small' : 'regular';
  const authorName = author.name;
  const repliesId = useId();

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
    editBaselineContent,
    setSegments,
    composerRef,
    handleStartEditing,
    resetToOriginal,
  } = useCommentEditor({
    commentContent: commentObject.content,
    storedCommentContent: commentObject.storedContent,
    isNewComment,
  });

  useEffect(() => {
    if (hasNewReply && !repliesExpanded) {
      setRepliesExpanded(true);
    }
  }, [hasNewReply, repliesExpanded]);

  // Upvoter names are pre-resolved
  const upvoterNames = useMemo(
    () => formatUpvoterNames(commentObject.upvoters, currentUserId),
    [commentObject.upvoters, currentUserId],
  );

  const isSegmentsEmpty = useMemo(() => isContentEmpty(segments), [segments]);

  // Extract unique repliers for collapsed reply preview (max 3 avatars)
  // Reply authors are pre-resolved
  const uniqueRepliers = useMemo(() => {
    if (!isTopLevel || replies.length === 0) return [];

    const seenUsers = new Set<string>();
    const result: Replier[] = [];

    for (const reply of replies) {
      if (isContentEmpty(reply.content)) continue;
      const userKey = normalizeForComparison(reply.author.email) || reply.id;

      if (seenUsers.has(userKey)) continue;
      seenUsers.add(userKey);

      result.push({
        id: reply.id,
        name: reply.author.name,
        email: reply.author.email,
        avatarUrl: reply.author.avatarUrl,
        removed: reply.author.removed,
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

    const didSave = editComment(
      commentObject.id,
      segments,
      parentId,
      editBaselineContent,
    );
    if (didSave) {
      setIsEditing(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await ctx.openConfirm({
      title: 'Delete this comment?',
      content: getDeleteConfirmContent(replyCount, ctx.ui.locale),
      choices: [{ label: 'Delete', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });

    if (!confirmed) return;

    deleteComment(commentObject.id, parentId);
  };

  const handleUpvote = () => {
    upvoteComment(commentObject.id, userUpvotedThisComment, parentId);
  };

  const commentRef = useRef<HTMLElement>(null);
  const repliesRef = useRef<HTMLUListElement>(null);
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
        // Replies can be prepended; scroll to their draft instead of an old reply.
        const repliesContainer = repliesRef.current;
        if (repliesContainer) {
          const newReply =
            repliesContainer.querySelector('[data-comment-draft="true"]') ??
            repliesContainer.lastElementChild;
          if (newReply) {
            newReply.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  // A record mention applies only with a model whose records the user can
  // read: the same rule as the record mention of the toolbar
  const hasReadableModels = getRecordMentionModels(readableModels).length > 0;
  const editComposer = getEditComposer(isNewComment, isSegmentsEmpty);

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

  // The model panel of /record shows only when the user can read a model:
  // without one, a record mention does not apply here
  const handleRecordTrigger = useCallback(() => {
    if (!hasReadableModels) return;
    setIsRecordSelectorOpen(true);
  }, [hasReadableModels]);

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
    <article
      ref={commentRef}
      className={styles.comment}
      style={avatarSizeStyle(avatarSize)}
      data-comment-id={commentObject.id}
      data-comment-draft={isNewComment ? 'true' : undefined}
    >
      <Avatar
        size={avatarSize}
        name={avatarName(author)}
        email={author.email || null}
        {...getAvatarImage(author)}
      />

      <div className={styles.main}>
        <div className={styles.header}>
          <span className={styles.author}>{authorName}</span>
          {/* A draft has no time: nothing is sent yet */}
          {!isNewComment && (
            <RelativeTime
              className={styles.time}
              value={commentObject.dateISO}
            />
          )}
          {!isEditing && userIsAuthor && (
            <div className={styles.actions}>
              <CommentActions
                onEdit={handleStartEditing}
                onDelete={handleDelete}
              />
            </div>
          )}
        </div>

        {isEditing ? (
          <CommentComposer
            variant={editComposer.variant}
            composerRef={composerRef}
            segments={segments}
            onSegmentsChange={setSegments}
            onSubmit={handleSave}
            onCancel={handleEscape}
            onBlur={handleBlur}
            projectUsers={projectUsers}
            usersLoading={usersLoading}
            usersLoadFailed={usersLoadFailed}
            onUsersRetry={onUsersRetry}
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
            onRecordTrigger={handleRecordTrigger}
            autoFocus
            dropdownPosition={dropdownPosition}
            ctx={ctx}
            onUserClick={handleUserToolbarClick}
            onFieldClick={handleFieldToolbarClick}
            // Assets need the picker of the sidebar
            onAssetClick={onPickerRequest && handleAssetToolbarClick}
            onModelClick={handleModelToolbarClick}
            readableModels={readableModels}
            onRecordModelSelect={handleRecordModelSelected}
            isRecordModelSelectorOpen={
              isRecordSelectorOpen && hasReadableModels
            }
            onRecordModelSelectorClose={handleRecordSelectorClose}
            busy={isPickerActive}
            submitDisabledReason={editComposer.disabledReason}
          />
        ) : (
          <div className={styles.text}>
            <CommentContentRenderer segments={commentObject.content} />
          </div>
        )}

        {!isEditing && (
          <CommentFooter
            upvoterCount={commentObject.upvoters.length}
            userUpvoted={userUpvotedThisComment}
            upvoterNames={upvoterNames}
            onUpvote={handleUpvote}
            onReply={isTopLevel ? handleReply : undefined}
            replyCount={replyCount}
            repliesExpanded={repliesExpanded}
            repliesId={repliesId}
            uniqueRepliers={uniqueRepliers}
            onToggleReplies={toggleReplies}
            locale={ctx.ui.locale}
          />
        )}
      </div>

      {replies.length > 0 && (
        <CommentReplies
          id={repliesId}
          open={repliesExpanded}
          listRef={repliesRef}
          hiddenCount={effectiveHiddenReplyCount}
          onLoadMore={() =>
            setHiddenReplyIds(hiddenReplies.slice(100).map((reply) => reply.id))
          }
        >
          {visibleReplies.map((reply) => (
            <li key={reply.id}>
              <Comment
                deleteComment={deleteComment}
                editComment={editComment}
                upvoteComment={upvoteComment}
                replyComment={replyComment}
                commentObject={reply}
                currentUserId={currentUserId}
                isReply
                modelFields={modelFields}
                projectUsers={projectUsers}
                usersLoading={usersLoading}
                usersLoadFailed={usersLoadFailed}
                onUsersRetry={onUsersRetry}
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
            </li>
          ))}
        </CommentReplies>
      )}
    </article>
  );
}, arePropsEqual);

export default Comment;
