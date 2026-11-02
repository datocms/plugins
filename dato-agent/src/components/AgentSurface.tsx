import { useRegisterActions } from 'datocms-react-ui/Actions';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import EntityRow from 'datocms-react-ui/EntityRow';
import FeedbackDot, {
  type FeedbackDotProps,
} from 'datocms-react-ui/FeedbackDot';
import InfoList from 'datocms-react-ui/InfoList';
import Pane from 'datocms-react-ui/Pane';
import Pill from 'datocms-react-ui/Pill';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import Spinner from 'datocms-react-ui/Spinner';
import SplitButton from 'datocms-react-ui/SplitButton';
import Toolbar from 'datocms-react-ui/Toolbar';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AddIcon, BoltIcon, HistoryIcon } from '../icons';
import { DEFAULT_MAX_CONVERSATIONS } from '../lib/conversations';
import {
  MCP_ACCESS_CHANGE_URL,
  type McpAccessLevel,
  mcpAccessLabel,
} from '../lib/mcpAccess';
import type { AgentMentionHost } from '../lib/mentionHost';
import type {
  AgentComposerSubmission,
  CommentSegment,
  Mention,
} from '../lib/mentions';
import { fallbackAssetMention, fallbackRecordMention } from '../lib/mentions';
import styles from './AgentSurface.module.css';
import FullFrame from './FullFrame';
import { MentionComposer } from './MentionComposer';
import { Transcript } from './transcript/Transcript';

export type AgentConnectionStatus =
  | 'setup'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type ProviderConfigurationStatus = 'missing' | 'configured';

export type DatoCmsConnectionStatus =
  | 'mcp_auth_required'
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
  /** The name of the open project, the one to authorize */
  projectName?: string;
  oauthAccessLevel?: McpAccessLevel;
  pluginReadOnly?: boolean;
  accessChecking?: boolean;
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

export type UnsafeApprovalScript = {
  language: 'typescript';
  source: string;
};

export type UnsafeApprovalOutcomeViewModel = {
  kind: 'failed_before_execution' | 'failed_after_execution' | 'unknown';
  diagnostic?: string;
};

export type UnsafeApprovalRecoveryViewModel = {
  status: 'available' | 'starting';
};

export type UnsafeApprovalViewModel = {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  details?: readonly UnsafeApprovalDetail[];
  script?: UnsafeApprovalScript;
  outcome?: UnsafeApprovalOutcomeViewModel;
  recovery?: UnsafeApprovalRecoveryViewModel;
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
  /**
   * Host-authored terminal notice persisted with the assistant message but
   * deliberately omitted from the live transcript while its outcome card is
   * visible. After reload it is restored as ordinary assistant text.
   */
  durableOutcomeNotice?: string;
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
  currentRecordId?: string;
  isRunning?: boolean;
  composerDisabled?: boolean;
  composerPlaceholder?: string;
  onSubmit: (message: AgentComposerSubmission | string) => void;
  mentionHost?: AgentMentionHost;
  onConnectDatoCms?: () => void;
  onDisconnectDatoCms?: () => void;
  onCheckDatoCmsAccess?: () => void;
  onRestartDatoCmsConnection?: () => void;
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
  onRepairUnsafeAction?: (approval: UnsafeApprovalViewModel) => void;
  onRetryFailedTurn?: (failureId: string) => void | Promise<void>;
  onCopyFailureDiagnostics?: (failureId: string) => Promise<void>;
  autoApproveEnabled?: boolean;
  autoApproveChanging?: boolean;
  autoApproveDisabledReason?: string;
  persistenceWarning?: string;
  onAutoApproveChange?: (
    enabled: boolean,
  ) => boolean | Promise<boolean> | undefined;
};

type ConnectionActionProps = Pick<
  AgentSurfaceProps,
  | 'connection'
  | 'onConnectDatoCms'
  | 'onDisconnectDatoCms'
  | 'onCheckDatoCmsAccess'
  | 'onRestartDatoCmsConnection'
