import CommentsList from '@components/CommentsList';
import { CommentComposer } from '@components/composer/CommentComposer';
import {
  CircleExclamationIcon,
  CommentsIcon,
  RefreshIcon,
} from '@components/Icons';
import { CommentErrorBoundary } from '@components/shared/CommentErrorBoundary';
import type { TipTapComposerRef } from '@components/tiptap/TipTapComposer';
import { isContentEmpty } from '@ctypes/comments';
import type { CommentSegment } from '@ctypes/mentions';
import { useCommentActions } from '@hooks/useCommentActions';
import { useCommentPagination } from '@hooks/useCommentPagination';
import { useCommentsData } from '@hooks/useCommentsData';
import type {
  CommentsStorageProblem,
  SubscriptionErrorInfo,
  SubscriptionStatus,
} from '@hooks/useCommentsSubscription';
import { useEntityResolver } from '@hooks/useEntityResolver';
import { useChangeCount, useHasLoadedOnce } from '@hooks/useHasLoadedOnce';
import { useMentionPermissions } from '@hooks/useMentionPermissions';
import { type RetryState, useOperationQueue } from '@hooks/useOperationQueue';
import { useProjectData } from '@hooks/useProjectData';
import { useReplyPicker } from '@hooks/useReplyPicker';
import { useToolbarHandlers } from '@hooks/useToolbarHandlers';
import { createAssetMention } from '@utils/composerHelpers';
import {
  categorizeGeneralError,
  type GeneralErrorType,
  type SubscriptionErrorType,
} from '@utils/errorCategorization';
import { findCommentsModel } from '@utils/itemTypeUtils';
import { buildPluginSettingsPath } from '@utils/navigationHelpers';
import {
  getCommentsModelIdForEnvironment,
  parsePluginParams,
} from '@utils/pluginParams';
import { createRecordMention } from '@utils/recordPickerHelpers';
import {
  getSidebarView,
  isLoadSettled,
  type SidebarView,
} from '@utils/sidebarState';
import { insertMentionWithRetry } from '@utils/textareaUtils';
import { getCurrentUserInfo } from '@utils/userTransformers';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Link from 'datocms-react-ui/Link';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ERROR_MESSAGES } from '@/constants';
import { createApiClient } from '@/utils/cmaClient';
import { ensureCommentsModelExistsWithClient } from '@/utils/commentsStorage';
import { logDebug, logError, logWarn } from '@/utils/errorLogger';
import { formatCount } from '@/utils/format';
import styles from './CommentsBar.module.css';
import { MentionPermissionsProvider } from './contexts/MentionPermissionsContext';
import { ProjectDataProvider } from './contexts/ProjectDataContext';

// Uses props (not context) due to shallow tree. Reply picker logic shared via useReplyPicker hook.
type Props = {
  ctx: RenderItemFormSidebarCtx;
};

const HELP = (
  <Toolbar.Help>
    Discuss this record with your team. Type / in a comment to mention people,
    fields, records, assets and models.
  </Toolbar.Help>
);

/** An unsaved record has no comments yet: nothing else applies */
const UNSAVED_RECORD_VIEW: SidebarView = {
  phase: 'ready',
  syncProblem: false,
  busy: false,
  activity: null,
  announcement: null,
};

type SidebarCalloutsProps = {
  /** Real-time updates are on in the settings, but there is no CDA token */
  missingCdaToken: boolean;
  syncProblem: boolean;
  /** The comments come from the real-time connection (else from the CMA) */
  realTimeEnabled: boolean;
  errorType: SubscriptionErrorType | undefined;
  settingsPath: string;
};

/**
 * The comments stopped updating. In real time, the connection is lost; else
 * the load of the latest comments failed, and only the header reloads them.
 */
