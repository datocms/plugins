import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

// Components
import RecordModelSelectorDropdown from '@components/RecordModelSelectorDropdown';
import ComposerToolbar from '@components/ComposerToolbar';
import CommentsList from '@components/CommentsList';
import SyncStatusIndicator from '@components/shared/SyncStatusIndicator';
import { CommentErrorBoundary } from '@components/shared/CommentErrorBoundary';
import { TipTapComposer, type TipTapComposerRef } from '@components/tiptap/TipTapComposer';

// Hooks
import { useOperationQueue } from '@hooks/useOperationQueue';
import { useProjectData } from '@hooks/useProjectData';
import { useToolbarHandlers } from '@hooks/useToolbarHandlers';
import { useCommentsData } from '@hooks/useCommentsData';
import { useCommentActions } from '@hooks/useCommentActions';
import { useMentionPermissions } from '@hooks/useMentionPermissions';

// Contexts
// SidebarNavigationProvider is already wrapped in main.tsx, no need to import here
import { ProjectDataProvider } from './contexts/ProjectDataContext';
import { MentionPermissionsProvider } from './contexts/MentionPermissionsContext';

// Types and utilities
import type { CommentSegment } from '@ctypes/mentions';
import { getCurrentUserInfo } from '@utils/userTransformers';
import { createApiClient } from '@utils/apiClient';
import { createRecordMention } from '@utils/recordPickerHelpers';
import { insertMentionWithRetry } from '@utils/textareaUtils';
import { isComposerEmpty, createAssetMention } from '@utils/composerHelpers';
import { parsePluginParams } from '@utils/pluginParams';
import { findCommentsModel } from '@utils/itemTypeUtils';
import { SUBSCRIPTION_STATUS } from '@hooks/useCommentsSubscription';
import { COMMENTS_PAGE_SIZE, ERROR_MESSAGES } from '@/constants';
import { logError, logWarn } from '@/utils/errorLogger';
import { categorizeGeneralError } from '@utils/errorCategorization';
import styles from '@styles/commentbar.module.css';

// Re-export types for use by other components
export type { UserInfo, FieldInfo, ModelInfo } from '@hooks/useMentions';
export type { CommentSegment, Mention } from '@ctypes/mentions';
export type { CommentType, Upvoter } from '@ctypes/comments';

/**
 * Props for the CommentsBar sidebar component.
 *
 * ARCHITECTURE NOTE: DATA FLOW PATTERN
 *
 * This component fetches project data (users, models, fields) using hooks and passes
 * it down as props, while GlobalCommentsChannel wraps with context providers. This
 * asymmetry is intentional and documented here:
 *
 * WHY COMMENTSBAR USES PROPS:
 * 1. CommentsBar is a single-entry-point component that owns all state
 * 2. The component tree is shallow (max 3-4 levels to Comment)
 * 3. Props make data flow explicit and easier to trace
 * 4. Matches the existing pattern in Comment.tsx (see its ARCHITECTURE NOTE)
 *
 * WHY GLOBALCOMMENTSCHANNEL USES CONTEXTS:
 * 1. Dashboard has multiple sibling components that need the same data
 * 2. Contexts avoid prop drilling across parallel component trees
 * 3. Dashboard is a full page with more complex layout structure
 *
 * CONSOLIDATION NOT RECOMMENDED:
 * - Forcing both to use contexts would hide data dependencies in CommentsBar
 * - Forcing both to use props would require prop drilling in Dashboard's parallel trees
 * - The current approach optimizes each entry point for its specific structure
 *
 * See Comment.tsx for the detailed rationale on props vs contexts for the Comment tree.
 *
 * ============================================================================
 * ARCHITECTURAL INCONSISTENCY: PICKER LOGIC
 * ============================================================================
 * CommentsBar has inline picker logic for asset/record mentions (~150 lines),
 * while GlobalCommentsChannel extracts this to hooks (usePageAssetMention,
 * usePageRecordMention).
 *
 * WHY THIS INCONSISTENCY EXISTS:
 * - GlobalCommentsChannel was implemented later with extracted hooks
 * - CommentsBar's inline logic works correctly and is well-tested
 * - The picker logic differs subtly between contexts (sidebar vs page)
 *
 * WHY NOT REFACTOR TO CONSOLIDATE:
 * 1. HIGH RISK, LOW REWARD: The inline logic works; extracting it risks regressions
 * 2. CONTEXT DIFFERENCES: CommentsBar uses ctx.loadItemTypeFields (sidebar context),
 *    GlobalCommentsChannel uses preloaded context data - different APIs
 * 3. TESTING BURDEN: Both paths would need extensive retesting after refactor
 * 4. CODE SIZE: ~150 lines is manageable inline; not worth abstraction overhead
 *
 * FUTURE GUIDANCE:
 * - If picker logic needs significant changes, consider extracting to shared hooks
 * - For bug fixes, apply to both locations with careful testing
 * - Do not attempt to unify without a strong functional reason
 * ============================================================================
 */