>;

/** What keeps the chat busy: a control that it locks says why */
type ChatLock = {
  autoApproveChanging: boolean;
  hostActionPending: boolean;
  isRunning: boolean;
  approvalPending: boolean;
  approvalDeciding: boolean;
};

function chatLockReason(lock: ChatLock): string | undefined {
  if (lock.autoApproveChanging) return 'Confirm or cancel auto-approve first.';
  if (lock.hostActionPending) return 'Wait for the current action to finish.';
  if (lock.isRunning) return 'Wait for the agent to finish.';
  if (lock.approvalPending) return 'Approve or deny the proposed change first.';
  if (lock.approvalDeciding) return 'Wait for the decision to save.';
  return undefined;
}

/**
 * Why the composer is off while no turn runs (a running turn shows Stop):
 * Send says it in its tooltip, since the editor shows no placeholder then.
 */
function composerLockReason(
  lock: Pick<
    ChatLock,
    'hostActionPending' | 'approvalPending' | 'approvalDeciding'
  > & { connecting: boolean },
): string {
  if (lock.hostActionPending) return 'Wait for the current action to finish.';
  if (lock.approvalPending) return 'Approve or deny the proposed change first.';
  if (lock.approvalDeciding) return 'Wait for the decision to save.';
  if (lock.connecting) return 'Wait for DatoCMS to connect.';
  return 'Wait for the current step to finish.';
}

function approvalLock(entries: readonly AgentTranscriptEntry[]) {
  let approvalPending = false;
  let approvalDeciding = false;

  for (const entry of entries) {
    if (entry.kind !== 'approval') continue;
    if (entry.approval.status === 'pending') approvalPending = true;
    if (
      entry.approval.status === 'approving' ||
      entry.approval.status === 'rejecting'
    ) {
      approvalDeciding = true;
    }
  }

  return { approvalPending, approvalDeciding };
}

const DATO_CMS_STATUS: Record<
  Exclude<DatoCmsConnectionStatus, 'connecting'>,
  { tone: FeedbackDotProps['tone']; word: string }
> = {
  connected: { tone: 'success', word: 'Connected' },
  disconnected: { tone: 'neutral', word: 'Not connected' },
  mcp_auth_required: { tone: 'warning', word: 'Sign-in expired' },
  error: { tone: 'danger', word: 'Connection failed' },
};

function accessCanBeWidened(level: McpAccessLevel | undefined) {
  return level === 'content_only' || level === 'content_view_only';
}

/** The name of the DatoCMS account, when it is more than a status word */
function datoCmsLabel(connection: AgentConnectionViewModel) {
  const accountLabel = connection.datoCmsAccountLabel?.trim();

  return accountLabel && !/remote\s+mcp|^connected\b/i.test(accountLabel)
    ? accountLabel
    : 'DatoCMS';
}

function DatoCmsStatus({ status }: { status: DatoCmsConnectionStatus }) {
  if (status === 'connecting') {
    return (
      <span className={styles.status} role="status">
        <Spinner inline label={false} />
        Connecting…
      </span>
    );
  }

  const { tone, word } = DATO_CMS_STATUS[status];

  return (
    <span className={styles.status} role="status">
      <FeedbackDot tone={tone} />
      {word}
    </span>
  );
}

/** The buttons of a row of the connection: they fix what the row says */
function RowActions({ children }: { children: ReactNode }) {
  return <div className={styles.rowActions}>{children}</div>;
}

/**
 * The DatoCMS connection. While it isn't connected, the button that fixes
 * it: Connect, or Connect again after an expired or failed sign-in, which
 * keeps the saved registration. After a failed sign-in its menu can also
 * start over with a new registration. Once connected, the value opens a
 * menu with Disconnect.
 */