function SyncProblemCallout({
  realTimeEnabled,
  errorType,
  settingsPath,
}: Omit<SidebarCalloutsProps, 'missingCdaToken' | 'syncProblem'>) {
  if (!realTimeEnabled) {
    return (
      <Callout
        tone="warning"
        title="Comments didn't reload"
        className={styles.callout}
      >
        The list can miss the latest changes. Reload it from the header.
      </Callout>
    );
  }

  return (
    <Callout
      tone="warning"
      title="Comments stopped updating"
      className={styles.callout}
    >
      {errorType === 'token_expired' ? (
        <>
          The Content Delivery API token is not valid any more. Add a new one in
          the <Link to={settingsPath}>plugin settings</Link>.
        </>
      ) : (
        'New comments from other people show up again once the connection is back.'
      )}
    </Callout>
  );
}

function SidebarCallouts({
  missingCdaToken,
  syncProblem,
  ...syncProblemProps
}: SidebarCalloutsProps) {
  return (
    <>
      {missingCdaToken && (
        <Callout
          tone="warning"
          title="Real-time updates are off"
          className={styles.callout}
        >
          The plugin has no Content Delivery API token. Add one in the{' '}
          <Link to={syncProblemProps.settingsPath}>plugin settings</Link>.
        </Callout>
      )}
      {syncProblem && <SyncProblemCallout {...syncProblemProps} />}
    </>
  );
}

/**
 * The state of the field list of a mention after its load failed, in the
 * words of the plugin, as the collaborators list says it
 */
function describeFieldsLoadError(type: GeneralErrorType): string {
  switch (type) {
    case 'permission_denied':
      return "Your role can't read the fields of this model.";
    case 'network_error':
      return "The fields didn't load. Check your connection.";
    default:
      return "The fields didn't load.";
  }
}

function describeLoadError(error: Error): string {
  switch (categorizeGeneralError(error).type) {
    case 'permission_denied':
      return "Your role can't read the comments of this record.";
    case 'network_error':
      return 'Check your connection, then try again.';
    default:
      return 'Try again. If it keeps failing, reload the record.';
  }
}

/**
 * A blank slate is the only content of the column, or it has a callout
 * above it (then it is a section of the column)
 */
type SlatePlacement = 'inline' | 'section';

type LoadErrorSlateProps = {
  error: Error;
  errorType: SubscriptionErrorType | undefined;
  settingsPath: string;
  onRetry: () => void;
  placement: SlatePlacement;
};

/**
 * The first load failed: there is nothing to keep on screen. Try again is
 * always there: a token error can also be a passing problem of the API.
 */
function LoadErrorSlate({
  error,
  errorType,
  settingsPath,
  onRetry,
  placement,
}: LoadErrorSlateProps) {
  return (
    <BlankSlate
      placement={placement}
      small
      error
      icon={<CircleExclamationIcon />}
      title="Comments didn't load"
      code={error.message}
      description={
        errorType === 'token_expired' ? (
          <>
            The Content Delivery API token is not valid any more. Add a new one
            in the <Link to={settingsPath}>plugin settings</Link>.
          </>
        ) : (
          describeLoadError(error)
        )
      }
      actions={
        <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
      }
    />
  );
}

type StorageProblemSlateProps = {
  problem: CommentsStorageProblem;
  settingsPath: string;
  placement: SlatePlacement;
};

/** The stored comments need the migration of the settings first */
function StorageProblemSlate({
  problem,
  settingsPath,
  placement,
}: StorageProblemSlateProps) {
  const actions = <Button label="Open plugin settings" to={settingsPath} />;

  if (problem.type === 'migration_required') {
    return (
      <BlankSlate
        placement={placement}
        small
        icon={<CommentsIcon />}
        title="Comments need a migration"
        description="This project keeps comments in an older format. Run the migration in the plugin settings before adding new comments."
        actions={actions}
      />
    );
  }

  return (
    <BlankSlate
      placement={placement}
      small
      error
      icon={<CircleExclamationIcon />}
      title="Comments can't be read"
      code={problem.message}
      description="Run the migration in the plugin settings before adding new comments."
      actions={actions}
    />
  );
}

