import { useRegisterActions } from 'datocms-react-ui/Actions';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import EntityRow from 'datocms-react-ui/EntityRow';
import FeedbackDot, {
  type FeedbackDotProps,
} from 'datocms-react-ui/FeedbackDot';
import InfoList from 'datocms-react-ui/InfoList';
import Modal from 'datocms-react-ui/Modal';
import Pane from 'datocms-react-ui/Pane';
import Pill from 'datocms-react-ui/Pill';
import RowList from 'datocms-react-ui/RowList';
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
import { AddIcon, BoltIcon, BoltOffIcon, HistoryIcon } from '../icons';
import { DEFAULT_MAX_CONVERSATIONS } from '../lib/conversations';
import { type McpAccessLevel, mcpAccessLabel } from '../lib/mcpAccess';
import type { AgentMentionHost } from '../lib/mentionHost';
import type {
  AgentComposerSubmission,
  CommentSegment,
  Mention,
} from '../lib/mentions';
import { fallbackAssetMention, fallbackRecordMention } from '../lib/mentions';
import type { SecretCandidate } from '../lib/secretCandidates';
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
  /** The error comes from a sign-in, so a new registration can fix it */
  shouldOfferSignInRestart?: boolean;
  /** The name of the open project, the one to authorize */
  projectName?: string;
  oauthAccessLevel?: McpAccessLevel;
  pluginReadOnly?: boolean;
  accessChecking?: boolean;
  /** True until the first access check of the current sign-in returns */
  accessCheckPending?: boolean;
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

export type CopyDiagnosticsResult =
  | { status: 'copied' }
  | { status: 'review'; candidates: readonly SecretCandidate[] };

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
  /** Signs in again, so the user can pick another access level */
  onReconnectDatoCms?: () => void;
  onCheckDatoCmsAccess?: () => void;
  /** Clears the error of the DatoCMS connection */
  onDismissDatoCmsError?: () => void;
  /** Signs in again with a new OAuth client, when the saved one fails */
  onRestartDatoCmsConnection?: () => void;
  /**
   * Opens the settings of the plugin. Given only when the user can edit
   * them: else the setup says to ask a project admin.
   */
  onOpenPluginSettings?: () => void;
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
  /**
   * Copies the diagnostics of a failure. Without `redact`, it can return
   * `review` with the values that look like secrets instead of copying: a
   * second call with the values to redact (maybe none) copies.
   */
  onCopyFailureDiagnostics?: (
    failureId: string,
    redact?: readonly string[],
  ) => Promise<CopyDiagnosticsResult | undefined>;
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
  | 'onRestartDatoCmsConnection'
  | 'onOpenPluginSettings'
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
  connected: { tone: 'success', word: 'Done' },
  disconnected: { tone: 'warning', word: 'To do' },
  mcp_auth_required: { tone: 'warning', word: 'Sign-in expired' },
  error: { tone: 'danger', word: 'Connection failed' },
};

/** A state word after its dot, or after a spinner while it changes */
function StepStatus({
  tone,
  word,
  busy = false,
}: {
  tone: FeedbackDotProps['tone'];
  word: string;
  busy?: boolean;
}) {
  return (
    <span className={styles.status} role="status">
      {busy ? <Spinner inline label={false} /> : <FeedbackDot tone={tone} />}
      {word}
    </span>
  );
}

/** One line on what the DatoCMS access lets the agent do */
function accessSummary(connection: AgentConnectionViewModel): string {
  if (connection.pluginReadOnly) {
    return 'Read-only mode is on in the plugin settings, so the agent can change nothing.';
  }
  switch (connection.oauthAccessLevel) {
    case 'content_view_only':
      return 'The agent can read content, but not change it.';
    case 'content_only':
      return 'The agent can edit content, but not the schema.';
    case 'unrestricted':
      return 'The agent can do anything your role allows.';
    default:
      return 'Not checked yet.';
  }
}

/** The buttons of a row of the setup: they do what the row says */
function RowActions({ children }: { children: ReactNode }) {
  return <div className={styles.rowActions}>{children}</div>;
}