function DatoCmsRow({
  connection,
  onConnectDatoCms,
  onDisconnectDatoCms,
  onRestartDatoCmsConnection,
}: Omit<ConnectionActionProps, 'onCheckDatoCmsAccess'>) {
  const status = connection.datoCmsStatus;
  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const canConnect = !connected && !connecting && Boolean(onConnectDatoCms);
  const canRestart =
    !connected &&
    !connecting &&
    Boolean(connection.datoCmsError && onRestartDatoCmsConnection);
  const connectLabel =
    status === 'mcp_auth_required' || connection.datoCmsError
      ? 'Connect again'
      : 'Connect';

  if (connected && onDisconnectDatoCms) {
    return (
      <InfoList.Row title={datoCmsLabel(connection)}>
        <Dropdown
          triggerComponent={InfoList.Value.Trigger}
          label={
            <>
              <FeedbackDot tone="success" /> Connected
            </>
          }
        >
          <Dropdown.Menu placement="bottom-end">
            <Dropdown.Option onPick={onDisconnectDatoCms}>
              Disconnect
            </Dropdown.Option>
          </Dropdown.Menu>
        </Dropdown>
      </InfoList.Row>
    );
  }

  return (
    <InfoList.Row title={datoCmsLabel(connection)}>
      <DatoCmsStatus status={status} />
      {(canConnect || canRestart) && (
        <RowActions>
          {/* The main action is the submit of the form of the panel */}
          {canConnect && canRestart && (
            <SplitButton
              label={connectLabel}
              menu={{ ariaLabel: 'More ways to connect' }}
              submit
              tone="primary"
            >
              <Dropdown.Option onPick={() => onRestartDatoCmsConnection?.()}>
                Start over with a new sign-in
              </Dropdown.Option>
            </SplitButton>
          )}
          {canConnect && !canRestart && (
            <Button label={connectLabel} submit tone="primary" />
          )}
          {!canConnect && canRestart && (
            <Button
              label="Connect again"
              onClick={() => onRestartDatoCmsConnection?.()}
              tone="primary"
            />
          )}
        </RowActions>
      )}
    </InfoList.Row>
  );
}

/**
 * What the agent can do, said once: Read-only mode of the plugin, else the
 * access of the connection, with how to allow more when it is limited. A
 * limited or unknown access can be checked again. While the agent waits for
 * setup, only an access that limits it shows.
 */
function AccessRow({
  connection,
  onCheckDatoCmsAccess,
  ready,
}: Pick<ConnectionActionProps, 'connection' | 'onCheckDatoCmsAccess'> & {
  ready: boolean;
}) {
  const accessLevel =
    connection.datoCmsStatus === 'connected'
      ? connection.oauthAccessLevel
      : undefined;
  if (!accessLevel) return null;

  const limited = accessLevel === 'unknown' || accessCanBeWidened(accessLevel);
  if (!ready && !limited && !connection.pluginReadOnly) return null;

  const canCheck = Boolean(onCheckDatoCmsAccess) && limited;

  return (
    <InfoList.Row title="Access">
      {connection.pluginReadOnly
        ? 'Read content only'
        : mcpAccessLabel(accessLevel)}
      {connection.pluginReadOnly ? (
        <div className={styles.note}>
          Read-only mode is on in the plugin settings.
        </div>
      ) : (
        accessCanBeWidened(accessLevel) && (
          // Check access again, under it, then offers to connect again
          <div className={styles.note}>
            {accessLevel === 'content_view_only'
              ? 'To let the agent make changes, remove its access in '
              : 'The agent can’t change models or settings. To allow more, remove its access in '}
            <a href={MCP_ACCESS_CHANGE_URL} rel="noreferrer" target="_blank">
              Account settings
            </a>
            , then check access again.
          </div>
        )
      )}
      {canCheck && onCheckDatoCmsAccess && (
        <RowActions>
          <CheckAccessButton
            checking={Boolean(connection.accessChecking)}
            onCheck={onCheckDatoCmsAccess}
            tone="ghost"
          />
        </RowActions>
      )}
    </InfoList.Row>
  );
}