type SidebarViewParams = {
  hasRecord: boolean;
  scopeKey: string;
  realTimeEnabled: boolean;
  status: SubscriptionStatus;
  isLoading: boolean;
  error: Error | null;
  isAutoReconnecting: boolean;
  pendingCount: number;
  retryState: RetryState;
  locale: string;
};

/**
 * What the sidebar shows. The spinner shows only before the first load of
 * the record: the later loads (a refetch after a save, a reconnection) keep
 * the comments and the composer on screen.
 */
function useSidebarView({
  hasRecord,
  scopeKey,
  error,
  retryState,
  ...rest
}: SidebarViewParams): SidebarView {
  const loadState = {
    realTimeEnabled: rest.realTimeEnabled,
    status: rest.status,
    isLoading: rest.isLoading,
    hasError: !!error,
  };
  const hasLoadedOnce = useHasLoadedOnce(scopeKey, isLoadSettled(loadState));

  if (!hasRecord) return UNSAVED_RECORD_VIEW;

  return getSidebarView({
    ...loadState,
    hasLoadedOnce,
    isAutoReconnecting: rest.isAutoReconnecting,
    pendingCount: rest.pendingCount,
    isRetrying: retryState.isRetrying,
    retryCount: retryState.retryCount,
    retryMessage: retryState.message,
    locale: rest.locale,
  });
}

/**
 * The kind of a real-time (CDA) error. In CMA mode the CDA token plays no
 * part, thus its errors never point to it.
 */
function getCdaErrorType(
  realTimeEnabled: boolean,
  errorInfo: SubscriptionErrorInfo | null,
): SubscriptionErrorType | undefined {
  return realTimeEnabled ? errorInfo?.type : undefined;
}

/** The background work while there is some, else the count of the comments */
function getSubtitle(
  view: SidebarView,
  commentCount: number,
  locale: string,
): string | null {
  if (view.activity) return view.activity;
  if (commentCount === 0) return null;
  return formatCount(commentCount, 'comment', 'comments', locale);
}

function getSubmitDisabledReason(
  isEmpty: boolean,
  pendingCount: number,
): string | null {
  if (isEmpty) return 'Write a comment first.';
  if (pendingCount > 0) return 'Wait until your last change is saved.';
  return null;
}

type SidebarHeaderParams = {
  view: SidebarView;
  subtitle: string | null;
  /** Real time reconnects; the CMA only loads the comments again */
  realTimeEnabled: boolean;
  onReconnect: () => void;
};

/**
 * The title bar. Pane.Header wants its parts as direct children, thus this
 * returns the element itself: a part that does not show is null.
 */
function renderSidebarHeader({
  view,
  subtitle,
  realTimeEnabled,
  onReconnect,
}: SidebarHeaderParams) {
  return (
    <Pane.Header>
      <Pane.Header.Title help={HELP}>Comments</Pane.Header.Title>
      {subtitle ? (
        <Pane.Header.Subtitle>{subtitle}</Pane.Header.Subtitle>
      ) : null}
      {view.busy ? <Pane.Header.Spinner /> : null}
      {view.syncProblem ? (
        <Pane.Header.Button>
          {/* Icon only: the title of a narrow sidebar keeps its room */}
          <Toolbar.Button
            iconOnly
            icon={RefreshIcon}
            label={realTimeEnabled ? 'Reconnect' : 'Reload'}
            onClick={onReconnect}
          />
        </Pane.Header.Button>
      ) : null}
    </Pane.Header>
  );
}

type SidebarBodyProps = {
  hasRecord: boolean;
  view: SidebarView;
  realTimeEnabled: boolean;
  error: Error | null;
  errorType: SubscriptionErrorType | undefined;
  storageProblem: CommentsStorageProblem | null;
  /** Real-time updates are on in the settings, but there is no CDA token */
  missingCdaToken: boolean;
  settingsPath: string;
  onRetry: () => void;
  /** The composer and the comments, when they apply */
  children: ReactNode;
};

