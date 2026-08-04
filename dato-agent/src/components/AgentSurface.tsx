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
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import datoMarkUrl from '../assets/dato-mark.svg';
import { MAX_CONVERSATION_MESSAGE_CHARACTERS } from '../lib/conversations';
import {
  BoltIcon,
  ChatIcon,
  CheckIcon,
  CircleCheckIcon,
  ConnectionIcon,
  CopyIcon,
  DisconnectIcon,
  HistoryIcon,
  PlusIcon,
  RetryIcon,
  SendIcon,
  StopIcon,
  WarningIcon,
} from './AgentIcons';
import styles from './AgentSurface.module.css';
import { Markdown } from './Markdown';

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
  modelLabel?: string;
  subtitle?: string;
  statusLabel?: string;
  fieldPath?: string;
};

export type AgentFieldResultViewModel = {
  fieldPath: string;
  title: string;
  locale?: string;
};

export type AgentAssetResultViewModel = {
  uploadId: string;
  title: string;
  deleted?: boolean;
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

export type AgentTranscriptEntry =
  | AgentMessageEntry
  | AgentActivityEntry
  | AgentRecordsEntry
  | AgentFieldsEntry
  | AgentAssetsEntry
  | AgentApprovalEntry;

export type AgentSurfaceProps = {
  connection: AgentConnectionViewModel;
  entries: readonly AgentTranscriptEntry[];
  isRunning?: boolean;
  composerDisabled?: boolean;
  composerPlaceholder?: string;
  onSubmit: (message: string) => void;
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
    entryId: string,
  ) => void | Promise<void>;
  onOpenField?: (
    field: AgentFieldResultViewModel,
    entryId: string,
  ) => void | Promise<void>;
  onOpenAsset?: (
    asset: AgentAssetResultViewModel,
    entryId: string,
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

function MessageEntry({
  entry,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
}: {
  entry: AgentMessageEntry;
  onRetryFailedTurn?: AgentSurfaceProps['onRetryFailedTurn'];
  onCopyFailureDiagnostics?: AgentSurfaceProps['onCopyFailureDiagnostics'];
}) {
  const errorMessage =
    typeof entry.error === 'string'
      ? entry.error.trim() || undefined
      : entry.error || entry.interrupted
        ? 'The response was interrupted.'
        : undefined;

  if (!entry.content && !errorMessage) {
    return null;
  }

  return (
    <article
      className={
        entry.role === 'user'
          ? `${styles.message} ${styles.userMessage}`
          : `${styles.message} ${styles.assistantMessage}${
              errorMessage ? ` ${styles.assistantError}` : ''
            }`
      }
      aria-label={entry.label ?? (entry.role === 'user' ? 'You' : 'Dato agent')}
    >
      {entry.content && <Markdown content={entry.content} />}
      {errorMessage && (
        <p className={styles.inlineError} role="alert">
          {errorMessage}
        </p>
      )}
      {entry.role === 'assistant' && errorMessage && entry.failure && (
        <FailureActions
          failure={entry.failure}
          onCopyDiagnostics={onCopyFailureDiagnostics}
          onRetry={onRetryFailedTurn}
        />
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
  onOpenRecord,
}: {
  disabled?: boolean;
  entry: AgentRecordsEntry;
  onOpenRecord?: AgentSurfaceProps['onOpenRecord'];
}) {
  const singleRecord =
    entry.records.length === 1 ? entry.records[0] : undefined;
  const content = (showOpenAffordance: boolean) => (
    <>
      <span>
        {entry.title ??
          `Showing ${entry.records.length} ${
            entry.records.length === 1 ? 'record' : 'records'
          }`}
      </span>
      <span className={styles.recordReceiptMeta}>
        {entry.records.length}{' '}
        {entry.records.length === 1 ? 'record' : 'records'}
        {showOpenAffordance && <span aria-hidden="true"> →</span>}
      </span>
    </>
  );

  return (
    <aside
      className={styles.recordReceipt}
      aria-label={entry.title ?? 'Records'}
      aria-busy={entry.opening || undefined}
    >
      {singleRecord && onOpenRecord ? (
        <button
          disabled={disabled}
          onClick={() => {
            void Promise.resolve(onOpenRecord(singleRecord, entry.id)).catch(
              () => undefined,
            );
          }}
          type="button"
        >
          {content(true)}
          <span className={styles.visuallyHidden}>Open record</span>
        </button>
      ) : (
        <>
          <div>{content(false)}</div>
          {onOpenRecord && entry.records.length > 1 && (
            <ul className={styles.recordResultList}>
              {entry.records.map((record) => (
                <li key={`${record.itemTypeId ?? 'record'}:${record.itemId}`}>
                  <button
                    aria-label={`Open ${record.title}`}
                    disabled={disabled}
                    onClick={() => {
                      void Promise.resolve(
                        onOpenRecord(record, entry.id),
                      ).catch(() => undefined);
                    }}
                    type="button"
                  >
                    <span>{record.title}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {entry.error && (
        <p className={styles.inlineError} role="alert">
          {entry.error}
        </p>
      )}
    </aside>
  );
}

type ReferenceReceiptItem = {
  key: string;
  title: string;
  meta?: string;
  disabled?: boolean;
  disabledLabel?: string;
};

function ReferenceReceipt({
  disabled,
  entry,
  itemKind,
  items,
  onOpen,
}: {
  disabled?: boolean;
  entry: AgentFieldsEntry | AgentAssetsEntry;
  itemKind: 'field' | 'asset';
  items: readonly ReferenceReceiptItem[];
  onOpen?: (key: string) => void;
}) {
  return (
    <aside
      aria-busy={Boolean(entry.openingKey) || undefined}
      aria-label={entry.title ?? `${itemKind}s`}
      className={styles.recordReceipt}
    >
      <div>
        <span>{entry.title ?? `Referenced ${itemKind}s`}</span>
        <span className={styles.recordReceiptMeta}>
          {items.length} {items.length === 1 ? itemKind : `${itemKind}s`}
        </span>
      </div>
      <ul className={styles.recordResultList}>
        {items.map((item) => (
          <li key={item.key}>
            <button
              aria-label={`${
                itemKind === 'field' ? 'Show' : 'Open'
              } ${item.title}`}
              disabled={disabled || item.disabled || !onOpen}
              onClick={() => onOpen?.(item.key)}
              type="button"
            >
              <span>{item.title}</span>
              <span>
                {item.disabledLabel ??
                  (entry.openingKey === item.key
                    ? 'Opening…'
                    : item.meta || '→')}
              </span>
            </button>
          </li>
        ))}
      </ul>
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
    <ReferenceReceipt
      disabled={disabled}
      entry={entry}
      itemKind="field"
      items={entry.fields.map((field) => ({
        key: `${field.fieldPath}:${field.locale ?? ''}`,
        title: field.title,
        ...(field.locale ? { meta: field.locale } : {}),
      }))}
      onOpen={
        onOpenField
          ? (key) => {
              const field = entry.fields.find(
                (candidate) =>
                  `${candidate.fieldPath}:${candidate.locale ?? ''}` === key,
              );
              if (field) {
                void Promise.resolve(onOpenField(field, entry.id)).catch(
                  () => undefined,
                );
              }
            }
          : undefined
      }
    />
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
    <ReferenceReceipt
      disabled={disabled}
      entry={entry}
      itemKind="asset"
      items={entry.assets.map((asset) => ({
        key: asset.uploadId,
        title: asset.title,
        ...(asset.deleted ? { disabled: true, disabledLabel: 'Deleted' } : {}),
      }))}
      onOpen={
        onOpenAsset
          ? (key) => {
              const asset = entry.assets.find(
                (candidate) => candidate.uploadId === key,
              );
              if (asset && !asset.deleted) {
                void Promise.resolve(onOpenAsset(asset, entry.id)).catch(
                  () => undefined,
                );
              }
            }
          : undefined
      }
    />
  );
}

function approvalActionDisabled(
  disabled: boolean | undefined,
  action: ((approval: UnsafeApprovalViewModel) => void) | undefined,
): boolean {
  return Boolean(disabled) || !action;
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
      <div className={styles.approvalBody}>
        <h3 id={titleId}>{approval.title}</h3>
        <p id={descriptionId}>{approval.description}</p>
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
      </div>
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

function Transcript({
  entries,
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
>) {
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
          entries.map((entry) => {
            switch (entry.kind) {
              case 'message':
                return (
                  <MessageEntry
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
                    disabled={Boolean(
                      isRunning || hostActionPending || entry.opening,
                    )}
                    entry={entry}
                    key={entry.id}
                    onOpenRecord={onOpenRecord}
                  />
                );
              case 'fields':
                return (
                  <FieldsEntry
                    disabled={Boolean(isRunning || hostActionPending)}
                    entry={entry}
                    key={entry.id}
                    onOpenField={onOpenField}
                  />
                );
              case 'assets':
                return (
                  <AssetsEntry
                    disabled={Boolean(isRunning || hostActionPending)}
                    entry={entry}
                    key={entry.id}
                    onOpenAsset={onOpenAsset}
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
          })
        )}
        <div ref={endRef} />
      </div>
    </main>
  );
}

function Composer({
  draft,
  setDraft,
  onSubmit,
  onStop,
  disabled,
  isRunning,
  placeholder,
  persistenceWarning,
  textareaRef,
}: {
  draft: string;
  setDraft: (draft: string) => void;
  onSubmit: (message: string) => void;
  onStop?: () => void;
  disabled: boolean;
  isRunning: boolean;
  placeholder: string;
  persistenceWarning?: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const composerId = useId();
  const inputDisabled = disabled || isRunning;
  const canSubmit = Boolean(draft.trim()) && !inputDisabled;

  const submit = () => {
    const message = draft.trim();

    if (!message || !canSubmit) {
      return;
    }

    onSubmit(message);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.composerInner}>
        <label className={styles.visuallyHidden} htmlFor={composerId}>
          Message the DatoCMS agent
        </label>
        <div className={styles.composerBox}>
          <TextareaAutosize
            className={styles.composerInput}
            disabled={inputDisabled}
            id={composerId}
            maxLength={MAX_CONVERSATION_MESSAGE_CHARACTERS}
            maxRows={6}
            minRows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ref={textareaRef}
            value={draft}
          />
          <button
            aria-label={isRunning ? 'Stop' : 'Send'}
            className={`${styles.sendButton}${
              isRunning ? ` ${styles.stopButton}` : ''
            }`}
            disabled={isRunning ? !onStop : !canSubmit}
            onClick={isRunning ? onStop : undefined}
            title={isRunning ? 'Stop' : 'Send'}
            type={isRunning ? 'button' : 'submit'}
          >
            {isRunning ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
        {persistenceWarning && (
          <p className={styles.composerWarning} role="alert">
            {persistenceWarning}
          </p>
        )}
      </div>
    </form>
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
  const [draft, setDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationActionPending, setConversationActionPending] =
    useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const settingsHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasConnectedRef = useRef(connection.status === 'connected');
  const wasSettingsOpenRef = useRef(false);
  const wasRunningRef = useRef(isRunning);
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
    const becameConnected = connected && !wasConnectedRef.current;

    if (settingsOpen) {
      settingsHeadingRef.current?.focus();
    } else if (
      wasSettingsOpenRef.current ||
      becameConnected ||
      (wasRunningRef.current && !isRunning)
    ) {
      textareaRef.current?.focus();
    }

    wasConnectedRef.current = connected;
    wasSettingsOpenRef.current = settingsOpen;
    wasRunningRef.current = isRunning;
  }, [connected, isRunning, settingsOpen]);

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

      setDraft('');

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
          <Composer
            disabled={composerDisabled}
            draft={draft}
            isRunning={isRunning}
            onStop={onStop}
            onSubmit={onSubmit}
            placeholder={composerPlaceholder}
            persistenceWarning={persistenceWarning}
            setDraft={setDraft}
            textareaRef={textareaRef}
          />
        </>
      )}
    </div>
  );
}

export default AgentSurface;