/** The model provider, only when an admin must set it up */
function ProviderRow({ connection }: { connection: AgentConnectionViewModel }) {
  const providerStatus =
    connection.providerConfigStatus ?? connection.openAiConfigStatus;
  if (providerStatus !== 'missing') return null;

  const providerName =
    connection.providerLabel ??
    (connection.openAiConfigStatus ? 'OpenAI' : undefined);

  return (
    <InfoList.Row title="Model provider">
      <span className={styles.value}>
        {providerName}
        <Pill tone="warning">Setup required</Pill>
      </span>
      {/* Who fixes it is in view, not in a tooltip a touch can't open */}
      <div className={styles.note}>
        Ask a project admin to set it up in the plugin settings.
      </div>
    </InfoList.Row>
  );
}

/**
 * The facts of the connection, each with the actions that change it in its
 * row: the DatoCMS connection, the access and the model provider.
 */
function ConnectionFacts({
  ready,
  ...props
}: ConnectionActionProps & { ready: boolean }) {
  return (
    <InfoList>
      <DatoCmsRow {...props} />
      <AccessRow {...props} ready={ready} />
      <ProviderRow connection={props.connection} />
    </InfoList>
  );
}

function ConnectionMessages({
  connection,
}: {
  connection: AgentConnectionViewModel;
}) {
  const connected = connection.datoCmsStatus === 'connected';
  const projectName = connection.projectName?.trim();

  // A failed sign-in is the one message: the next one comes with the next
  // attempt. What limits the agent is in the access row.
  if (connection.datoCmsError) {
    return (
      <Callout className={styles.callout} tone="danger">
        {connection.datoCmsError}
      </Callout>
    );
  }

  return connected ? null : (
    <Callout className={styles.callout}>
      When DatoCMS asks which projects to allow, select only{' '}
      <strong>
        {projectName || 'the project where this plugin is installed'}
      </strong>
      .
    </Callout>
  );
}

function CheckAccessButton({
  checking,
  onCheck,
  tone,
}: {
  checking: boolean;
  onCheck: () => void;
  tone?: 'soft' | 'ghost';
}) {
  return (
    <Button
      busy={checking}
      label="Check access again"
      onClick={onCheck}
      tone={tone}
    />
  );
}

/**
 * The DatoCMS connection: what the user must know first (an error, how to
 * authorize), then its state with the actions that change it. Until the
 * agent is ready it is the whole view, with the inset of a form: no panel
 * that could hide the one thing to do. Then it is a panel under the chats,
 * closed when all is well.
 */
function ConnectionPanel({
  ready,
  ...props
}: ConnectionActionProps & {
  /** The agent can chat: DatoCMS is connected and the provider is set up */
  ready: boolean;
}) {
  const { connection, onConnectDatoCms } = props;
  const accessLevel =
    connection.datoCmsStatus === 'connected'
      ? connection.oauthAccessLevel
      : undefined;
  const needsAttention =
    Boolean(connection.datoCmsError) ||
    Boolean(connection.pluginReadOnly) ||
    accessLevel === 'unknown' ||
    accessCanBeWidened(accessLevel);
  const form = (
    <form
      className={
        ready ? styles.connection : `${styles.connection} ${styles.setup}`
      }
      onSubmit={(event) => {
        event.preventDefault();
        onConnectDatoCms?.();
      }}
    >
      <ConnectionMessages connection={connection} />
      <ConnectionFacts {...props} ready={ready} />
    </form>
  );

  if (!ready) {
    return form;
  }

  return (
    <SidebarPanel startOpen={needsAttention} title="Connection" titleLevel={2}>
      {form}
    </SidebarPanel>
  );
}

/**
 * A chat: it opens on click, or only shows while switching isn't possible.
 * While it opens, a spinner shows at its end.
 */
