import {
  BackIcon,
  Button,
  Form,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipDelayGroup,
  TooltipTrigger,
} from 'datocms-react-ui';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import datoMarkUrl from '../assets/dato-mark.svg';
import type { AgentMentionHost } from '../lib/mentionHost';
import type {
  AgentComposerSubmission,
  CommentSegment,
  Mention,
} from '../lib/mentions';
import { fallbackAssetMention, fallbackRecordMention } from '../lib/mentions';
import { MentionDisplay } from '../recordComments/entrypoints/components/shared/MentionDisplay';
import commentStyles from '../recordComments/entrypoints/styles/comment.module.css';
import {
  BoltIcon,
  ChatIcon,
  CheckIcon,
  CircleCheckIcon,
  ConnectionIcon,
  CopyIcon,
  DisconnectIcon,
  EditIcon,
  HistoryIcon,
  PlusIcon,
  RetryIcon,
  WarningIcon,
} from './AgentIcons';
import styles from './AgentSurface.module.css';
import { Markdown } from './Markdown';
import { MentionComposer } from './MentionComposer';

export type AgentConnectionStatus =
  | 'setup'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type ProviderConfigurationStatus = 'missing' | 'configured';

export type DatoCmsConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type AgentConnectionViewModel = {
  status: AgentConnectionStatus;
  statusLabel?: string;
  detail?: string;
  contextLabel?: string;
  providerConfigStatus?: ProviderConfigurationStatus;
  providerLabel?: string;
  /** @deprecated Kept for older view-model callers during parameter migration. */
  openAiConfigStatus?: ProviderConfigurationStatus;
  datoCmsStatus: DatoCmsConnectionStatus;
  datoCmsAccountLabel?: string;
  datoCmsError?: string;
};

export type AgentConversationSummaryViewModel = {
  id: string;
  title: string;
  preview?: string;
  updatedAtLabel?: string;
  isCurrent?: boolean;
};

export type AgentActivityStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export type AgentActivityViewModel = {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  timestampLabel?: string;
  status: AgentActivityStatus;
};

export type AgentActivityPhase =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentRecordResultViewModel = {
  itemId: string;
  itemTypeId?: string;
  title: string;
  mention?: Extract<Mention, { type: 'record' }>;
  modelLabel?: string;
  subtitle?: string;
  statusLabel?: string;
  fieldPath?: string;
};

export type AgentFieldResultViewModel = {
  fieldPath: string;
  title: string;
  locale?: string;
  mention?: Extract<Mention, { type: 'field' }>;
};

export type AgentAssetResultViewModel = {
  uploadId: string;
  title: string;
  deleted?: boolean;
  mention?: Extract<Mention, { type: 'asset' }>;
};

export type AgentModelResultViewModel = {
  modelId: string;
  apiKey: string;
  title: string;
  isBlockModel: boolean;
};

export type AgentUserResultViewModel = {
  userId: string;
  title: string;
  email: string;
  avatarUrl: string | null;
};

export type UnsafeApprovalStatus =
  | 'pending'
  | 'approving'
  | 'rejecting'
  | 'approved'
  | 'rejected'
  | 'error';

export type UnsafeApprovalDetail = {
  label: string;
  value: string;
};

export type UnsafeApprovalViewModel = {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  details?: readonly UnsafeApprovalDetail[];
  status: UnsafeApprovalStatus;
  error?: string;
  automatic?: boolean;
};

export type AgentMessageEntry = {
  id: string;
  kind: 'message';
  role: 'user' | 'assistant';
  content: string;
  label?: string;
  timestampLabel?: string;
  streaming?: boolean;
  error?: string | boolean;
  interrupted?: boolean;
  segments?: readonly CommentSegment[];
  createdAt?: string;
  failure?: {
    id: string;
    retryable: boolean;
  };
};

export type AgentActivityEntry = {
  id: string;
  kind: 'activity';
  title?: string;
  phase: AgentActivityPhase;
  activities: readonly AgentActivityViewModel[];
};

export type AgentRecordsEntry = {
  id: string;
  kind: 'records';
  title?: string;
  records: readonly AgentRecordResultViewModel[];
  error?: string;
  opening?: boolean;
};

export type AgentFieldsEntry = {
  id: string;
  kind: 'fields';
  title?: string;
  fields: readonly AgentFieldResultViewModel[];
  error?: string;
  openingKey?: string;
};

export type AgentAssetsEntry = {
  id: string;
  kind: 'assets';
  title?: string;
  assets: readonly AgentAssetResultViewModel[];
  error?: string;
  openingKey?: string;
};

export type AgentApprovalEntry = {
  id: string;
  kind: 'approval';
  approval: UnsafeApprovalViewModel;
};

export type AgentMentionsEntry = {
  id: string;
  kind: 'mentions';
  title?: string;
  mentions: readonly Mention[];
  error?: string;
};

export type AgentTranscriptEntry =
  | AgentMessageEntry
  | AgentActivityEntry
  | AgentRecordsEntry
  | AgentFieldsEntry
  | AgentAssetsEntry
  | AgentMentionsEntry
  | AgentApprovalEntry;

export type AgentSurfaceProps = {
  connection: AgentConnectionViewModel;
  entries: readonly AgentTranscriptEntry[];
  isRunning?: boolean;
  composerDisabled?: boolean;
  composerPlaceholder?: string;
  onSubmit: (message: AgentComposerSubmission | string) => void;
  mentionHost?: AgentMentionHost;
  onConnectDatoCms?: () => void;
  onDisconnectDatoCms?: () => void;
  recentConversations?: readonly AgentConversationSummaryViewModel[];
  onSelectConversation?: (
    conversation: AgentConversationSummaryViewModel,
  ) => boolean | undefined | Promise<boolean | undefined>;
  onStartNewChat?: () => boolean | undefined | Promise<boolean | undefined>;
  onStop?: () => void;
  onOpenRecord?: (
    record: AgentRecordResultViewModel,
    entryId?: string,
  ) => void | Promise<void>;
  onOpenField?: (
    field: AgentFieldResultViewModel,
    entryId?: string,
  ) => void | Promise<void>;
  onOpenAsset?: (
    asset: AgentAssetResultViewModel,
    entryId?: string,
  ) => void | Promise<void>;
  hostActionPending?: boolean;
  onReviewUnsafeAction?: (approval: UnsafeApprovalViewModel) => void;
  onApproveUnsafeAction?: (approval: UnsafeApprovalViewModel) => void;
  onRejectUnsafeAction?: (approval: UnsafeApprovalViewModel) => void;
  onRetryFailedTurn?: (failureId: string) => void | Promise<void>;
  onCopyFailureDiagnostics?: (failureId: string) => Promise<void>;
  autoApproveEnabled?: boolean;
  autoApproveChanging?: boolean;
  autoApproveError?: string;
  persistenceWarning?: string;
  onAutoApproveChange?: (
    enabled: boolean,
  ) => boolean | Promise<boolean> | undefined;
};

