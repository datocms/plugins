import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import RecordModelSelectorDropdown from '@components/RecordModelSelectorDropdown';
import ComposerToolbar from '@components/ComposerToolbar';
import CommentsList from '@components/CommentsList';
import SyncStatusIndicator from '@components/shared/SyncStatusIndicator';
import { CommentErrorBoundary } from '@components/shared/CommentErrorBoundary';
import { TipTapComposer, type TipTapComposerRef } from '@components/tiptap/TipTapComposer';

import { useOperationQueue } from '@hooks/useOperationQueue';
import { useProjectData } from '@hooks/useProjectData';
import { useToolbarHandlers } from '@hooks/useToolbarHandlers';
import { useCommentsData } from '@hooks/useCommentsData';
import { useCommentActions } from '@hooks/useCommentActions';
import { useMentionPermissions } from '@hooks/useMentionPermissions';

import { ProjectDataProvider } from './contexts/ProjectDataContext';
import { MentionPermissionsProvider } from './contexts/MentionPermissionsContext';

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

export type { UserInfo, FieldInfo, ModelInfo } from '@hooks/useMentions';
export type { CommentSegment, Mention } from '@ctypes/mentions';
export type { CommentType, Upvoter } from '@ctypes/comments';

// Uses props (not context) due to shallow tree. Picker logic duplicated with GlobalCommentsChannel
// due to different context types - update both locations for bug fixes.
type Props = {
  ctx: RenderItemFormSidebarCtx;
};

const CommentsBar = ({ ctx }: Props) => {
  const { email: userEmail, name: userName } = getCurrentUserInfo(ctx.currentUser);

  const [composerSegments, setComposerSegments] = useState<CommentSegment[]>([]);
  const composerRef = useRef<TipTapComposerRef>(null);
  const pendingNewReplies = useRef(new Set<string>());

  const [isRecordModelSelectorOpen, setIsRecordModelSelectorOpen] = useState(false);
  const [isPickerInProgress, setIsPickerInProgress] = useState(false);

  // Tracks how many old comments to hide (new comments at index 0 always visible)
  const [hiddenOldCount, setHiddenOldCount] = useState<number | null>(null);

  const cmaToken = ctx.currentUserAccessToken;
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
  const realTimeEnabled = pluginParams.realTimeUpdatesEnabled ?? true;
  const cdaToken = pluginParams.cdaToken;

  const client = useMemo(() => createApiClient(cmaToken), [cmaToken]);
  const { projectUsers, projectModels, modelFields, typedUsers } = useProjectData(ctx, { loadFields: true });
  const { canMentionAssets, canMentionModels, readableModels } = useMentionPermissions(ctx, projectModels);

  const commentsModelId = useMemo(() => {
    const model = findCommentsModel(ctx.itemTypes);
    return model?.id ?? null;
  }, [ctx.itemTypes]);

  // Updated by subscription (existing) or queue (new). 8-second cooldown prevents race conditions.
  const [commentRecordId, setCommentRecordId] = useState<string | null>(null);

  // Must be called BEFORE useCommentsData so isSyncAllowed is available
  const { enqueue, pendingCount, isSyncAllowed, retryState } = useOperationQueue({
    client,
    commentRecordId,
    commentsModelId,
    modelId: ctx.itemType.id,
    recordId: ctx.item?.id,
    ctx,
    onRecordCreated: setCommentRecordId,
  });

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

  useEffect(() => {
    if (hiddenOldCount === null && comments.length > 0) {
      setHiddenOldCount(Math.max(0, comments.length - COMMENTS_PAGE_SIZE));
    }
  }, [comments.length, hiddenOldCount]);

  const visibleComments = useMemo(() => {
    const hideCount = hiddenOldCount ?? Math.max(0, comments.length - COMMENTS_PAGE_SIZE);
    const showCount = comments.length - hideCount;
    return comments.slice(0, showCount);
  }, [comments, hiddenOldCount]);

  const hasMoreComments = (hiddenOldCount ?? 0) > 0;

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

  // Picker modals are DatoCMS-controlled; no timeouts (users may browse 30+ seconds)
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

  const handleRecordTrigger = useCallback(() => {
    setIsRecordModelSelectorOpen(true);
  }, []);

  const handleRecordModelSelectorClose = useCallback(() => {
    setIsRecordModelSelectorOpen(false);
    setIsPickerInProgress(false);
    (activeReplyComposerRef.current || composerRef.current)?.focus();
    activeReplyComposerRef.current = null;
  }, []);

  const activeReplyComposerRef = useRef<TipTapComposerRef | null>(null);

  const handleReplyPickerRequest = useCallback(
    async (type: 'asset' | 'record', replyComposerRef: RefObject<TipTapComposerRef | null>) => {
      activeReplyComposerRef.current = replyComposerRef.current;
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
          await insertMentionWithRetry(activeReplyComposerRef, assetMention);
        } catch (error) {
          logError('Asset picker error:', error);
          ctx.alert(ERROR_MESSAGES.ASSET_PICKER_FAILED);
        } finally {
          setIsPickerInProgress(false);
          activeReplyComposerRef.current = null;
        }
      } else if (type === 'record') {
        setIsRecordModelSelectorOpen(true);
      }
    },
    [ctx, canMentionAssets]
  );

  const handleRecordModelSelectForReply = useCallback(
    async (model: { id: string; apiKey: string; name: string; isBlockModel: boolean }) => {
      setIsRecordModelSelectorOpen(false);
      const targetComposer = activeReplyComposerRef.current || composerRef.current;

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

        let fields: Awaited<ReturnType<typeof ctx.loadItemTypeFields>> = [];
        if (itemType) {
          try {
            fields = await ctx.loadItemTypeFields(model.id);
          } catch (fieldError) {
            logError('Failed to load item type fields for record mention', fieldError, { modelId: model.id });
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

  const isComposerEmptyValue = useMemo(
    () => isComposerEmpty(composerSegments),
    [composerSegments]
  );

  if ((realTimeEnabled && status === SUBSCRIPTION_STATUS.CONNECTING) || (!realTimeEnabled && isLoading)) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </Canvas>
    );
  }

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
        typedUsers={typedUsers}
      >
        <MentionPermissionsProvider
          canMentionFields={true}
          canMentionAssets={canMentionAssets}
          canMentionModels={canMentionModels}
        >
        <div className={styles.container}>
          <div className={styles.header}>
            <SyncStatusIndicator
              subscriptionStatus={status}
              subscriptionError={errorInfo?.message ?? null}
              retryState={retryState}
              onRetry={retrySubscription}
            />
          </div>

          {realTimeEnabled && !cdaToken && (
            <div className={styles.warning}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" role="img" aria-labelledby="warningIconTitle">
                <title id="warningIconTitle">Warning</title>
                <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
              </svg>
              <span>Realtime updates disabled. Configure a CDA token in plugin settings.</span>
            </div>
          )}

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

                {isRecordModelSelectorOpen && (
                  <RecordModelSelectorDropdown
                    models={readableModels}
                    onSelect={handleRecordModelSelectForReply}
                    onClose={handleRecordModelSelectorClose}
                  />
                )}

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
            typedUsers={typedUsers}
          />
        </div>
        </MentionPermissionsProvider>
      </ProjectDataProvider>
    </Canvas>
  );
};

export default CommentsBar;