type Props = {
  ctx: RenderItemFormSidebarCtx;
};

const CommentsBar = ({ ctx }: Props) => {
  const { email: userEmail, name: userName } = getCurrentUserInfo(ctx.currentUser);

  // Composer state - now uses segments directly
  const [composerSegments, setComposerSegments] = useState<CommentSegment[]>([]);
  const composerRef = useRef<TipTapComposerRef>(null);
  const pendingNewReplies = useRef(new Set<string>());

  // Record model selector state (for & mentions)
  const [isRecordModelSelectorOpen, setIsRecordModelSelectorOpen] = useState(false);

  // Track when any picker operation is in progress (prevents blur deletion of replies)
  const [isPickerInProgress, setIsPickerInProgress] = useState(false);

  // Pagination state - track how many old comments to hide
  // This ensures new comments (prepended at index 0) are always visible
  const [hiddenOldCount, setHiddenOldCount] = useState<number | null>(null);

  // Plugin configuration
  const cmaToken = ctx.currentUserAccessToken;
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
  const realTimeEnabled = pluginParams.realTimeUpdatesEnabled ?? true;
  const cdaToken = pluginParams.cdaToken;

  // API client
  const client = useMemo(() => createApiClient(cmaToken), [cmaToken]);

  // Load project data (users, models, fields)
  // Pass client for avatar URL caching from user overrides
  const { projectUsers, projectModels, modelFields, userOverrides, typedUsers } = useProjectData(ctx, { loadFields: true, client });

  // Compute mention permissions based on user role
  const { canMentionAssets, canMentionModels, readableModels } = useMentionPermissions(
    ctx,
    projectModels
  );

  // Compute commentsModelId early so useOperationQueue can use it
  const commentsModelId = useMemo(() => {
    const model = findCommentsModel(ctx.itemTypes);
    return model?.id ?? null;
  }, [ctx.itemTypes]);

  /**
   * State for commentRecordId - managed here as single source of truth.
   *
   * ============================================================================
   * RACE CONDITION ANALYSIS - MULTIPLE UPDATE SOURCES
   * ============================================================================
   *
   * This state is updated from two async sources:
   * 1. useCommentsData subscription - when it discovers an existing comment record
   * 2. useOperationQueue - when it creates a new record for the first comment
   *
   * CONCERN: "Both callbacks could fire simultaneously, causing inconsistent state"
   * ANALYSIS: This is protected by the cooldown mechanism in useOperationQueue:
   *
   *   1. When useOperationQueue creates a record, it calls setCommentRecordId AND
   *      starts an 8-second cooldown
   *   2. During cooldown, isSyncAllowed is false
   *   3. useCommentsData's sync effect checks isSyncAllowed before updating state
   *   4. Therefore, subscription updates are BLOCKED while the operation completes
   *
   * SCENARIO TRACE:
   *   T=0: User adds first comment, useOperationQueue starts creating record
   *   T=1: Record created, onRecordCreated(newId) called, cooldown starts
   *   T=2: Subscription receives update, but isSyncAllowed=false, update blocked
   *   T=9: Cooldown ends, isSyncAllowed=true
   *   T=9+: Next subscription update (if any) can now sync
   *
   * The only way both could conflict is if:
   *   - Subscription finds existing record BEFORE operation creates one
   *   - This is actually correct behavior: operation will find the existing
   *     record and update it instead of creating a duplicate (see executeWithRetry)
   *
   * DO NOT add additional synchronization mechanisms here. The cooldown already
   * provides the necessary coordination between these two update sources.
   * ============================================================================
   */
  const [commentRecordId, setCommentRecordId] = useState<string | null>(null);

  // Operation queue for handling concurrent updates with infinite retry
  // Must be called BEFORE useCommentsData so isSyncAllowed is available
  const {
    enqueue,
    pendingCount,
    isSyncAllowed,
    retryState,
  } = useOperationQueue({
    client,
    commentRecordId,
    commentsModelId,
    modelId: ctx.itemType.id,
    recordId: ctx.item?.id,
    ctx,
    onRecordCreated: setCommentRecordId,
  });

  // Comments data and subscription
  const {
    comments,
    setComments,
    isLoading,
    error,
    errorInfo,
    status,
    retry: retrySubscription,
  } = useCommentsData({
    context: 'record',
    ctx,
    realTimeEnabled,
    cdaToken,
    client,
    isSyncAllowed,
    onCommentRecordIdChange: setCommentRecordId,
  });

  // Initialize hiddenOldCount when comments first load
  // This only runs once - when comments become available for the first time
  useEffect(() => {
    if (hiddenOldCount === null && comments.length > 0) {
      setHiddenOldCount(Math.max(0, comments.length - COMMENTS_PAGE_SIZE));
    }
  }, [comments.length, hiddenOldCount]);

  // Calculate visible comments - hide the oldest N comments
  // New comments (prepended at index 0) are automatically visible
  const visibleComments = useMemo(() => {
    const hideCount = hiddenOldCount ?? Math.max(0, comments.length - COMMENTS_PAGE_SIZE);
    const showCount = comments.length - hideCount;
    return comments.slice(0, showCount);
  }, [comments, hiddenOldCount]);

  const hasMoreComments = (hiddenOldCount ?? 0) > 0;

  // Comment actions (submit, delete, edit, upvote, reply)
  const {
    submitNewComment,
    deleteComment,
    editComment,
    upvoteComment,
    replyComment,
  } = useCommentActions({
    ctx,
    userEmail,
    userName,
    setComments,
    enqueue,
    composerSegments,
    setComposerSegments,
    pendingNewReplies,
  });

  /**
   * ============================================================================
   * PICKER LOGIC - WHY THIS IS INLINE RATHER THAN EXTRACTED TO HOOKS
   * ============================================================================
   *
   * GlobalCommentsChannel uses dedicated hooks (usePageAssetMention, usePageRecordMention)
   * for picker logic, but CommentsBar keeps it inline. This asymmetry is intentional:
   *
   * 1. DIFFERENT CONTEXT TYPES:
   *    - Sidebar uses RenderItemFormSidebarCtx (has ctx.item, ctx.scrollToField)
   *    - Page uses RenderPageCtx (different capabilities)
   *    - A unified hook would need union types and conditional logic everywhere
   *
   * 2. SIDEBAR-SPECIFIC STATE:
   *    - `isPickerInProgress` prevents blur deletion of reply composers
   *    - This state is tightly coupled to sidebar lifecycle and focus management
   *    - Extracting would require passing this state back and forth
   *
   * 3. EXTRACTION COST vs BENEFIT:
   *    - The code is ~100 lines of straightforward async handlers
   *    - Extracting would add indirection without reducing complexity
   *    - The page context hooks exist because that code was larger and more complex
   *
   * 4. MAINTENANCE CONSIDERATION:
   *    - If you need to change picker behavior, update BOTH locations
   *    - Asset creation logic is identical (can be extracted to a utility if needed)
   *    - Record picker differs due to model selector positioning
   *
   * ============================================================================
   * WHY PICKER OPERATIONS DON'T HAVE TIMEOUTS
   * ============================================================================
   *
   * It was suggested to add timeouts to ctx.selectUpload() and ctx.selectItem() to
   * handle cases where the modal "hangs" and never closes. However, this is NOT
   * safe to implement for several reasons:
   *
   * 1. USER BROWSING TIME IS UNPREDICTABLE:
   *    Users may take 30+ seconds to browse assets/records, especially in large
   *    projects. A timeout would interrupt legitimate user activity.
   *
   * 2. MODAL IS CONTROLLED BY DATOCMS:
   *    The picker modal is rendered and controlled by the DatoCMS application,
   *    not by our plugin code. We cannot programmatically close it. If we reject
   *    with a timeout while the modal is still open, we'd be in an inconsistent
   *    state where the modal is visible but the promise has already resolved.
   *
   * 3. RECOVERY IS SIMPLE:
   *    If a picker truly hangs (extremely rare), the user can:
   *    - Press Escape to close the modal
   *    - Click outside the modal to dismiss it
   *    - Refresh the page as a last resort
   *    The isPickerInProgress flag resets on component unmount.
   *
   * 4. ROOT CAUSE IS EXTERNAL:
   *    A hanging picker would indicate a bug in DatoCMS's picker implementation,
   *    not in our plugin. Adding a timeout would mask the symptom, not fix it.
   *
   * DO NOT ADD TIMEOUT WRAPPERS TO PICKER OPERATIONS.
   * ============================================================================
   */

  // Handle asset trigger from TipTap (opens asset picker)
  const handleAssetTrigger = useCallback(async () => {
    if (!canMentionAssets) return;

    try {
      const upload = await ctx.selectUpload({ multiple: false });
      if (!upload) return;

      const assetMention = createAssetMention(upload);
      composerRef.current?.insertMention(assetMention);
    } catch (error) {
      logError('Asset picker error:', error);
      ctx.alert(ERROR_MESSAGES.ASSET_PICKER_FAILED);
    }
  }, [ctx, canMentionAssets]);

  // Handle record trigger from TipTap (opens model selector, then record picker)
  const handleRecordTrigger = useCallback(() => {
    setIsRecordModelSelectorOpen(true);
  }, []);

  const handleRecordModelSelectorClose = useCallback(() => {
    setIsRecordModelSelectorOpen(false);
    setIsPickerInProgress(false);
    // Focus the correct composer (reply if active, otherwise main)
    const targetComposer = activeReplyComposerRef.current || composerRef.current;
    targetComposer?.focus();
    activeReplyComposerRef.current = null;
  }, []);

  // Reply picker handling - for asset/record mentions in reply editors
  const activeReplyComposerRef = useRef<TipTapComposerRef | null>(null);

  const handleReplyPickerRequest = useCallback(
    async (type: 'asset' | 'record', replyComposerRef: RefObject<TipTapComposerRef | null>) => {
      activeReplyComposerRef.current = replyComposerRef.current;

      // Mark picker as in progress to prevent blur deletion
      setIsPickerInProgress(true);

      if (type === 'asset') {
        if (!canMentionAssets) {
          setIsPickerInProgress(false);
          return;
        }
        try {
          const upload = await ctx.selectUpload({ multiple: false });
          if (!upload) {
            activeReplyComposerRef.current?.focus();
            setIsPickerInProgress(false);
            return;
          }

          const assetMention = createAssetMention(upload);

          // Wait for editor to be ready after modal closes, then insert mention
          await insertMentionWithRetry(activeReplyComposerRef, assetMention);
        } catch (error) {
          logError('Asset picker error:', error);
          ctx.alert(ERROR_MESSAGES.ASSET_PICKER_FAILED);
        } finally {
          setIsPickerInProgress(false);
          activeReplyComposerRef.current = null;
        }
      } else if (type === 'record') {
        // For records, we need to open the model selector first
        // isPickerInProgress stays true until record selection is complete
        setIsRecordModelSelectorOpen(true);
      }
    },
    [ctx, canMentionAssets]
  );

  // Modified record model selection to support both main composer and replies
  const handleRecordModelSelectForReply = useCallback(
    async (model: { id: string; apiKey: string; name: string; isBlockModel: boolean }) => {
      setIsRecordModelSelectorOpen(false);

      // Determine target composer - reply (if active) or main
      const targetComposer = activeReplyComposerRef.current || composerRef.current;

      // Guard: if this was a reply context but the ref is now null, the reply may have been
      // deleted (e.g., by blur handler). In this case, abort.
      if (!targetComposer) {
        logWarn('No valid composer target for record mention, aborting');
        setIsPickerInProgress(false);
        activeReplyComposerRef.current = null;
        return;
      }

      try {
        const record = await ctx.selectItem(model.id, { multiple: false });
        if (!record) {
          targetComposer?.focus();
          return;
        }

        const itemType = ctx.itemTypes[model.id];

        // Load fields with error handling - if it fails, continue with empty fields
        // This allows record mentions to work even if field loading fails
        let fields: Awaited<ReturnType<typeof ctx.loadItemTypeFields>> = [];
        if (itemType) {
          try {
            fields = await ctx.loadItemTypeFields(model.id);
          } catch (fieldError) {
            logError('Failed to load item type fields for record mention', fieldError, { modelId: model.id });
            // Continue with empty fields - the mention will still work, just without field-based title
          }
        }

        const mainLocale = ctx.site.attributes.locales[0];

        const recordMention = await createRecordMention(
          { id: record.id, attributes: record.attributes },
          { id: model.id, apiKey: model.apiKey, name: model.name, isBlockModel: model.isBlockModel },
          itemType,
          fields,
          mainLocale,
          client
        );

        // Wait for editor to be ready after modal closes, then insert mention
        await insertMentionWithRetry(targetComposer, recordMention);
      } catch (error) {
        logError('Record picker error:', error);
        ctx.alert(ERROR_MESSAGES.RECORD_PICKER_FAILED);
      } finally {
        setIsPickerInProgress(false);
        activeReplyComposerRef.current = null;
      }
    },
    [ctx, client]
  );

  // Toolbar button handlers
  const {
    handleUserToolbarClick,
    handleFieldToolbarClick,
    handleModelToolbarClick,
    handleAssetToolbarClick,
    handleRecordToolbarClick,
  } = useToolbarHandlers({
    composerRef,
    canMentionModels,
    handleAssetTrigger,
    handleRecordTrigger,
  });

  // Check if composer has content (memoized to prevent recalculation on unrelated state changes)
  const isComposerEmptyValue = useMemo(
    () => isComposerEmpty(composerSegments),
    [composerSegments]
  );

  // Loading state
  if ((realTimeEnabled && status === SUBSCRIPTION_STATUS.CONNECTING) || (!realTimeEnabled && isLoading)) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </Canvas>
    );
  }

  // Error state - use categorized error messages for user-friendly display
  if (error) {
    const categorizedError = categorizeGeneralError(error);
    return (
      <Canvas ctx={ctx}>
        <div className={styles.error} role="alert">
          <p>Error loading comments</p>
          <span>{categorizedError.message}</span>
        </div>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <ProjectDataProvider
        projectUsers={projectUsers}
        projectModels={projectModels}
        modelFields={modelFields}
        currentUserEmail={userEmail}
        userOverrides={userOverrides}
        typedUsers={typedUsers}
      >
        <MentionPermissionsProvider
          canMentionFields={true}
          canMentionAssets={canMentionAssets}
          canMentionModels={canMentionModels}
        >
        <div className={styles.container}>
          {/* Header with status indicators */}
          <div className={styles.header}>
            <SyncStatusIndicator
              subscriptionStatus={status}
              subscriptionError={errorInfo?.message ?? null}
              pendingCount={pendingCount}
              retryState={retryState}
              onRetry={retrySubscription}
            />
          </div>

          {/* Warning when real-time is enabled but no CDA token */}
          {realTimeEnabled && !cdaToken && (
            <div className={styles.warning}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" role="img" aria-labelledby="warningIconTitle">
                <title id="warningIconTitle">Warning</title>
                <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
              </svg>
              <span>Realtime updates disabled. Configure a CDA token in plugin settings.</span>
            </div>
          )}

          {/* Composer - wrapped in error boundary to prevent editor crashes from breaking the sidebar */}
          <div className={styles.composer}>
            <CommentErrorBoundary fallbackMessage="Unable to load editor. Please refresh.">
              <div className={styles.composerInputWrapper}>
                <TipTapComposer
                  ref={composerRef}
                  segments={composerSegments}
                  onSegmentsChange={setComposerSegments}
                  onSubmit={submitNewComment}
                  placeholder="Add a comment...&#10;@ user, # field, & record, ^ asset, $ model"
                  projectUsers={projectUsers}
                  modelFields={modelFields}
                  projectModels={projectModels}
                  canMentionAssets={canMentionAssets}
                  canMentionModels={canMentionModels}
                  canMentionFields={true}
                  onAssetTrigger={handleAssetTrigger}
                  onRecordTrigger={handleRecordTrigger}
                  autoFocus={false}
                  ctx={ctx}
                />

                {/* Record model selector dropdown (for & mentions) */}
                {isRecordModelSelectorOpen && (
                  <RecordModelSelectorDropdown
                    models={readableModels}
                    onSelect={handleRecordModelSelectForReply}
                    onClose={handleRecordModelSelectorClose}
                  />
                )}

                {/* Toolbar */}
                <ComposerToolbar
                  onUserClick={handleUserToolbarClick}
                  onFieldClick={handleFieldToolbarClick}
                  onRecordClick={handleRecordToolbarClick}
                  onAssetClick={handleAssetToolbarClick}
                  onModelClick={handleModelToolbarClick}
                  onSendClick={submitNewComment}
                  isSendDisabled={isComposerEmptyValue || pendingCount > 0}
                  canMentionAssets={canMentionAssets}
                  canMentionModels={canMentionModels}
                />
              </div>
            </CommentErrorBoundary>
          </div>

          {/* Comments list */}
          <CommentsList
            comments={visibleComments}
            hasMoreComments={hasMoreComments}
            onLoadMore={() => setHiddenOldCount((prev) => Math.max(0, (prev ?? 0) - COMMENTS_PAGE_SIZE))}
            currentUserEmail={userEmail}
            modelFields={modelFields}
            projectUsers={projectUsers}
            projectModels={projectModels}
            deleteComment={deleteComment}
            editComment={editComment}
            upvoteComment={upvoteComment}
            replyComment={replyComment}
            onPickerRequest={handleReplyPickerRequest}
            canMentionAssets={canMentionAssets}
            canMentionModels={canMentionModels}
            ctx={ctx}
            isPickerActive={isPickerInProgress}
            userOverrides={userOverrides}
            typedUsers={typedUsers}
          />
        </div>
        </MentionPermissionsProvider>
      </ProjectDataProvider>
    </Canvas>
  );
};

export default CommentsBar;