/** The content of the pane: the callouts, then a state or the comments */
function SidebarBody({
  hasRecord,
  view,
  realTimeEnabled,
  error,
  errorType,
  storageProblem,
  missingCdaToken,
  settingsPath,
  onRetry,
  children,
}: SidebarBodyProps) {
  if (hasRecord && view.phase === 'loading') {
    return (
      <BlankSlate placement="area" small loading title="Loading comments" />
    );
  }

  let content = children;
  // Under a callout, a blank slate is no longer alone in the column
  const slatePlacement: SlatePlacement =
    missingCdaToken || view.syncProblem ? 'section' : 'inline';

  if (!hasRecord) {
    content = (
      <BlankSlate
        placement={slatePlacement}
        small
        icon={<CommentsIcon />}
        title="Save the record to comment"
        description="Comments belong to a saved record."
      />
    );
  } else if (view.phase === 'failed' && error) {
    content = (
      <LoadErrorSlate
        error={error}
        errorType={errorType}
        settingsPath={settingsPath}
        onRetry={onRetry}
        placement={slatePlacement}
      />
    );
  } else if (storageProblem) {
    content = (
      <StorageProblemSlate
        problem={storageProblem}
        settingsPath={settingsPath}
        placement={slatePlacement}
      />
    );
  }

  return (
    <div className={styles.content}>
      <SidebarCallouts
        missingCdaToken={missingCdaToken}
        syncProblem={view.syncProblem}
        realTimeEnabled={realTimeEnabled}
        errorType={errorType}
        settingsPath={settingsPath}
      />
      {content}
    </div>
  );
}

