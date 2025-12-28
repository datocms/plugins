import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
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
import type { UserOverrides } from '@utils/pluginParams';
import {
  resolveUpvoterName,
  type TypedUserInfo,
} from '@utils/userDisplayResolver';

/**
 * Props for the Comment component.
 *
 * ARCHITECTURE NOTE: Permission flags (canMentionFields, canMentionAssets, canMentionModels)
 * are intentionally passed as props rather than using React context. While this creates
 * prop drilling through 3-4 component levels, this is a deliberate tradeoff because:
 *
 * 1. **Explicit data flow**: Props make the data requirements visible at each level,
 *    whereas context hides dependencies and makes components harder to understand.
 *
 * 2. **Component isolation**: Each Comment is self-contained with all its dependencies
 *    declared in its props, making testing and reuse straightforward.
 *
 * 3. **Performance**: React.memo with custom comparator (arePropsEqual) can efficiently
 *    skip re-renders by comparing these stable boolean props directly.
 *
 * 4. **Manageable depth**: 3-4 levels of prop passing is acceptable complexity.
 *    Context would be warranted if the depth reached 6+ levels or if props needed
 *    to skip intermediate components entirely.
 *
 * A CommentActionsContext was previously created but removed as dead code because
 * the explicit prop approach proved more maintainable for this component tree.
 */
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
  ctx?: RenderItemFormSidebarCtx;
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
  /** User overrides for custom names/avatars */
  userOverrides?: UserOverrides;
  /** Users with type information for override resolution */
  typedUsers?: TypedUserInfo[];
};

/**
 * Custom comparator for Comment component.
 * Performs targeted comparison on commentObject using efficient helpers.
 */
function arePropsEqual(prev: CommentProps, next: CommentProps): boolean {
  // Deep compare commentObject (the main data)
  const prevComment = prev.commentObject;
  const nextComment = next.commentObject;

  // Fast path: same reference
  if (prevComment === nextComment) {
    return compareRemainingProps(prev, next);
  }

  // Compare primitive fields (id is the unique identifier)
  if (prevComment.id !== nextComment.id) return false;

  // Compare content segments using efficient helper
  if (!areSegmentsEqual(prevComment.content, nextComment.content)) return false;

  // Compare upvoters using efficient helper
  if (!areUpvotersEqual(prevComment.usersWhoUpvoted, nextComment.usersWhoUpvoted)) return false;

  // Compare replies using efficient helper
  if (!areRepliesEqual(prevComment.replies, nextComment.replies)) return false;

  return compareRemainingProps(prev, next);
}

/**
 * Compare non-commentObject props.
 *
 * NOTE ON EXCLUDED PROPS:
 * -----------------------
 * `ctx` is intentionally EXCLUDED from this comparison for performance reasons.
 *
 * The DatoCMS plugin SDK's context object (`RenderItemFormSidebarCtx`) is
 * recreated on every render cycle from the parent. Including it would cause
 * this comparator to always return false, defeating memoization entirely.
 *
 * Why this is safe:
 * 1. `ctx` is only used when `isEditing` is true (inside TipTapComposer)
 * 2. When editing, state changes already trigger re-renders
 * 3. The relevant ctx properties (user info, permissions) are passed as
 *    separate props which ARE compared
 * 4. Most Comment instances don't receive ctx at all (dashboard context)
 *
 * If ctx-dependent behavior outside of editing is ever added, revisit this.
 */