/**
 * Step 1: the model provider. Who can set it up opens the plugin settings;
 * the others are told who to ask.
 */
function ProviderStep({
  connection,
  onOpenPluginSettings,
  primary,
}: Pick<ConnectionActionProps, 'connection' | 'onOpenPluginSettings'> & {
  /** Its button is the main action: no other step waits */
  primary: boolean;
}) {
  const providerStatus =
    connection.providerConfigStatus ?? connection.openAiConfigStatus;
  const done = providerStatus !== 'missing';

  return (
    <InfoList.Row title="1. Choose AI provider & model">
      <StepStatus
        tone={done ? 'success' : 'warning'}
        word={done ? 'Done' : 'To do'}
      />
      {!done && (
        <div className={styles.note}>
          {onOpenPluginSettings
            ? 'Add an API key and pick a model in the plugin settings.'
            : 'A developer or project admin sets this up in the plugin settings: ask them for help.'}
        </div>
      )}
      {!done && onOpenPluginSettings && (
        <RowActions>
          <Button
            label="Open plugin settings"
            onClick={onOpenPluginSettings}
            tone={primary ? 'primary' : 'soft'}
          />
        </RowActions>
      )}
    </InfoList.Row>
  );
}

/**
 * Step 2: the DatoCMS connection. While it isn't connected, the button that
 * fixes it: Connect, or Connect again after an expired or failed sign-in,
 * which keeps the saved registration. When a new registration can fix the
 * failure, its menu can also start over with one.
 */
function DatoCmsStep({
  connection,
  onConnectDatoCms,
  onRestartDatoCmsConnection,
}: Pick<
  ConnectionActionProps,
  'connection' | 'onConnectDatoCms' | 'onRestartDatoCmsConnection'
>) {
  const status = connection.datoCmsStatus;
  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const canConnect = !connected && !connecting && Boolean(onConnectDatoCms);
  const canRestart =
    !connected &&
    !connecting &&
    Boolean(connection.shouldOfferSignInRestart && onRestartDatoCmsConnection);
  const connectLabel =
    status === 'mcp_auth_required' || connection.datoCmsError
      ? 'Connect again'
      : 'Connect';

  return (
    <InfoList.Row title="2. Connect AI to DatoCMS MCP">
      {connecting ? (
        <StepStatus busy tone="neutral" word="Connecting…" />
      ) : (
        <StepStatus {...DATO_CMS_STATUS[status]} />
      )}
      {connected && (
        <div className={styles.note}>
          Current access level:{' '}
          {mcpAccessLabel(connection.oauthAccessLevel ?? 'unknown')}.{' '}
          {accessSummary(connection)}
        </div>
      )}
      {(canConnect || canRestart) && (
        <RowActions>
          {/* The main action is the submit of the form of the setup */}
          {canConnect && canRestart && (
            <SplitButton
              label={connectLabel}
              menu={{ ariaLabel: 'More ways to connect' }}
              submit
              tone="primary"
            >
              <Dropdown.Option onPick={() => onRestartDatoCmsConnection?.()}>
                Start over with a new registration
              </Dropdown.Option>
            </SplitButton>
          )}
          {canConnect && !canRestart && (
            <Button label={connectLabel} submit tone="primary" />
          )}
          {!canConnect && canRestart && (
            <Button
              label="Start over with a new registration"
              onClick={() => onRestartDatoCmsConnection?.()}
              tone="primary"
            />
          )}
        </RowActions>
      )}
    </InfoList.Row>
  );
}

/** What the user must know before signing in: an error, else the project */
function ConnectionMessage({
  connection,
}: {
  connection: AgentConnectionViewModel;
}) {
  const projectName = connection.projectName?.trim();

  // A failed sign-in is the one message: the next one comes with the next
  // attempt
  if (connection.datoCmsError) {
    return (
      <Callout className={styles.callout} tone="danger">
        {connection.datoCmsError}
      </Callout>
    );
  }

  return connection.datoCmsStatus === 'connected' ? null : (
    <Callout className={styles.callout}>
      When DatoCMS asks which projects to allow, select only{' '}
      <strong>
        {projectName || 'the project where this plugin is installed'}
      </strong>
      .
    </Callout>
  );
}