function ChatRow({
  conversation,
  onSelect,
  opening,
}: {
  conversation: AgentConversationSummaryViewModel;
  onSelect?: (conversation: AgentConversationSummaryViewModel) => void;
  opening: boolean;
}) {
  const selected = Boolean(conversation.isCurrent);
  const content = (
    <EntityRow
      layout="row"
      multilineTitle
      title={conversation.title.trim() || 'Untitled chat'}
      trailing={opening ? <Spinner inline label="Opening chat" /> : undefined}
    />
  );

  return onSelect ? (
    <RowList.Item onClick={() => onSelect(conversation)} selected={selected}>
      {content}
    </RowList.Item>
  ) : (
    <RowList.Item selected={selected}>{content}</RowList.Item>
  );
}

/**
 * The recent chats, right under the bar that names them: no panel, whose
 * title would say "Chats" a second time
 */
function ChatList({
  conversations,
  locked,
  onSelectConversation,
  openingConversationId,
}: {
  conversations: readonly AgentConversationSummaryViewModel[];
  /** The rows only show the chats: switching is not possible now */
  locked: boolean;
  onSelectConversation?: (
    conversation: AgentConversationSummaryViewModel,
  ) => void;
  /** The chat that is opening */
  openingConversationId?: string;
}) {
  const visibleConversations = conversations.slice(
    0,
    DEFAULT_MAX_CONVERSATIONS,
  );

  if (visibleConversations.length === 0) {
    return (
      <div className={styles.noChats}>
        <BlankSlate
          description="The chats you start show here."
          icon={<HistoryIcon />}
          placement="inline"
          small
          title="No chats yet"
        />
      </div>
    );
  }

  return (
    <RowList>
      {visibleConversations.map((conversation) => (
        <ChatRow
          conversation={conversation}
          key={conversation.id}
          onSelect={locked ? undefined : onSelectConversation}
          opening={conversation.id === openingConversationId}
        />
      ))}
    </RowList>
  );
}

type ChatsViewProps = ConnectionActionProps &
  Pick<AgentSurfaceProps, 'recentConversations'> & {
    connected: boolean;
    contentRef: RefObject<HTMLDivElement | null>;
    /** Why the chats can't change now, when they can't */
    conversationLockReason?: string;
    /** A chat is opening, or a new chat is starting */
    conversationActionPending: boolean;
    /** The chat that is opening */
    openingConversationId?: string;
    onBack: () => void;
    onSelectConversation?: (
      conversation: AgentConversationSummaryViewModel,
    ) => void;
    onStartNewChat?: () => void;
  };

/**
 * The chats and the connection: the first view until the agent is ready
 * (DatoCMS connected and the model provider set up), with only the
 * connection, and the view that "Open chats" shows after: the chats first,
 * then the connection. The list holds a few chats, thus the connection
 * stays in view when it opens.
 */
function ChatsView({
  connected,
  contentRef,
  conversationActionPending,
  conversationLockReason,
  onBack,
  onSelectConversation,
  onStartNewChat,
  openingConversationId,
  recentConversations = [],
  ...connectionProps
}: ChatsViewProps) {
  // Before the agent is ready a chat can't open: only the connection shows
  const showChats =
    connected && (recentConversations.length > 0 || Boolean(onStartNewChat));
  const setupTitle =
    connectionProps.connection.datoCmsStatus === 'connected'
      ? 'Waiting for setup'
      : 'Connect your DatoCMS account';

  // Escape goes back to the chat, once DatoCMS is connected
  useRegisterActions([
    {
      id: 'chats.back',
      name: 'Back to chat',
      shortcut: { key: 'escape' },
      applicable: () => connected,
      run: onBack,
      palette: 'hidden',
    },
  ]);

  return (
    <Pane
      ariaLabel="Chats"
      header={
        <Toolbar>
          {connected && (
            <Toolbar.GoBack
              action="chats.back"
              ariaLabel="Back to chat"
              onClick={onBack}
            />
          )}
          <Toolbar.Title
            help={
              connected ? undefined : (
                <Toolbar.Help>
                  Ask the agent to find, create or update content. It works with
                  your DatoCMS account, so it can do what your role allows.
                </Toolbar.Help>
              )
            }
          >
            {connected ? 'Chats' : setupTitle}
          </Toolbar.Title>
          {/* A new chat is starting. The button stays as it is: it keeps
              the focus if the chat doesn't start. */}
          <Toolbar.Spinner
            show={conversationActionPending && !openingConversationId}
          />
          <Toolbar.Space />
          {connected && onStartNewChat && (
            <Toolbar.Button
              disabled={
                conversationLockReason
                  ? { reason: conversationLockReason }
                  : undefined
              }
              icon={AddIcon}
              label="New chat"
              onClick={onStartNewChat}
            />
          )}
        </Toolbar>
      }
    >
      <div ref={contentRef}>
        {showChats && (
          <ChatList
            conversations={recentConversations}
            locked={Boolean(conversationLockReason)}
            onSelectConversation={onSelectConversation}
            openingConversationId={openingConversationId}
          />
        )}
        <ConnectionPanel {...connectionProps} ready={connected} />
      </div>
    </Pane>
  );
}

