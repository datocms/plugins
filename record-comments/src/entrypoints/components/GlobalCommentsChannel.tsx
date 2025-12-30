import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { Client } from '@datocms/cma-client-browser';

// Components
import Comment from './Comment';
import ComposerBox from './ComposerBox';
import RecordModelSelectorDropdown from './RecordModelSelectorDropdown';
import ComposerToolbar from './ComposerToolbar';
import { TipTapComposer, type TipTapComposerRef } from './tiptap/TipTapComposer';
import { CommentErrorBoundary } from './shared/CommentErrorBoundary';
import { NewCommentsIndicator } from './NewCommentsIndicator';
import { SearchIcon, ChatBubbleIcon } from './Icons';

// Hooks
import type { ModelInfo } from '@hooks/useMentions';
import { useOperationQueue } from '@hooks/useOperationQueue';
import { useCommentActions } from '@hooks/useCommentActions';
import { useToolbarHandlers } from '@hooks/useToolbarHandlers';
import { usePageAssetMention } from '@hooks/usePageAssetMention';
import { usePageRecordMention } from '@hooks/usePageRecordMention';
import { useAutoScroll } from '@hooks/useAutoScroll';
import { usePagination } from '@hooks/usePagination';

// Contexts
import { useProjectDataContext } from '../contexts/ProjectDataContext';
import { useMentionPermissionsContext } from '../contexts/MentionPermissionsContext';

// Types and utilities
import type { CommentType } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import { SUBSCRIPTION_STATUS } from '@hooks/useCommentsSubscription';
import { GLOBAL_MODEL_ID, GLOBAL_RECORD_ID, ERROR_MESSAGES } from '@/constants';
import { categorizeGeneralError } from '@utils/errorCategorization';
import { createRecordMention } from '@utils/recordPickerHelpers';
import { getItemTypeEmoji } from '@utils/itemTypeUtils';
import { isComposerEmpty, createAssetMention } from '@utils/composerHelpers';
import { logError } from '@/utils/errorLogger';
import styles from '@styles/dashboard.module.css';

type GlobalCommentsChannelProps = {
  ctx: RenderPageCtx;
  client: Client | null;
  userName: string;
  readableModels: ModelInfo[];
  accentColor: string;
  // Comments data (lifted to parent)
  comments: CommentType[];
  filteredComments: CommentType[];
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  commentsModelId: string | null;
  commentRecordId: string | null;
  setCommentRecordId: (id: string | null) => void;
  isLoading: boolean;
  error: Error | null;
  status: string;
  isFiltering: boolean;
  onSyncAllowedChange: (isSyncAllowed: boolean) => void;
  /** Ref for the comments list scroll container (for scroll compensation during sync) */
  commentsListRef: RefObject<HTMLDivElement>;
};

