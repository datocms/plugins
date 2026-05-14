import CommentsList from '@components/CommentsList';
import ComposerToolbar from '@components/ComposerToolbar';
import RecordModelSelectorDropdown from '@components/RecordModelSelectorDropdown';
import { CommentErrorBoundary } from '@components/shared/CommentErrorBoundary';
import SyncStatusIndicator from '@components/shared/SyncStatusIndicator';
import {
  TipTapComposer,
  type TipTapComposerRef,
} from '@components/tiptap/TipTapComposer';
import { isContentEmpty } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import { useCommentActions } from '@hooks/useCommentActions';
import { useCommentsData } from '@hooks/useCommentsData';
import { SUBSCRIPTION_STATUS } from '@hooks/useCommentsSubscription';
import { useEntityResolver } from '@hooks/useEntityResolver';
import { useMentionPermissions } from '@hooks/useMentionPermissions';
import { useOperationQueue } from '@hooks/useOperationQueue';
import { useProjectData } from '@hooks/useProjectData';
import { useReplyPicker } from '@hooks/useReplyPicker';
import { useToolbarHandlers } from '@hooks/useToolbarHandlers';
import styles from '@styles/commentbar.module.css';
import { createApiClient } from '@utils/apiClient';
import { createAssetMention } from '@utils/composerHelpers';
import { categorizeGeneralError } from '@utils/errorCategorization';
import { findCommentsModel } from '@utils/itemTypeUtils';
import {
  getCommentsModelIdForEnvironment,
  parsePluginParams,
} from '@utils/pluginParams';
import { createRecordMention } from '@utils/recordPickerHelpers';
import { insertMentionWithRetry } from '@utils/textareaUtils';
import { getCurrentUserInfo } from '@utils/userTransformers';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMMENTS_PAGE_SIZE, ERROR_MESSAGES } from '@/constants';
import { ensureCommentsModelExistsWithClient } from '@/utils/commentsStorage';
import { logDebug, logError, logWarn } from '@/utils/errorLogger';
import { MentionPermissionsProvider } from './contexts/MentionPermissionsContext';
import { ProjectDataProvider } from './contexts/ProjectDataContext';

// Uses props (not context) due to shallow tree. Reply picker logic shared via useReplyPicker hook.
type Props = {
  ctx: RenderItemFormSidebarCtx;
};