type AutoApproveToggleProps = {
  enabled: boolean;
  changing: boolean;
  /** Why auto-approve can't change at all (Read-only mode, the access) */
  unavailableReason?: string;
  /** Why it can't change now */
  lockReason?: string;
  onChange?: AgentSurfaceProps['onAutoApproveChange'];
};

function AutoApproveToggle({
  enabled,
  changing,
  unavailableReason,
  lockReason,
  onChange,
}: AutoApproveToggleProps) {
  // Without a way to change it and without a reason, the toggle doesn't apply
  if (!onChange && !unavailableReason) {
    return null;
  }

  const reason = changing ? undefined : (unavailableReason ?? lockReason);
  // A disabled or busy button has no hint: its reason is its tooltip. The
  // hint tells what auto-approve does when on; the On pill shows its state.
  const hint =
    reason || changing
      ? null
      : 'When on, changes run without asking you first.';

  return (
    <Tooltip label={hint} placement="bottom">
      <Toolbar.Button
        busy={changing}
        disabled={reason ? { reason } : undefined}
        icon={BoltIcon}
        label="Auto-approve"
        onClick={() => {
          void onChange?.(!enabled);
        }}
        pressed={enabled}
        // Changes may run without review: a risk the user chose, thus the
        // warning tone (danger is for a problem)
        trailing={enabled ? <Pill tone="warning">On</Pill> : undefined}
      />
    </Tooltip>
  );
}

function currentChatTitle(
  conversations: readonly AgentConversationSummaryViewModel[],
) {
  const current = conversations.find((conversation) => conversation.isCurrent);
  if (!current) return 'New chat';

  return current.title.trim() || 'Untitled chat';
}

/** The messages about the chat, above the composer */
function ChatNotices({
  connection,
  onCheckDatoCmsAccess,
  persistenceWarning,
}: Pick<
  AgentSurfaceProps,
  'connection' | 'onCheckDatoCmsAccess' | 'persistenceWarning'
>) {
  return (
    <>
      {connection.oauthAccessLevel === 'unknown' && (
        <div className={styles.notice}>
          <Callout
            className={styles.callout}
            title="Couldn’t check your DatoCMS access"
            tone="warning"
          >
            The agent can read content, but won’t make changes until you check
            again.
          </Callout>
          {onCheckDatoCmsAccess && (
            <CheckAccessButton
              checking={Boolean(connection.accessChecking)}
              onCheck={onCheckDatoCmsAccess}
            />
          )}
        </div>
      )}
      {persistenceWarning && (
        <Callout className={styles.callout} tone="warning">
          {persistenceWarning}
        </Callout>
      )}
    </>
  );
}

function fallbackMentionHost(): AgentMentionHost {
  return {
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
  };
}

function focusComposer(region: HTMLElement | null) {
  region?.querySelector<HTMLElement>('[role="textbox"]')?.focus();
}

/**
 * Where the focus goes: into the chats view when it opens, back to the
 * composer when it closes, and back to the composer after a turn that the
 * composer started (never after a turn started elsewhere).
 */