function compareRemainingProps(prev: CommentProps, next: CommentProps): boolean {
  return (
    prev.currentUserEmail === next.currentUserEmail &&
    prev.isReply === next.isReply &&
    prev.canMentionFields === next.canMentionFields &&
    prev.canMentionAssets === next.canMentionAssets &&
    prev.canMentionModels === next.canMentionModels &&
    prev.isPickerActive === next.isPickerActive &&
    /**
     * ARRAY REFERENCE STABILITY CONTRACT:
     * These arrays are compared by reference, which requires the parent to provide
     * stable references. This contract IS fulfilled by useProjectData.ts which
     * memoizes all three arrays:
     * - stableProjectUsers (line ~217-253)
     * - stableModelFields (line ~260-263)
     * - projectModels (line ~77-86)
     *
     * DO NOT change these to deep equality checks - reference equality is
     * intentional for performance. If memoization breaks in useProjectData,
     * fix it there rather than adding expensive deep comparisons here.
     */
    prev.modelFields === next.modelFields &&
    prev.projectUsers === next.projectUsers &&
    prev.projectModels === next.projectModels &&
    // Callbacks compared by reference (rely on useCallback stability)
    prev.deleteComment === next.deleteComment &&
    prev.editComment === next.editComment &&
    prev.upvoteComment === next.upvoteComment &&
    prev.replyComment === next.replyComment &&
    prev.onPickerRequest === next.onPickerRequest
    // NOTE: ctx is intentionally excluded - see comment above
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
  userOverrides,
  typedUsers = [],
}: CommentProps) {
  // Check if the current user has upvoted this comment
  const userUpvotedThisComment = commentObject.usersWhoUpvoted.some(
    (upvoter) => upvoter.email === currentUserEmail
  );

  // Check if this is a new comment (empty content)
  const isNewComment = isContentEmpty(commentObject.content);
  const isTopLevel = 'replies' in commentObject;
  const userIsAuthor = commentObject.author.email === currentUserEmail;

  const replies = isTopLevel ? commentObject.replies ?? [] : [];
  const replyCount = replies.length;
  const hasNewReply = replies.some((r) => isContentEmpty(r.content));

  const avatarSize = isReply ? 24 : 32;

  /**
   * PERFORMANCE OPTIMIZATION: User lookup Maps for O(1) resolution.
   *
   * Previously, resolving author/reply avatars used O(n) linear searches through
   * typedUsers for each comment. With 100 comments and 50 users, this caused
   * 5000+ iterations per render cycle.
   *
   * These Maps provide O(1) lookups by indexing users by email and name.
   * The Maps are only rebuilt when typedUsers changes (stable reference from parent).
   */
  const userLookupMaps = useMemo(() => {
    const byEmail = new Map<string, number>();
    const byName = new Map<string, number>();

    for (let i = 0; i < typedUsers.length; i++) {
      const user = typedUsers[i].user;
      const email = user.email?.toLowerCase().trim();
      const name = user.name?.toLowerCase().trim();

      // Email lookup takes priority - only set if not already present
      if (email && !byEmail.has(email)) {
        byEmail.set(email, i);
      }
      // Name lookup as fallback for SSO users without email
      if (name && !byName.has(name)) {
        byName.set(name, i);
      }
    }

    return { byEmail, byName };
  }, [typedUsers]);

  // Resolve author display with overrides
  // Match against ORIGINAL user info (typedUsers), then get overridden info from projectUsers
  // This is needed because projectUsers may have overridden names that don't match the comment author name
  const resolvedAuthor = useMemo(() => {
    const fallbackAvatarUrl = getGravatarUrl(commentObject.author.email || '', avatarSize * 2);
    const authorEmail = commentObject.author.email?.toLowerCase().trim();
    const authorNameLower = commentObject.author.name?.toLowerCase().trim();

    // O(1) lookup using Maps instead of O(n) linear search
    let matchedIndex = -1;
    if (authorEmail) {
      matchedIndex = userLookupMaps.byEmail.get(authorEmail) ?? -1;
    }
    if (matchedIndex === -1 && authorNameLower) {
      matchedIndex = userLookupMaps.byName.get(authorNameLower) ?? -1;
    }

    if (matchedIndex !== -1 && matchedIndex < projectUsers.length) {
      // Use the user from projectUsers which has overrides applied
      const userWithOverrides = projectUsers[matchedIndex];
      return {
        name: userWithOverrides.name,
        avatarUrl: userWithOverrides.avatarUrl ?? fallbackAvatarUrl,
      };
    }

    // No match - use original author info
    return {
      name: commentObject.author.name,
      avatarUrl: fallbackAvatarUrl,
    };
  }, [commentObject.author, projectUsers, userLookupMaps, avatarSize]);

  const avatarUrl = resolvedAuthor.avatarUrl;
  const authorName = resolvedAuthor.name;

  // State
  const [repliesExpanded, setRepliesExpanded] = useState(false);

  // Ref to track picker state for blur handler (avoids stale closure issue)
  // Update synchronously during render to avoid any gaps
  const isPickerActiveRef = useRef(isPickerActive);
  isPickerActiveRef.current = isPickerActive;

  // Comment editor hook
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

  // Auto-expand when a new reply is being composed
  useEffect(() => {
    if (hasNewReply && !repliesExpanded) {
      setRepliesExpanded(true);
    }
  }, [hasNewReply, repliesExpanded]);

  /**
   * Memoized upvoter names for tooltip display.
   * Uses overrides if available, falling back to original name or email.
   */
  const upvoterNames = useMemo(
    () =>
      commentObject.usersWhoUpvoted
        .map((upvoter) => resolveUpvoterName(upvoter, typedUsers, userOverrides))
        .join(', '),
    [commentObject.usersWhoUpvoted, typedUsers, userOverrides]
  );

  // Check if segments are empty (memoized to prevent recalculation on unrelated state changes)
  const isSegmentsEmpty = useMemo(
    () => isComposerEmpty(segments),
    [segments]
  );

  const handleSave = () => {
    if (isSegmentsEmpty) {
      // If empty, delete the comment
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

  /**
   * Handles comment deletion.
   *
   * DESIGN DECISION: No confirmation dialog is shown before deletion.
   *
   * This was an intentional UX tradeoff made for the following reasons:
   *
   * 1. **Undo capability via queue**: The comment operation queue provides implicit
   *    recovery - if a delete fails, the comment reappears. While not a true "undo",
   *    it prevents accidental data loss from network issues.
   *
   * 2. **Friction vs. flow**: Confirmation dialogs interrupt the user's workflow.
   *    For a commenting system used frequently, this friction compounds. Slack,
   *    for example, also deletes messages without confirmation.
   *
   * 3. **Visual feedback**: The comment disappears immediately (optimistic UI),
   *    giving users instant feedback that their action was registered.
   *
   * 4. **Implementation complexity**: Adding a confirmation modal would require:
   *    - A new ConfirmationModal component (or using DatoCMS's ctx.openConfirm)
   *    - Async state management for the confirmation flow
   *    - Focus management for accessibility
   *    - Integration with the picker state to avoid conflicts
   *
   * FUTURE CONSIDERATION: If user feedback indicates accidental deletions are
   * a problem, consider:
   * - Using ctx.openConfirm() from the DatoCMS SDK (simpler)
   * - Adding a "toast with undo" pattern (better UX than confirmation)
   * - Only confirming deletion for comments with replies (higher stakes)
   *
   * DO NOT add a confirmation dialog without first gathering user feedback
   * indicating this is a real problem, as it adds friction for all users
   * to solve a problem that may affect few.
   */
  const handleDelete = () => {
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

  const handleReply = () => {
    setRepliesExpanded(true);
    replyComment(commentObject.id);
  };

  const handleEscape = () => {
    if (isNewComment) {
      // New comment, delete it
      handleDelete();
    } else {
      // Existing comment, cancel edit
      resetToOriginal();
    }
  };

  /**
   * Handles composer blur - auto-deletes empty new replies.
   *
   * UX DESIGN DECISION: 150ms DELAY FOR AUTO-DELETE
   * ------------------------------------------------
   * The 150ms delay exists to allow button clicks to register before the blur
   * event fires. This is necessary because clicking toolbar buttons triggers
   * blur first, then click.
   *
   * KEYBOARD USER CONSIDERATION:
   * It was suggested that keyboard users tabbing away might accidentally lose
   * their reply composer. However, this matches the behavior of popular apps:
   *
   * 1. SLACK PATTERN: Slack also auto-closes empty message drafts when you
   *    navigate away. Users expect ephemeral "start typing" states to disappear.
   *
   * 2. EXPLICIT INTENT: If a user opens a reply, types nothing, and tabs away,
   *    they likely didn't intend to reply. Keeping an empty composer would
   *    clutter the UI.
   *
   * 3. NO DATA LOSS: Only EMPTY composers are auto-deleted. If the user typed
   *    anything, the composer persists. The 150ms window also allows for
   *    accidental clicks/tabs to be recovered with a quick refocus.
   *
   * 4. ALTERNATIVES CONSIDERED:
   *    - Longer delay (500ms+): Makes UI feel sluggish when intentionally closing
   *    - Toast notification: Adds noise for expected behavior
   *    - Confirmation dialog: Too heavy for an empty composer
   *
   * DO NOT extend the delay or add confirmation without clear user feedback
   * indicating this is a real problem. The current behavior is intentional.
   */
  const handleBlur = () => {
    // Small delay to allow button clicks to register
    setTimeout(() => {
      // Don't auto-delete if a picker (asset/record) is active
      // Use ref to get current value (avoids stale closure from when blur was triggered)
      if (isSegmentsEmpty && isNewComment && !isPickerActiveRef.current) {
        handleDelete();
      }
    }, 150);
  };

  const toggleReplies = () => {
    setRepliesExpanded(!repliesExpanded);

    // ACCESSIBILITY CONSIDERATION: Focus management on reply expansion
    // ----------------------------------------------------------------
    // Moving focus to the first reply when expanding could be added here,
    // but was intentionally omitted after analysis:
    //
    // PROS of auto-focusing first reply:
    // - Keyboard users can immediately navigate replies
    // - Screen reader users get context about expanded content
    //
    // CONS of auto-focusing first reply:
    // - Unexpected focus movement can disorient users
    // - Users clicking to expand might not want focus to move
    // - Breaks the common UI pattern where expand/collapse doesn't move focus
    // - Could interfere with users who expand multiple reply threads
    //
    // CURRENT BEHAVIOR: Focus stays on the toggle button after expanding.
    // This is consistent with most expand/collapse UI patterns (accordions, trees).
    // Users who want to navigate replies can Tab to them after expanding.
    //
    // If focus management is needed in the future, implement it via:
    // 1. Add a ref to the replies container: const repliesRef = useRef<HTMLDivElement>(null)
    // 2. When expanding, focus the first reply: repliesRef.current?.querySelector('button')?.focus()
    // 3. Consider adding aria-live="polite" to announce the expansion
  };

  // Toolbar handlers - insert trigger characters to activate mention dropdowns
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
    <div className={cn(styles.comment, isReply && styles.reply, userIsAuthor && styles.ownComment)}>
      {/* Hover Actions */}
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

      {/* Comment body */}
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
          {/* Header */}
          <div className={styles.header}>
            <span className={styles.authorName}>{authorName}</span>
            <span className={styles.timestamp}>
              <ReactTimeAgo date={new Date(commentObject.dateISO)} />
            </span>
          </div>

          {/* Content or Editor */}
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
                  onAssetTrigger={handleAssetToolbarClick}
                  onRecordTrigger={handleRecordToolbarClick}
                  autoFocus
                  ctx={ctx}
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

          {/* Footer */}
          <div className={styles.footer}>
            {/* Reactions / Upvotes */}
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

            {/* Reply count toggle */}
            {isTopLevel && replyCount > 0 && !isEditing && (
              <button
                type="button"
                className={styles.replyToggle}
                onClick={toggleReplies}
                aria-expanded={repliesExpanded}
                aria-label={`${repliesExpanded ? 'Collapse' : 'Expand'} ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
              >
                {/* Stacked avatars of repliers */}
                <div className={styles.replyAvatars}>
                  {replies.slice(0, 3).map((reply, idx) => {
                    const fallbackUrl = getGravatarUrl(reply.author.email || '', 40);
                    const replyEmail = reply.author.email?.toLowerCase().trim();
                    const replyNameLower = reply.author.name?.toLowerCase().trim();

                    // O(1) lookup using Maps (same optimization as resolvedAuthor)
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
                  })}
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

      {/* Collapsible Replies */}
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
              userOverrides={userOverrides}
              typedUsers={typedUsers}
            />
          ))}
        </div>
      )}
    </div>
  );
}, arePropsEqual);

export default Comment;