const ACTIVITY_LABELS: Record<AgentActivityStatus, string> = {
  pending: 'Waiting',
  running: 'In progress',
  success: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
};

type CredentialPanelProps = Pick<
  AgentSurfaceProps,
  | 'connection'
  | 'onConnectDatoCms'
  | 'onDisconnectDatoCms'
  | 'recentConversations'
  | 'onSelectConversation'
  | 'onStartNewChat'
>;

function DatoCmsConnectionField({
  connection,
  onConnectDatoCms,
  onDisconnectDatoCms,
}: Pick<
  CredentialPanelProps,
  'connection' | 'onConnectDatoCms' | 'onDisconnectDatoCms'
>) {
  const datoCmsConnected = connection.datoCmsStatus === 'connected';
  const datoCmsConnecting = connection.datoCmsStatus === 'connecting';
  const accountLabel = connection.datoCmsAccountLabel?.trim();
  const connectedLabel =
    accountLabel && !/remote\s+mcp|^connected\b/i.test(accountLabel)
      ? accountLabel
      : 'DatoCMS';

  return (
    <Form
      className={styles.connectionForm}
      onSubmit={(event) => {
        event.preventDefault();
        onConnectDatoCms?.();
      }}
    >
      <div className={styles.connectionRow}>
        <span className={styles.datoMark}>
          <img alt="" aria-hidden="true" src={datoMarkUrl} />
        </span>
        <strong className={styles.connectionLabel}>{connectedLabel}</strong>
        <span className={styles.connectionActions}>
          {datoCmsConnecting ? (
            <span
              aria-label="Connecting to DatoCMS"
              className={styles.connectionSpinner}
              role="status"
            >
              <Spinner size={16} />
            </span>
          ) : datoCmsConnected ? (
            <>
              <span
                aria-label="Connected"
                className={styles.connectedStatus}
                role="img"
              >
                <CircleCheckIcon />
              </span>
              {onDisconnectDatoCms && (
                <Tooltip placement="left">
                  <TooltipTrigger>
                    <button
                      aria-label="Disconnect DatoCMS"
                      className={`${styles.iconButton} ${styles.disconnectButton}`}
                      onClick={onDisconnectDatoCms}
                      type="button"
                    >
                      <DisconnectIcon />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Disconnect</TooltipContent>
                </Tooltip>
              )}
            </>
          ) : (
            <Button
              buttonSize="xxs"
              buttonType="primary"
              disabled={!onConnectDatoCms}
              type="submit"
            >
              Connect
            </Button>
          )}
        </span>
      </div>

      {connection.datoCmsError && (
        <p className={styles.inlineError} role="alert">
          {connection.datoCmsError}
        </p>
      )}
    </Form>
  );
}