function useSurfaceFocus({
  composerDisabled,
  isRunning,
  settingsOpen,
  showChats,
}: {
  composerDisabled: boolean;
  isRunning: boolean;
  settingsOpen: boolean;
  showChats: boolean;
}) {
  const chatsContentRef = useRef<HTMLDivElement>(null);
  const composerRegionRef = useRef<HTMLDivElement>(null);
  const focusComposerAfterSettingsRef = useRef(false);
  const restoreComposerAfterRunRef = useRef(false);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (settingsOpen) {
      // The first chat that can open, else the title of the Connection
      // panel (the toggle in its heading): what comes first in the view
      chatsContentRef.current
        ?.querySelector<HTMLElement>('[role="button"], button[aria-expanded]')
        ?.focus();
    }
  }, [settingsOpen]);

  useEffect(() => {
    if (
      !showChats &&
      !isRunning &&
      !composerDisabled &&
      focusComposerAfterSettingsRef.current
    ) {
      focusComposerAfterSettingsRef.current = false;
      focusComposer(composerRegionRef.current);
    }
  }, [composerDisabled, isRunning, showChats]);

  useEffect(() => {
    const turnFinished = wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;

    if (!turnFinished) {
      return;
    }

    const shouldRestore = restoreComposerAfterRunRef.current;
    restoreComposerAfterRunRef.current = false;
    if (shouldRestore && !showChats && !composerDisabled) {
      focusComposer(composerRegionRef.current);
    }
  }, [composerDisabled, isRunning, showChats]);

  /** The next close of the chats view gives the focus to the composer */
  const focusComposerAfterSettings = useCallback(() => {
    focusComposerAfterSettingsRef.current = true;
  }, []);

  /** The composer starts a turn: it gets the focus back when it ends */
  const rememberComposerFocus = useCallback(() => {
    restoreComposerAfterRunRef.current = Boolean(
      composerRegionRef.current?.contains(document.activeElement),
    );
  }, []);

  return {
    chatsContentRef,
    composerRegionRef,
    focusComposerAfterSettings,
    rememberComposerFocus,
  };
}