const CommentsBar = ({ ctx }: Props) => {
  const { id: currentUserId } = getCurrentUserInfo(ctx.currentUser);

  const [composerSegments, setComposerSegments] = useState<CommentSegment[]>(
    [],
  );
  const composerRef = useRef<TipTapComposerRef>(null);
  const pendingNewReplies = useRef(new Set<string>());

  const [isRecordModelSelectorOpen, setIsRecordModelSelectorOpen] =
    useState(false);

  // Tracks how many old comments to hide (new comments at index 0 always visible)
  const [hiddenOldCount, setHiddenOldCount] = useState<number | null>(null);

  const cmaToken = ctx.currentUserAccessToken;
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
  const realTimeRequested = pluginParams.realTimeUpdatesEnabled;
  const cdaToken = pluginParams.cdaToken;
  const realTimeEnabled = realTimeRequested && !!cdaToken;
  const storedCommentsModelId = getCommentsModelIdForEnvironment(
    pluginParams,
    ctx.environment,
  );

  useEffect(() => {
    logDebug('Comments sidebar initialized', {
      hasCdaToken: !!cdaToken,
      mode: realTimeEnabled ? 'realtime' : 'cma-fallback',
      modelId: ctx.itemType.id,
      realTimeEnabled,
      realTimeRequested,
      recordId: ctx.item?.id ?? null,
    });
  }, [
    cdaToken,
    ctx.item?.id,
    ctx.itemType.id,
    realTimeEnabled,
    realTimeRequested,
  ]);

  const client = useMemo(
    () => createApiClient(cmaToken, ctx.environment, ctx.cmaBaseUrl),
    [cmaToken, ctx.environment, ctx.cmaBaseUrl],
  );
  const [fieldMentionsRequestKey, setFieldMentionsRequestKey] = useState(0);
  const {
    projectUsers,
    projectModels,
    modelFields,
    typedUsers,
    isLoadingFields,
    fieldLoadError,
    retryFields,
  } = useProjectData(ctx, {
    fieldsRequestKey: fieldMentionsRequestKey,
    loadFields: fieldMentionsRequestKey > 0,
  });
  const { canMentionAssets, canMentionModels, readableModels } =
    useMentionPermissions(ctx, projectModels);

  const handleFieldMentionIntent = useCallback(() => {
    setFieldMentionsRequestKey((previous) => (previous === 0 ? 1 : previous));
  }, []);

  const handleFieldMentionsRetry = useCallback(() => {
    setFieldMentionsRequestKey((previous) => (previous === 0 ? 1 : previous));
    retryFields();
  }, [retryFields]);

  const fieldMentionsErrorMessage = fieldLoadError?.message ?? null;

  const mainLocale = ctx.site.attributes.locales[0] ?? 'en';
  const {
    prefetchEntities,
    seedResolvedMentionsFromSegments,
    resolveComments,
    cacheVersion,
  } = useEntityResolver({
    client,
    projectUsers,
    projectModels,
    modelFields,
    itemTypes: ctx.itemTypes,
    mainLocale,
  });

  const [commentsModelId, setCommentsModelId] = useState<string | null>(() => {
    const model = findCommentsModel(ctx.itemTypes);
    return model?.id ?? storedCommentsModelId;
  });

  useEffect(() => {
    const nextCommentsModelId =
      findCommentsModel(ctx.itemTypes)?.id ?? storedCommentsModelId;

    if (nextCommentsModelId && nextCommentsModelId !== commentsModelId) {
      setCommentsModelId(nextCommentsModelId);
    }
  }, [commentsModelId, ctx.itemTypes, storedCommentsModelId]);

  useEffect(() => {
    logDebug('Comments model resolution state', {
      activeCommentsModelId: commentsModelId,
      contextCommentsModelId: findCommentsModel(ctx.itemTypes)?.id ?? null,
      hasClient: !!client,
      storedCommentsModelId,
    });
  }, [client, commentsModelId, ctx.itemTypes, storedCommentsModelId]);

  const resolveCommentsModelIdViaClient = useCallback(
    async (environment: string): Promise<string | null> => {
      if (!client) return null;

      logDebug('Ensuring comments model via CMA client', { environment });

      try {
        const ensuredCommentsModelId =
          await ensureCommentsModelExistsWithClient(client);
        setCommentsModelId((previous) =>
          previous === ensuredCommentsModelId
            ? previous
            : ensuredCommentsModelId,
        );
        logDebug('Ensured comments model via CMA client', {
          commentsModelId: ensuredCommentsModelId,
          environment,
        });
        return ensuredCommentsModelId;
      } catch (error) {
        if (!storedCommentsModelId) {
          throw error;
        }
        logDebug('Falling back to stored comments model ID in sidebar', {
          environment,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [client, storedCommentsModelId],
  );

  const resolveCommentsModelId = useCallback(async (): Promise<
    string | null
  > => {
    const contextCommentsModelId = findCommentsModel(ctx.itemTypes)?.id;
    if (contextCommentsModelId) {
      logDebug('Using comments model ID from loaded item types', {
        commentsModelId: contextCommentsModelId,
      });
      if (contextCommentsModelId !== commentsModelId) {
        setCommentsModelId(contextCommentsModelId);
      }
      return contextCommentsModelId;
    }

    if (client) {
      const clientResolvedId = await resolveCommentsModelIdViaClient(
        ctx.environment,
      );
      if (clientResolvedId) {
        return clientResolvedId;
      }
    }

    if (storedCommentsModelId) {
      logDebug('Using stored comments model ID from plugin parameters', {
        commentsModelId: storedCommentsModelId,
        environment: ctx.environment,
      });
      if (storedCommentsModelId !== commentsModelId) {
        setCommentsModelId(storedCommentsModelId);
      }
      return storedCommentsModelId;
    }

    logDebug('Comments model ID could not be resolved', {
      environment: ctx.environment,
      hasClient: !!client,
    });
    return null;
  }, [
    client,
    commentsModelId,
    ctx.environment,
    ctx.itemTypes,
    resolveCommentsModelIdViaClient,
    storedCommentsModelId,
  ]);

  useEffect(() => {
    if (commentsModelId || !client) {
      return;
    }

    let cancelled = false;

    void resolveCommentsModelId().catch((error) => {
      if (cancelled) {
        return;
      }

      logError('Failed to resolve comments model in sidebar', error, {
        environment: ctx.environment,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [client, commentsModelId, ctx.environment, resolveCommentsModelId]);

  // Updated by subscription (existing) or queue (new). 8-second cooldown prevents race conditions.
  const [commentRecordId, setCommentRecordId] = useState<string | null>(null);

  // Must be called BEFORE useCommentsData so isSyncAllowed is available
  const { enqueue, pendingCount, isSyncAllowed, retryState } =
    useOperationQueue({
      client,
      commentRecordId,
      commentsModelId,
      modelId: ctx.itemType.id,
      recordId: ctx.item?.id,
      ctx,
      onRecordCreated: setCommentRecordId,
      resolveCommentsModelId,
    });

  const handleOrphanedDraft = useCallback(() => {
    ctx.alert('The comment you were replying to was deleted by another user.');
  }, [ctx]);

  const {
    comments,
    setComments,
    isLoading,
    error,
    errorInfo,
    status,
    retry: retrySubscription,
    isAutoReconnecting,
    storageProblem,
  } = useCommentsData({
    ctx,
    realTimeEnabled,
    cdaToken,
    client,
    commentsModelId,
    isSyncAllowed,
    onCommentRecordIdChange: setCommentRecordId,
    currentUserId,
    onOrphanedDraft: handleOrphanedDraft,
  });

  useEffect(() => {
    if (hiddenOldCount === null && comments.length > 0) {
      setHiddenOldCount(Math.max(0, comments.length - COMMENTS_PAGE_SIZE));
    }
  }, [comments.length, hiddenOldCount]);

  const visibleStoredComments = useMemo(() => {
    const hideCount =
      hiddenOldCount ?? Math.max(0, comments.length - COMMENTS_PAGE_SIZE);
    const showCount = comments.length - hideCount;
    return comments.slice(0, showCount);
  }, [comments, hiddenOldCount]);

  useEffect(() => {
    prefetchEntities(visibleStoredComments);
  }, [visibleStoredComments, prefetchEntities]);

  const visibleComments = useMemo(
    () => resolveComments(visibleStoredComments),
    // cacheVersion triggers re-resolution when async entities (records/assets) are fetched
    [visibleStoredComments, resolveComments, cacheVersion],
  );

  const hasMoreComments = (hiddenOldCount ?? 0) > 0;

  const {
    submitNewComment,
    deleteComment,
    editComment,
    upvoteComment,
    replyComment,
  } = useCommentActions({
    ctx,
    userId: currentUserId,
    comments,
    setComments,
    enqueue,
    composerSegments,
    setComposerSegments,
    pendingNewReplies,
    onBeforePersistSegments: seedResolvedMentionsFromSegments,
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
    composerRef.current?.focus();
  }, []);

  const {
    isPickerInProgress,
    handleReplyPickerRequest,
    handleRecordModelSelectFromComment,
  } = useReplyPicker({
    ctx,
    client,
    canMentionAssets,
  });

  const handleRecordModelSelectForReply = useCallback(
    async (model: {
      id: string;
      apiKey: string;
      name: string;
      isBlockModel: boolean;
    }) => {
      setIsRecordModelSelectorOpen(false);
      const targetComposer = composerRef.current;

      if (!targetComposer) {
        logWarn('No valid composer target for record mention, aborting');
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
            logError(
              'Failed to load item type fields for record mention',
              fieldError,
              { modelId: model.id },
            );
          }
        }

        const mainLocale = ctx.site.attributes.locales[0] ?? 'en';

        const recordMention = await createRecordMention(
          { id: record.id, attributes: record.attributes },
          {
            id: model.id,
            apiKey: model.apiKey,
            name: model.name,
            isBlockModel: model.isBlockModel,
          },
          itemType,
          fields,
          mainLocale,
          client,
        );

        await insertMentionWithRetry(targetComposer, recordMention);
      } catch (error) {
        logError('Record picker error:', error);
        ctx.alert(ERROR_MESSAGES.RECORD_PICKER_FAILED);
      }
    },
    [ctx, client],
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
    () => isContentEmpty(composerSegments),
    [composerSegments],
  );

  if (
    (realTimeEnabled && status === SUBSCRIPTION_STATUS.CONNECTING) ||
    (!realTimeEnabled && isLoading)
  ) {
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
        currentUserId={currentUserId}
        typedUsers={typedUsers}
      >
        <MentionPermissionsProvider
          canMentionFields={true}
          canMentionAssets={canMentionAssets}
          canMentionModels={canMentionModels}
        >
          <div className={styles.container}>
            {/* Inline status indicators (errors, retrying, connecting) - positioned in header */}
            {!isAutoReconnecting && (
              <div className={styles.header}>
                <SyncStatusIndicator
                  subscriptionStatus={status}
                  subscriptionError={errorInfo?.message ?? null}
                  retryState={retryState}
                  onRetry={retrySubscription}
                  realTimeEnabled={realTimeEnabled}
                  isAutoReconnecting={false}
                />
              </div>
            )}

            {realTimeRequested && !cdaToken && (
              <div className={styles.warning}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  role="img"
                  aria-labelledby="warningIconTitle"
                >
                  <title id="warningIconTitle">Warning</title>
                  <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
                </svg>
                <span>
                  Realtime updates disabled. Configure a CDA token in plugin
                  settings.
                </span>
              </div>
            )}

            {storageProblem ? (
              <div className={styles.migrationRequired} role="alert">
                <p>
                  {storageProblem.type === 'migration_required'
                    ? 'Comments are stored in an older format.'
                    : 'Comments storage could not be read.'}
                </p>
                <span>
                  Go to the plugin settings screen and run the comment
                  migration before adding new comments.
                </span>
                {storageProblem.type === 'malformed_aggregate' && (
                  <span className={styles.migrationRequiredDetails}>
                    {storageProblem.message}
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className={styles.composer}>
                  <CommentErrorBoundary fallbackMessage="Unable to load editor. Please refresh.">
                    {isAutoReconnecting && (
                      <SyncStatusIndicator
                        subscriptionStatus={status}
                        subscriptionError={null}
                        retryState={retryState}
                        onRetry={retrySubscription}
                        realTimeEnabled={realTimeEnabled}
                        isAutoReconnecting={true}
                        variant="banner"
                      />
                    )}
                    <div className={styles.composerInputWrapper}>
                      <TipTapComposer
                        ref={composerRef}
                        segments={composerSegments}
                        onSegmentsChange={setComposerSegments}
                        onSubmit={submitNewComment}
                        placeholder="Add a comment...&#10;Type / for commands"
                        projectUsers={projectUsers}
                        modelFields={modelFields}
                        projectModels={projectModels}
                        canMentionAssets={canMentionAssets}
                        canMentionModels={canMentionModels}
                        canMentionFields={true}
                        fieldMentionsLoading={isLoadingFields}
                        fieldMentionsError={fieldMentionsErrorMessage}
                        onFieldMentionIntent={handleFieldMentionIntent}
                        onFieldMentionsRetry={handleFieldMentionsRetry}
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
                  onLoadMore={() =>
                    setHiddenOldCount((prev) =>
                      Math.max(0, (prev ?? 0) - COMMENTS_PAGE_SIZE),
                    )
                  }
                  currentUserId={currentUserId}
                  modelFields={modelFields}
                  fieldMentionsLoading={isLoadingFields}
                  fieldMentionsError={fieldMentionsErrorMessage}
                  onFieldMentionIntent={handleFieldMentionIntent}
                  onFieldMentionsRetry={handleFieldMentionsRetry}
                  projectUsers={projectUsers}
                  projectModels={projectModels}
                  deleteComment={deleteComment}
                  editComment={editComment}
                  upvoteComment={upvoteComment}
                  replyComment={replyComment}
                  onPickerRequest={handleReplyPickerRequest}
                  onRecordModelSelect={handleRecordModelSelectFromComment}
                  readableModels={readableModels}
                  canMentionAssets={canMentionAssets}
                  canMentionModels={canMentionModels}
                  ctx={ctx}
                  isPickerActive={isPickerInProgress}
                />
              </>
            )}
          </div>
        </MentionPermissionsProvider>
      </ProjectDataProvider>
    </Canvas>
  );
};

export default CommentsBar;