function RecentChats({
  conversations,
  disabled,
  onSelectConversation,
  onStartNewChat,
}: {
  conversations: readonly AgentConversationSummaryViewModel[];
  disabled?: boolean;
  onSelectConversation?: (
    conversation: AgentConversationSummaryViewModel,
  ) => void;
  onStartNewChat?: () => void;
}) {
  const headingId = useId();
  const visibleConversations = conversations.slice(0, 3);

  if (visibleConversations.length === 0 && !onStartNewChat) {
    return null;
  }

  return (
    <section className={styles.recentChats} aria-labelledby={headingId}>
      <div className={styles.recentChatsHeader}>
        <div className={styles.recentChatsTitle}>
          <HistoryIcon />
          <h3 id={headingId}>Chats</h3>
        </div>
        {onStartNewChat && (
          <Tooltip placement="left">
            <TooltipTrigger>
              <button
                aria-label="New chat"
                className={`${styles.iconButton} ${styles.newChatButton}`}
                disabled={disabled}
                onClick={onStartNewChat}
                type="button"
              >
                <PlusIcon />
              </button>
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        )}
      </div>

      {visibleConversations.length > 0 ? (
        <ul className={styles.recentChatsList}>
          {visibleConversations.map((conversation) => {
            const title = conversation.title.trim() || 'Untitled chat';

            return (
              <li key={conversation.id}>
                <button
                  aria-current={conversation.isCurrent ? 'page' : undefined}
                  className={styles.recentChat}
                  disabled={disabled || !onSelectConversation}
                  onClick={() => onSelectConversation?.(conversation)}
                  title={title}
                  type="button"
                >
                  <span className={styles.recentChatIcon}>
                    <ChatIcon />
                  </span>
                  <strong className={styles.recentChatTitle}>{title}</strong>
                  {conversation.isCurrent && (
                    <span
                      aria-label="Current chat"
                      className={styles.currentChatIcon}
                      role="img"
                    >
                      <CheckIcon />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.noRecentChats}>
          <ChatIcon />
          <span>No chats</span>
        </div>
      )}
    </section>
  );
}

function CredentialPanel({
  connection,
  onConnectDatoCms,
  onDisconnectDatoCms,
  recentConversations = [],
  onSelectConversation,
  onStartNewChat,
  isSettings,
  headingRef,
  conversationActionsDisabled,
}: CredentialPanelProps & {
  isSettings: boolean;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  conversationActionsDisabled?: boolean;
}) {
  const providerConfigStatus =
    connection.providerConfigStatus ?? connection.openAiConfigStatus;
  const configuredProviderLabel =
    connection.providerLabel ??
    (connection.openAiConfigStatus ? 'OpenAI' : 'AI provider');

  return (
    <section
      className={styles.credentials}
      aria-labelledby="agent-credentials-title"
    >
      <header className={styles.credentialsHeader}>
        <span className={styles.credentialsHeaderIcon}>
          <ConnectionIcon />
        </span>
        <h2
          id="agent-credentials-title"
          ref={headingRef}
          tabIndex={isSettings ? -1 : undefined}
        >
          Connection
        </h2>
      </header>

      {providerConfigStatus === 'missing' && (
        <div className={styles.configurationNotice} role="status">
          <WarningIcon />
          <span>{configuredProviderLabel} setup required</span>
        </div>
      )}

      <TooltipDelayGroup delay={250}>
        <DatoCmsConnectionField
          connection={connection}
          onConnectDatoCms={onConnectDatoCms}
          onDisconnectDatoCms={onDisconnectDatoCms}
        />
        <RecentChats
          conversations={recentConversations}
          disabled={conversationActionsDisabled}
          onSelectConversation={onSelectConversation}
          onStartNewChat={onStartNewChat}
        />
      </TooltipDelayGroup>
    </section>
  );
}

function EmptyState() {
  return (
    <section className={styles.emptyState} aria-label="Empty conversation">
      <p>What can I help with?</p>
    </section>
  );
}

function FailureActions({
  failure,
  onRetry,
  onCopyDiagnostics,
}: {
  failure: NonNullable<AgentMessageEntry['failure']>;
  onRetry?: AgentSurfaceProps['onRetryFailedTurn'];
  onCopyDiagnostics?: AgentSurfaceProps['onCopyFailureDiagnostics'];
}) {
  const [retryPending, setRetryPending] = useState(false);
  const [copyState, setCopyState] = useState<
    'idle' | 'copying' | 'copied' | 'error'
  >('idle');
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== undefined) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const retry = async () => {
    if (retryPending || !onRetry) {
      return;
    }

    setRetryPending(true);

    try {
      await onRetry(failure.id);
    } catch {
      return;
    } finally {
      setRetryPending(false);
    }
  };

  const copyDiagnostics = async () => {
    if (retryPending || copyState === 'copying' || !onCopyDiagnostics) {
      return;
    }

    if (copiedTimerRef.current !== undefined) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = undefined;
    }

    setCopyState('copying');

    try {
      await onCopyDiagnostics(failure.id);
      setCopyState('copied');
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = undefined;
        setCopyState('idle');
      }, 2_000);
    } catch {
      setCopyState('error');
    }
  };

  return (
    <>
      <div className={styles.failureActions}>
        {failure.retryable && (
          <button
            className={`${styles.failureAction} ${styles.failureActionPrimary}`}
            disabled={retryPending || !onRetry}
            onClick={() => {
              void retry();
            }}
            type="button"
          >
            <RetryIcon />
            <span>{retryPending ? 'Trying again…' : 'Try again'}</span>
          </button>
        )}
        <button
          className={styles.failureAction}
          disabled={
            retryPending || copyState === 'copying' || !onCopyDiagnostics
          }
          onClick={() => {
            void copyDiagnostics();
          }}
          type="button"
        >
          <CopyIcon />
          <span>{copyState === 'copied' ? 'Copied' : 'Copy diagnostics'}</span>
        </button>
      </div>
      <span aria-live="polite" className={styles.visuallyHidden} role="status">
        {copyState === 'copied' ? 'Diagnostics copied' : ''}
      </span>
      {copyState === 'error' && (
        <p className={styles.failureActionError} role="alert">
          Couldn’t copy diagnostics
        </p>
      )}
    </>
  );
}

function mentionIdentity(mention: Mention) {
  return mention.type === 'field'
    ? `${mention.type}:${mention.fieldPath}:${mention.locale ?? ''}`
    : `${mention.type}:${mention.id}`;
}

function withStableKeys<T>(
  values: readonly T[],
  identity: (value: T) => string,
) {
  const occurrences = new Map<string, number>();
  const keyed: Array<{ key: string; value: T }> = [];
  for (const value of values) {
    const base = identity(value);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    keyed.push({ key: `${base}:${occurrence}`, value });
  }
  return keyed;
}

function messageError(entry: AgentMessageEntry) {
  if (typeof entry.error === 'string') return entry.error.trim() || undefined;
  return entry.error || entry.interrupted
    ? 'The response was interrupted.'
    : undefined;
}

function UserMessageContent({
  content,
  mentionHost,
  disabled,
  onOpenMention,
  segments,
}: {
  content: string;
  mentionHost: AgentMentionHost;
  disabled: boolean;
  onOpenMention: (mention: Mention) => void;
  segments?: readonly CommentSegment[];
}) {
  if (!segments?.length)
    return <div className={commentStyles.text}>{content}</div>;

  return (
    <div className={commentStyles.text}>
      {withStableKeys(segments, (segment) =>
        segment.type === 'text'
          ? `text:${segment.content.slice(0, 64)}`
          : mentionIdentity(segment.mention),
      ).map(({ key, value: segment }) =>
        segment.type === 'text' ? (
          <span key={key}>{segment.content}</span>
        ) : (
          <MentionDisplay
            isClickable={
              !disabled &&
              !(
                segment.mention.type === 'user' &&
                segment.mention.id === mentionHost.projectOwnerId
              )
            }
            isProjectOwner={
              segment.mention.type === 'user' &&
              segment.mention.id === mentionHost.projectOwnerId
            }
            key={key}
            mention={segment.mention}
            onClick={() => onOpenMention(segment.mention)}
            projectUsers={[mentionHost.currentUser]}
          />
        ),
      )}
    </div>
  );
}

function AssistantMessageContent({
  entry,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
}: {
  entry: AgentMessageEntry;
  onRetryFailedTurn?: AgentSurfaceProps['onRetryFailedTurn'];
  onCopyFailureDiagnostics?: AgentSurfaceProps['onCopyFailureDiagnostics'];
}) {
  const errorMessage = messageError(entry);

  if (!entry.content && !errorMessage) return null;

  return (
    <div className={styles.agentTurnItem}>
      {entry.content && (
        <Markdown
          className={styles.assistantMarkdown}
          content={entry.content}
        />
      )}
      {errorMessage && (
        <p className={styles.inlineError} role="alert">
          {errorMessage}
        </p>
      )}
      {errorMessage && entry.failure && (
        <FailureActions
          failure={entry.failure}
          onCopyDiagnostics={onCopyFailureDiagnostics}
          onRetry={onRetryFailedTurn}
        />
      )}
    </div>
  );
}

function MessageEntry({
  disabled,
  entry,
  mentionHost,
  onOpenMention,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
}: {
  disabled: boolean;
  entry: AgentMessageEntry;
  mentionHost: AgentMentionHost;
  onOpenMention: (mention: Mention) => void;
  onRetryFailedTurn?: AgentSurfaceProps['onRetryFailedTurn'];
  onCopyFailureDiagnostics?: AgentSurfaceProps['onCopyFailureDiagnostics'];
}) {
  const errorMessage = messageError(entry);

  if (!entry.content && !errorMessage) {
    return null;
  }

  return (
    <article
      aria-label={entry.label ?? (entry.role === 'user' ? 'You' : 'Dato agent')}
      className={
        entry.role === 'user'
          ? `${styles.message} ${styles.userMessage}`
          : `${styles.message} ${styles.assistantMessage}${
              errorMessage ? ` ${styles.assistantError}` : ''
            }`
      }
    >
      {entry.content && entry.role === 'user' && (
        <UserMessageContent
          content={entry.content}
          mentionHost={mentionHost}
          disabled={disabled}
          onOpenMention={onOpenMention}
          segments={entry.segments}
        />
      )}
      {entry.role === 'assistant' && (
        <AssistantMessageContent
          entry={entry}
          onCopyFailureDiagnostics={onCopyFailureDiagnostics}
          onRetryFailedTurn={onRetryFailedTurn}
        />
      )}
      {entry.role === 'user' && errorMessage && (
        <p className={styles.inlineError} role="alert">
          {errorMessage}
        </p>
      )}
    </article>
  );
}

function activitiesWithStatus(
  activities: readonly AgentActivityViewModel[],
  status: AgentActivityStatus,
): AgentActivityViewModel[] {
  return activities.filter((activity) => activity.status === status);
}

function activityPresentation(entry: AgentActivityEntry): {
  summary: string;
  showSpinner: boolean;
  failed: boolean;
} {
  const { activities, phase } = entry;
  const current = activitiesWithStatus(activities, 'running').at(-1);
  const failedCount = activitiesWithStatus(activities, 'error').length;
  const cancelledCount = activitiesWithStatus(activities, 'cancelled').length;
  const completedCount = activitiesWithStatus(activities, 'success').length;
  const pendingCount = activitiesWithStatus(activities, 'pending').length;

  if (phase === 'running') {
    if (current) {
      return { summary: current.label, showSpinner: true, failed: false };
    }

    return {
      summary: failedCount > 0 ? 'Trying another approach…' : 'Working…',
      showSpinner: true,
      failed: false,
    };
  }

  if (phase === 'failed') {
    return {
      summary: 'Couldn’t complete this request',
      showSpinner: false,
      failed: true,
    };
  }

  if (phase === 'cancelled' || cancelledCount > 0) {
    return { summary: 'Stopped', showSpinner: false, failed: false };
  }

  if (phase === 'waiting' || pendingCount > 0) {
    return {
      summary: 'Waiting for approval',
      showSpinner: false,
      failed: false,
    };
  }

  if (failedCount > 0) {
    return {
      summary: 'DatoCMS activity',
      showSpinner: false,
      failed: false,
    };
  }

  return {
    summary: `${completedCount} ${
      completedCount === 1 ? 'step' : 'steps'
    } completed`,
    showSpinner: false,
    failed: false,
  };
}

function activityStatusLabel(
  activity: AgentActivityViewModel,
  phase: AgentActivityPhase,
): string {
  if (activity.timestampLabel) {
    return activity.timestampLabel;
  }

  if (activity.status !== 'error' || phase === 'failed') {
    return ACTIVITY_LABELS[activity.status];
  }

  return phase === 'running' ? 'Trying another approach' : 'Not completed';
}

function ActivityItem({
  activity,
  phase,
}: {
  activity: AgentActivityViewModel;
  phase: AgentActivityPhase;
}) {
  const recoverable = activity.status === 'error' && phase !== 'failed';

  return (
    <li
      className={`${styles.activityItem} ${
        recoverable
          ? styles.activityRecoverable
          : styles[`activity_${activity.status}`]
      }`}
    >
      <span className={styles.activityMarker} aria-hidden="true" />
      <div className={styles.activityContent}>
        <div className={styles.activityHeading}>
          <strong>{activity.label}</strong>
          <span>{activityStatusLabel(activity, phase)}</span>
        </div>
        {activity.description && <p>{activity.description}</p>}
        {activity.detail && <pre>{activity.detail}</pre>}
      </div>
    </li>
  );
}

function ActivityEntry({ entry }: { entry: AgentActivityEntry }) {
  if (entry.activities.length === 0 && entry.phase !== 'running') {
    return null;
  }

  const presentation = activityPresentation(entry);

  return (
    <details
      className={`${styles.activityDisclosure}${
        presentation.failed ? ` ${styles.activityDisclosureFailed}` : ''
      }`}
    >
      <summary>
        {presentation.showSpinner && <Spinner size={14} />}
        <span>{presentation.summary}</span>
      </summary>
      {entry.activities.length > 0 && (
        <ol className={styles.activityList}>
          {entry.activities.map((activity) => (
            <ActivityItem
              activity={activity}
              key={activity.id}
              phase={entry.phase}
            />
          ))}
        </ol>
      )}
    </details>
  );
}

function RecordsEntry({
  disabled,
  entry,
  mentionHost,
  onOpenRecord,
}: {
  disabled?: boolean;
  entry: AgentRecordsEntry;
  mentionHost: AgentMentionHost;
  onOpenRecord?: AgentSurfaceProps['onOpenRecord'];
}) {
  const modelsById = new Map(
    mentionHost.projectModels.map((model) => [model.id, model]),
  );

  return (
    <aside
      aria-busy={entry.opening || undefined}
      aria-label={entry.title ?? 'Records'}
      className={styles.mentionReceipt}
    >
      {entry.title && (
        <span className={styles.mentionReceiptTitle}>{entry.title}</span>
      )}
      <div className={styles.mentionReceiptItems}>
        {entry.records.map((record) => {
          const model = record.itemTypeId
            ? modelsById.get(record.itemTypeId)
            : undefined;
          const mention =
            record.mention ??
            fallbackRecordMention({
              id: record.itemId,
              title: record.title,
              ...(model
                ? {
                    model: {
                      modelId: model.id,
                      modelApiKey: model.apiKey,
                      modelName: model.name,
                      modelEmoji: null,
                      isSingleton: false,
                    },
                  }
                : {}),
            });
          return (
            <MentionDisplay
              accessibleLabel={`Open ${mention.title}`}
              isClickable={!disabled && Boolean(onOpenRecord)}
              key={`${record.itemTypeId ?? 'record'}:${record.itemId}`}
              mention={mention}
              onClick={() => {
                if (!disabled && onOpenRecord) {
                  void Promise.resolve(onOpenRecord(record, entry.id)).catch(
                    () => undefined,
                  );
                }
              }}
            />
          );
        })}
      </div>
      {entry.error && (
        <p className={styles.inlineError} role="alert">
          {entry.error}
        </p>
      )}
    </aside>
  );
}

function FieldsEntry({
  disabled,
  entry,
  onOpenField,
}: {
  disabled?: boolean;
  entry: AgentFieldsEntry;
  onOpenField?: AgentSurfaceProps['onOpenField'];
}) {
  return (
    <aside
      aria-busy={Boolean(entry.openingKey) || undefined}
      aria-label={entry.title ?? 'Fields'}
      className={styles.mentionReceipt}
    >
      {entry.title && (
        <span className={styles.mentionReceiptTitle}>{entry.title}</span>
      )}
      <div className={styles.mentionReceiptItems}>
        {entry.fields.map((field) => (
          <MentionDisplay
            accessibleLabel={`Show ${field.title}`}
            isClickable={!disabled && Boolean(onOpenField)}
            key={`${field.fieldPath}:${field.locale ?? ''}`}
            mention={
              field.mention ?? {
                type: 'field',
                apiKey: field.fieldPath.split('.').at(-1) || field.fieldPath,
                label: field.title,
                localized: Boolean(field.locale),
                fieldPath: field.fieldPath,
                ...(field.locale ? { locale: field.locale } : {}),
              }
            }
            onClick={() => {
              if (!disabled && onOpenField) {
                void Promise.resolve(onOpenField(field, entry.id)).catch(
                  () => undefined,
                );
              }
            }}
          />
        ))}
      </div>
      {entry.error && <p className={styles.inlineError}>{entry.error}</p>}
    </aside>
  );
}

function AssetsEntry({
  disabled,
  entry,
  onOpenAsset,
}: {
  disabled?: boolean;
  entry: AgentAssetsEntry;
  onOpenAsset?: AgentSurfaceProps['onOpenAsset'];
}) {
  return (
    <aside
      aria-busy={Boolean(entry.openingKey) || undefined}
      aria-label={entry.title ?? 'Assets'}
      className={styles.mentionReceipt}
    >
      {entry.title && (
        <span className={styles.mentionReceiptTitle}>{entry.title}</span>
      )}
      <div className={styles.mentionReceiptItems}>
        {entry.assets.map((asset) => (
          <span className={styles.mentionReceiptItem} key={asset.uploadId}>
            <MentionDisplay
              accessibleLabel={`Open ${asset.title}`}
              assetLayout="row"
              isClickable={!disabled && !asset.deleted && Boolean(onOpenAsset)}
              mention={
                asset.mention ??
                fallbackAssetMention(asset.uploadId, asset.title)
              }
              onClick={() => {
                if (!disabled && !asset.deleted && onOpenAsset) {
                  void Promise.resolve(onOpenAsset(asset, entry.id)).catch(
                    () => undefined,
                  );
                }
              }}
            />
            {asset.deleted && (
              <span className={styles.mentionReceiptState}>Deleted</span>
            )}
          </span>
        ))}
      </div>
      {entry.error && <p className={styles.inlineError}>{entry.error}</p>}
    </aside>
  );
}

function MentionsEntry({
  disabled,
  entry,
  mentionHost,
}: {
  disabled?: boolean;
  entry: AgentMentionsEntry;
  mentionHost: AgentMentionHost;
}) {
  return (
    <aside
      aria-label={entry.title ?? 'References'}
      className={styles.mentionReceipt}
    >
      {entry.title && (
        <span className={styles.mentionReceiptTitle}>{entry.title}</span>
      )}
      <div className={styles.mentionReceiptItems}>
        {withStableKeys(entry.mentions, mentionIdentity).map(
          ({ key, value: mention }) => {
            const isOwner =
              mention.type === 'user' &&
              mention.id === mentionHost.projectOwnerId;
            const isOpenable =
              !disabled &&
              !isOwner &&
              (mention.type === 'user' ||
                mention.type === 'model' ||
                mention.type === 'file');
            return (
              <MentionDisplay
                accessibleLabel={
                  mention.type === 'user'
                    ? `Open ${mention.name}`
                    : mention.type === 'model'
                      ? `Open ${mention.name}`
                      : mention.type === 'file'
                        ? `Show details for ${mention.filename}`
                        : undefined
                }
                assetLayout="row"
                isClickable={isOpenable}
                isProjectOwner={isOwner}
                key={key}
                mention={mention}
                onClick={() => {
                  if (!isOpenable) return;
                  if (mention.type === 'user') {
                    void mentionHost.openUser(mention.id);
                  } else if (mention.type === 'model') {
                    mentionHost.openModel(mention.id, mention.isBlockModel);
                  } else if (mention.type === 'file') {
                    void mentionHost.openLocalFile(mention);
                  }
                }}
                projectUsers={entry.mentions.filter(
                  (
                    candidate,
                  ): candidate is Extract<Mention, { type: 'user' }> =>
                    candidate.type === 'user',
                )}
              />
            );
          },
        )}
      </div>
      {entry.error && <p className={styles.inlineError}>{entry.error}</p>}
    </aside>
  );
}

function approvalActionDisabled(
  disabled: boolean | undefined,
  action: ((approval: UnsafeApprovalViewModel) => void) | undefined,
): boolean {
  return Boolean(disabled) || !action;
}

function ApprovalFooter({
  approval,
  canDecide,
  disabled,
  onReview,
  onApprove,
  onReject,
}: {
  approval: UnsafeApprovalViewModel;
  canDecide: boolean;
  disabled?: boolean;
  onReview?: (approval: UnsafeApprovalViewModel) => void;
  onApprove?: (approval: UnsafeApprovalViewModel) => void;
  onReject?: (approval: UnsafeApprovalViewModel) => void;
}) {
  const hasDetails = Boolean(approval.details?.length && onReview);
  if (!hasDetails && !canDecide) {
    return null;
  }

  return (
    <div className={styles.approvalFooter}>
      {hasDetails && (
        <button
          aria-haspopup="dialog"
          className={styles.approvalDetailsButton}
          disabled={disabled}
          onClick={() => onReview?.(approval)}
          type="button"
        >
          Review details
        </button>
      )}
      {canDecide && (
        <div className={styles.approvalActions}>
          <Button
            buttonSize="xs"
            buttonType="negative"
            disabled={approvalActionDisabled(disabled, onReject)}
            onClick={() => onReject?.(approval)}
          >
            Deny
          </Button>
          <Button
            buttonSize="xs"
            buttonType="primary"
            disabled={approvalActionDisabled(disabled, onApprove)}
            onClick={() => onApprove?.(approval)}
          >
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}

function ApprovalEntry({
  approval,
  disabled,
  onReview,
  onApprove,
  onReject,
}: {
  approval: UnsafeApprovalViewModel;
  disabled?: boolean;
  onReview?: (approval: UnsafeApprovalViewModel) => void;
  onApprove?: (approval: UnsafeApprovalViewModel) => void;
  onReject?: (approval: UnsafeApprovalViewModel) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();

  if (approval.automatic && !approval.error) {
    return null;
  }

  const canDecide = approval.status === 'pending';
  const statusMessage =
    approval.error ??
    {
      pending: undefined,
      approving: 'Approving…',
      rejecting: 'Denying…',
      approved: 'Approved.',
      rejected: 'Denied. No action was taken.',
      error: 'This change could not be approved.',
    }[approval.status];
  const isResolved =
    approval.status === 'approved' || approval.status === 'rejected';

  if (isResolved) {
    return (
      <section
        aria-label={`${approval.title}. ${statusMessage}`}
        className={`${styles.approvalCard} ${styles.approvalCardResolved}`}
        role="group"
      >
        <span className={styles.approvalIcon}>
          <EditIcon />
        </span>
        <p className={styles.approvalResolution} role="status">
          {statusMessage}
        </p>
        {approval.details && approval.details.length > 0 && onReview && (
          <button
            aria-haspopup="dialog"
            className={styles.approvalDetailsButton}
            disabled={disabled}
            onClick={() => onReview(approval)}
            type="button"
          >
            Review details
          </button>
        )}
      </section>
    );
  }

  return (
    <section
      aria-describedby={`${descriptionId}${statusMessage ? ` ${statusId}` : ''}`}
      aria-labelledby={titleId}
      className={styles.approvalCard}
      role="group"
    >
      <div className={styles.approvalHeader}>
        <span className={styles.approvalIcon}>
          <EditIcon />
        </span>
        <div className={styles.approvalBody}>
          <h3 id={titleId}>{approval.title}</h3>
          <p id={descriptionId}>{approval.description}</p>
        </div>
      </div>
      <ApprovalFooter
        approval={approval}
        canDecide={canDecide}
        disabled={disabled}
        onApprove={onApprove}
        onReject={onReject}
        onReview={onReview}
      />
      {statusMessage && (
        <p
          className={
            approval.error || approval.status === 'error'
              ? styles.inlineError
              : styles.approvalResolution
          }
          id={statusId}
          role={
            approval.error || approval.status === 'error' ? 'alert' : 'status'
          }
        >
          {statusMessage}
        </p>
      )}
    </section>
  );
}

type TranscriptGroup =
  | { kind: 'user'; id: string; entry: AgentMessageEntry }
  | { kind: 'agent'; id: string; entries: AgentTranscriptEntry[] };

function groupTranscriptEntries(
  entries: readonly AgentTranscriptEntry[],
): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];

  for (const entry of entries) {
    if (entry.kind === 'message' && entry.role === 'user') {
      groups.push({ kind: 'user', id: `user:${entry.id}`, entry });
      continue;
    }

    const previous = groups.at(-1);
    if (previous?.kind === 'agent') {
      previous.entries.push(entry);
    } else {
      groups.push({
        kind: 'agent',
        id: `agent:${entry.id}`,
        entries: [entry],
      });
    }
  }

  return groups;
}

function agentEntryIsVisible(entry: AgentTranscriptEntry): boolean {
  switch (entry.kind) {
    case 'message':
      return (
        entry.role === 'assistant' &&
        Boolean(entry.content || messageError(entry))
      );
    case 'activity':
      return entry.phase === 'running' || entry.activities.length > 0;
    case 'approval':
      return !entry.approval.automatic || Boolean(entry.approval.error);
    case 'records':
      return Boolean(entry.title || entry.error || entry.records.length > 0);
    case 'fields':
      return Boolean(entry.title || entry.error || entry.fields.length > 0);
    case 'assets':
      return Boolean(entry.title || entry.error || entry.assets.length > 0);
    case 'mentions':
      return Boolean(entry.title || entry.error || entry.mentions.length > 0);
  }
}

type TranscriptMentionActions = Pick<
  AgentSurfaceProps,
  'onOpenRecord' | 'onOpenField' | 'onOpenAsset'
> & { mentionHost: AgentMentionHost };

function ignoreHostActionFailure(result: void | Promise<void>) {
  void Promise.resolve(result).catch(() => undefined);
}

function openTranscriptMention(
  mention: Mention,
  actions: TranscriptMentionActions,
) {
  switch (mention.type) {
    case 'record':
      if (!actions.onOpenRecord) return;
      ignoreHostActionFailure(
        actions.onOpenRecord({
          itemId: mention.id,
          itemTypeId: mention.modelId,
          title: mention.title,
        }),
      );
      return;
    case 'field':
      if (!actions.onOpenField) return;
      ignoreHostActionFailure(
        actions.onOpenField({
          fieldPath: mention.fieldPath,
          title: mention.label,
          ...(mention.locale ? { locale: mention.locale } : {}),
        }),
      );
      return;
    case 'asset':
      if (!actions.onOpenAsset) return;
      ignoreHostActionFailure(
        actions.onOpenAsset({ uploadId: mention.id, title: mention.filename }),
      );
      return;
    case 'file':
      ignoreHostActionFailure(actions.mentionHost.openLocalFile(mention));
      return;
    case 'model':
      actions.mentionHost.openModel(mention.id, mention.isBlockModel);
      return;
    case 'user':
      ignoreHostActionFailure(actions.mentionHost.openUser(mention.id));
  }
}

function AgentTurnEntry({
  entries,
  hostActionPending,
  mentionHost,
  onApproveUnsafeAction,
  onCopyFailureDiagnostics,
  onOpenAsset,
  onOpenField,
  onOpenRecord,
  onRejectUnsafeAction,
  onRetryFailedTurn,
  onReviewUnsafeAction,
}: {
  entries: readonly AgentTranscriptEntry[];
  hostActionPending?: boolean;
  mentionHost: AgentMentionHost;
  onApproveUnsafeAction?: AgentSurfaceProps['onApproveUnsafeAction'];
  onCopyFailureDiagnostics?: AgentSurfaceProps['onCopyFailureDiagnostics'];
  onOpenAsset?: AgentSurfaceProps['onOpenAsset'];
  onOpenField?: AgentSurfaceProps['onOpenField'];
  onOpenRecord?: AgentSurfaceProps['onOpenRecord'];
  onRejectUnsafeAction?: AgentSurfaceProps['onRejectUnsafeAction'];
  onRetryFailedTurn?: AgentSurfaceProps['onRetryFailedTurn'];
  onReviewUnsafeAction?: AgentSurfaceProps['onReviewUnsafeAction'];
}) {
  const visibleEntries = entries.filter(agentEntryIsVisible);
  if (visibleEntries.length === 0) return null;

  const label =
    visibleEntries.find(
      (entry): entry is AgentMessageEntry => entry.kind === 'message',
    )?.label ?? 'Dato agent';

  return (
    <article
      aria-label={label}
      className={`${styles.message} ${styles.assistantMessage}`}
    >
      <div className={styles.agentTurnContent}>
        {visibleEntries.map((entry) => {
          switch (entry.kind) {
            case 'message':
              return (
                <AssistantMessageContent
                  entry={entry}
                  key={entry.id}
                  onCopyFailureDiagnostics={onCopyFailureDiagnostics}
                  onRetryFailedTurn={onRetryFailedTurn}
                />
              );
            case 'activity':
              return <ActivityEntry entry={entry} key={entry.id} />;
            case 'records':
              return (
                <RecordsEntry
                  disabled={Boolean(hostActionPending || entry.opening)}
                  entry={entry}
                  key={entry.id}
                  mentionHost={mentionHost}
                  onOpenRecord={onOpenRecord}
                />
              );
            case 'fields':
              return (
                <FieldsEntry
                  disabled={Boolean(hostActionPending)}
                  entry={entry}
                  key={entry.id}
                  onOpenField={onOpenField}
                />
              );
            case 'assets':
              return (
                <AssetsEntry
                  disabled={Boolean(hostActionPending)}
                  entry={entry}
                  key={entry.id}
                  onOpenAsset={onOpenAsset}
                />
              );
            case 'mentions':
              return (
                <MentionsEntry
                  disabled={Boolean(hostActionPending)}
                  entry={entry}
                  key={entry.id}
                  mentionHost={mentionHost}
                />
              );
            case 'approval':
              return (
                <ApprovalEntry
                  approval={entry.approval}
                  disabled={hostActionPending}
                  key={entry.id}
                  onApprove={onApproveUnsafeAction}
                  onReject={onRejectUnsafeAction}
                  onReview={onReviewUnsafeAction}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    </article>
  );
}

function Transcript({
  entries,
  mentionHost,
  onOpenRecord,
  onOpenField,
  onOpenAsset,
  onReviewUnsafeAction,
  onApproveUnsafeAction,
  onRejectUnsafeAction,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
  isRunning,
  hostActionPending,
}: Pick<
  AgentSurfaceProps,
  | 'entries'
  | 'onOpenRecord'
  | 'onOpenField'
  | 'onOpenAsset'
  | 'onReviewUnsafeAction'
  | 'onApproveUnsafeAction'
  | 'onRejectUnsafeAction'
  | 'onRetryFailedTurn'
  | 'onCopyFailureDiagnostics'
  | 'isRunning'
  | 'hostActionPending'
> & { mentionHost: AgentMentionHost }) {
  const transcriptRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    void entries;
    void isRunning;

    if (shouldAutoScrollRef.current) {
      endRef.current?.scrollIntoView?.({ block: 'end' });
    }
  }, [entries, isRunning]);

  return (
    <main
      aria-busy={isRunning}
      aria-live="polite"
      aria-relevant="additions text"
      className={styles.transcript}
      onScroll={() => {
        const transcript = transcriptRef.current;

        if (!transcript) {
          return;
        }

        shouldAutoScrollRef.current =
          transcript.scrollHeight -
            transcript.scrollTop -
            transcript.clientHeight <=
          80;
      }}
      ref={transcriptRef}
      role="log"
    >
      <div className={styles.transcriptInner}>
        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          groupTranscriptEntries(entries).map((group) =>
            group.kind === 'user' ? (
              <MessageEntry
                disabled={Boolean(hostActionPending)}
                entry={group.entry}
                key={group.id}
                mentionHost={mentionHost}
                onOpenMention={(mention) => {
                  if (hostActionPending) return;
                  openTranscriptMention(mention, {
                    mentionHost,
                    onOpenAsset,
                    onOpenField,
                    onOpenRecord,
                  });
                }}
                onCopyFailureDiagnostics={onCopyFailureDiagnostics}
                onRetryFailedTurn={onRetryFailedTurn}
              />
            ) : (
              <AgentTurnEntry
                entries={group.entries}
                hostActionPending={hostActionPending}
                key={group.id}
                mentionHost={mentionHost}
                onApproveUnsafeAction={onApproveUnsafeAction}
                onCopyFailureDiagnostics={onCopyFailureDiagnostics}
                onOpenAsset={onOpenAsset}
                onOpenField={onOpenField}
                onOpenRecord={onOpenRecord}
                onRejectUnsafeAction={onRejectUnsafeAction}
                onRetryFailedTurn={onRetryFailedTurn}
                onReviewUnsafeAction={onReviewUnsafeAction}
              />
            ),
          )
        )}
        <div ref={endRef} />
      </div>
    </main>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" className={styles.settingsIcon} viewBox="0 0 24 24">
      <path
        className={styles.settingsIconPath}
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
      />
      <circle className={styles.settingsIconPath} cx="12" cy="12" r="3" />
    </svg>
  );
}

function UtilityControls({
  connected,
  settingsOpen,
  autoApproveEnabled,
  autoApproveChanging,
  autoApproveError,
  disabled,
  onAutoApproveChange,
  onToggleSettings,
}: {
  connected: boolean;
  settingsOpen: boolean;
  autoApproveEnabled: boolean;
  autoApproveChanging: boolean;
  autoApproveError?: string;
  disabled: boolean;
  onAutoApproveChange?: (
    enabled: boolean,
  ) => boolean | Promise<boolean> | undefined;
  onToggleSettings: () => void;
}) {
  if (!connected) {
    return null;
  }

  return (
    <div className={styles.utilityBar}>
      {!settingsOpen && (
        <Tooltip placement="bottom">
          <TooltipTrigger>
            <button
              aria-label={
                autoApproveChanging
                  ? 'Confirming auto-approve'
                  : autoApproveEnabled
                    ? 'Turn off auto-approve'
                    : 'Turn on auto-approve'
              }
              aria-pressed={autoApproveEnabled}
              className={`${styles.autoApproveControl}${
                autoApproveEnabled ? ` ${styles.autoApproveControlEnabled}` : ''
              }`}
              disabled={disabled || !onAutoApproveChange}
              onClick={() => {
                void onAutoApproveChange?.(!autoApproveEnabled);
              }}
              type="button"
            >
              {autoApproveChanging ? <Spinner size={14} /> : <BoltIcon />}
              <span>Auto</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {autoApproveEnabled
              ? 'Turn off auto-approve'
              : 'Turn on auto-approve'}
          </TooltipContent>
        </Tooltip>
      )}
      <button
        aria-label={settingsOpen ? 'Back to chat' : 'Connection settings'}
        className={styles.utilityButton}
        disabled={disabled}
        onClick={onToggleSettings}
        title={settingsOpen ? 'Back to chat' : 'Connection settings'}
        type="button"
      >
        {settingsOpen ? <BackIcon height={13} width={13} /> : <SettingsIcon />}
      </button>
      {autoApproveError && !settingsOpen && (
        <span className={styles.autoApproveToolbarError} role="alert">
          {autoApproveError}
        </span>
      )}
    </div>
  );
}

export function AgentSurface({
  connection,
  entries,
  isRunning = false,
  composerDisabled = false,
  composerPlaceholder = 'Ask the agent to find, create, or update content…',
  onSubmit,
  mentionHost,
  onConnectDatoCms,
  onDisconnectDatoCms,
  recentConversations = [],
  onSelectConversation,
  onStartNewChat,
  onStop,
  onOpenRecord,
  onOpenField,
  onOpenAsset,
  hostActionPending = false,
  onReviewUnsafeAction,
  onApproveUnsafeAction,
  onRejectUnsafeAction,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
  autoApproveEnabled = false,
  autoApproveChanging = false,
  autoApproveError,
  persistenceWarning,
  onAutoApproveChange,
}: AgentSurfaceProps) {
  const resolvedMentionHost =
    mentionHost ??
    ({
      currentUser: {
        id: 'current-user',
        name: 'You',
        email: '',
        avatarUrl: null,
        userType: 'user',
      },
      projectOwnerId: 'project-owner',
      projectModels: [],
      recordModels: [],
      canMentionFields: false,
      canMentionAssets: false,
      canMentionModels: false,
      loadProjectUsers: async () => [],
      selectAsset: async () => undefined,
      selectRecord: async () => undefined,
      resolveAsset: async ({ uploadId, label }) =>
        fallbackAssetMention(uploadId, label || `Asset #${uploadId}`),
      resolveRecord: async ({ itemId, label }) =>
        fallbackRecordMention({
          id: itemId,
          title: label || `Record #${itemId}`,
        }),
      openUser: () => undefined,
      openModel: () => undefined,
      openLocalFile: async () => undefined,
    } satisfies AgentMentionHost);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationActionPending, setConversationActionPending] =
    useState(false);
  const settingsHeadingRef = useRef<HTMLHeadingElement>(null);
  const composerRegionRef = useRef<HTMLDivElement>(null);
  const connected = connection.status === 'connected';
  const showCredentials = !connected || settingsOpen;
  const hasUnsettledApproval = entries.some(
    (entry) =>
      entry.kind === 'approval' &&
      ['pending', 'approving', 'rejecting'].includes(entry.approval.status),
  );
  const conversationActionsDisabled =
    conversationActionPending ||
    autoApproveChanging ||
    hostActionPending ||
    isRunning ||
    hasUnsettledApproval ||
    connection.status === 'connecting' ||
    connection.datoCmsStatus === 'connecting';

  useEffect(() => {
    if (settingsOpen) {
      settingsHeadingRef.current?.focus();
    }
  }, [settingsOpen]);

  useEffect(() => {
    if (!showCredentials && !isRunning && !composerDisabled) {
      composerRegionRef.current
        ?.querySelector<HTMLElement>('[role="textbox"]')
        ?.focus();
    }
  }, [composerDisabled, isRunning, showCredentials]);

  const runConversationAction = async (
    action: () => boolean | undefined | Promise<boolean | undefined>,
  ) => {
    if (conversationActionPending) {
      return;
    }

    setConversationActionPending(true);

    try {
      const completed = await action();

      if (completed === false) {
        return;
      }

      if (connected) {
        setSettingsOpen(false);
      }
    } catch {
      return;
    } finally {
      setConversationActionPending(false);
    }
  };

  return (
    <div className={styles.root}>
      <UtilityControls
        autoApproveChanging={autoApproveChanging}
        autoApproveEnabled={autoApproveEnabled}
        autoApproveError={autoApproveError}
        connected={connected}
        disabled={
          isRunning ||
          hasUnsettledApproval ||
          autoApproveChanging ||
          hostActionPending
        }
        onAutoApproveChange={onAutoApproveChange}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        settingsOpen={settingsOpen}
      />

      {showCredentials ? (
        <div className={styles.credentialsScroller}>
          <CredentialPanel
            connection={connection}
            conversationActionsDisabled={conversationActionsDisabled}
            headingRef={settingsOpen ? settingsHeadingRef : undefined}
            isSettings={connected}
            onConnectDatoCms={onConnectDatoCms}
            onDisconnectDatoCms={onDisconnectDatoCms}
            onSelectConversation={
              onSelectConversation
                ? (conversation) => {
                    void runConversationAction(() =>
                      onSelectConversation(conversation),
                    );
                  }
                : undefined
            }
            onStartNewChat={
              onStartNewChat
                ? () => {
                    void runConversationAction(onStartNewChat);
                  }
                : undefined
            }
            recentConversations={recentConversations}
          />
        </div>
      ) : (
        <>
          <Transcript
            entries={entries}
            isRunning={isRunning}
            mentionHost={resolvedMentionHost}
            onApproveUnsafeAction={onApproveUnsafeAction}
            onCopyFailureDiagnostics={onCopyFailureDiagnostics}
            onOpenAsset={onOpenAsset}
            onOpenField={onOpenField}
            onOpenRecord={onOpenRecord}
            hostActionPending={hostActionPending}
            onRejectUnsafeAction={onRejectUnsafeAction}
            onRetryFailedTurn={onRetryFailedTurn}
            onReviewUnsafeAction={onReviewUnsafeAction}
          />
          <div className={styles.composer} ref={composerRegionRef}>
            <div className={styles.composerInner}>
              <MentionComposer
                disabled={composerDisabled}
                host={resolvedMentionHost}
                isRunning={isRunning}
                navigation={{
                  handleOpenAsset: async (assetId) => {
                    await onOpenAsset?.({
                      uploadId: assetId,
                      title: `Asset ${assetId}`,
                    });
                  },
                  handleOpenFile: resolvedMentionHost.openLocalFile,
                  handleOpenRecord: async (recordId, modelId) => {
                    await onOpenRecord?.({
                      itemId: recordId,
                      itemTypeId: modelId,
                      title: `Record ${recordId}`,
                    });
                  },
                  handleScrollToField: async (
                    fieldPath,
                    _localized,
                    locale,
                  ) => {
                    await onOpenField?.({
                      fieldPath,
                      title: fieldPath,
                      ...(locale ? { locale } : {}),
                    });
                  },
                  handleOpenModel: resolvedMentionHost.openModel,
                  handleOpenUser: resolvedMentionHost.openUser,
                }}
                onStop={onStop}
                onSubmit={onSubmit}
                persistenceWarning={persistenceWarning}
                placeholder={composerPlaceholder}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AgentSurface;