export function AgentSurface({
  connection,
  entries,
  currentRecordId,
  isRunning = false,
  composerDisabled = false,
  composerPlaceholder = 'Ask the agent to find, create, or update content…',
  onSubmit,
  mentionHost,
  onConnectDatoCms,
  onDisconnectDatoCms,
  onCheckDatoCmsAccess,
  onRestartDatoCmsConnection,
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
  onRepairUnsafeAction,
  onRetryFailedTurn,
  onCopyFailureDiagnostics,
  autoApproveEnabled = false,
  autoApproveChanging = false,
  autoApproveDisabledReason,
  persistenceWarning,
  onAutoApproveChange,
}: AgentSurfaceProps) {
  const resolvedMentionHost = mentionHost ?? fallbackMentionHost();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The chat action that runs: a chat that opens (its id) or a new chat
  const [pendingConversationAction, setPendingConversationAction] = useState<{
    conversationId?: string;
  } | null>(null);
  const conversationActionPending = pendingConversationAction !== null;
  const connected = connection.status === 'connected';
  const showCredentials = !connected || settingsOpen;
  const {
    chatsContentRef,
    composerRegionRef,
    focusComposerAfterSettings,
    rememberComposerFocus,
  } = useSurfaceFocus({
    composerDisabled,
    isRunning,
    settingsOpen,
    showChats: showCredentials,
  });
  const approvalState = approvalLock(entries);
  const lockReason = chatLockReason({
    autoApproveChanging,
    hostActionPending,
    isRunning,
    ...approvalState,
  });
  const connecting =
    connection.status === 'connecting' ||
    connection.datoCmsStatus === 'connecting';
  const composerDisabledReason = composerDisabled
    ? composerLockReason({ connecting, hostActionPending, ...approvalState })
    : undefined;
  // A chat that is opening only ignores more clicks and shows a spinner: its
  // controls keep the focus, in case the switch is refused and the view
  // stays
  const conversationLockReason = connecting
    ? 'Wait for DatoCMS to connect.'
    : lockReason;

  const closeSettings = useCallback(() => {
    focusComposerAfterSettings();
    setSettingsOpen(false);
  }, [focusComposerAfterSettings]);

  const runConversationAction = async (
    action: () => boolean | undefined | Promise<boolean | undefined>,
    conversationId?: string,
  ) => {
    if (conversationActionPending || conversationLockReason) {
      return;
    }

    setPendingConversationAction({ conversationId });

    try {
      const completed = await action();

      if (completed === false) {
        return;
      }

      if (connected) {
        closeSettings();
      }
    } catch {
      return;
    } finally {
      setPendingConversationAction(null);
    }
  };

  return (
    <FullFrame>
      {showCredentials ? (
        <ChatsView
          connected={connected}
          connection={connection}
          contentRef={chatsContentRef}
          conversationActionPending={conversationActionPending}
          conversationLockReason={conversationLockReason}
          onBack={closeSettings}
          onCheckDatoCmsAccess={onCheckDatoCmsAccess}
          onConnectDatoCms={onConnectDatoCms}
          onDisconnectDatoCms={onDisconnectDatoCms}
          onRestartDatoCmsConnection={onRestartDatoCmsConnection}
          onSelectConversation={
            onSelectConversation
              ? (conversation) => {
                  void runConversationAction(
                    () => onSelectConversation(conversation),
                    conversation.id,
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
          openingConversationId={pendingConversationAction?.conversationId}
          recentConversations={recentConversations}
        />
      ) : (
        <Pane
          footer={
            <div className={styles.footer} ref={composerRegionRef}>
              <ChatNotices
                connection={connection}
                onCheckDatoCmsAccess={onCheckDatoCmsAccess}
                persistenceWarning={persistenceWarning}
              />
              <MentionComposer
                currentRecordId={currentRecordId}
                disabled={composerDisabled}
                disabledReason={composerDisabledReason}
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
                    if (recordId === currentRecordId) return;
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
                onSubmit={(submission) => {
                  rememberComposerFocus();
                  onSubmit(submission);
                }}
                placeholder={composerPlaceholder}
              />
            </div>
          }
          header={
            <Toolbar>
              <Toolbar.Title>
                {currentChatTitle(recentConversations)}
              </Toolbar.Title>
              <Toolbar.Space />
              {/* Not in a Toolbar.Group: a group shrinks with the title, and
                  in a narrow sidebar its buttons would go out of the frame */}
              <AutoApproveToggle
                changing={autoApproveChanging}
                enabled={autoApproveEnabled}
                lockReason={lockReason}
                onChange={onAutoApproveChange}
                unavailableReason={autoApproveDisabledReason}
              />
              <Toolbar.Button
                disabled={lockReason ? { reason: lockReason } : undefined}
                icon={HistoryIcon}
                iconOnly
                label="Open chats"
                onClick={() => setSettingsOpen(true)}
              />
            </Toolbar>
          }
        >
          <Transcript
            autoApproveEnabled={autoApproveEnabled}
            currentRecordId={currentRecordId}
            entries={entries}
            hostActionPending={hostActionPending}
            isRunning={isRunning}
            mentionHost={resolvedMentionHost}
            onApproveUnsafeAction={onApproveUnsafeAction}
            onCopyFailureDiagnostics={onCopyFailureDiagnostics}
            onOpenAsset={onOpenAsset}
            onOpenField={onOpenField}
            onOpenRecord={onOpenRecord}
            onRejectUnsafeAction={onRejectUnsafeAction}
            onRepairUnsafeAction={onRepairUnsafeAction}
            onRetryFailedTurn={onRetryFailedTurn}
            onReviewUnsafeAction={onReviewUnsafeAction}
          />
        </Pane>
      )}
    </FullFrame>
  );
}

export default AgentSurface;