const GlobalCommentsChannel = ({
  ctx,
  client,
  userName,
  readableModels,
  accentColor,
  comments,
  filteredComments,
  setComments,
  commentsModelId,
  commentRecordId,
  setCommentRecordId,
  isLoading,
  error,
  status,
  isFiltering,
  onSyncAllowedChange,
  commentsListRef,
}: GlobalCommentsChannelProps) => {
  const { projectUsers, projectModels, currentUserEmail: userEmail, typedUsers } = useProjectDataContext();
  const { canMentionAssets, canMentionModels } = useMentionPermissionsContext();

  const [composerSegments, setComposerSegments] = useState<CommentSegment[]>([]);
  const composerRef = useRef<TipTapComposerRef>(null);
  const pendingNewReplies = useRef(new Set<string>());

  const operationQueue = useOperationQueue({
    client,
    commentRecordId,
    commentsModelId,
    modelId: GLOBAL_MODEL_ID,
    recordId: GLOBAL_RECORD_ID,
    ctx,
    onRecordCreated: setCommentRecordId,
  });

  useEffect(() => {
    onSyncAllowedChange(operationQueue.isSyncAllowed);
  }, [operationQueue.isSyncAllowed, onSyncAllowedChange]);

  const {
    submitNewComment,
    deleteComment,
    editComment,
    upvoteComment,
    replyComment,
  } = useCommentActions({
    userEmail,
    userName,
    setComments,
    enqueue: operationQueue.enqueue,
    composerSegments,
    setComposerSegments,
    pendingNewReplies,
    insertPosition: 'append',
  });

  const {
    handleUserToolbarClick,
    handleFieldToolbarClick,
    handleModelToolbarClick,
  } = useToolbarHandlers({
    composerRef,
    canMentionModels,
  });

  const { handleAssetTrigger, handleAssetClick } = usePageAssetMention({
    ctx,
    composerRef,
    canMentionAssets,
  });

  const {
    isRecordModelSelectorOpen,
    handleRecordTrigger,
    handleRecordModelSelect,
    handleRecordModelSelectorClose,
  } = usePageRecordMention({
    ctx,
    client,
    composerRef,
    projectModels,
  });

  const activeReplyComposerRef = useRef<TipTapComposerRef | null>(null);
  const [isReplyPickerLoading, setIsReplyPickerLoading] = useState(false);

  const handleReplyPickerRequest = useCallback(
    async (type: 'asset' | 'record', replyComposerRef: RefObject<TipTapComposerRef | null>) => {
      // Record mentions are now handled by the Comment component's own dropdown
      if (type !== 'asset') return;
      if (isReplyPickerLoading) return;
      if (!canMentionAssets) return;

      activeReplyComposerRef.current = replyComposerRef.current;
      setIsReplyPickerLoading(true);

      try {
        const upload = await ctx.selectUpload({ multiple: false });
        if (!upload) {
          activeReplyComposerRef.current?.focus();
          return;
        }

        const assetMention = createAssetMention(upload);
        activeReplyComposerRef.current?.insertMention(assetMention);
      } catch (error) {
        logError('Reply asset picker error:', error);
        ctx.alert(ERROR_MESSAGES.ASSET_PICKER_FAILED);
        activeReplyComposerRef.current?.focus();
      } finally {
        setIsReplyPickerLoading(false);
      }
    },
    [ctx, canMentionAssets, isReplyPickerLoading]
  );

  // Callback for Comment component's record model selection (renders dropdown inside comment)
  const handleRecordModelSelectFromComment = useCallback(
    async (
      model: ModelInfo,
      targetComposerRef: RefObject<TipTapComposerRef | null>
    ) => {
      const targetComposer = targetComposerRef.current;
      if (!targetComposer) {
        return;
      }

      setIsReplyPickerLoading(true);

      try {
        const record = await ctx.selectItem(model.id, { multiple: false });
        if (!record) {
          targetComposer.focus();
          return;
        }

        const itemType = ctx.itemTypes[model.id];
        const fields = itemType ? await ctx.loadItemTypeFields(model.id) : [];
        const mainLocale = ctx.site.attributes.locales[0];
        const modelEmoji = getItemTypeEmoji(itemType);

        const recordMention = await createRecordMention(
          { id: record.id, attributes: record.attributes },
          { id: model.id, apiKey: model.apiKey, name: model.name, isBlockModel: model.isBlockModel },
          itemType,
          fields,
          mainLocale,
          client,
          modelEmoji
        );

        targetComposer.insertMention(recordMention);
      } catch (error) {
        logError('Reply record picker error:', error);
        ctx.alert(ERROR_MESSAGES.RECORD_PICKER_FAILED);
      } finally {
        setIsReplyPickerLoading(false);
      }
    },
    [ctx, client]
  );

  const sortedComments = useMemo(
    () =>
      [...filteredComments].sort((a, b) => a.dateISO.localeCompare(b.dateISO)),
    [filteredComments]
  );

  const {
    newItemsCount: newCommentsCount,
    handleScroll,
    handleNewItemsClick: handleNewCommentsClick,
  } = useAutoScroll({
    containerRef: commentsListRef,
    itemsCount: comments.length,
  });

  const {
    paginatedItems: paginatedComments,
    hasMore: hasMoreComments,
    handleLoadEarlier,
  } = usePagination({
    items: sortedComments,
    containerRef: commentsListRef,
  });

  const isComposerEmptyValue = useMemo(
    () => isComposerEmpty(composerSegments),
    [composerSegments]
  );

  if (status === SUBSCRIPTION_STATUS.CONNECTING || isLoading) {
    return (
      <div className={styles.channelContainer}>
        <div className={styles.channelHeaderMinimal}>
          <span className={styles.channelTitleMinimal}>Project Comments</span>
        </div>
        <div className={styles.commentsListEmpty} role="status" aria-live="polite" aria-label="Loading comments">
          <div className={styles.loadingSpinner} />
        </div>
      </div>
    );
  }

  if (error) {
    const categorizedError = categorizeGeneralError(error);
    return (
      <div className={styles.channelContainer}>
        <div className={styles.channelHeaderMinimal}>
          <span className={styles.channelTitleMinimal}>Project Comments</span>
        </div>
        <div className={styles.error} role="alert">
          <p>Error loading comments</p>
          <span>{categorizedError.message}</span>
        </div>
      </div>
    );
  }

  const hasComments = comments.length > 0;
  const hasFilteredComments = paginatedComments.length > 0;
  const showNoResults = hasComments && sortedComments.length === 0 && isFiltering;

  return (
    <div className={styles.channelContainer}>
      <div className={styles.channelHeaderMinimal}>
        <span className={styles.channelTitleMinimal}>Project Comments</span>
      </div>

      {hasFilteredComments ? (
        <div ref={commentsListRef} className={styles.commentsList} onScroll={handleScroll}>
          {hasMoreComments && (
            <div style={{ padding: '12px 24px', textAlign: 'center' }}>
              <button
                type="button"
                className={styles.loadEarlierButton}
                onClick={handleLoadEarlier}
              >
                Load earlier messages
              </button>
            </div>
          )}
          {paginatedComments.map((comment) => (
            <div key={comment.id} style={{ padding: '0 24px' }}>
              <CommentErrorBoundary>
                <Comment
                  deleteComment={deleteComment}
                  editComment={editComment}
                  upvoteComment={upvoteComment}
                  replyComment={replyComment}
                  commentObject={comment}
                  currentUserEmail={userEmail}
                  modelFields={[]}
                  projectUsers={projectUsers}
                  projectModels={projectModels}
                  ctx={ctx}
                  canMentionFields={false}
                  onPickerRequest={handleReplyPickerRequest}
                  onRecordModelSelect={handleRecordModelSelectFromComment}
                  readableModels={readableModels}
                  canMentionAssets={canMentionAssets}
                  canMentionModels={canMentionModels}
                  isPickerActive={isReplyPickerLoading}
                  typedUsers={typedUsers}
                  dropdownPosition="above"
                />
              </CommentErrorBoundary>
            </div>
          ))}
        </div>
      ) : showNoResults ? (
        <div className={styles.noResults}>
          <SearchIcon className={styles.noResultsIcon} />
          <h3 className={styles.noResultsTitle}>No comments match your filters</h3>
          <p className={styles.noResultsDescription}>
            Try adjusting your search or filter criteria.
          </p>
        </div>
      ) : (
        <div className={styles.commentsListEmpty}>
          <ChatBubbleIcon className={styles.emptyIcon} />
          <h3 className={styles.emptyTitle}>Start the conversation</h3>
          <p className={styles.emptyDescription}>
            Be the first to share an update or ask a question about this project.
          </p>
        </div>
      )}

      <NewCommentsIndicator
        count={newCommentsCount}
        onClick={handleNewCommentsClick}
        accentColor={accentColor}
      />

      <div className={styles.composer}>
        <CommentErrorBoundary fallbackMessage="Unable to load editor. Please refresh the page.">
          <ComposerBox accentColor={accentColor}>
            <TipTapComposer
              ref={composerRef}
              segments={composerSegments}
              onSegmentsChange={setComposerSegments}
              onSubmit={submitNewComment}
              placeholder={"Add a message...\n@ user, & record, ^ asset, $ model"}
              projectUsers={projectUsers}
              modelFields={[]}
              projectModels={projectModels}
              canMentionAssets={canMentionAssets}
              canMentionModels={canMentionModels}
              canMentionFields={false}
              onAssetTrigger={handleAssetTrigger}
              onRecordTrigger={handleRecordTrigger}
              autoFocus={false}
              large
              dropdownPosition="above"
            />

            {isRecordModelSelectorOpen && (
              <RecordModelSelectorDropdown
                models={readableModels}
                onSelect={handleRecordModelSelect}
                onClose={handleRecordModelSelectorClose}
                position="above"
              />
            )}

            <ComposerToolbar
              onUserClick={handleUserToolbarClick}
              onFieldClick={handleFieldToolbarClick}
              onRecordClick={handleRecordTrigger}
              onAssetClick={handleAssetClick}
              onModelClick={handleModelToolbarClick}
              onSendClick={submitNewComment}
              isSendDisabled={isComposerEmptyValue || operationQueue.pendingCount > 0}
              canMentionAssets={canMentionAssets}
              canMentionModels={canMentionModels}
              canMentionFields={false}
              large
              accentColor={accentColor}
            />
          </ComposerBox>
        </CommentErrorBoundary>
      </div>
    </div>
  );
};

export default GlobalCommentsChannel;