/**
 * The setup, until the agent is ready: two numbered steps, each with its
 * state and the action that does it. The chats show only once both are
 * done. It has the inset of a form in a pane.
 */
function SetupSteps(props: ConnectionActionProps) {
  const { connection, onConnectDatoCms } = props;
  const datoCmsConnected = connection.datoCmsStatus === 'connected';

  return (
    <form
      className={styles.setup}
      onSubmit={(event) => {
        event.preventDefault();
        onConnectDatoCms?.();
      }}
    >
      <ConnectionMessage connection={connection} />
      <InfoList>
        <ProviderStep {...props} primary={datoCmsConnected} />
        <DatoCmsStep {...props} />
      </InfoList>
    </form>
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
 * The setup or the chats: the first view until the agent is ready (DatoCMS
 * connected and the model provider set up), with only the setup steps, and
 * the view that "Open chats" shows after, with only the chats. The access and
 * the settings are in the "⋮" menu of the chat, so nobody changes the
 * connection by accident.
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
            {connected ? 'Chats' : 'Agent setup'}
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
        {!connected && <SetupSteps {...connectionProps} />}
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
        // Off reads as off: a slashed bolt and its own words
        icon={enabled ? BoltIcon : BoltOffIcon}
        label={enabled ? 'Auto: On' : 'Auto-approve is off'}
        onClick={() => {
          void onChange?.(!enabled);
        }}
        pressed={enabled}
        // Changes run without review: the badge says it is a risk
        trailing={enabled ? <Pill tone="danger">Danger</Pill> : undefined}
      />
    </Tooltip>
  );
}

/**
 * The "⋮" menu of the chat: the AI settings, the DatoCMS access, and
 * Reconnect and Disconnect, which ask first. While the agent works, its
 * options say why they wait.
 */
function AgentOptionsMenu({
  connection,
  lockReason,
  onOpenPluginSettings,
  onReconnect,
  onDisconnect,
}: {
  connection: AgentConnectionViewModel;
  /** Why the options can't run now */
  lockReason?: string;
  onOpenPluginSettings?: () => void;
  onReconnect?: () => void;
  onDisconnect?: () => void;
}) {
  const disabled = lockReason ? { reason: lockReason } : undefined;

  return (
    <Toolbar.DotsDropdown label="Agent options">
      <Dropdown.Option
        disabled={
          onOpenPluginSettings
            ? disabled
            : {
                reason:
                  'Only users who can edit the schema can change the AI settings.',
              }
        }
        onPick={() => onOpenPluginSettings?.()}
      >
        AI settings
      </Dropdown.Option>
      <Dropdown.Separator />
      <Dropdown.Text>
        {/* The menu takes the width of its longest line: this text wraps, so
            the menu fits in the narrowest chat */}
        <span className={styles.menuText}>
          Current DatoCMS access level:{' '}
          <strong>
            {mcpAccessLabel(connection.oauthAccessLevel ?? 'unknown')}
          </strong>
          . {accessSummary(connection)}
        </span>
      </Dropdown.Text>
      {onReconnect && (
        <Dropdown.Option disabled={disabled} onPick={onReconnect}>
          Reconnect to change access…
        </Dropdown.Option>
      )}
      {onDisconnect && (
        <>
          <Dropdown.Separator />
          <Dropdown.Option alert disabled={disabled} onPick={onDisconnect}>
            Disconnect from DatoCMS…
          </Dropdown.Option>
        </>
      )}
    </Toolbar.DotsDropdown>
  );
}

/**
 * Asks before Reconnect. It is a dialog of the frame, not of the host: the
 * sign-in window opens only from a click in this frame.
 */
function ReconnectDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal freeContent onClose={onCancel} title="Reconnect to change access?">
      <Modal.Body>
        You’ll sign in to DatoCMS again and pick a new access level on its
        consent screen. Your current connection ends when you finish.
      </Modal.Body>
      <Modal.Footer>
        <Button label="Reconnect" onClick={onConfirm} tone="primary" />
      </Modal.Footer>
    </Modal>
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
      {/* Before the first check returns, "unknown" only means "not checked yet" */}
      {connection.oauthAccessLevel === 'unknown' &&
        !connection.accessCheckPending && (
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
              <Button
                busy={Boolean(connection.accessChecking)}
                label="Check access again"
                onClick={onCheckDatoCmsAccess}
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

/**
 * Reconnect and Disconnect of the "⋮" menu, and the errors of the connection
 * while the chat shows. Reconnect asks in a dialog of the frame (its
 * `reconnectAsked`), which closes for good once the agent gets busy, so it
 * can't come back later and take an Enter meant for the composer.
 * Disconnect asks in a confirm of the host. Once connected, the setup isn't
 * in view: an error of the connection (a failed Reconnect) shows as a toast.
 */
function useConnectionOptions({
  connected,
  datoCmsError,
  lockReason,
  onDisconnectDatoCms,
  onDismissDatoCmsError,
  onReconnectDatoCms,
}: Pick<
  AgentSurfaceProps,
  'onDisconnectDatoCms' | 'onDismissDatoCmsError' | 'onReconnectDatoCms'
> & {
  connected: boolean;
  datoCmsError?: string;
  lockReason?: string;
}) {
  const ctx = useCtx();
  const [reconnectAsked, setReconnectAsked] = useState(false);
  if (reconnectAsked && (lockReason || !connected)) setReconnectAsked(false);

  const chatError = connected ? datoCmsError : undefined;
  const alertedErrorRef = useRef<string>(undefined);
  useEffect(() => {
    if (!chatError) {
      alertedErrorRef.current = undefined;
      return;
    }
    // A new ctx or callback doesn't show the same error twice
    if (alertedErrorRef.current === chatError) return;
    alertedErrorRef.current = chatError;
    void ctx.alert(chatError);
    onDismissDatoCmsError?.();
  }, [ctx, chatError, onDismissDatoCmsError]);

  const disconnect = async () => {
    const choice = await ctx.openConfirm({
      title: 'Disconnect from DatoCMS?',
      content:
        'DatoCMS revokes the agent’s token, so every open tab loses the connection. Connect again from the setup to keep chatting.',
      choices: [
        { label: 'Disconnect', value: 'disconnect', intent: 'negative' },
      ],
      cancel: { label: 'Cancel', value: 'cancel' },
    });
    if (choice === 'disconnect') onDisconnectDatoCms?.();
  };

  return {
    askReconnect: onReconnectDatoCms
      ? () => setReconnectAsked(true)
      : undefined,
    disconnect: onDisconnectDatoCms ? () => void disconnect() : undefined,
    reconnectDialog: reconnectAsked && onReconnectDatoCms && (
      <ReconnectDialog
        onCancel={() => setReconnectAsked(false)}
        onConfirm={() => {
          setReconnectAsked(false);
          onReconnectDatoCms();
        }}
      />
    ),
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
  onReconnectDatoCms,
  onCheckDatoCmsAccess,
  onDismissDatoCmsError,
  onRestartDatoCmsConnection,
  onOpenPluginSettings,
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

  const { askReconnect, disconnect, reconnectDialog } = useConnectionOptions({
    connected,
    datoCmsError: connection.datoCmsError,
    lockReason,
    onDisconnectDatoCms,
    onDismissDatoCmsError,
    onReconnectDatoCms,
  });

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
          onConnectDatoCms={onConnectDatoCms}
          onOpenPluginSettings={onOpenPluginSettings}
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
              <AgentOptionsMenu
                connection={connection}
                lockReason={lockReason}
                onDisconnect={disconnect}
                onOpenPluginSettings={onOpenPluginSettings}
                onReconnect={askReconnect}
              />
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
      {reconnectDialog}
    </FullFrame>
  );
}

export default AgentSurface;
