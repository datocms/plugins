import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
import { useMentionStateQueue } from '@hooks/useMentionStateQueue';
import { useCommentActions } from '@hooks/useCommentActions';
import { useToolbarHandlers } from '@hooks/useToolbarHandlers';
import { usePageAssetMention } from '@hooks/usePageAssetMention';
import { usePageRecordMention } from '@hooks/usePageRecordMention';
import { useReplyPicker } from '@hooks/useReplyPicker';
import { useAutoScroll } from '@hooks/useAutoScroll';
import { usePagination } from '@hooks/usePagination';
import { useEntityResolver } from '@hooks/useEntityResolver';

// Contexts
import { useProjectDataContext } from '../contexts/ProjectDataContext';
import { useMentionPermissionsContext } from '../contexts/MentionPermissionsContext';

// Types and utilities
import type { CommentType } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import { SUBSCRIPTION_STATUS } from '@hooks/useCommentsSubscription';
import { GLOBAL_MODEL_ID, GLOBAL_RECORD_ID } from '@/constants';
import { categorizeGeneralError } from '@utils/errorCategorization';
import { isContentEmpty } from '@ctypes/comments';
import { parsePluginParams } from '@utils/pluginParams';
import styles from '@styles/dashboard.module.css';

type GlobalCommentsChannelProps = {
  ctx: RenderPageCtx;
  client: Client | null;
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
  const { projectUsers, projectModels, modelFields, currentUserId: userId, typedUsers } = useProjectDataContext();
  const { canMentionAssets, canMentionModels } = useMentionPermissionsContext();
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
  const notificationsEndpoint = pluginParams.notificationsEndpoint;

  const mainLocale = ctx.site.attributes.locales[0] ?? 'en';
  const { resolveComments, cacheVersion } = useEntityResolver({
    client,
    projectUsers,
    projectModels,
    modelFields,
    itemTypes: ctx.itemTypes,
    mainLocale,
  });

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

  const mentionStateQueue = useMentionStateQueue({
    client,
    commentsModelId,
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
    userId,
    setComments,
    enqueue: operationQueue.enqueue,
    enqueueMentionState: mentionStateQueue.enqueue,
    mentionContext: {
      modelId: GLOBAL_MODEL_ID,
      recordId: GLOBAL_RECORD_ID,
    },
    notificationsEndpoint,
    currentUserAccessToken: ctx.currentUserAccessToken,
    projectUsers,
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

  const {
    isPickerInProgress: isReplyPickerLoading,
    handleReplyPickerRequest,
    handleRecordModelSelectFromComment,
  } = useReplyPicker({
    ctx,
    client,
    canMentionAssets,
  });

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

  // Resolve stored comments to display-ready format with full mention data
  // cacheVersion triggers re-resolution when async entities (records/assets) are fetched
  const resolvedComments = useMemo(
    () => resolveComments(paginatedComments),
    [paginatedComments, resolveComments, cacheVersion]
  );

  const isComposerEmptyValue = useMemo(
    () => isContentEmpty(composerSegments),
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
          {resolvedComments.map((comment) => (
            <div key={comment.id} style={{ padding: '0 24px' }}>
              <CommentErrorBoundary>
                <Comment
                  deleteComment={deleteComment}
                  editComment={editComment}
                  upvoteComment={upvoteComment}
                  replyComment={replyComment}
                  commentObject={comment}
                  currentUserId={userId}
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
              placeholder={"Add a message...\nType / for commands"}
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