const CommentsBar = ({ ctx }: Props) => {
  const { id: currentUserId } = getCurrentUserInfo(ctx.currentUser);

  const [composerSegments, setComposerSegments] = useState<CommentSegment[]>(
    [],
  );
  const composerRef = useRef<TipTapComposerRef>(null);
  const pendingNewReplies = useRef(new Set<string>());

  const [isRecordModelSelectorOpen, setIsRecordModelSelectorOpen] =
    useState(false);
  // A picker of the CMS (assets, records) is open for the new comment: the
  // mention buttons stay while it has the focus
  const [isComposerPickerOpen, setIsComposerPickerOpen] = useState(false);

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
    isLoadingUsers,
    usersLoadError,
    retryUsers,
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

  const fieldMentionsErrorMessage = fieldLoadError
    ? describeFieldsLoadError(fieldLoadError.type)
    : null;

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

  // The comments of one record in one environment: the pagination and the
  // first load start again when it changes
  const scopeKey = JSON.stringify([
    ctx.environment,
    ctx.itemType.id,
    ctx.item?.id ?? null,
  ]);

  // The CMA fallback also empties and loads the comments again with a new
  // client (a new access token): that load is a first one too. Real time
  // keeps its subscription, thus there only the record counts.
  const clientChangeCount = useChangeCount(client);
  const loadScopeKey = JSON.stringify([
    scopeKey,
    realTimeEnabled ? 0 : clientChangeCount,
  ]);

  const { visibleStoredComments, hasMoreComments, loadMore } =
    useCommentPagination(comments, scopeKey);

  useEffect(() => {
    prefetchEntities(visibleStoredComments);
  }, [visibleStoredComments, prefetchEntities]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Async cache mutations require re-resolution even when the comment array is unchanged.
  const visibleComments = useMemo(
    () => resolveComments(visibleStoredComments),
    // cacheVersion triggers re-resolution when async entities (records/assets) are fetched
    [visibleStoredComments, resolveComments, cacheVersion],
  );

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

    setIsComposerPickerOpen(true);
    try {
      const upload = await ctx.selectUpload({ multiple: false });
      if (!upload) return;

      const assetMention = createAssetMention(upload);
      composerRef.current?.insertMention(assetMention);
    } catch (error) {
      logError('Asset picker error:', error);
      ctx.alert(ERROR_MESSAGES.ASSET_PICKER_FAILED);
    } finally {
      setIsComposerPickerOpen(false);
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

      // The model panel closes as the record picker opens
      setIsComposerPickerOpen(true);
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
      } finally {
        setIsComposerPickerOpen(false);
      }
    },
    [ctx, client],
  );

  const {
    handleUserToolbarClick,
    handleFieldToolbarClick,
    handleModelToolbarClick,
    handleAssetToolbarClick,
  } = useToolbarHandlers({
    composerRef,
    canMentionModels,
    handleAssetTrigger,
  });

  const isComposerEmptyValue = useMemo(
    () => isContentEmpty(composerSegments),
    [composerSegments],
  );

  const view = useSidebarView({
    hasRecord: !!ctx.item,
    scopeKey: loadScopeKey,
    realTimeEnabled,
    status,
    isLoading,
    error,
    isAutoReconnecting,
    pendingCount,
    retryState,
    locale: ctx.ui.locale,
  });

  const commentCount = useMemo(
    () => comments.filter((comment) => !isContentEmpty(comment.content)).length,
    [comments],
  );

  const settingsPath = buildPluginSettingsPath(ctx);
  const showsComments = !!ctx.item && view.phase === 'ready' && !storageProblem;
  const announcement = showsComments ? view.announcement : null;

  const header = renderSidebarHeader({
    view,
    subtitle: showsComments
      ? getSubtitle(view, commentCount, ctx.ui.locale)
      : null,
    realTimeEnabled,
    onReconnect: retrySubscription,
  });

  return (
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
        <div className={styles.root}>
          {/* The subtitle is plain text: screen readers hear the background
              work (saving, retrying and why, reconnecting) from this status */}
          <div role="status" className="visually-hidden">
            {announcement}
          </div>
          <Pane ariaLabel="Comments" header={header}>
            <SidebarBody
              hasRecord={!!ctx.item}
              view={view}
              realTimeEnabled={realTimeEnabled}
              error={error}
              errorType={getCdaErrorType(realTimeEnabled, errorInfo)}
              storageProblem={storageProblem}
              missingCdaToken={realTimeRequested && !cdaToken}
              settingsPath={settingsPath}
              onRetry={retrySubscription}
            >
              <CommentErrorBoundary
                fallbackTitle="The editor didn't load"
                fallbackMessage="Reload the record to try again."
                fallbackClassName={styles.callout}
              >
                <CommentComposer
                  variant="new"
                  composerRef={composerRef}
                  segments={composerSegments}
                  onSegmentsChange={setComposerSegments}
                  onSubmit={submitNewComment}
                  projectUsers={projectUsers}
                  usersLoading={isLoadingUsers}
                  usersLoadFailed={!!usersLoadError}
                  onUsersRetry={retryUsers}
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
                  onUserClick={handleUserToolbarClick}
                  onFieldClick={handleFieldToolbarClick}
                  onAssetClick={handleAssetToolbarClick}
                  onModelClick={handleModelToolbarClick}
                  // The record mention lists the models of these that are
                  // not blocks; without one it hides
                  readableModels={readableModels}
                  onRecordModelSelect={handleRecordModelSelectForReply}
                  isRecordModelSelectorOpen={isRecordModelSelectorOpen}
                  onRecordModelSelectorClose={handleRecordModelSelectorClose}
                  busy={isComposerPickerOpen}
                  submitDisabledReason={getSubmitDisabledReason(
                    isComposerEmptyValue,
                    pendingCount,
                  )}
                />
              </CommentErrorBoundary>

              <CommentsList
                comments={visibleComments}
                hasMoreComments={hasMoreComments}
                onLoadMore={loadMore}
                currentUserId={currentUserId}
                modelFields={modelFields}
                fieldMentionsLoading={isLoadingFields}
                fieldMentionsError={fieldMentionsErrorMessage}
                onFieldMentionIntent={handleFieldMentionIntent}
                onFieldMentionsRetry={handleFieldMentionsRetry}
                projectUsers={projectUsers}
                usersLoading={isLoadingUsers}
                usersLoadFailed={!!usersLoadError}
                onUsersRetry={retryUsers}
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
            </SidebarBody>
          </Pane>
        </div>
      </MentionPermissionsProvider>
    </ProjectDataProvider>
  );
};

export default CommentsBar;
