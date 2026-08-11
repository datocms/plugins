import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentActivityPhase,
  type AgentActivityViewModel,
  type AgentAssetResultViewModel,
  type AgentConversationSummaryViewModel,
  type AgentFieldResultViewModel,
  type AgentMentionsEntry,
  type AgentRecordResultViewModel,
  AgentSurface,
  type AgentTranscriptEntry,
  type UnsafeApprovalViewModel,
} from '../components/AgentSurface';
import {
  type AgentApprovalDecision,
  type AgentApprovalOutcome,
  type AgentApprovalRequest,
  type AgentConversationHistoryMessage,
  type AgentRepairContext,
  type AgentRepairPolicy,
  type AgentRuntimeAttachment,
  type AgentRuntimeEvent,
  type AgentTurnResult,
  type AgentTurnStatus,
  createAgentRepairPolicy,
  createAgentRuntime,
  type FieldReferenceInput,
  type GetModelSchemaCallback,
  MAX_AGENT_ATTACHMENT_TOTAL_BYTES,
  MAX_AGENT_ATTACHMENTS_PER_MESSAGE,
  MAX_AGENT_ATTACHMENTS_PER_REQUEST,
  type NavigationCallbackResult,
  type PresentFieldsInput,
  type PresentModelsInput,
  type PresentUsersInput,
  type ReadCurrentRecordLiveFormStateInput,
  repairPolicyViolation,
} from '../lib/agentRuntime';
import {
  READ_ONLY_REJECTION_MESSAGE,
  validateApprovalScope,
} from '../lib/approval';
import type { ApprovalDetailsDecision } from '../lib/approvalDetailsModal';
import {
  type AutoApprovalScope,
  createAutoApprovalStore,
} from '../lib/autoApproval';
import {
  type AgentConfig,
  type AgentProvider,
  activeApiKey,
  activeFastMode,
  activeModel,
  activeModelMaxOutputTokens,
  activeReasoningEffort,
  providerLabel,
} from '../lib/config';
import {
  type Conversation,
  type ConversationAssetResultGroup,
  type ConversationFieldResultGroup,
  type ConversationMentionResultGroup,
  type ConversationMessage,
  type ConversationRecordResultGroup,
  type ConversationScope,
  type ConversationStore,
  createConversationStore,
  withoutLegacyDemoTranscript,
} from '../lib/conversations';
import {
  type CredentialScope,
  createCredentialStore,
  createOAuthCredentials,
  isOAuthClientRegistrationFresh,
  type OAuthCredentials,
} from '../lib/credentials';
import {
  copyTextToClipboard,
  DIAGNOSTICS_SCHEMA_VERSION,
  serializeDiagnostics,
} from '../lib/diagnostics';
import type { CreateDatoAssetCallback } from '../lib/localAssetTool';
import {
  getSessionLocalFile,
  hasSessionLocalFileBytes,
} from '../lib/localFiles';
import { DATOCMS_MCP_UNSAFE_SCRIPT_TOOL } from '../lib/mcpPolicy';
import type { AgentMentionHost } from '../lib/mentionHost';
import {
  type AgentComposerSubmission,
  type CommentSegment,
  fallbackAssetMention,
  fallbackRecordMention,
  type LocalFileAttachmentDescriptor,
  type Mention,
  mentionFromModel,
  mentionFromUser,
  segmentsProviderText,
} from '../lib/mentions';
import type {
  AgentNavigator,
  OpenAssetResult,
  RecordListTarget,
  RecordTarget,
} from '../lib/navigation';
import {
  computeRedirectUri,
  createAuthorizationRequest,
  discardPendingAuthorization,
  exchangeAuthorizationCode,
  navigateOAuthPopup,
  openOAuthPopup,
  registerClient,
  revokeToken,
  waitForOAuthCallback,
} from '../lib/oauth';
import { type AgentSurfaceKind, buildSystemPrompt } from '../lib/systemPrompt';
import {
  createUnsafeDispatchJournalStore,
  type UnsafeDispatchJournal,
  type UnsafeDispatchJournalStore,
} from '../lib/unsafeDispatchJournal';
import type { FieldInfo } from '../recordComments/entrypoints/hooks/useMentions';

type CurrentRecord = {
  id: string;
  modelApiKey?: string;
  fieldPath?: string;
  hasUnsavedChanges?: boolean;
  title?: string;
};

export type AgentFrameProps = {
  pluginId: string;
  siteId: string;
  siteName: string;
  environment: string;
  isEnvironmentPrimary: boolean;
  currentUserId: string;
  /**
   * The DatoCMS host surface. A record sidebar can exist before its record has
   * a saved ID, so this must not be inferred only from `currentRecord`.
   */
  surface?: AgentSurfaceKind;
  currentRecord?: CurrentRecord;
  editorHasUnsavedChanges?: boolean;
  scope: ConversationScope;
  navigator: AgentNavigator;
  mentionHost?: AgentMentionHost;
  config: AgentConfig;
  /**
   * Captures the latest bounded DatoCMS metadata when a user submits a
   * message. Keeping this behind a callback avoids remounting or mutating an
   * active turn while the editor changes.
   */
  loadHostContext?: (
    signal?: AbortSignal,
  ) =>
    | AgentHostContextSnapshot
    | undefined
    | Promise<AgentHostContextSnapshot | undefined>;
  getModelSchema?: GetModelSchemaCallback;
  /**
   * Sidebar-only verifier for field receipts. It must resolve against the
   * latest current-model schema before a receipt is shown.
   */
  prepareCurrentFieldReferences?: (
    input: PresentFieldsInput,
    signal?: AbortSignal,
  ) => PresentFieldsInput | Promise<PresentFieldsInput>;
  /**
   * Sidebar-only live browser-form reader. Its result is not saved CMS state.
   */
  readCurrentRecordLiveFormState?: (
    input: ReadCurrentRecordLiveFormStateInput,
    signal?: AbortSignal,
  ) => NavigationCallbackResult | Promise<NavigationCallbackResult>;
  /**
   * Reveals an already-verified field on the current record without navigating
   * away from the record form.
   */
  openCurrentField?: (field: FieldReferenceInput) => void | Promise<void>;
  onReviewApprovalDetails: (
    approval: UnsafeApprovalViewModel,
  ) => Promise<ApprovalDetailsDecision | null>;
  onConfirmEnableAutoApprove: () => Promise<boolean>;
};

export type AgentHostContextSnapshot = {
  text: string;
  fingerprint: string;
};

type PendingApproval = {
  responseId: string;
  request: AgentApprovalRequest;
  decision?: AgentApprovalDecision;
  automatic?: boolean;
};

type ActiveTurn = {
  id: string;
  message: string;
  displayMessage: string;
  segments: CommentSegment[];
  history: AgentConversationHistoryMessage[];
  attachments: AgentRuntimeAttachment[];
  attachmentDescriptors?: LocalFileAttachmentDescriptor[];
  entriesBefore: AgentTranscriptEntry[];
  conversationBefore: Conversation;
  userEntryId: string;
  assistantEntryId: string;
  activityEntryId: string;
  autoApprovalBundleCount: number;
  userStopped: boolean;
  unsafeOperationDispatched: boolean;
  dispatchedApprovalIds: string[];
  cancelledBeforeDispatchApprovalIds: string[];
  cancelledBeforeDispatchReason?:
    | 'prior_outcome_uncertain'
    | 'editor_state_changed';
  localAssetDispatchState:
    | 'idle'
    | 'dispatching'
    | 'confirmed'
    | 'outcome_unknown';
  unsafeJournalId?: string;
  provider: AgentProvider;
  model: string;
  startedAt: string;
  textDeltaCount: number;
  textDeltaCharacters: number;
  diagnosticEventOutputCharacters: number;
  diagnosticEventsDropped: number;
  events: Array<{
    capturedAt: string;
    elapsedMs: number;
    event: AgentRuntimeEvent;
  }>;
  approvalSubmissions: Array<{
    capturedAt: string;
    responseId: string;
    decisions: AgentApprovalDecision[];
  }>;
  approvalOutcomes: AgentApprovalOutcome[];
  confirmedApprovalIds: string[];
  hostContexts: Array<{
    capturedAt: string;
    text: string;
    fingerprint: string;
  }>;
  previousResponseId?: string;
  injectHostContext?: boolean;
  hostContextFingerprint?: string;
  repairContext?: AgentRepairContext;
  repairPolicy?: AgentRepairPolicy;
  repairPolicyIdentity?: string;
  repairOauthAccessToken?: string;
};

type RetryCandidate = {
  failureId: string;
  submission: AgentComposerSubmission;
  history: ActiveTurn['history'];
  entriesBefore: AgentTranscriptEntry[];
  conversationBefore: Conversation;
  userEntryId: string;
  repairContext?: AgentRepairContext;
  repairPolicy?: AgentRepairPolicy;
};

type UnsafeRepairCandidate = {
  approvalRequestId: string;
  outcome: Extract<AgentApprovalOutcome, { kind: 'failed_before_execution' }>;
  request: AgentApprovalRequest;
  state: 'staged' | 'available' | 'starting';
  turnId: string;
  repairTurnId?: string;
};

type PendingNavigation =
  | { type: 'openRecord'; target: RecordTarget }
  | { type: 'showRecords'; target: RecordListTarget };

const MAX_AUTO_APPROVAL_BUNDLES_PER_TURN = 8;
const MAX_DIAGNOSTIC_EVENTS_PER_TURN = 500;
const MAX_DIAGNOSTIC_EVENT_OUTPUT_CHARACTERS = 500_000;
const DIAGNOSTIC_OUTPUT_TRUNCATION_MARKER =
  '\n… [additional diagnostic tool output omitted]';

const STALE_RESPONSE_CHAIN_STATE_PATTERN =
  /\b(?:not found|cannot be found|can't be found|could not be found|couldn't be found|does not exist|expired|invalid|unknown|no longer (?:available|exists|valid))\b/i;
const RESPONSE_CHAIN_REFERENCE_PATTERN =
  /\b(?:previous[_\s-]?response(?:[_\s-]?id)?|response chain)\b/i;
const NO_RESPONSE_FOUND_PATTERN = /\bno response (?:was )?found\b/i;

function uid(prefix: string): string {
  const suffix =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

function createEmptyConversation(): Conversation {
  const now = new Date().toISOString();
  return {
    id: uid('conversation'),
    title: 'New conversation',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function reusableOpenAiResponseId(
  conversation: Conversation,
  provider: AgentProvider,
  model: string,
): string | undefined {
  if (provider !== 'openai' || !conversation.previousResponseId) {
    return undefined;
  }

  const isLegacyOpenAiChain =
    conversation.responseProvider === undefined &&
    conversation.responseModel === undefined;
  const matchesCurrentConfiguration =
    conversation.responseProvider === provider &&
    conversation.responseModel === model;

  return isLegacyOpenAiChain || matchesCurrentConfiguration
    ? conversation.previousResponseId
    : undefined;
}

function withoutProviderState(conversation: Conversation): Conversation {
  const {
    previousResponseId: _previousResponseId,
    responseProvider: _responseProvider,
    responseModel: _responseModel,
    hostContextFingerprint: _hostContextFingerprint,
    ...portableConversation
  } = conversation;

  return portableConversation;
}

function errorMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  ) {
    return value.message;
  }

  return '';
}

function isStaleOpenAiResponseChainError(
  value: unknown,
  previousResponseId: string,
): boolean {
  const message = errorMessage(value);
  const noResponseFound =
    Boolean(message) && NO_RESPONSE_FOUND_PATTERN.test(message);
  if (
    !message ||
    (!STALE_RESPONSE_CHAIN_STATE_PATTERN.test(message) && !noResponseFound)
  ) {
    return false;
  }

  return (
    message.toLowerCase().includes(previousResponseId.toLowerCase()) ||
    RESPONSE_CHAIN_REFERENCE_PATTERN.test(message) ||
    noResponseFound
  );
}

function activityStatus(
  status: Extract<
    AgentRuntimeEvent,
    { type: 'activity' }
  >['activity']['status'],
): AgentActivityViewModel['status'] {
  switch (status) {
    case 'in_progress':
      return 'running';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'waiting':
      return 'pending';
  }
}

function activityPhase(
  status: AgentTurnStatus,
  automaticallyContinuing: boolean,
): AgentActivityPhase {
  switch (status) {
    case 'aborted':
      return 'cancelled';
    case 'failed':
    case 'incomplete':
      return 'failed';
    case 'approval_required':
      return automaticallyContinuing ? 'running' : 'waiting';
    case 'completed':
      return 'completed';
  }
}

function settleTurnEntry(
  entry: AgentTranscriptEntry,
  turn: ActiveTurn,
  turnStatus: AgentTurnStatus,
  phase: AgentActivityPhase,
  settledStatus: AgentActivityViewModel['status'],
): AgentTranscriptEntry {
  if (entry.id === turn.assistantEntryId && entry.kind === 'message') {
    const interrupted =
      turnStatus === 'failed' ||
      turnStatus === 'incomplete' ||
      turnStatus === 'aborted';
    return {
      ...entry,
      ...(turnStatus === 'aborted' && !entry.content.trim()
        ? { content: 'Stopped.' }
        : {}),
      streaming: false,
      ...(interrupted ? { interrupted: true } : {}),
    };
  }

  if (entry.id === turn.activityEntryId && entry.kind === 'activity') {
    return {
      ...entry,
      phase,
      activities: entry.activities.map((activity) =>
        activity.status === 'running'
          ? { ...activity, status: settledStatus }
          : activity,
      ),
    };
  }

  return entry;
}

function settleUnsafeJournalClaimFailure(
  entry: AgentTranscriptEntry,
  turn: ActiveTurn,
  approvalIds: ReadonlySet<string>,
  message: string,
): AgentTranscriptEntry {
  if (entry.id === turn.assistantEntryId && entry.kind === 'message') {
    return {
      ...entry,
      streaming: false,
      interrupted: true,
      error: message,
    };
  }
  if (entry.id === turn.activityEntryId && entry.kind === 'activity') {
    return {
      ...entry,
      phase: 'failed',
      activities: entry.activities.map((activity) =>
        approvalIds.has(activity.id)
          ? { ...activity, status: 'error' as const }
          : activity,
      ),
    };
  }
  if (entry.kind === 'approval' && approvalIds.has(entry.approval.id)) {
    return {
      ...entry,
      approval: {
        ...entry.approval,
        automatic: false,
        status: 'error',
        error: message,
      },
    };
  }

  return entry;
}

function settleReadOnlyCancellationEntry(
  entry: AgentTranscriptEntry,
  turn: ActiveTurn,
): AgentTranscriptEntry {
  if (entry.id === turn.assistantEntryId && entry.kind === 'message') {
    return {
      ...entry,
      ...(!entry.content.trim()
        ? { content: READ_ONLY_REJECTION_MESSAGE }
        : {}),
      streaming: false,
      interrupted: false,
      error: undefined,
    };
  }

  if (entry.id === turn.activityEntryId && entry.kind === 'activity') {
    return {
      ...entry,
      phase: 'completed',
      activities: entry.activities.map((activity) =>
        activity.status === 'running'
          ? { ...activity, status: 'cancelled' as const }
          : activity,
      ),
    };
  }

  return entry;
}

function withoutApprovalRecovery(
  entries: readonly AgentTranscriptEntry[],
): AgentTranscriptEntry[] {
  return entries.map((entry) => {
    if (entry.kind !== 'approval' || !entry.approval.recovery) return entry;
    const { recovery: _recovery, ...approval } = entry.approval;
    return { ...entry, approval };
  });
}

const DURABLE_UNSAFE_OUTCOME_NOTICES = {
  unknown:
    'Outcome needs checking. The change may have run. Check DatoCMS before trying again.',
  failedAfterExecution:
    'Change may be incomplete. Some project content may have changed. Check DatoCMS before trying again.',
  failedBeforeExecution:
    'This operation didn’t run. It made no project content changes.',
  successfulInterruption:
    'The approved DatoCMS operation completed, but the agent’s final reply was interrupted.',
} as const;

function durableUnsafeOutcomeNotice(
  turn: ActiveTurn,
  assistantEntry:
    | Extract<AgentTranscriptEntry, { kind: 'message' }>
    | undefined,
  allowSuccessfulInterruptionNotice = true,
): string | undefined {
  const exactOutcomes = turn.approvalOutcomes.filter((outcome) =>
    turn.confirmedApprovalIds.includes(outcome.approvalRequestId),
  );
  if (exactOutcomes.some((outcome) => outcome.kind === 'unknown')) {
    return DURABLE_UNSAFE_OUTCOME_NOTICES.unknown;
  }
  if (
    exactOutcomes.some((outcome) => outcome.kind === 'failed_after_execution')
  ) {
    return DURABLE_UNSAFE_OUTCOME_NOTICES.failedAfterExecution;
  }
  if (
    exactOutcomes.some((outcome) => outcome.kind === 'failed_before_execution')
  ) {
    return DURABLE_UNSAFE_OUTCOME_NOTICES.failedBeforeExecution;
  }
  if (
    allowSuccessfulInterruptionNotice &&
    turn.confirmedApprovalIds.length > 0 &&
    (!assistantEntry?.content.trim() ||
      assistantEntry.interrupted ||
      Boolean(assistantEntry.error))
  ) {
    return DURABLE_UNSAFE_OUTCOME_NOTICES.successfulInterruption;
  }
  return undefined;
}

function persistedTranscriptMessageText(
  entry: Extract<AgentTranscriptEntry, { kind: 'message' }>,
): string {
  const content = entry.content.trim();
  const notice = entry.durableOutcomeNotice?.trim();
  if (!notice || content.includes(notice)) return entry.content;
  return content ? `${content}\n\n${notice}` : notice;
}

function stringifyDetail(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const text =
      typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > 4_000 ? `${text.slice(0, 4_000)}\n…` : text;
  } catch {
    return undefined;
  }
}

function updateAssetFromModalResult(
  asset: AgentAssetResultViewModel,
  targetUploadId: string,
  result: OpenAssetResult,
): AgentAssetResultViewModel {
  if (asset.uploadId !== targetUploadId) {
    return asset;
  }

  const updated = { ...asset };
  if (result.uploadId) {
    updated.uploadId = result.uploadId;
  }
  if (result.title) {
    updated.title = result.title;
  }
  if (result.deleted) {
    updated.deleted = true;
  }
  return updated;
}

function applyAssetModalResult(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
  targetUploadId: string,
  result: OpenAssetResult,
): AgentTranscriptEntry[] {
  return entries.map((entry) => {
    if (entry.kind !== 'assets' || entry.id !== entryId) {
      return entry;
    }

    return {
      ...entry,
      assets: entry.assets.map((asset) =>
        updateAssetFromModalResult(asset, targetUploadId, result),
      ),
    };
  });
}

function settleAssetReceipt(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
  error: string | undefined,
): AgentTranscriptEntry[] {
  return entries.map((entry) =>
    entry.kind === 'assets' && entry.id === entryId
      ? {
          ...entry,
          openingKey: undefined,
          error,
        }
      : entry,
  );
}

function startRecordReceiptOpening(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
): AgentTranscriptEntry[] {
  return entries.map((entry) =>
    entry.kind === 'records' && entry.id === entryId
      ? { ...entry, error: undefined, opening: true }
      : entry,
  );
}

function settleRecordReceiptOpening(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
  error: string | undefined,
): AgentTranscriptEntry[] {
  return entries.map((entry) =>
    entry.kind === 'records' && entry.id === entryId
      ? { ...entry, opening: false, error }
      : entry,
  );
}

function startFieldReceiptOpening(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
  openingKey: string,
): AgentTranscriptEntry[] {
  return entries.map((entry) =>
    entry.kind === 'fields' && entry.id === entryId
      ? { ...entry, error: undefined, openingKey }
      : entry,
  );
}

function settleFieldReceiptOpening(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
  error: string | undefined,
): AgentTranscriptEntry[] {
  return entries.map((entry) =>
    entry.kind === 'fields' && entry.id === entryId
      ? { ...entry, openingKey: undefined, error }
      : entry,
  );
}

function startAssetReceiptOpening(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
  openingKey: string,
): AgentTranscriptEntry[] {
  return entries.map((entry) =>
    entry.kind === 'assets' && entry.id === entryId
      ? { ...entry, error: undefined, openingKey }
      : entry,
  );
}

function fieldReceiptCanOpen(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
): boolean {
  const receipt = entries.find(
    (entry) => entry.kind === 'fields' && entry.id === entryId,
  );
  return receipt?.kind === 'fields' && !receipt.openingKey;
}

function assetReceiptCanOpen(
  entries: readonly AgentTranscriptEntry[],
  entryId: string,
): boolean {
  const receipt = entries.find(
    (entry) => entry.kind === 'assets' && entry.id === entryId,
  );
  return receipt?.kind === 'assets' && !receipt.openingKey;
}

function directAssetCanOpen(
  asset: AgentAssetResultViewModel,
  hostActionPending: boolean,
): boolean {
  return !asset.deleted && !hostActionPending;
}

async function openAssetInHost(
  navigator: AgentNavigator,
  asset: AgentAssetResultViewModel,
): Promise<{ result?: OpenAssetResult; error?: string }> {
  try {
    return {
      result: await navigator.openAsset({
        uploadId: asset.uploadId,
        label: asset.title,
      }),
    };
  } catch (error) {
    const detail = errorMessage(error).trim();
    return {
      error: detail
        ? `Could not open this asset. ${detail}`
        : 'Could not open this asset.',
    };
  }
}

async function openFieldInHost(
  openCurrentField: NonNullable<AgentFrameProps['openCurrentField']>,
  field: AgentFieldResultViewModel,
): Promise<string | undefined> {
  try {
    await openCurrentField({
      fieldPath: field.fieldPath,
      label: field.title,
      locale: field.locale,
    });
    return undefined;
  } catch (error) {
    const detail = errorMessage(error).trim();
    return detail
      ? `Could not show this field. ${detail}`
      : 'Could not show this field.';
  }
}

function assetResultChangesReceipt(
  result: OpenAssetResult | undefined,
): result is OpenAssetResult {
  return Boolean(result?.deleted || result?.uploadId || result?.title);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Approval details deliberately normalize several optional MCP argument shapes in one review model.
function approvalViewModel(
  pending: PendingApproval,
  scope: {
    siteId: string;
    siteName?: string;
    environment: string;
    isEnvironmentPrimary: boolean;
    scriptSessionId?: string;
    readOnly?: boolean;
  },
): UnsafeApprovalViewModel {
  const validation = validateApprovalScope(
    {
      name: pending.request.name,
      arguments: pending.request.arguments,
      serverLabel: pending.request.serverLabel,
    },
    scope,
    { readOnly: scope.readOnly },
  );
  const parsed = validation.parsedArguments ?? {};
  const body =
    typeof parsed.body === 'object' && parsed.body !== null
      ? (parsed.body as Record<string, unknown>)
      : {};
  const status = pending.decision
    ? pending.decision.approve
      ? 'approving'
      : 'rejecting'
    : validation.allowed
      ? 'pending'
      : 'error';

  return {
    id: pending.request.approvalRequestId,
    title: 'Review this change',
    description: validation.allowed
      ? typeof parsed.name === 'string'
        ? `Run “${parsed.name}” in ${scope.siteName ?? 'this project'}.`
        : `Run this operation in ${scope.siteName ?? 'this project'}.`
      : validation.reason,
    actionLabel: 'Approve',
    status,
    automatic: pending.automatic,
    ...(validation.allowed ? {} : { error: validation.reason }),
    ...(typeof body.content === 'string'
      ? {
          script: {
            language: 'typescript' as const,
            source: body.content,
          },
        }
      : {}),
    details: [
      { label: 'Project', value: String(parsed.site_id ?? 'Not provided') },
      {
        label: 'Environment',
        value: scope.isEnvironmentPrimary
          ? 'Primary'
          : String(parsed.environment ?? 'Not provided'),
      },
      { label: 'Operation', value: pending.request.name },
      ...(typeof parsed.name === 'string'
        ? [{ label: 'Saved script', value: parsed.name }]
        : []),
    ],
  };
}

function transcriptFromConversation(
  conversation: Conversation,
): AgentTranscriptEntry[] {
  return conversation.messages.flatMap((message) => [
    {
      id: message.id,
      kind: 'message' as const,
      role: message.role,
      content: message.text,
      createdAt: message.createdAt,
      ...(message.segments ? { segments: message.segments } : {}),
      ...(message.interrupted ? { interrupted: true } : {}),
    },
    ...(message.recordResults ?? []).map((group) => ({
      id: group.id,
      kind: 'records' as const,
      ...(group.title ? { title: group.title } : {}),
      records: group.records,
    })),
    ...(message.fieldResults ?? []).map((group) => ({
      id: group.id,
      kind: 'fields' as const,
      ...(group.title ? { title: group.title } : {}),
      fields: group.fields,
    })),
    ...(message.assetResults ?? []).map((group) => ({
      id: group.id,
      kind: 'assets' as const,
      ...(group.title ? { title: group.title } : {}),
      assets: group.assets,
    })),
    ...(message.mentionResults ?? []).map((group) => ({
      id: group.id,
      kind: 'mentions' as const,
      ...(group.title ? { title: group.title } : {}),
      mentions: group.mentions,
    })),
  ]);
}

function recordResultsFollowingMessage(
  entries: readonly AgentTranscriptEntry[],
  messageIndex: number,
): ConversationRecordResultGroup[] | undefined {
  const groups: ConversationRecordResultGroup[] = [];

  for (const entry of entries.slice(messageIndex + 1)) {
    if (entry.kind === 'message') {
      break;
    }

    if (entry.kind === 'records') {
      groups.push({
        id: entry.id,
        ...(entry.title ? { title: entry.title } : {}),
        records: entry.records.map((record) => ({
          itemId: record.itemId,
          title: record.title,
          ...(record.itemTypeId ? { itemTypeId: record.itemTypeId } : {}),
          ...(record.fieldPath ? { fieldPath: record.fieldPath } : {}),
          ...(record.mention ? { mention: { ...record.mention } } : {}),
        })),
      });
    }
  }

  return groups.length > 0 ? groups : undefined;
}

function fieldResultsFollowingMessage(
  entries: readonly AgentTranscriptEntry[],
  messageIndex: number,
): ConversationFieldResultGroup[] | undefined {
  const groups: ConversationFieldResultGroup[] = [];

  for (const entry of entries.slice(messageIndex + 1)) {
    if (entry.kind === 'message') {
      break;
    }

    if (entry.kind === 'fields') {
      groups.push({
        id: entry.id,
        ...(entry.title ? { title: entry.title } : {}),
        fields: entry.fields.map((field) => ({
          fieldPath: field.fieldPath,
          title: field.title,
          ...(field.locale ? { locale: field.locale } : {}),
          ...(field.mention ? { mention: { ...field.mention } } : {}),
        })),
      });
    }
  }

  return groups.length > 0 ? groups : undefined;
}

function assetResultsFollowingMessage(
  entries: readonly AgentTranscriptEntry[],
  messageIndex: number,
): ConversationAssetResultGroup[] | undefined {
  const groups: ConversationAssetResultGroup[] = [];

  for (const entry of entries.slice(messageIndex + 1)) {
    if (entry.kind === 'message') {
      break;
    }

    if (entry.kind === 'assets') {
      groups.push({
        id: entry.id,
        ...(entry.title ? { title: entry.title } : {}),
        assets: entry.assets.map((asset) => ({
          uploadId: asset.uploadId,
          title: asset.title,
          ...(asset.deleted ? { deleted: true } : {}),
          ...(asset.mention ? { mention: { ...asset.mention } } : {}),
        })),
      });
    }
  }

  return groups.length > 0 ? groups : undefined;
}

function mentionResultsFollowingMessage(
  entries: readonly AgentTranscriptEntry[],
  messageIndex: number,
): ConversationMentionResultGroup[] | undefined {
  const groups: ConversationMentionResultGroup[] = [];

  for (const entry of entries.slice(messageIndex + 1)) {
    if (entry.kind === 'message') break;
    if (entry.kind === 'mentions') {
      groups.push({
        id: entry.id,
        ...(entry.title ? { title: entry.title } : {}),
        mentions: entry.mentions.map((mention) => ({ ...mention })),
      });
    }
  }

  return groups.length > 0 ? groups : undefined;
}

function presentedFieldResult(
  field: FieldReferenceInput,
): AgentFieldResultViewModel {
  const title = field.label || field.fieldPath;
  const apiKey = field.apiKey || field.fieldPath.split('.').at(-1) || title;
  return {
    fieldPath: field.fieldPath,
    title,
    mention: {
      type: 'field',
      apiKey,
      label: title,
      localized: field.localized ?? Boolean(field.locale),
      fieldPath: field.fieldPath,
      ...(field.locale ? { locale: field.locale } : {}),
      ...(field.fieldType ? { fieldType: field.fieldType } : {}),
    },
    ...(field.locale ? { locale: field.locale } : {}),
  };
}

const MAX_RESTORED_PRESENTATION_REFERENCES = 100;

type PresentationHydrationTarget =
  | {
      type: 'record';
      itemId: string;
      itemTypeId?: string;
      label?: string;
    }
  | { type: 'asset'; uploadId: string; label?: string };

function restoredPresentationTargets(
  entries: readonly AgentTranscriptEntry[],
): PresentationHydrationTarget[] {
  const targets = new Map<string, PresentationHydrationTarget>();
  for (const entry of entries.slice().reverse()) {
    for (const target of presentationTargetsFromEntry(entry)) {
      if (targets.size >= MAX_RESTORED_PRESENTATION_REFERENCES) {
        return [...targets.values()];
      }
      const key = presentationTargetKey(target);
      if (!targets.has(key)) targets.set(key, target);
    }
  }

  return [...targets.values()];
}

function presentationTargetKey(target: PresentationHydrationTarget): string {
  const id = target.type === 'record' ? target.itemId : target.uploadId;
  return `${target.type}:${id}`;
}

function recordPresentationTargets(
  entry: Extract<AgentTranscriptEntry, { kind: 'records' }>,
): PresentationHydrationTarget[] {
  return entry.records
    .slice()
    .reverse()
    .map((record) => ({
      type: 'record' as const,
      itemId: record.itemId,
      ...(record.itemTypeId ? { itemTypeId: record.itemTypeId } : {}),
      ...(record.title ? { label: record.title } : {}),
    }));
}

function assetPresentationTargets(
  entry: Extract<AgentTranscriptEntry, { kind: 'assets' }>,
): PresentationHydrationTarget[] {
  return entry.assets
    .slice()
    .reverse()
    .map((asset) => ({
      type: 'asset' as const,
      uploadId: asset.uploadId,
      ...(asset.title ? { label: asset.title } : {}),
    }));
}

function presentationTargetFromSegment(
  segment: CommentSegment,
): PresentationHydrationTarget | undefined {
  if (segment.type !== 'mention') return undefined;
  if (segment.mention.type === 'record') {
    return {
      type: 'record',
      itemId: segment.mention.id,
      ...(segment.mention.modelId !== 'unknown'
        ? { itemTypeId: segment.mention.modelId }
        : {}),
      label: segment.mention.title,
    };
  }
  if (segment.mention.type !== 'asset') return undefined;
  return {
    type: 'asset',
    uploadId: segment.mention.id,
    label: segment.mention.filename,
  };
}

function messagePresentationTargets(
  entry: Extract<AgentTranscriptEntry, { kind: 'message' }>,
): PresentationHydrationTarget[] {
  if (!entry.segments) return [];
  return entry.segments
    .slice()
    .reverse()
    .map(presentationTargetFromSegment)
    .filter(
      (target): target is PresentationHydrationTarget => target !== undefined,
    );
}

function presentationTargetsFromEntry(
  entry: AgentTranscriptEntry,
): PresentationHydrationTarget[] {
  if (entry.kind === 'records') return recordPresentationTargets(entry);
  if (entry.kind === 'assets') return assetPresentationTargets(entry);
  if (entry.kind === 'message') return messagePresentationTargets(entry);
  return [];
}

type ResolvedPresentations = {
  records: Map<string, Extract<Mention, { type: 'record' }>>;
  assets: Map<string, Extract<Mention, { type: 'asset' }>>;
};

type ResolvedEntityMention = Extract<
  Mention,
  { type: 'record' } | { type: 'asset' }
>;

function resolvedPresentations(
  results: readonly PromiseSettledResult<ResolvedEntityMention>[],
): ResolvedPresentations {
  const records = new Map<string, Extract<Mention, { type: 'record' }>>();
  const assets = new Map<string, Extract<Mention, { type: 'asset' }>>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    if (result.value.type === 'record') {
      records.set(result.value.id, result.value);
    } else if (result.value.type === 'asset') {
      assets.set(result.value.id, result.value);
    }
  }
  return { records, assets };
}

function needsRestoredFieldPresentation(
  entries: readonly AgentTranscriptEntry[],
): boolean {
  return entries.some((entry) => {
    if (entry.kind === 'fields') {
      return entry.fields.some((field) => !field.mention?.fieldType);
    }
    return (
      entry.kind === 'message' &&
      Boolean(
        entry.segments?.some(
          (segment) =>
            segment.type === 'mention' &&
            segment.mention.type === 'field' &&
            !segment.mention.fieldType,
        ),
      )
    );
  });
}

async function restoredFieldPresentations(
  mentionHost: AgentMentionHost,
  needed: boolean,
): Promise<ReadonlyMap<string, FieldInfo>> {
  if (!needed || !mentionHost.loadModelFields) return new Map();
  try {
    const fields = await mentionHost.loadModelFields();
    return new Map(fields.map((field) => [field.fieldPath, field]));
  } catch {
    return new Map();
  }
}

function genericRecordPresentationTitle(title: string, itemId: string) {
  return (
    title.trim().toLowerCase().replaceAll('#', '') ===
    `record ${itemId.toLowerCase()}`
  );
}

function enrichedRecordMention(
  current: Extract<Mention, { type: 'record' }> | undefined,
  resolved: Extract<Mention, { type: 'record' }>,
): Extract<Mention, { type: 'record' }> {
  if (!current) return resolved;
  const resolvedModelKnown = resolved.modelId !== 'unknown';
  return {
    ...resolved,
    title:
      genericRecordPresentationTitle(resolved.title, resolved.id) &&
      !genericRecordPresentationTitle(current.title, current.id)
        ? current.title
        : resolved.title,
    modelId: resolvedModelKnown ? resolved.modelId : current.modelId,
    modelApiKey: resolved.modelApiKey || current.modelApiKey,
    modelName:
      resolved.modelName === 'Record' && current.modelName !== 'Record'
        ? current.modelName
        : resolved.modelName,
    modelEmoji: resolved.modelEmoji ?? current.modelEmoji,
    thumbnailUrl: resolved.thumbnailUrl ?? current.thumbnailUrl,
    ...(resolved.isSingleton || current.isSingleton
      ? { isSingleton: true }
      : {}),
  };
}

function genericAssetPresentationTitle(title: string, uploadId: string) {
  return (
    title.trim().toLowerCase().replaceAll('#', '') ===
    `asset ${uploadId.toLowerCase()}`
  );
}

function enrichedAssetMention(
  current: Extract<Mention, { type: 'asset' }> | undefined,
  resolved: Extract<Mention, { type: 'asset' }>,
): Extract<Mention, { type: 'asset' }> {
  if (!current) return resolved;
  return {
    ...resolved,
    filename:
      genericAssetPresentationTitle(resolved.filename, resolved.id) &&
      !genericAssetPresentationTitle(current.filename, current.id)
        ? current.filename
        : resolved.filename,
    url: resolved.url || current.url,
    thumbnailUrl: resolved.thumbnailUrl ?? current.thumbnailUrl,
    mimeType:
      resolved.mimeType === 'application/octet-stream'
        ? current.mimeType
        : resolved.mimeType,
  };
}

function enrichedFieldMention({
  current,
  field,
  fieldPath,
  title,
  locale,
}: {
  current?: Extract<Mention, { type: 'field' }>;
  field?: FieldInfo;
  fieldPath: string;
  title: string;
  locale?: string;
}): Extract<Mention, { type: 'field' }> {
  const resolvedLocale = locale ?? current?.locale;
  return {
    type: 'field',
    apiKey:
      field?.apiKey ||
      current?.apiKey ||
      fieldPath.split('.').at(-1) ||
      fieldPath,
    label: field?.label || current?.label || title,
    localized:
      field?.localized ?? current?.localized ?? Boolean(resolvedLocale),
    fieldPath,
    ...(resolvedLocale ? { locale: resolvedLocale } : {}),
    ...(field?.fieldType || current?.fieldType
      ? { fieldType: field?.fieldType || current?.fieldType }
      : {}),
  };
}

function enrichedEntityMention(
  current: Mention,
  records: ReadonlyMap<string, Extract<Mention, { type: 'record' }>>,
  assets: ReadonlyMap<string, Extract<Mention, { type: 'asset' }>>,
  fields: ReadonlyMap<string, FieldInfo>,
): Mention {
  if (current.type === 'record') {
    const resolved = records.get(current.id);
    return resolved ? enrichedRecordMention(current, resolved) : current;
  }
  if (current.type === 'asset') {
    const resolved = assets.get(current.id);
    return resolved ? enrichedAssetMention(current, resolved) : current;
  }
  if (current.type === 'field') {
    const field = fields.get(current.fieldPath);
    return field
      ? enrichedFieldMention({
          current,
          field,
          fieldPath: current.fieldPath,
          title: current.label,
        })
      : current;
  }
  return current;
}

function applyRestoredPresentation(
  entries: readonly AgentTranscriptEntry[],
  records: ReadonlyMap<string, Extract<Mention, { type: 'record' }>>,
  assets: ReadonlyMap<string, Extract<Mention, { type: 'asset' }>>,
  fields: ReadonlyMap<string, FieldInfo>,
): AgentTranscriptEntry[] {
  return entries.map((entry) => {
    if (entry.kind === 'records') {
      return {
        ...entry,
        records: entry.records.map((record) => {
          const resolved = records.get(record.itemId);
          if (!resolved) return record;
          const current =
            record.mention ??
            fallbackRecordMention({
              id: record.itemId,
              title: record.title,
              ...(record.itemTypeId
                ? {
                    model: {
                      modelId: record.itemTypeId,
                      modelApiKey: '',
                      modelName: 'Record',
                      modelEmoji: null,
                    },
                  }
                : {}),
            });
          const mention = enrichedRecordMention(current, resolved);
          return {
            ...record,
            title: mention.title,
            mention,
            ...(mention.modelId !== 'unknown'
              ? { itemTypeId: mention.modelId }
              : {}),
          };
        }),
      };
    }
    if (entry.kind === 'assets') {
      return {
        ...entry,
        assets: entry.assets.map((asset) => {
          const resolved = assets.get(asset.uploadId);
          const mention = resolved
            ? enrichedAssetMention(
                asset.mention ??
                  fallbackAssetMention(asset.uploadId, asset.title),
                resolved,
              )
            : undefined;
          return mention
            ? { ...asset, title: mention.filename, mention }
            : asset;
        }),
      };
    }
    if (entry.kind === 'fields') {
      return {
        ...entry,
        fields: entry.fields.map((fieldResult) => {
          const field = fields.get(fieldResult.fieldPath);
          if (!field) return fieldResult;
          return {
            ...fieldResult,
            mention: enrichedFieldMention({
              current: fieldResult.mention,
              field,
              fieldPath: fieldResult.fieldPath,
              title: fieldResult.title,
              ...(fieldResult.locale ? { locale: fieldResult.locale } : {}),
            }),
          };
        }),
      };
    }
    if (entry.kind !== 'message' || !entry.segments) return entry;
    return {
      ...entry,
      segments: entry.segments.map((segment) => {
        if (segment.type !== 'mention') return segment;
        return {
          type: 'mention',
          mention: enrichedEntityMention(
            segment.mention,
            records,
            assets,
            fields,
          ),
        };
      }),
    };
  });
}

function conversationMessageFromTranscript(
  entries: readonly AgentTranscriptEntry[],
  entry: Extract<AgentTranscriptEntry, { kind: 'message' }>,
  index: number,
  createdAt: string,
): ConversationMessage | undefined {
  const persistedText = persistedTranscriptMessageText(entry);
  const assistant = entry.role === 'assistant';
  const recordResults = assistant
    ? recordResultsFollowingMessage(entries, index)
    : undefined;
  const fieldResults = assistant
    ? fieldResultsFollowingMessage(entries, index)
    : undefined;
  const assetResults = assistant
    ? assetResultsFollowingMessage(entries, index)
    : undefined;
  const mentionResults = assistant
    ? mentionResultsFollowingMessage(entries, index)
    : undefined;

  if (
    !persistedText.trim() &&
    !recordResults &&
    !fieldResults &&
    !assetResults &&
    !mentionResults
  ) {
    return undefined;
  }

  const message: ConversationMessage = {
    id: entry.id,
    role: entry.role,
    text: persistedText,
    createdAt: entry.createdAt ?? createdAt,
  };

  if (entry.segments?.length) {
    message.segments = entry.segments.map((segment) =>
      segment.type === 'text'
        ? { ...segment }
        : { type: 'mention', mention: { ...segment.mention } },
    );
  }

  if (assistant && (entry.interrupted || Boolean(entry.error))) {
    message.interrupted = true;
  }
  if (recordResults) {
    message.recordResults = recordResults;
  }
  if (fieldResults) {
    message.fieldResults = fieldResults;
  }
  if (assetResults) {
    message.assetResults = assetResults;
  }
  if (mentionResults) {
    message.mentionResults = mentionResults;
  }

  return message;
}

function conversationMessagesFromTranscript(
  entries: readonly AgentTranscriptEntry[],
  createdAt: string,
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  entries.forEach((entry, index) => {
    if (entry.kind !== 'message') {
      return;
    }

    const message = conversationMessageFromTranscript(
      entries,
      entry,
      index,
      createdAt,
    );
    if (message) {
      messages.push(message);
    }
  });

  return messages;
}

function conversationProviderText(message: ConversationMessage): string {
  if (message.role === 'user' && message.segments?.length) {
    return segmentsProviderText(message.segments, {
      localFileBytesAvailable: hasSessionLocalFileBytes,
    });
  }

  if (message.role !== 'assistant') return message.text;

  const references = [
    ...(message.recordResults ?? []).flatMap((group) =>
      group.records.map((record) => ({
        type: 'record',
        id: record.itemId,
        ...(record.itemTypeId ? { modelId: record.itemTypeId } : {}),
        label: record.title,
      })),
    ),
    ...(message.fieldResults ?? []).flatMap((group) =>
      group.fields.map((field) => ({
        type: 'field',
        fieldPath: field.fieldPath,
        ...(field.locale ? { locale: field.locale } : {}),
        label: field.title,
      })),
    ),
    ...(message.assetResults ?? []).flatMap((group) =>
      group.assets.map((asset) => ({
        type: 'asset',
        id: asset.uploadId,
        label: asset.title,
      })),
    ),
    ...(message.mentionResults ?? []).flatMap((group) =>
      group.mentions.map(hostPresentedMentionReference),
    ),
  ];

  return references.length > 0
    ? `${message.text}\n\nHOST-PRESENTED DATOCMS REFERENCES\n${JSON.stringify(
        references,
      )}`
    : message.text;
}

function hostPresentedMentionReference(mention: Mention) {
  switch (mention.type) {
    case 'user':
      return { type: mention.type, id: mention.id, label: mention.name };
    case 'field':
      return {
        type: mention.type,
        fieldPath: mention.fieldPath,
        ...(mention.locale ? { locale: mention.locale } : {}),
        label: mention.label,
      };
    case 'asset':
      return { type: mention.type, id: mention.id, label: mention.filename };
    case 'file':
      return {
        type: mention.type,
        id: mention.id,
        label: mention.filename,
        mimeType: mention.mimeType,
        size: mention.size,
      };
    case 'record':
      return {
        type: mention.type,
        id: mention.id,
        modelId: mention.modelId,
        modelApiKey: mention.modelApiKey,
        label: mention.title,
      };
    case 'model':
      return {
        type: mention.type,
        id: mention.id,
        apiKey: mention.apiKey,
        isBlockModel: mention.isBlockModel,
        label: mention.name,
      };
  }
}

function localFileDescriptors(
  segments: readonly CommentSegment[] | undefined,
): LocalFileAttachmentDescriptor[] {
  return (segments ?? []).flatMap((segment) =>
    segment.type === 'mention' && segment.mention.type === 'file'
      ? [
          {
            id: segment.mention.id,
            filename: segment.mention.filename,
            mimeType: segment.mention.mimeType,
            size: segment.mention.size,
            lastModified: segment.mention.lastModified,
          },
        ]
      : [],
  );
}

function runtimeAttachments(
  descriptors: readonly LocalFileAttachmentDescriptor[] | undefined,
): AgentRuntimeAttachment[] {
  const seen = new Set<string>();
  return (descriptors ?? []).flatMap((descriptor) => {
    if (seen.has(descriptor.id)) return [];
    seen.add(descriptor.id);
    const file = getSessionLocalFile(descriptor.id);
    return file ? [{ ...descriptor, file }] : [];
  });
}

function eligibleProviderHistoryMessages(
  messages: readonly ConversationMessage[],
): ConversationMessage[] {
  const eligibleMessages: ConversationMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.interrupted) {
      // An interrupted assistant response is not valid provider history. Its
      // immediately preceding user request belongs to the same unfinished
      // exchange, so retaining only that request would ask the provider to
      // answer it again before the editor's new message.
      if (eligibleMessages.at(-1)?.role === 'user') {
        eligibleMessages.pop();
      }
      continue;
    }

    if (message.role === 'user' || message.text.trim()) {
      eligibleMessages.push(message);
    }
  }
  return eligibleMessages;
}

function providerHistory(
  messages: readonly ConversationMessage[],
  currentAttachments: readonly AgentRuntimeAttachment[],
): AgentConversationHistoryMessage[] {
  const eligibleMessages = eligibleProviderHistoryMessages(messages);
  const history = eligibleMessages.map(
    (message): AgentConversationHistoryMessage => ({
      role: message.role,
      text: conversationProviderText(message),
    }),
  );
  let remainingCount = Math.max(
    0,
    MAX_AGENT_ATTACHMENTS_PER_REQUEST - currentAttachments.length,
  );
  let remainingBytes = Math.max(
    0,
    MAX_AGENT_ATTACHMENT_TOTAL_BYTES -
      currentAttachments.reduce(
        (total, attachment) => total + attachment.size,
        0,
      ),
  );
  const reservedIds = new Set(
    currentAttachments.map((attachment) => attachment.id),
  );
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const historyEntry = history[index];
    const message = eligibleMessages[index];
    if (historyEntry?.role !== 'user' || !message) continue;

    const retained: AgentRuntimeAttachment[] = [];
    for (const attachment of runtimeAttachments(
      localFileDescriptors(message.segments),
    )) {
      if (
        retained.length >= MAX_AGENT_ATTACHMENTS_PER_MESSAGE ||
        remainingCount === 0 ||
        attachment.size > remainingBytes ||
        reservedIds.has(attachment.id)
      ) {
        continue;
      }
      retained.push(attachment);
      reservedIds.add(attachment.id);
      remainingCount -= 1;
      remainingBytes -= attachment.size;
    }
    if (retained.length > 0) historyEntry.attachments = retained;
  }

  return history;
}

function loadStoredConversations(
  conversationStore: ConversationStore,
): Conversation[] {
  let stored: Conversation[];
  try {
    stored = conversationStore.list();
  } catch {
    return [];
  }

  return stored.flatMap((conversation) => {
    const cleaned = withoutLegacyDemoTranscript(conversation);

    if (cleaned.messages.length === 0) {
      try {
        conversationStore.remove(cleaned.id);
      } catch {
        // Empty placeholders stay hidden when browser storage is unavailable.
      }
      return [];
    }

    if (cleaned !== conversation) {
      try {
        return [conversationStore.save(cleaned)];
      } catch {
        return [cleaned];
      }
    }

    return [conversation];
  });
}

function unsafeDispatchRecoveryMessage(journal: UnsafeDispatchJournal): string {
  const hasUnknownOutcome = journal.operations.some(
    (operation) => operation.state === 'dispatched',
  );
  const hasConfirmedOutcome = journal.operations.some(
    (operation) => operation.state === 'confirmed',
  );
  if (hasUnknownOutcome) {
    return 'An approved DatoCMS change may already have run, but the chat closed before its result was confirmed. Check the affected content before trying the same change again.';
  }
  if (hasConfirmedOutcome) {
    return 'The approved DatoCMS operation returned a result, but the chat closed before that result could be safely restored. Check DatoCMS before trying it again.';
  }

  return 'The chat closed before this approved DatoCMS change was sent. No change was made.';
}

function recoverUnsafeDispatchJournal(
  conversationStore: ConversationStore,
  journalStore: UnsafeDispatchJournalStore,
): Conversation[] {
  const stored = loadStoredConversations(conversationStore);
  let journal: UnsafeDispatchJournal | undefined;
  try {
    journal = journalStore.read();
  } catch {
    return stored;
  }
  if (!journal) {
    return stored;
  }

  const now = new Date().toISOString();
  const existing = stored.find(
    (conversation) => conversation.id === journal.conversation.id,
  );
  const base: Conversation = existing ?? {
    id: journal.conversation.id,
    title: journal.conversation.title,
    createdAt: journal.conversation.createdAt,
    updatedAt: journal.updatedAt,
    messages: [],
  };
  const recoveryMessageId = `unsafe-recovery:${journal.id}`;
  const messages = base.messages.filter(
    (message) =>
      message.id !== recoveryMessageId &&
      message.id !== journal.turn.assistantEntryId,
  );
  if (!messages.some((message) => message.id === journal.turn.userEntryId)) {
    messages.push({
      id: journal.turn.userEntryId,
      role: 'user',
      text: journal.turn.userMessage,
      createdAt: journal.turn.startedAt,
    });
  }
  messages.push({
    id: recoveryMessageId,
    role: 'assistant',
    text: unsafeDispatchRecoveryMessage(journal),
    createdAt: now,
  });

  const portable = withoutProviderState({
    ...base,
    title:
      base.title === 'New conversation'
        ? journal.turn.userMessage.slice(0, 80)
        : base.title,
    updatedAt: now,
    messages,
  });

  try {
    conversationStore.save(portable);
    journalStore.clear(journal.id);
  } catch {
    return loadStoredConversations(conversationStore);
  }

  return loadStoredConversations(conversationStore);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This frame coordinates the chat, OAuth, persistence, native navigation, and approval state that must share one React lifecycle.
export default function AgentFrame(props: AgentFrameProps) {
  const mentionHost = useMemo<AgentMentionHost>(
    () =>
      props.mentionHost ?? {
        currentUser: {
          id: props.currentUserId,
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
        resolveRecord: async ({ itemId, itemTypeId, label }) =>
          fallbackRecordMention({
            id: itemId,
            title: label || `Record #${itemId}`,
            ...(itemTypeId
              ? {
                  model: {
                    modelId: itemTypeId,
                    modelApiKey: '',
                    modelName: 'Record',
                    modelEmoji: null,
                  },
                }
              : {}),
          }),
        openUser: () => undefined,
        openModel: () => undefined,
        openLocalFile: async () => undefined,
      },
    [props.currentUserId, props.mentionHost],
  );
  const mentionHostRef = useRef(mentionHost);
  mentionHostRef.current = mentionHost;
  const surface: AgentSurfaceKind =
    props.surface ?? (props.currentRecord ? 'record' : 'project');
  const scopeType = props.scope.type;
  const scopeId =
    props.scope.type === 'record'
      ? props.scope.recordId
      : props.scope.type === 'custom'
        ? props.scope.id
        : undefined;
  const stableScope = useMemo<ConversationScope>(
    () =>
      scopeType === 'project'
        ? { type: 'project' }
        : scopeType === 'record'
          ? { type: 'record', recordId: scopeId ?? '' }
          : { type: 'custom', id: scopeId ?? '' },
    [scopeId, scopeType],
  );
  const credentialScope: CredentialScope = useMemo(
    () => ({
      siteId: props.siteId,
      currentUserId: props.currentUserId,
    }),
    [props.currentUserId, props.siteId],
  );
  const autoApprovalScope: AutoApprovalScope = useMemo(
    () => ({
      pluginId: props.pluginId,
      siteId: props.siteId,
      environment: props.environment,
      currentUserId: props.currentUserId,
    }),
    [props.currentUserId, props.environment, props.pluginId, props.siteId],
  );
  const oauthStore = useMemo(
    () => createCredentialStore(credentialScope),
    [credentialScope],
  );
  const autoApprovalStore = useMemo(
    () => createAutoApprovalStore(autoApprovalScope),
    [autoApprovalScope],
  );
  const readOnlyRef = useRef(props.config.readOnly);
  const conversationStorageContext = useMemo(
    () => ({
      pluginId: props.pluginId,
      siteId: props.siteId,
      environment: props.environment,
      currentUserId: props.currentUserId,
      scope: stableScope,
    }),
    [
      props.currentUserId,
      props.environment,
      props.pluginId,
      props.siteId,
      stableScope,
    ],
  );
  const conversationStore = useMemo(
    () => createConversationStore(conversationStorageContext),
    [conversationStorageContext],
  );
  const unsafeDispatchJournalStore = useMemo(
    () => createUnsafeDispatchJournalStore(conversationStorageContext),
    [conversationStorageContext],
  );
  const initialStoredConversations = useMemo(
    () =>
      recoverUnsafeDispatchJournal(
        conversationStore,
        unsafeDispatchJournalStore,
      ),
    [conversationStore, unsafeDispatchJournalStore],
  );
  const initialConversation = useMemo(
    () => initialStoredConversations[0] ?? createEmptyConversation(),
    [initialStoredConversations],
  );
  const [conversation, setConversation] =
    useState<Conversation>(initialConversation);
  const conversationRef = useRef(conversation);
  const [storedConversations, setStoredConversations] = useState<
    Conversation[]
  >(initialStoredConversations);
  const [entries, setEntries] = useState<AgentTranscriptEntry[]>(() =>
    transcriptFromConversation(initialConversation),
  );
  const entriesRef = useRef(entries);
  const [oauthCredentials, setOauthCredentials] =
    useState<OAuthCredentials | null>(() => {
      try {
        return oauthStore.setRemembered(true)?.credentials ?? null;
      } catch {
        return null;
      }
    });
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthError, setOauthError] = useState<string>();
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(() => {
    try {
      if (props.config.readOnly) {
        autoApprovalStore.setEnabled(false);
        return false;
      }
      return autoApprovalStore.isEnabled();
    } catch {
      return false;
    }
  });
  const [autoApproveChanging, setAutoApproveChanging] = useState(false);
  const [autoApproveError, setAutoApproveError] = useState<string>();
  const [conversationPersistenceError, setConversationPersistenceError] =
    useState<string>();
  const [running, setRunning] = useState(false);
  const [hostActionPending, setHostActionPending] = useState(false);
  const [currentInspectorRecordId, setCurrentInspectorRecordId] =
    useState<string>();
  const [pendingApprovals, setPendingApprovals] = useState<
    Map<string, PendingApproval>
  >(new Map());
  const pendingApprovalsRef = useRef(pendingApprovals);
  const runtimeRef = useRef<ReturnType<typeof createAgentRuntime> | undefined>(
    undefined,
  );
  const abortRef = useRef<AbortController | undefined>(undefined);
  const activeTurnRef = useRef<ActiveTurn | undefined>(undefined);
  const retryCandidateRef = useRef<RetryCandidate | undefined>(undefined);
  const unsafeRepairCandidateRef = useRef<UnsafeRepairCandidate | undefined>(
    undefined,
  );
  const repairPolicyIdentity = JSON.stringify({
    config: props.config,
    currentUserId: props.currentUserId,
    environment: props.environment,
    siteId: props.siteId,
    scope: stableScope,
  });
  const repairPolicyIdentityRef = useRef(repairPolicyIdentity);
  const liveRepairPolicyIdentityRef = useRef(repairPolicyIdentity);
  const failureDiagnosticsRef = useRef(new Map<string, string>());
  const pendingNavigationRef = useRef<PendingNavigation[]>([]);
  const currentInspectorRecordIdRef = useRef<string | undefined>(undefined);
  const hostActionPendingRef = useRef(false);
  const approvalDispatchRef = useRef(new Set<string>());
  const autoApprovalDispatchRef = useRef(new Set<string>());
  const autoApproveEnabledRef = useRef(autoApproveEnabled);
  const autoApproveChangeRef = useRef(false);
  const editorDirtyRef = useRef(
    Boolean(
      props.editorHasUnsavedChanges ?? props.currentRecord?.hasUnsavedChanges,
    ),
  );
  const mountedRef = useRef(true);
  const oauthPopupRef = useRef<Window | undefined>(undefined);
  const oauthCredentialsRef = useRef(oauthCredentials);
  const checkpointActiveTurnRef = useRef<
    ((turn: ActiveTurn, updateState: boolean) => void) | undefined
  >(undefined);

  autoApproveEnabledRef.current = autoApproveEnabled;
  readOnlyRef.current = props.config.readOnly;
  liveRepairPolicyIdentityRef.current = repairPolicyIdentity;
  oauthCredentialsRef.current = oauthCredentials;
  editorDirtyRef.current = Boolean(
    props.editorHasUnsavedChanges ?? props.currentRecord?.hasUnsavedChanges,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      hostActionPendingRef.current = false;
      const activeTurn = activeTurnRef.current;
      if (activeTurn && !activeTurn.unsafeOperationDispatched) {
        checkpointActiveTurnRef.current?.(activeTurn, false);
      }
      abortRef.current?.abort();
      void runtimeRef.current?.dispose?.();
      runtimeRef.current = undefined;
      retryCandidateRef.current = undefined;
      unsafeRepairCandidateRef.current = undefined;
      failureDiagnosticsRef.current.clear();
      if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
        oauthPopupRef.current.close();
      }
    };
  }, []);

  const openRecordInHost = async (target: RecordTarget) => {
    if (
      surface === 'project' &&
      currentInspectorRecordIdRef.current === target.itemId
    ) {
      return;
    }

    await props.navigator.openRecord(target);
    if (surface === 'project' && mountedRef.current) {
      currentInspectorRecordIdRef.current = target.itemId;
      setCurrentInspectorRecordId(target.itemId);
    }
  };

  const showRecordsInHost = async (target: RecordListTarget) => {
    await props.navigator.showRecords(target);
    if (surface === 'project' && mountedRef.current) {
      currentInspectorRecordIdRef.current = undefined;
      setCurrentInspectorRecordId(undefined);
    }
  };

  useEffect(() => {
    const synchronizeAutoApproval = (event: StorageEvent) => {
      if (event.key !== autoApprovalStore.key) {
        return;
      }

      let enabled = false;
      try {
        if (readOnlyRef.current) {
          autoApprovalStore.setEnabled(false);
        } else {
          enabled = autoApprovalStore.isEnabled();
        }
      } catch {
        enabled = false;
      }
      autoApproveEnabledRef.current = enabled;
      setAutoApproveEnabled(enabled);
      setAutoApproveError(undefined);
    };

    window.addEventListener('storage', synchronizeAutoApproval);
    return () => window.removeEventListener('storage', synchronizeAutoApproval);
  }, [autoApprovalStore]);

  const updateEntries = (
    updater: (current: AgentTranscriptEntry[]) => AgentTranscriptEntry[],
  ) => {
    const next = updater(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  };

  const retireUnsafeRepairCandidate = (approvalRequestId?: string): void => {
    const candidate = unsafeRepairCandidateRef.current;
    if (
      approvalRequestId &&
      candidate &&
      candidate.approvalRequestId !== approvalRequestId
    ) {
      return;
    }

    const retiredId = approvalRequestId ?? candidate?.approvalRequestId;
    unsafeRepairCandidateRef.current = undefined;
    if (!retiredId) return;

    updateEntries((current) =>
      current.map((entry) => {
        if (
          entry.kind !== 'approval' ||
          entry.approval.id !== retiredId ||
          !entry.approval.recovery
        ) {
          return entry;
        }
        const { recovery: _recovery, ...approval } = entry.approval;
        return { ...entry, approval };
      }),
    );
  };

  const confirmUnsafeJournalOperations = (
    turn: ActiveTurn,
    approvalRequestIds: readonly string[],
  ): void => {
    const confirmedApprovalIds = [...new Set(approvalRequestIds)].filter(
      Boolean,
    );
    if (confirmedApprovalIds.length === 0) return;

    turn.confirmedApprovalIds = [
      ...new Set([...turn.confirmedApprovalIds, ...confirmedApprovalIds]),
    ];
    if (!turn.unsafeJournalId) return;

    try {
      unsafeDispatchJournalStore.markConfirmed(
        turn.unsafeJournalId,
        confirmedApprovalIds,
      );
      mentionHostRef.current.invalidatePresentationCache?.();
      void refreshPresentationEntriesRef.current();
    } catch {
      // Keep a stale journal fail-closed. Recovery is not exposed while a
      // durable dispatched operation remains unresolved.
    }
  };

  const releaseConfirmedUnsafeJournal = (
    turn: ActiveTurn,
    { allowSuccessfulInterruptionNotice = true } = {},
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Durable outcome persistence, read-back verification, and journal release intentionally stay in one fail-closed transaction.
  ): boolean => {
    try {
      const durableJournal = unsafeDispatchJournalStore.read();
      if (!durableJournal) {
        turn.unsafeJournalId = undefined;
        return true;
      }
      if (
        !turn.unsafeJournalId ||
        durableJournal.id !== turn.unsafeJournalId ||
        durableJournal.operations.some(
          (operation) => operation.state !== 'confirmed',
        )
      ) {
        return false;
      }

      const assistantEntry = entriesRef.current.find(
        (entry): entry is Extract<AgentTranscriptEntry, { kind: 'message' }> =>
          entry.id === turn.assistantEntryId && entry.kind === 'message',
      );
      if (!assistantEntry) return false;
      const durableNotice = durableUnsafeOutcomeNotice(
        turn,
        assistantEntry,
        allowSuccessfulInterruptionNotice,
      );
      if (durableNotice) {
        updateEntries((current) =>
          current.map((entry) =>
            entry.id === turn.assistantEntryId && entry.kind === 'message'
              ? { ...entry, durableOutcomeNotice: durableNotice }
              : entry,
          ),
        );
      }

      const expectedAssistantEntry = entriesRef.current.find(
        (entry): entry is Extract<AgentTranscriptEntry, { kind: 'message' }> =>
          entry.id === turn.assistantEntryId && entry.kind === 'message',
      );
      if (!expectedAssistantEntry) return false;
      const expectedText = persistedTranscriptMessageText(
        expectedAssistantEntry,
      );
      if (!expectedText.trim()) return false;

      persistConversation({});
      const durableConversation = conversationStore.get(
        conversationRef.current.id,
      );
      const durableAssistantMessage = durableConversation?.messages.find(
        (message) => message.id === turn.assistantEntryId,
      );
      if (durableAssistantMessage?.text !== expectedText) {
        return false;
      }

      const verifiedJournal = unsafeDispatchJournalStore.read();
      if (
        !turn.unsafeJournalId ||
        verifiedJournal?.id !== turn.unsafeJournalId ||
        verifiedJournal.operations.some(
          (operation) => operation.state !== 'confirmed',
        )
      ) {
        return false;
      }

      unsafeDispatchJournalStore.clear(turn.unsafeJournalId);
      turn.unsafeJournalId = undefined;
      return unsafeDispatchJournalStore.read() === undefined;
    } catch {
      return false;
    }
  };

  const recordApprovalOutcome = (
    outcome: AgentApprovalOutcome,
    turn: ActiveTurn,
  ): void => {
    turn.approvalOutcomes = [
      ...turn.approvalOutcomes.filter(
        (candidate) =>
          candidate.approvalRequestId !== outcome.approvalRequestId,
      ),
      outcome,
    ];
    const currentCandidate = unsafeRepairCandidateRef.current;
    if (
      currentCandidate &&
      currentCandidate.approvalRequestId !== outcome.approvalRequestId
    ) {
      retireUnsafeRepairCandidate(currentCandidate.approvalRequestId);
    }

    updateEntries((current) =>
      current.map((entry) => {
        if (
          entry.kind !== 'approval' ||
          entry.approval.id !== outcome.approvalRequestId
        ) {
          return entry;
        }
        const { recovery: _recovery, ...approval } = entry.approval;
        return {
          ...entry,
          approval: {
            ...approval,
            outcome: {
              kind: outcome.kind,
              diagnostic: outcome.diagnostic,
            },
          },
        };
      }),
    );

    if (outcome.kind !== 'failed_before_execution') {
      retireUnsafeRepairCandidate(outcome.approvalRequestId);
      return;
    }

    const pending = pendingApprovalsRef.current.get(outcome.approvalRequestId);
    const submittedApprovalIds = new Set(
      turn.approvalSubmissions.flatMap((submission) =>
        submission.decisions.map((decision) => decision.approvalRequestId),
      ),
    );
    const replacementApprovalAlreadyExists = [
      ...pendingApprovalsRef.current.keys(),
    ].some(
      (approvalRequestId) =>
        approvalRequestId !== outcome.approvalRequestId &&
        !submittedApprovalIds.has(approvalRequestId),
    );
    if (
      !pending ||
      pending.request.name !== DATOCMS_MCP_UNSAFE_SCRIPT_TOOL ||
      replacementApprovalAlreadyExists ||
      readOnlyRef.current
    ) {
      retireUnsafeRepairCandidate(outcome.approvalRequestId);
      return;
    }

    const retained = unsafeRepairCandidateRef.current;
    if (retained?.approvalRequestId === outcome.approvalRequestId) {
      retained.outcome = outcome;
      return;
    }

    unsafeRepairCandidateRef.current = {
      approvalRequestId: outcome.approvalRequestId,
      outcome,
      request: { ...pending.request },
      state: 'staged',
      turnId: turn.id,
    };
  };

  const activateUnsafeRepairCandidate = (turn: ActiveTurn): void => {
    const candidate = unsafeRepairCandidateRef.current;
    if (
      !candidate ||
      candidate.turnId !== turn.id ||
      candidate.state !== 'staged'
    ) {
      return;
    }

    const lastSubmission = turn.approvalSubmissions.at(-1);
    const approvedDecisionIds =
      lastSubmission?.decisions
        .filter((decision) => decision.approve)
        .map((decision) => decision.approvalRequestId) ?? [];
    const allApprovedOperationsConfirmed = approvedDecisionIds.every(
      (approvalRequestId) =>
        turn.confirmedApprovalIds.includes(approvalRequestId),
    );
    const siblingHasUncertainOrPossibleChanges = turn.approvalOutcomes.some(
      (outcome) =>
        outcome.approvalRequestId !== candidate.approvalRequestId &&
        (outcome.kind === 'failed_after_execution' ||
          outcome.kind === 'unknown'),
    );
    const isLatestApprovedOperation = approvedDecisionIds.includes(
      candidate.approvalRequestId,
    );
    if (
      !isLatestApprovedOperation ||
      !allApprovedOperationsConfirmed ||
      siblingHasUncertainOrPossibleChanges ||
      readOnlyRef.current ||
      !activeApiKey(props.config).trim() ||
      !activeModel(props.config).trim() ||
      !oauthCredentialsRef.current?.token?.accessToken ||
      !releaseConfirmedUnsafeJournal(turn)
    ) {
      retireUnsafeRepairCandidate(candidate.approvalRequestId);
      return;
    }

    candidate.state = 'available';
    updateEntries((current) =>
      current.map((entry) =>
        entry.kind === 'approval' &&
        entry.approval.id === candidate.approvalRequestId
          ? {
              ...entry,
              approval: {
                ...entry.approval,
                recovery: { status: 'available' as const },
              },
            }
          : entry,
      ),
    );
  };

  const settleActivatedRepairTurn = (turn: ActiveTurn): void => {
    const candidate = unsafeRepairCandidateRef.current;
    if (candidate?.state === 'starting' && candidate.repairTurnId === turn.id) {
      retireUnsafeRepairCandidate(candidate.approvalRequestId);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: The serialized identity is the sole policy trigger; the ref-backed retire helper must not retrigger this effect on every render.
  useEffect(() => {
    if (repairPolicyIdentityRef.current === repairPolicyIdentity) return;
    repairPolicyIdentityRef.current = repairPolicyIdentity;
    retireUnsafeRepairCandidate();
  }, [repairPolicyIdentity]);

  const updatePendingApprovals = (
    updater: (
      current: Map<string, PendingApproval>,
    ) => Map<string, PendingApproval>,
  ) => {
    const next = updater(pendingApprovalsRef.current);
    pendingApprovalsRef.current = next;
    setPendingApprovals(next);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: This is a one-way policy transition keyed only by the persisted Read Only value and its session store. State helpers are synchronous ref-backed guards; adding the render-local dispatch function would retrigger this effect on every render.
  useEffect(() => {
    if (!props.config.readOnly) {
      return;
    }

    retireUnsafeRepairCandidate();

    autoApproveEnabledRef.current = false;
    setAutoApproveEnabled(false);
    setAutoApproveError(undefined);
    try {
      autoApprovalStore.setEnabled(false);
    } catch {
      // The live in-memory policy is authoritative even when session storage
      // is unavailable.
    }

    const blocked = [...pendingApprovalsRef.current.values()].filter(
      (pending) =>
        pending.request.name === DATOCMS_MCP_UNSAFE_SCRIPT_TOOL &&
        pending.decision?.approve !== false &&
        !(
          activeTurnRef.current?.unsafeOperationDispatched &&
          approvalDispatchRef.current.has(pending.responseId)
        ),
    );
    if (blocked.length === 0) {
      return;
    }

    const blockedIds = new Set(
      blocked.map((pending) => pending.request.approvalRequestId),
    );
    const responseIds = [
      ...new Set(blocked.map((pending) => pending.responseId)),
    ];
    updatePendingApprovals((current) => {
      const next = new Map(current);
      for (const pending of blocked) {
        next.set(pending.request.approvalRequestId, {
          ...pending,
          automatic: false,
          decision: {
            approvalRequestId: pending.request.approvalRequestId,
            approve: false,
            reason: READ_ONLY_REJECTION_MESSAGE,
          },
        });
      }
      return next;
    });
    updateEntries((current) =>
      current.filter(
        (entry) =>
          entry.kind !== 'approval' || !blockedIds.has(entry.approval.id),
      ),
    );

    for (const responseId of responseIds) {
      void dispatchApprovalGroup(responseId);
    }
  }, [autoApprovalStore, props.config.readOnly]);

  const beginHostAction = (): boolean => {
    if (!mountedRef.current || hostActionPendingRef.current) {
      return false;
    }

    hostActionPendingRef.current = true;
    setHostActionPending(true);
    return true;
  };

  const finishHostAction = () => {
    hostActionPendingRef.current = false;
    if (mountedRef.current) {
      setHostActionPending(false);
    }
  };

  const activateConversation = (next: Conversation) => {
    const controller = abortRef.current;
    const runtime = runtimeRef.current;
    activeTurnRef.current = undefined;
    retryCandidateRef.current = undefined;
    unsafeRepairCandidateRef.current = undefined;
    failureDiagnosticsRef.current.clear();
    abortRef.current = undefined;
    controller?.abort();
    runtimeRef.current = undefined;
    void runtime?.dispose?.();
    pendingNavigationRef.current = [];
    approvalDispatchRef.current.clear();
    autoApprovalDispatchRef.current.clear();
    pendingApprovalsRef.current = new Map();
    setPendingApprovals(new Map());
    conversationRef.current = next;
    setConversation(next);
    const transcript = transcriptFromConversation(next);
    entriesRef.current = transcript;
    setEntries(transcript);
    setRunning(false);
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One bounded persistence transaction normalizes transcript state, provider-chain state, browser errors, and mounted UI refs.
  function persistConversation(
    {
      previousResponseId,
      responseProvider,
      responseModel,
      hostContextFingerprint,
    }: {
      previousResponseId?: string;
      responseProvider?: AgentProvider;
      responseModel?: string;
      hostContextFingerprint?: string;
    },
    { updateState = true }: { updateState?: boolean } = {},
  ) {
    const now = new Date().toISOString();
    const messages = conversationMessagesFromTranscript(
      entriesRef.current,
      now,
    );
    const firstUserMessage = messages.find(
      (message) => message.role === 'user',
    );
    try {
      const {
        previousResponseId: _storedPreviousResponseId,
        responseProvider: _storedResponseProvider,
        responseModel: _storedResponseModel,
        hostContextFingerprint: _storedHostContextFingerprint,
        ...conversationWithoutProviderState
      } = conversationRef.current;
      const next = conversationStore.save({
        ...conversationWithoutProviderState,
        title:
          conversationRef.current.title === 'New conversation' &&
          firstUserMessage
            ? firstUserMessage.text.slice(0, 80)
            : conversationRef.current.title,
        updatedAt: now,
        messages,
        ...(previousResponseId ? { previousResponseId } : {}),
        ...(responseProvider ? { responseProvider } : {}),
        ...(responseModel ? { responseModel } : {}),
        ...(hostContextFingerprint ? { hostContextFingerprint } : {}),
      });
      conversationRef.current = next;
      if (updateState && mountedRef.current) {
        setConversation(next);
        setStoredConversations(loadStoredConversations(conversationStore));
        setConversationPersistenceError(undefined);
      }
    } catch {
      if (updateState && mountedRef.current) {
        setConversationPersistenceError(
          'This chat could not be saved in this browser.',
        );
      }
    }
  }

  function persistRestoredPresentation() {
    const current = conversationRef.current;
    try {
      const next = conversationStore.save({
        ...current,
        messages: conversationMessagesFromTranscript(
          entriesRef.current,
          current.updatedAt,
        ),
      });
      conversationRef.current = next;
      if (mountedRef.current) {
        setConversation(next);
        setStoredConversations(loadStoredConversations(conversationStore));
        setConversationPersistenceError(undefined);
      }
    } catch {
      if (mountedRef.current) {
        setConversationPersistenceError(
          'This chat could not be saved in this browser.',
        );
      }
    }
  }

  const persistRestoredPresentationRef = useRef(persistRestoredPresentation);
  persistRestoredPresentationRef.current = persistRestoredPresentation;

  const refreshPresentationEntries = async () => {
    const activeConversationId = conversationRef.current.id;
    const presentationHost = mentionHostRef.current;
    const targets = restoredPresentationTargets(entriesRef.current);
    const needsFields = needsRestoredFieldPresentation(entriesRef.current);
    if (targets.length === 0 && !needsFields) return;

    const [results, fields] = await Promise.all([
      Promise.allSettled(
        targets.map(async (target) =>
          target.type === 'record'
            ? presentationHost.resolveRecord(target)
            : presentationHost.resolveAsset(target),
        ),
      ),
      restoredFieldPresentations(presentationHost, needsFields),
    ]);
    if (!mountedRef.current) return;
    if (conversationRef.current.id !== activeConversationId) return;

    const { records, assets } = resolvedPresentations(results);
    if (records.size === 0 && assets.size === 0 && fields.size === 0) return;

    const next = applyRestoredPresentation(
      entriesRef.current,
      records,
      assets,
      fields,
    );
    entriesRef.current = next;
    setEntries(next);
    if (!activeTurnRef.current) persistRestoredPresentationRef.current();
  };

  const refreshPresentationEntriesRef = useRef(refreshPresentationEntries);
  refreshPresentationEntriesRef.current = refreshPresentationEntries;

  useEffect(() => {
    void conversation.id;
    void refreshPresentationEntriesRef.current();
  }, [conversation.id]);

  const checkpointInterruptedTurn = (
    turn: ActiveTurn,
    updateState: boolean,
  ) => {
    if (turn.unsafeOperationDispatched) {
      return;
    }

    const interruptedText = 'Stopped.';
    entriesRef.current = entriesRef.current.map((entry) => {
      if (entry.id === turn.assistantEntryId && entry.kind === 'message') {
        return {
          ...entry,
          content: entry.content.trim() ? entry.content : interruptedText,
          streaming: false,
          interrupted: true,
        };
      }
      if (entry.id === turn.activityEntryId && entry.kind === 'activity') {
        return {
          ...entry,
          phase: 'cancelled' as const,
          activities: entry.activities.map((activity) =>
            activity.status === 'running'
              ? { ...activity, status: 'cancelled' as const }
              : activity,
          ),
        };
      }
      return entry;
    });
    if (updateState && mountedRef.current) {
      setEntries(entriesRef.current);
    }
    persistConversation({}, { updateState });
  };
  checkpointActiveTurnRef.current = checkpointInterruptedTurn;

  // biome-ignore lint/correctness/useExhaustiveDependencies: OAuth storage identity is the sole external trigger; recovery invalidation uses the current ref-backed helper.
  useEffect(() => {
    const credentialIdentity = (credentials: OAuthCredentials | null) =>
      credentials?.token
        ? `${credentials.client.clientId}\u0000${credentials.token.accessToken}\u0000${credentials.token.obtainedAt}`
        : credentials
          ? `${credentials.client.clientId}\u0000no-token`
          : '';

    const synchronizeOAuthCredentials = (event: StorageEvent) => {
      if (event.key !== oauthStore.key) {
        return;
      }

      let nextCredentials: OAuthCredentials | null = null;
      try {
        nextCredentials = oauthStore.setRemembered(true)?.credentials ?? null;
      } catch {
        setOauthError('The DatoCMS connection could not be synchronized.');
        return;
      }

      if (
        credentialIdentity(nextCredentials) ===
        credentialIdentity(oauthCredentialsRef.current)
      ) {
        return;
      }

      retireUnsafeRepairCandidate();

      const activeTurn = activeTurnRef.current;
      if (activeTurn && !activeTurn.unsafeOperationDispatched) {
        checkpointActiveTurnRef.current?.(activeTurn, true);
        activeTurnRef.current = undefined;
        retryCandidateRef.current = undefined;
        pendingNavigationRef.current = [];
        pendingApprovalsRef.current = new Map();
        setPendingApprovals(new Map());
        approvalDispatchRef.current.clear();
        autoApprovalDispatchRef.current.clear();
        const runtime = runtimeRef.current;
        runtimeRef.current = undefined;
        abortRef.current?.abort();
        abortRef.current = undefined;
        void runtime?.dispose?.();
        setRunning(false);
      }

      oauthCredentialsRef.current = nextCredentials;
      setOauthCredentials(nextCredentials);
      setOauthError(undefined);
    };

    window.addEventListener('storage', synchronizeOAuthCredentials);
    return () =>
      window.removeEventListener('storage', synchronizeOAuthCredentials);
  }, [oauthStore]);

  const clearOpenAiResponseChain = () => {
    const portableConversation = withoutProviderState(conversationRef.current);

    conversationRef.current = portableConversation;
    setConversation(portableConversation);
    try {
      const cleared = conversationStore.save(portableConversation);
      conversationRef.current = cleared;
      setConversation(cleared);
      setStoredConversations(loadStoredConversations(conversationStore));
    } catch {
      // Recovery still uses the in-memory text history when browser storage is
      // temporarily unavailable.
    }
  };

  const runtimeSystemContext = () => ({
    siteId: props.siteId,
    siteName: props.siteName,
    surface,
    environment: props.environment,
    isEnvironmentPrimary: props.isEnvironmentPrimary,
    scriptSessionId: conversationRef.current.id,
    currentRecord: props.currentRecord
      ? {
          id: props.currentRecord.id,
          modelApiKey: props.currentRecord.modelApiKey,
          fieldPath: props.currentRecord.fieldPath,
          hasUnsavedChanges: props.currentRecord.hasUnsavedChanges,
        }
      : null,
  });

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One bounded recorder coalesces activity snapshots while enforcing event and aggregate-output limits.
  function recordRuntimeEvent(
    turn: ActiveTurn,
    event: AgentRuntimeEvent,
  ): void {
    if (event.type === 'text_delta') {
      turn.textDeltaCount += 1;
      turn.textDeltaCharacters += event.delta.length;
      return;
    }

    const capturedAt = new Date().toISOString();
    const existingIndex =
      event.type === 'activity'
        ? turn.events.findIndex(
            (snapshot) =>
              snapshot.event.type === 'activity' &&
              snapshot.event.activity.id === event.activity.id &&
              snapshot.event.activity.status === event.activity.status,
          )
        : -1;
    const existing =
      existingIndex >= 0 ? turn.events[existingIndex] : undefined;
    const previousOutputCharacters =
      existing?.event.type === 'activity' &&
      typeof existing.event.activity.output === 'string'
        ? existing.event.activity.output.length
        : 0;
    const eventWithMergedActivity =
      event.type === 'activity' && existing?.event.type === 'activity'
        ? {
            ...event,
            activity: {
              ...existing.event.activity,
              ...event.activity,
            },
          }
        : event;
    const rawOutput =
      eventWithMergedActivity.type === 'activity' &&
      typeof eventWithMergedActivity.activity.output === 'string'
        ? eventWithMergedActivity.activity.output
        : undefined;
    const outputBudgetUsed =
      turn.diagnosticEventOutputCharacters - previousOutputCharacters;
    const remainingOutputCharacters = Math.max(
      0,
      MAX_DIAGNOSTIC_EVENT_OUTPUT_CHARACTERS - outputBudgetUsed,
    );
    const boundedOutput =
      rawOutput === undefined
        ? undefined
        : rawOutput.length <= remainingOutputCharacters
          ? rawOutput
          : remainingOutputCharacters >
              DIAGNOSTIC_OUTPUT_TRUNCATION_MARKER.length
            ? `${rawOutput.slice(
                0,
                remainingOutputCharacters -
                  DIAGNOSTIC_OUTPUT_TRUNCATION_MARKER.length,
              )}${DIAGNOSTIC_OUTPUT_TRUNCATION_MARKER}`
            : DIAGNOSTIC_OUTPUT_TRUNCATION_MARKER.slice(
                0,
                remainingOutputCharacters,
              );
    const recordedEvent =
      eventWithMergedActivity.type === 'activity' && rawOutput !== undefined
        ? {
            ...eventWithMergedActivity,
            activity: {
              ...eventWithMergedActivity.activity,
              output: boundedOutput,
            },
          }
        : eventWithMergedActivity;
    const snapshot = {
      capturedAt,
      elapsedMs: Math.max(
        0,
        Date.parse(capturedAt) - Date.parse(turn.startedAt),
      ),
      event: recordedEvent,
    };

    if (existingIndex >= 0) {
      turn.events[existingIndex] = snapshot;
    } else if (turn.events.length < MAX_DIAGNOSTIC_EVENTS_PER_TURN) {
      turn.events.push(snapshot);
    } else {
      turn.diagnosticEventsDropped += 1;
      return;
    }

    turn.diagnosticEventOutputCharacters =
      outputBudgetUsed + (boundedOutput?.length ?? 0);
  }

  const registerTerminalFailure = (
    turn: ActiveTurn,
    {
      result,
      thrownError,
      source,
    }: {
      result?: AgentTurnResult;
      thrownError?: unknown;
      source: 'turn' | 'runtime_exception' | 'approval_exception';
    },
  ): void => {
    const failureId = turn.assistantEntryId;
    const retryable = Boolean(
      source === 'turn' &&
        (result?.status === 'failed' || result?.status === 'incomplete') &&
        result.error?.retryable === true &&
        !turn.userStopped &&
        !turn.unsafeOperationDispatched,
    );
    const message =
      result?.error?.message ||
      errorMessage(thrownError) ||
      'The request could not be completed.';

    updateEntries((current) =>
      current.map((entry) =>
        entry.id === turn.assistantEntryId && entry.kind === 'message'
          ? {
              ...entry,
              error:
                typeof entry.error === 'string' && entry.error.trim()
                  ? entry.error
                  : message,
              failure: { id: failureId, retryable },
            }
          : entry,
      ),
    );

    const capturedAt = new Date().toISOString();
    const systemContext = runtimeSystemContext();
    failureDiagnosticsRef.current.set(
      failureId,
      serializeDiagnostics({
        schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
        capturedAt,
        plugin: {
          name: 'Dato Agent (Beta)',
          package: 'datocms-plugin-dato-agent',
          version: '0.1.0',
          url: window.location.href,
        },
        browser: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          online: navigator.onLine,
        },
        project: {
          pluginId: props.pluginId,
          siteId: props.siteId,
          siteName: props.siteName,
          environment: props.environment,
          isEnvironmentPrimary: props.isEnvironmentPrimary,
          currentUserId: props.currentUserId,
          scope: stableScope,
          currentRecord: props.currentRecord,
          editorHasUnsavedChanges: editorDirtyRef.current,
        },
        configuration: {
          ...props.config,
          activeApiKey: activeApiKey(props.config),
          activeModel: activeModel(props.config),
          activeModelMaxOutputTokens: activeModelMaxOutputTokens(props.config),
          activeReasoningEffort: activeReasoningEffort(props.config),
          autoApproveEnabled: autoApproveEnabledRef.current,
        },
        oauthCredentials,
        conversation: {
          beforeTurn: turn.conversationBefore,
          current: conversationRef.current,
          providerHistory: turn.history,
        },
        turn: {
          id: turn.id,
          source,
          message: turn.message,
          userEntryId: turn.userEntryId,
          assistantEntryId: turn.assistantEntryId,
          activityEntryId: turn.activityEntryId,
          provider: turn.provider,
          model: turn.model,
          startedAt: turn.startedAt,
          finishedAt: capturedAt,
          durationMs: Math.max(
            0,
            Date.parse(capturedAt) - Date.parse(turn.startedAt),
          ),
          previousResponseId: turn.previousResponseId,
          injectHostContext: turn.injectHostContext,
          textDeltaCount: turn.textDeltaCount,
          textDeltaCharacters: turn.textDeltaCharacters,
          diagnosticEventOutputCharacters: turn.diagnosticEventOutputCharacters,
          diagnosticEventsDropped: turn.diagnosticEventsDropped,
          hostContexts: turn.hostContexts,
          userStopped: turn.userStopped,
          unsafeOperationDispatched: turn.unsafeOperationDispatched,
          dispatchedApprovalIds: turn.dispatchedApprovalIds,
          cancelledBeforeDispatchApprovalIds:
            turn.cancelledBeforeDispatchApprovalIds,
          cancelledBeforeDispatchReason: turn.cancelledBeforeDispatchReason,
          autoApprovalBundleCount: turn.autoApprovalBundleCount,
          approvalSubmissions: turn.approvalSubmissions,
          approvalOutcomes: turn.approvalOutcomes,
          confirmedApprovalIds: turn.confirmedApprovalIds,
          completionResult: result,
          events: turn.events,
          thrownError,
          systemPrompt: buildSystemPrompt(systemContext, {
            additionalInstructions: props.config.additionalInstructions,
            readOnly: props.config.readOnly,
          }),
        },
        transcript: entriesRef.current,
        pendingApprovals: [...pendingApprovalsRef.current.values()],
        pendingNavigation: pendingNavigationRef.current,
      }),
    );

    retryCandidateRef.current = retryable
      ? {
          failureId,
          submission: {
            displayText: turn.displayMessage,
            providerText: turn.message,
            segments: turn.segments,
            ...(turn.attachmentDescriptors?.length
              ? { attachments: turn.attachmentDescriptors }
              : {}),
          },
          history: turn.history,
          entriesBefore: withoutApprovalRecovery(turn.entriesBefore),
          conversationBefore: turn.conversationBefore,
          userEntryId: turn.userEntryId,
          ...(turn.repairContext ? { repairContext: turn.repairContext } : {}),
          ...(turn.repairPolicy ? { repairPolicy: turn.repairPolicy } : {}),
        }
      : undefined;
  };

  const appendRecordResults = async (
    title: string,
    records: readonly RecordTarget[],
  ) => {
    const presentedRecords = await Promise.all(
      records.map(async (record) => {
        const mention = await mentionHostRef.current.resolveRecord({
          itemId: record.itemId,
          ...(record.itemTypeId ? { itemTypeId: record.itemTypeId } : {}),
          ...(record.label ? { label: record.label } : {}),
        });
        const itemTypeId =
          mention.modelId !== 'unknown' ? mention.modelId : record.itemTypeId;
        return {
          itemId: record.itemId,
          title: mention.title,
          mention,
          ...(itemTypeId ? { itemTypeId } : {}),
          ...(record.fieldPath ? { fieldPath: record.fieldPath } : {}),
        } satisfies AgentRecordResultViewModel;
      }),
    );
    updateEntries((current) => [
      ...current,
      {
        id: uid('records'),
        kind: 'records',
        title,
        records: presentedRecords,
      },
    ]);
  };

  const appendFieldResults = (
    title: string,
    fields: readonly FieldReferenceInput[],
  ) => {
    updateEntries((current) => [
      ...current,
      {
        id: uid('fields'),
        kind: 'fields',
        title,
        fields: fields.map(presentedFieldResult),
      },
    ]);
  };

  const appendAssetResults = async (
    title: string,
    assets: readonly { uploadId: string; label?: string }[],
  ) => {
    const presentedAssets = await Promise.all(
      assets.map(async (asset) => {
        const mention = await mentionHostRef.current.resolveAsset(asset);
        return {
          uploadId: asset.uploadId,
          title: mention.filename,
          mention,
        } satisfies AgentAssetResultViewModel;
      }),
    );
    updateEntries((current) => [
      ...current,
      {
        id: uid('assets'),
        kind: 'assets',
        title,
        assets: presentedAssets,
      },
    ]);
  };

  const appendMentions = (
    title: string,
    mentions: AgentMentionsEntry['mentions'],
  ) => {
    updateEntries((current) => [
      ...current,
      {
        id: uid('mentions'),
        kind: 'mentions',
        title,
        mentions,
      },
    ]);
  };

  const queuePendingNavigation = (pending: PendingNavigation) => {
    const replacedPrevious = pendingNavigationRef.current.length > 0;
    pendingNavigationRef.current = [pending];

    return {
      queued: true,
      replacedPrevious,
      selectionPolicy: 'latest_navigation_wins',
      message: replacedPrevious
        ? 'This is now the pending navigation and replaced an earlier request. Only the final navigation request in this turn is applied.'
        : 'This is queued as the current navigation. Only the final navigation request in this turn is applied; a later request will replace it.',
    };
  };

  const cancelPendingNavigationForExplicitHostAction = () => {
    // A deliberate editor click always wins over navigation the agent queued
    // earlier in the same turn. Otherwise the queued action can unexpectedly
    // replace the record or asset modal the editor just chose to inspect.
    pendingNavigationRef.current = [];
  };

  const flushPendingNavigation = async (turn: ActiveTurn) => {
    const pending = pendingNavigationRef.current.at(-1);
    if (!pending) {
      return;
    }
    if (!beginHostAction()) {
      pendingNavigationRef.current = [];
      return;
    }
    pendingNavigationRef.current = [];

    try {
      if (pending.type === 'openRecord') {
        await openRecordInHost(pending.target);
        return;
      }

      await showRecordsInHost(pending.target);
    } catch (error) {
      mergeActivity(turn.activityEntryId, {
        id: `navigation:${pending.type}`,
        label:
          pending.type === 'openRecord'
            ? 'Opening the record'
            : 'Showing the records',
        status: 'error',
        detail:
          error instanceof Error
            ? error.message
            : 'DatoCMS could not open this result.',
      });
    } finally {
      finishHostAction();
    }
  };

  const hostCreateAsset = mentionHost.createAsset;
  const createDatoAsset: CreateDatoAssetCallback | undefined =
    !props.config.readOnly && hostCreateAsset && mentionHost.canCreateAssets
      ? // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Source validation, irreversible dispatch marking, and outcome-unknown handling form one asset-upload boundary.
        async (input, signal) => {
          if (readOnlyRef.current) {
            throw new Error(READ_ONLY_REJECTION_MESSAGE);
          }
          const turn = activeTurnRef.current;
          if (!turn) {
            throw new Error('The active chat request is no longer available.');
          }
          if (
            turn.localAssetDispatchState === 'dispatching' ||
            turn.localAssetDispatchState === 'outcome_unknown'
          ) {
            throw new Error(
              'The previous asset upload may have completed, but its result could not be confirmed. Check the media library before trying again.',
            );
          }

          const source =
            input.source === 'attached_file'
              ? (() => {
                  const attachment = [
                    ...turn.attachments,
                    ...turn.history.flatMap((entry) => entry.attachments ?? []),
                  ].find((candidate) => candidate.id === input.attachmentId);
                  const file = attachment
                    ? getSessionLocalFile(attachment.id)
                    : undefined;
                  if (!attachment || !file) {
                    throw new Error(
                      'That local file is not available in this chat session. Ask the editor to attach it again.',
                    );
                  }
                  return {
                    source: 'file' as const,
                    fileOrBlob: file,
                    filename: input.filename ?? attachment.filename,
                  };
                })()
              : {
                  source: 'url' as const,
                  url: input.url,
                  ...(input.filename ? { filename: input.filename } : {}),
                };
          let dispatched = false;
          let mention: Awaited<ReturnType<typeof hostCreateAsset>>;
          try {
            if (readOnlyRef.current) {
              throw new Error(READ_ONLY_REJECTION_MESSAGE);
            }
            mention = await hostCreateAsset(source, {
              skipConfirmation:
                autoApproveEnabledRef.current && !editorDirtyRef.current,
              signal,
              onUploadDispatch: () => {
                if (readOnlyRef.current) {
                  throw new Error(READ_ONLY_REJECTION_MESSAGE);
                }
                if (activeTurnRef.current !== turn) {
                  throw new Error(
                    'The active chat request is no longer available.',
                  );
                }
                dispatched = true;
                turn.localAssetDispatchState = 'dispatching';
                turn.unsafeOperationDispatched = true;
              },
            });
            if (dispatched) {
              turn.localAssetDispatchState = 'confirmed';
            }
          } catch (error) {
            if (dispatched) {
              turn.localAssetDispatchState = 'outcome_unknown';
              throw new Error(
                'The asset upload may have completed, but its result could not be confirmed. Check the media library before trying again.',
                { cause: error },
              );
            }
            throw error;
          }
          await appendAssetResults('Asset created', [
            { uploadId: mention.id, label: mention.filename },
          ]);
          return {
            uploadId: mention.id,
            filename: mention.filename,
            url: mention.url,
            mimeType: mention.mimeType,
          };
        }
      : undefined;

  const createRuntime = (hostContext?: string) =>
    createAgentRuntime({
      provider: props.config.provider,
      apiKey: activeApiKey(props.config),
      mcpAccessToken: oauthCredentials?.token?.accessToken ?? '',
      model: activeModel(props.config),
      modelMaxOutputTokens: activeModelMaxOutputTokens(props.config),
      reasoningEffort: activeReasoningEffort(props.config),
      fastMode: activeFastMode(props.config),
      readOnly: props.config.readOnly,
      additionalInstructions: props.config.additionalInstructions,
      hostContext,
      getModelSchema: props.getModelSchema,
      ...(createDatoAsset ? { createDatoAsset } : {}),
      context: runtimeSystemContext(),
      navigation: {
        presentRecords: async ({ title, records }) => {
          await appendRecordResults(title, records);
          return {
            presented: true,
            count: records.length,
            message:
              'Clickable record results were added to the chat without changing the current CMS view.',
          };
        },
        openRecord: async ({ itemId, itemTypeId, fieldPath }) => {
          const target = { itemId, itemTypeId, fieldPath };
          await appendRecordResults('Record found', [target]);
          return queuePendingNavigation({ type: 'openRecord', target });
        },
        showRecords: async ({ title, records }) => {
          await appendRecordResults(title, records);
          if (!props.navigator.supportsRecordList) {
            return {
              presented: true,
              queued: false,
              count: records.length,
              message:
                'Clickable record results were added to the chat. The current CMS view was not changed.',
            };
          }
          return queuePendingNavigation({
            type: 'showRecords',
            target: { title, records },
          });
        },
        ...(props.prepareCurrentFieldReferences &&
        props.openCurrentField &&
        props.readCurrentRecordLiveFormState
          ? {
              presentFields: async (input) => {
                const verified = await props.prepareCurrentFieldReferences?.(
                  input,
                  abortRef.current?.signal,
                );
                if (!verified) {
                  throw new Error(
                    'The current record fields could not be verified.',
                  );
                }
                appendFieldResults(verified.title, verified.fields);
                return {
                  presented: true,
                  count: verified.fields.length,
                  message:
                    'Clickable field references were added to the chat. No field was opened automatically.',
                };
              },
              readCurrentRecordLiveFormState: (
                input: ReadCurrentRecordLiveFormStateInput,
              ) =>
                props.readCurrentRecordLiveFormState?.(
                  input,
                  abortRef.current?.signal,
                ),
            }
          : {}),
        presentAssets: async ({ title, assets }) => {
          await appendAssetResults(title, assets);
          return {
            presented: true,
            count: assets.length,
            message:
              'Clickable asset references were added to the chat. No asset was opened automatically.',
          };
        },
        presentModels: ({ title, models }: PresentModelsInput) => {
          const verified = models.map((reference) => {
            const model = mentionHost.projectModels.find(
              (candidate) => candidate.id === reference.modelId,
            );
            if (!model) {
              throw new Error(
                `Model ${JSON.stringify(reference.modelId)} is not available in the current project.`,
              );
            }
            return mentionFromModel(model);
          });
          appendMentions(title, verified);
          return {
            presented: true,
            count: verified.length,
            message:
              'Clickable model references were added to the chat. No schema was changed.',
          };
        },
        presentUsers: async ({ title, users }: PresentUsersInput) => {
          const directory = await mentionHost.loadProjectUsers();
          const verified = users.map((reference) => {
            const user = directory.find(
              (candidate) => candidate.id === reference.userId,
            );
            if (!user) {
              throw new Error(
                `User ${JSON.stringify(reference.userId)} is not available in the current project.`,
              );
            }
            return mentionFromUser(user);
          });
          appendMentions(title, verified);
          return {
            presented: true,
            count: verified.length,
            message:
              'Clickable user references were added to the chat. No notification was sent.',
          };
        },
      },
    });

  const mergeActivity = (
    entryId: string,
    activity: AgentActivityViewModel,
    phase?: AgentActivityPhase,
  ) => {
    updateEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId || entry.kind !== 'activity') {
          return entry;
        }
        const existing = entry.activities.findIndex(
          (item) => item.id === activity.id,
        );
        const activities =
          existing === -1
            ? [...entry.activities, activity]
            : entry.activities.map((item, index) =>
                index === existing ? { ...item, ...activity } : item,
              );
        return { ...entry, ...(phase ? { phase } : {}), activities };
      }),
    );
  };

  const addApprovalEntry = (
    responseId: string,
    approval: AgentApprovalRequest,
  ) => {
    const repairCandidate = unsafeRepairCandidateRef.current;
    if (
      repairCandidate &&
      repairCandidate.approvalRequestId !== approval.approvalRequestId
    ) {
      retireUnsafeRepairCandidate(repairCandidate.approvalRequestId);
    }
    const blockedByReadOnly =
      readOnlyRef.current && approval.name === DATOCMS_MCP_UNSAFE_SCRIPT_TOOL;
    const repairViolation = repairPolicyViolation(
      { name: approval.name, arguments: approval.arguments },
      activeTurnRef.current?.repairPolicy,
    );
    const blockedReason = blockedByReadOnly
      ? READ_ONLY_REJECTION_MESSAGE
      : repairViolation;
    const pending: PendingApproval = {
      responseId,
      request: approval,
      automatic: blockedReason ? false : autoApproveEnabledRef.current,
      ...(blockedReason
        ? {
            decision: {
              approvalRequestId: approval.approvalRequestId,
              approve: false,
              reason: blockedReason,
            },
          }
        : {}),
    };
    updatePendingApprovals((current) => {
      const next = new Map(current);
      next.set(approval.approvalRequestId, pending);
      return next;
    });
    if (blockedReason) {
      return;
    }
    updateEntries((current) => {
      if (
        current.some(
          (entry) => entry.id === `approval:${approval.approvalRequestId}`,
        )
      ) {
        return current;
      }
      return [
        ...current,
        {
          id: `approval:${approval.approvalRequestId}`,
          kind: 'approval',
          approval: approvalViewModel(pending, {
            ...props,
            readOnly: readOnlyRef.current,
          }),
        },
      ];
    });
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Exhaustively mapping the typed runtime event union keeps state transitions explicit.
  async function handleRuntimeEvent(
    event: AgentRuntimeEvent,
    turn: ActiveTurn,
  ) {
    if (!mountedRef.current || activeTurnRef.current !== turn) {
      return;
    }

    switch (event.type) {
      case 'text_delta':
        updateEntries((current) =>
          current.map((entry) =>
            entry.id === turn.assistantEntryId && entry.kind === 'message'
              ? { ...entry, content: `${entry.content}${event.delta}` }
              : entry,
          ),
        );
        break;
      case 'activity':
        if (
          turn.unsafeOperationDispatched &&
          event.activity.kind === 'mcp_tool' &&
          (event.activity.status === 'completed' ||
            event.activity.status === 'failed')
        ) {
          // A write may have changed arbitrary record or asset presentation.
          // Clear again when the exact remote call settles: hydration can have
          // repopulated the cache while the request was in flight.
          mentionHostRef.current.invalidatePresentationCache?.();
          void refreshPresentationEntriesRef.current();
        }
        mergeActivity(
          turn.activityEntryId,
          {
            id: event.activity.id,
            label: event.activity.label,
            status: activityStatus(event.activity.status),
            ...(event.activity.toolName
              ? { description: event.activity.toolName.replaceAll('_', ' ') }
              : {}),
            ...(event.activity.error
              ? { detail: event.activity.error }
              : event.activity.arguments !== undefined
                ? { detail: stringifyDetail(event.activity.arguments) }
                : {}),
          },
          event.activity.status === 'waiting' ? 'waiting' : 'running',
        );
        break;
      case 'approval_required':
        addApprovalEntry(event.responseId, event.approval);
        break;
      case 'approval_outcome':
        recordApprovalOutcome(event.approvalOutcome, turn);
        break;
      case 'error':
        if (
          event.error.code === 'aborted' ||
          (turn.userStopped && !turn.unsafeOperationDispatched)
        ) {
          break;
        }
        updateEntries((current) =>
          current.map((entry) =>
            entry.id === turn.assistantEntryId && entry.kind === 'message'
              ? {
                  ...entry,
                  error: event.error.message,
                }
              : entry,
          ),
        );
        break;
      case 'turn_completed': {
        confirmUnsafeJournalOperations(
          turn,
          event.result.confirmedApprovalIds ?? [],
        );
        for (const outcome of event.result.approvalOutcomes ?? []) {
          recordApprovalOutcome(outcome, turn);
        }
        if (
          event.result.status !== 'approval_required' ||
          turn.approvalOutcomes.some((outcome) =>
            turn.confirmedApprovalIds.includes(outcome.approvalRequestId),
          )
        ) {
          releaseConfirmedUnsafeJournal(turn, {
            allowSuccessfulInterruptionNotice:
              event.result.status !== 'approval_required',
          });
        }
        const settledTurnStatus =
          turn.userStopped && !turn.unsafeOperationDispatched
            ? ('aborted' as const)
            : event.result.status;
        updateEntries((current) => {
          const phase = activityPhase(
            settledTurnStatus,
            autoApproveEnabledRef.current && !editorDirtyRef.current,
          );
          const settledStatus: AgentActivityViewModel['status'] =
            settledTurnStatus === 'aborted'
              ? 'cancelled'
              : settledTurnStatus === 'failed' ||
                  settledTurnStatus === 'incomplete'
                ? 'error'
                : 'success';

          const settled = current.map((entry) =>
            settleTurnEntry(
              entry,
              turn,
              settledTurnStatus,
              phase,
              settledStatus,
            ),
          );
          return settled;
        });
        if (settledTurnStatus !== 'approval_required') {
          if (
            settledTurnStatus === 'failed' ||
            settledTurnStatus === 'incomplete'
          ) {
            registerTerminalFailure(turn, {
              result: event.result,
              source: 'turn',
            });
          }
          activateUnsafeRepairCandidate(turn);
          settleActivatedRepairTurn(turn);
          setRunning(false);
          activeTurnRef.current = undefined;
          const finishedRuntime = runtimeRef.current;
          runtimeRef.current = undefined;
          void finishedRuntime?.dispose?.();
          const completed = settledTurnStatus === 'completed';
          const openAiTurn = turn.provider === 'openai';
          persistConversation({
            previousResponseId:
              completed && openAiTurn ? event.result.responseId : undefined,
            responseProvider: completed ? turn.provider : undefined,
            responseModel: completed ? turn.model : undefined,
            hostContextFingerprint:
              completed && openAiTurn && event.result.responseId
                ? turn.hostContextFingerprint
                : undefined,
          });
          if (settledTurnStatus === 'completed') {
            await flushPendingNavigation(turn);
          } else {
            pendingNavigationRef.current = [];
          }
        } else {
          setRunning(autoApproveEnabledRef.current && !editorDirtyRef.current);
        }
        break;
      }
      default:
        break;
    }
  }

  async function observeRuntimeEvent(
    event: AgentRuntimeEvent,
    turn: ActiveTurn,
  ): Promise<void> {
    recordRuntimeEvent(turn, event);
    await handleRuntimeEvent(event, turn);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One guarded lifecycle keeps a turn's controller, runtime, persistence, and UI settlement atomic.
  async function submit(
    rawSubmission: AgentComposerSubmission | string,
    retryCandidate?: RetryCandidate,
    repairContext:
      | AgentRepairContext
      | undefined = retryCandidate?.repairContext,
    repairPolicy: AgentRepairPolicy | undefined = retryCandidate?.repairPolicy,
  ): Promise<void> {
    const submission: AgentComposerSubmission =
      typeof rawSubmission === 'string'
        ? {
            displayText: rawSubmission.trim(),
            providerText: rawSubmission.trim(),
            segments: [{ type: 'text', content: rawSubmission.trim() }],
          }
        : rawSubmission;
    const message = segmentsProviderText(submission.segments, {
      localFileBytesAvailable: hasSessionLocalFileBytes,
    }).trim();
    const displayMessage = submission.displayText.trim();
    if (running || !message || !displayMessage) {
      return;
    }

    if (!repairContext && !retryCandidate) {
      retireUnsafeRepairCandidate();
    }

    // The visible mention list is the authority for which browser files belong
    // to this turn. Never accept a detached descriptor that is not represented
    // in the editor-visible message.
    const attachmentDescriptors = localFileDescriptors(submission.segments);
    const attachments = runtimeAttachments(attachmentDescriptors);
    const history =
      retryCandidate?.history ??
      providerHistory(conversationRef.current.messages, attachments);
    const entriesBefore = retryCandidate
      ? retryCandidate.entriesBefore
      : entriesRef.current.map((entry) =>
          entry.kind === 'message' && entry.failure?.retryable
            ? {
                ...entry,
                failure: { ...entry.failure, retryable: false },
              }
            : entry,
        );
    const conversationBefore =
      retryCandidate?.conversationBefore ?? conversationRef.current;
    if (retryCandidate) {
      const portableConversation = withoutProviderState(conversationBefore);
      conversationRef.current = portableConversation;
      setConversation(portableConversation);
    } else {
      retryCandidateRef.current = undefined;
    }
    pendingNavigationRef.current = [];
    const userEntryId = retryCandidate?.userEntryId ?? uid('user');
    const assistantEntryId = uid('assistant');
    const activityEntryId = uid('activity');
    const startedAt = new Date().toISOString();
    const turn: ActiveTurn = {
      id: uid('turn'),
      message,
      displayMessage,
      segments: submission.segments,
      history,
      attachments,
      ...(attachmentDescriptors.length > 0 ? { attachmentDescriptors } : {}),
      entriesBefore,
      conversationBefore,
      userEntryId,
      assistantEntryId,
      activityEntryId,
      autoApprovalBundleCount: 0,
      userStopped: false,
      unsafeOperationDispatched: false,
      dispatchedApprovalIds: [],
      cancelledBeforeDispatchApprovalIds: [],
      localAssetDispatchState: 'idle',
      provider: props.config.provider,
      model: activeModel(props.config),
      startedAt,
      textDeltaCount: 0,
      textDeltaCharacters: 0,
      diagnosticEventOutputCharacters: 0,
      diagnosticEventsDropped: 0,
      events: [],
      approvalSubmissions: [],
      approvalOutcomes: [],
      confirmedApprovalIds: [],
      hostContexts: [],
      ...(repairContext
        ? {
            repairContext,
            ...(repairPolicy ? { repairPolicy } : {}),
            repairPolicyIdentity,
            repairOauthAccessToken:
              oauthCredentialsRef.current?.token?.accessToken ?? '',
          }
        : {}),
    };
    const claimedRepairCandidate = unsafeRepairCandidateRef.current;
    if (repairContext && claimedRepairCandidate?.state === 'starting') {
      claimedRepairCandidate.repairTurnId = turn.id;
    }
    const retryBaselineEntryIds = new Set([
      ...entriesBefore.map((entry) => entry.id),
      userEntryId,
      activityEntryId,
      assistantEntryId,
    ]);
    const retryBaselineApprovalIds = new Set(
      pendingApprovalsRef.current.keys(),
    );
    activeTurnRef.current = turn;
    updateEntries(() => [
      ...entriesBefore,
      {
        id: userEntryId,
        kind: 'message',
        role: 'user',
        content: displayMessage,
        segments: submission.segments,
        createdAt: startedAt,
      },
      {
        id: activityEntryId,
        kind: 'activity',
        phase: 'running',
        activities: [],
      },
      {
        id: assistantEntryId,
        kind: 'message',
        role: 'assistant',
        content: '',
        streaming: true,
        createdAt: startedAt,
      },
    ]);
    const currentConversation = conversationRef.current;
    persistConversation({
      previousResponseId: currentConversation.previousResponseId,
      responseProvider: currentConversation.responseProvider,
      responseModel: currentConversation.responseModel,
      hostContextFingerprint: currentConversation.hostContextFingerprint,
    });
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const loadFreshHostContext = async () => {
      if (!props.loadHostContext) {
        return undefined;
      }

      try {
        const loaded = await props.loadHostContext(controller.signal);
        if (
          loaded?.text.trim() &&
          /^[A-Za-z0-9._:-]{1,128}$/.test(loaded.fingerprint)
        ) {
          const snapshot = {
            text: loaded.text.trim(),
            fingerprint: loaded.fingerprint,
          } satisfies AgentHostContextSnapshot;
          turn.hostContexts.push({
            capturedAt: new Date().toISOString(),
            ...snapshot,
          });
          return snapshot;
        }
      } catch {
        // Host metadata is an optimization. The Remote MCP remains the
        // authoritative fallback if an SDK field load is temporarily
        // unavailable.
      }

      return undefined;
    };

    try {
      const hostContext = props.loadHostContext
        ? await loadFreshHostContext()
        : undefined;
      const previousResponseId = repairContext
        ? undefined
        : reusableOpenAiResponseId(
            conversationRef.current,
            turn.provider,
            turn.model,
          );
      const injectHostContext = Boolean(
        hostContext &&
          (turn.provider === 'anthropic' ||
            !previousResponseId ||
            conversationRef.current.hostContextFingerprint !==
              hostContext.fingerprint),
      );
      turn.previousResponseId = retryCandidate ? undefined : previousResponseId;
      turn.injectHostContext = retryCandidate
        ? Boolean(hostContext)
        : injectHostContext;
      turn.hostContextFingerprint =
        turn.provider === 'openai'
          ? hostContext
            ? hostContext.fingerprint
            : previousResponseId
              ? conversationRef.current.hostContextFingerprint
              : undefined
          : undefined;

      const firstRuntime = createRuntime(hostContext?.text);
      runtimeRef.current = firstRuntime;
      const heldTerminalEvents: AgentRuntimeEvent[] = [];
      let firstResult: AgentTurnResult | undefined;
      let firstError: unknown;
      try {
        firstResult = await firstRuntime.runTurn(
          {
            message,
            history,
            attachments,
            previousResponseId,
            injectHostContext,
            ...(repairContext ? { repairContext } : {}),
            ...(repairPolicy ? { repairPolicy } : {}),
            signal: controller.signal,
          },
          async (event) => {
            recordRuntimeEvent(turn, event);
            if (event.type === 'error' || event.type === 'turn_completed') {
              heldTerminalEvents.push(event);
              return;
            }
            await handleRuntimeEvent(event, turn);
          },
        );
      } catch (error) {
        firstError = error;
      }

      const terminalError = heldTerminalEvents.find(
        (event) => event.type === 'error',
      );
      const retryCause =
        firstError ??
        firstResult?.error ??
        (terminalError?.type === 'error' ? terminalError.error : undefined);
      const shouldRetryWithoutChain =
        turn.provider === 'openai' &&
        previousResponseId !== undefined &&
        !turn.userStopped &&
        !controller.signal.aborted &&
        !turn.unsafeOperationDispatched &&
        isStaleOpenAiResponseChainError(retryCause, previousResponseId);
      let result: AgentTurnResult;

      if (shouldRetryWithoutChain) {
        if (runtimeRef.current === firstRuntime) {
          runtimeRef.current = undefined;
        }
        clearOpenAiResponseChain();
        try {
          await firstRuntime.dispose?.();
        } catch {
          // A stale server-side chain is already unusable. Runtime cleanup must
          // not prevent rebuilding the request from local text history.
        }
        pendingNavigationRef.current = [];
        updatePendingApprovals(
          (current) =>
            new Map(
              [...current].filter(([id]) => retryBaselineApprovalIds.has(id)),
            ),
        );
        updateEntries((current) =>
          current
            .filter((entry) => retryBaselineEntryIds.has(entry.id))
            .map((entry) => {
              if (entry.id === assistantEntryId && entry.kind === 'message') {
                const {
                  error: _error,
                  interrupted: _interrupted,
                  ...clean
                } = entry;
                return {
                  ...clean,
                  content: '',
                  streaming: true,
                };
              }
              if (entry.id === activityEntryId && entry.kind === 'activity') {
                return {
                  ...entry,
                  phase: 'running' as const,
                  activities: [],
                };
              }
              return entry;
            }),
        );

        const retryHostContext = props.loadHostContext
          ? await loadFreshHostContext()
          : undefined;
        turn.previousResponseId = undefined;
        turn.injectHostContext = Boolean(retryHostContext);
        turn.hostContextFingerprint = retryHostContext?.fingerprint;
        const retryRuntime = createRuntime(retryHostContext?.text);
        runtimeRef.current = retryRuntime;
        result = await retryRuntime.runTurn(
          {
            message,
            history,
            attachments,
            previousResponseId: undefined,
            injectHostContext: Boolean(retryHostContext),
            ...(repairContext ? { repairContext } : {}),
            ...(repairPolicy ? { repairPolicy } : {}),
            signal: controller.signal,
          },
          (event) => observeRuntimeEvent(event, turn),
        );
      } else {
        if (firstError) {
          throw firstError;
        }
        if (!firstResult) {
          throw new Error('The agent did not return a result.');
        }
        await heldTerminalEvents.reduce(
          (pending, event) =>
            pending.then(() => handleRuntimeEvent(event, turn)),
          Promise.resolve(),
        );
        result = firstResult;
      }

      if (mountedRef.current && activeTurnRef.current === turn) {
        if (result.status === 'approval_required') {
          const responseId = result.responseId;
          const responseApprovals = responseId
            ? [...pendingApprovalsRef.current.values()].filter(
                (item) => item.responseId === responseId,
              )
            : [];
          if (
            responseId &&
            (readOnlyRef.current ||
              (responseApprovals.length > 0 &&
                responseApprovals.every((item) => item.decision)))
          ) {
            await dispatchApprovalGroup(responseId);
          } else {
            await autoApproveResponse(responseId);
          }
        } else {
          setRunning(false);
          activeTurnRef.current = undefined;
        }
      }
    } catch (error) {
      if (!mountedRef.current || activeTurnRef.current !== turn) {
        return;
      }
      pendingNavigationRef.current = [];
      const failedRuntime = runtimeRef.current;
      runtimeRef.current = undefined;
      void failedRuntime?.dispose?.();
      const message = controller.signal.aborted
        ? 'Stopped.'
        : error instanceof Error
          ? error.message
          : 'The agent could not start.';
      setRunning(false);
      activeTurnRef.current = undefined;
      updateEntries((current) =>
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Assistant and activity states settle together for cancellation, partial output, and startup failure.
        current.map((entry) => {
          if (entry.id === assistantEntryId && entry.kind === 'message') {
            return {
              ...entry,
              ...(controller.signal.aborted && !entry.content.trim()
                ? { content: message }
                : {}),
              streaming: false,
              interrupted: true,
              ...(controller.signal.aborted ? {} : { error: message }),
            };
          }

          if (entry.id === activityEntryId && entry.kind === 'activity') {
            return {
              ...entry,
              phase: controller.signal.aborted
                ? ('cancelled' as const)
                : ('failed' as const),
              activities: entry.activities.map((activity) =>
                activity.status === 'running'
                  ? {
                      ...activity,
                      status: controller.signal.aborted
                        ? ('cancelled' as const)
                        : ('error' as const),
                    }
                  : activity,
              ),
            };
          }

          return entry;
        }),
      );
      if (!controller.signal.aborted) {
        registerTerminalFailure(turn, {
          thrownError: error,
          source: 'runtime_exception',
        });
      }
      settleActivatedRepairTurn(turn);
      persistConversation({});
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = undefined;
      }
    }
  }

  const retryFailedTurn = async (failureId: string): Promise<void> => {
    const candidate = retryCandidateRef.current;
    if (
      !candidate ||
      candidate.failureId !== failureId ||
      running ||
      activeTurnRef.current ||
      pendingApprovalsRef.current.size > 0 ||
      approvalDispatchRef.current.size > 0 ||
      !activeApiKey(props.config).trim() ||
      !activeModel(props.config).trim() ||
      !oauthCredentials?.token?.accessToken
    ) {
      return;
    }

    // Claim the candidate before yielding so a double click can never start
    // two provider chains.
    retryCandidateRef.current = undefined;
    retireUnsafeRepairCandidate();
    await submit(candidate.submission, candidate);
  };

  const copyFailureDiagnostics = async (failureId: string): Promise<void> => {
    const diagnostics = failureDiagnosticsRef.current.get(failureId);
    if (!diagnostics) {
      throw new Error('Diagnostics are no longer available.');
    }

    await copyTextToClipboard(diagnostics);
  };

  const stopActiveTurn = (): void => {
    if (activeTurnRef.current) {
      activeTurnRef.current.userStopped = true;
    }
    abortRef.current?.abort();
  };

  function pauseAutomaticApproval(responseId: string, reason: string): void {
    const group = [...pendingApprovalsRef.current.values()].filter(
      (item) => item.responseId === responseId,
    );
    const approvalIds = new Set(
      group.map((item) => item.request.approvalRequestId),
    );

    updatePendingApprovals((current) => {
      const next = new Map(current);
      for (const item of group) {
        next.set(item.request.approvalRequestId, {
          ...item,
          automatic: false,
        });
      }
      return next;
    });
    const activityEntryId = activeTurnRef.current?.activityEntryId;
    updateEntries((current) =>
      current.map((entry) => {
        if (entry.id === activityEntryId && entry.kind === 'activity') {
          return { ...entry, phase: 'waiting' as const };
        }

        return entry.kind === 'approval' && approvalIds.has(entry.approval.id)
          ? {
              ...entry,
              approval: {
                ...entry.approval,
                automatic: false,
                status: 'pending' as const,
                error: reason,
              },
            }
          : entry;
      }),
    );
    setRunning(false);
  }

  function rejectUnsafeDispatchBeforeNetwork(
    turn: ActiveTurn,
    unsafeJournalId: string,
    approvalRequestIds: readonly string[],
    message: string,
  ): never {
    cancelUnsafeDispatchBeforeNetwork(
      turn,
      unsafeJournalId,
      approvalRequestIds,
    );
    throw new Error(message);
  }

  function cancelUnsafeDispatchBeforeNetwork(
    turn: ActiveTurn,
    unsafeJournalId: string,
    approvalRequestIds: readonly string[],
    reason:
      | 'prior_outcome_uncertain'
      | 'editor_state_changed' = 'editor_state_changed',
  ): void {
    turn.cancelledBeforeDispatchApprovalIds = [
      ...new Set([
        ...turn.cancelledBeforeDispatchApprovalIds,
        ...approvalRequestIds,
      ]),
    ];
    if (
      reason === 'prior_outcome_uncertain' ||
      !turn.cancelledBeforeDispatchReason
    ) {
      turn.cancelledBeforeDispatchReason = reason;
    }
    if (!turn.unsafeOperationDispatched) {
      try {
        unsafeDispatchJournalStore.clear(unsafeJournalId);
        turn.unsafeJournalId = undefined;
      } catch {
        // The network boundary remains blocked even when the now-unneeded
        // armed journal cannot be removed.
      }
    } else {
      try {
        unsafeDispatchJournalStore.discardArmed(
          unsafeJournalId,
          approvalRequestIds,
        );
      } catch {
        // Preserve the already-dispatched operation journal; the Remote MCP
        // boundary is still blocked for the remaining armed operation.
      }
    }
  }

  function rejectReadOnlyUnsafeDispatch(
    turn: ActiveTurn,
    unsafeJournalId: string,
    approvalRequestIds: readonly string[],
  ): void {
    if (!readOnlyRef.current) return;
    rejectUnsafeDispatchBeforeNetwork(
      turn,
      unsafeJournalId,
      approvalRequestIds,
      READ_ONLY_REJECTION_MESSAGE,
    );
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Group dispatch preserves one atomic, idempotent unsafe continuation and its outcome-unknown handling.
  async function dispatchApprovalGroup(responseId: string): Promise<void> {
    if (approvalDispatchRef.current.has(responseId)) {
      return;
    }

    let group = [...pendingApprovalsRef.current.values()].filter(
      (item) => item.responseId === responseId,
    );
    if (group.length === 0) {
      return;
    }

    const runtime = runtimeRef.current;
    const turn = activeTurnRef.current;
    if (readOnlyRef.current) {
      const blockedIds = new Set<string>();
      group = group.map((item) => {
        if (item.request.name !== DATOCMS_MCP_UNSAFE_SCRIPT_TOOL) {
          return item;
        }
        blockedIds.add(item.request.approvalRequestId);
        return {
          ...item,
          automatic: false,
          decision: {
            approvalRequestId: item.request.approvalRequestId,
            approve: false,
            reason: READ_ONLY_REJECTION_MESSAGE,
          },
        };
      });
      if (blockedIds.size > 0) {
        updatePendingApprovals((current) => {
          const next = new Map(current);
          for (const item of group) {
            next.set(item.request.approvalRequestId, item);
          }
          return next;
        });
        updateEntries((current) =>
          current.filter(
            (entry) =>
              entry.kind !== 'approval' || !blockedIds.has(entry.approval.id),
          ),
        );
      }
    }
    if (group.some((item) => !item.decision)) {
      return;
    }
    const approvalIds = new Set(
      group.map((item) => item.request.approvalRequestId),
    );
    const approvedItems = group.filter((item) => item.decision?.approve);
    if (!runtime || !turn) {
      updateEntries((current) =>
        current.map((entry) =>
          entry.kind === 'approval' && approvalIds.has(entry.approval.id)
            ? {
                ...entry,
                approval: {
                  ...entry.approval,
                  status: 'error',
                  error:
                    'This approval has expired. Start a new request to try again.',
                },
              }
            : entry,
        ),
      );
      setRunning(false);
      return;
    }

    let unsafeJournalId: string | undefined;
    if (approvedItems.length > 0) {
      persistConversation({});
      unsafeJournalId = turn.unsafeJournalId ?? uid('unsafe-dispatch');
      const journalOperations = approvedItems.map((item) => ({
        approvalRequestId: item.request.approvalRequestId,
        name: item.request.name,
        arguments: item.request.arguments,
        automatic: item.automatic === true,
      }));
      try {
        if (turn.unsafeJournalId) {
          unsafeDispatchJournalStore.appendArmed(
            unsafeJournalId,
            responseId,
            journalOperations,
          );
        } else {
          unsafeDispatchJournalStore.claim({
            id: unsafeJournalId,
            conversation: {
              id: conversationRef.current.id,
              title: conversationRef.current.title,
              createdAt: conversationRef.current.createdAt,
            },
            turn: {
              id: turn.id,
              userEntryId: turn.userEntryId,
              assistantEntryId: turn.assistantEntryId,
              userMessage: turn.displayMessage,
              provider: turn.provider,
              model: turn.model,
              startedAt: turn.startedAt,
            },
            responseId,
            scope: stableScope,
            operations: journalOperations,
          });
          turn.unsafeJournalId = unsafeJournalId;
        }
      } catch (error) {
        const message = errorMessage(error);
        updatePendingApprovals((current) => {
          const next = new Map(current);
          for (const item of group) {
            next.delete(item.request.approvalRequestId);
          }
          return next;
        });
        updateEntries((current) =>
          current.map((entry) =>
            settleUnsafeJournalClaimFailure(entry, turn, approvalIds, message),
          ),
        );
        activeTurnRef.current = undefined;
        runtimeRef.current = undefined;
        void runtime.dispose?.();
        setRunning(false);
        persistConversation({});
        return;
      }
    }

    updateEntries((current) =>
      current.map((entry) =>
        entry.id === turn.activityEntryId && entry.kind === 'activity'
          ? {
              ...entry,
              phase: 'running' as const,
              activities: entry.activities.map((activity) =>
                approvalIds.has(activity.id)
                  ? { ...activity, status: 'running' as const }
                  : activity,
              ),
            }
          : entry,
      ),
    );

    approvalDispatchRef.current.add(responseId);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let result: AgentTurnResult | undefined;
    let thrownMessage: string | undefined;

    try {
      const decisions = group.flatMap((item) =>
        item.decision ? [item.decision] : [],
      );
      const automaticDispatch = approvedItems.some(
        (item) => item.automatic === true,
      );
      turn.approvalSubmissions.push({
        capturedAt: new Date().toISOString(),
        responseId,
        decisions,
      });
      result = await runtime.submitApprovals(
        {
          responseId,
          decisions,
          signal: controller.signal,
          ...(unsafeJournalId
            ? {
                unsafeDispatchCallbacks: {
                  beforeDispatch: (
                    dispatchedApprovalIds: readonly string[],
                  ) => {
                    const repairViolation = dispatchedApprovalIds
                      .map((approvalRequestId) =>
                        group.find(
                          (item) =>
                            item.request.approvalRequestId ===
                            approvalRequestId,
                        ),
                      )
                      .filter(
                        (item): item is PendingApproval => item !== undefined,
                      )
                      .map((item) =>
                        repairPolicyViolation(
                          {
                            name: item.request.name,
                            arguments: item.request.arguments,
                          },
                          turn.repairPolicy,
                        ),
                      )
                      .find((reason): reason is string => Boolean(reason));
                    if (repairViolation) {
                      rejectUnsafeDispatchBeforeNetwork(
                        turn,
                        unsafeJournalId,
                        dispatchedApprovalIds,
                        repairViolation,
                      );
                    }
                    rejectReadOnlyUnsafeDispatch(
                      turn,
                      unsafeJournalId,
                      dispatchedApprovalIds,
                    );
                    const repairBoundaryChanged = Boolean(
                      turn.repairContext &&
                        (turn.repairPolicyIdentity !==
                          liveRepairPolicyIdentityRef.current ||
                          !turn.repairOauthAccessToken ||
                          turn.repairOauthAccessToken !==
                            oauthCredentialsRef.current?.token?.accessToken),
                    );
                    if (
                      activeTurnRef.current !== turn ||
                      controller.signal.aborted ||
                      hostActionPendingRef.current ||
                      editorDirtyRef.current ||
                      repairBoundaryChanged ||
                      (automaticDispatch && !autoApproveEnabledRef.current)
                    ) {
                      rejectUnsafeDispatchBeforeNetwork(
                        turn,
                        unsafeJournalId,
                        dispatchedApprovalIds,
                        'The change was not sent because the editor state changed. Close the open dialog and save or discard any unsaved changes before reviewing it again.',
                      );
                    }
                    unsafeDispatchJournalStore.markDispatched(
                      unsafeJournalId,
                      dispatchedApprovalIds,
                    );
                    turn.dispatchedApprovalIds = [
                      ...new Set([
                        ...turn.dispatchedApprovalIds,
                        ...dispatchedApprovalIds,
                      ]),
                    ];
                    turn.unsafeOperationDispatched = true;
                    mentionHostRef.current.invalidatePresentationCache?.();
                  },
                  confirmed: (confirmedApprovalIds: readonly string[]) => {
                    confirmUnsafeJournalOperations(turn, confirmedApprovalIds);
                  },
                  cancelledBeforeDispatch: (
                    cancelledApprovalIds: readonly string[],
                    reason,
                  ) => {
                    cancelUnsafeDispatchBeforeNetwork(
                      turn,
                      unsafeJournalId,
                      cancelledApprovalIds,
                      reason,
                    );
                  },
                },
              }
            : {}),
        },
        (event) => observeRuntimeEvent(event, turn),
      );
      if (unsafeJournalId) {
        confirmUnsafeJournalOperations(turn, result.confirmedApprovalIds ?? []);
      }
    } catch (error) {
      thrownMessage =
        error instanceof Error
          ? error.message
          : 'The result of this operation could not be confirmed.';
      const readOnlyCancellation =
        thrownMessage === READ_ONLY_REJECTION_MESSAGE &&
        !turn.unsafeOperationDispatched;
      if (runtimeRef.current === runtime) {
        runtimeRef.current = undefined;
      }
      void runtime.dispose?.();
      pendingNavigationRef.current = [];
      if (activeTurnRef.current === turn) {
        activeTurnRef.current = undefined;
      }
      if (readOnlyCancellation) {
        updateEntries((current) =>
          current
            .filter(
              (entry) =>
                entry.kind !== 'approval' ||
                !approvalIds.has(entry.approval.id),
            )
            .map((entry) => settleReadOnlyCancellationEntry(entry, turn)),
        );
      } else {
        updateEntries((current) =>
          current.map((entry) => {
            if (
              entry.id === turn.assistantEntryId &&
              entry.kind === 'message'
            ) {
              return {
                ...entry,
                streaming: false,
                interrupted: true,
                error: thrownMessage,
              };
            }
            if (
              entry.id === turn.activityEntryId &&
              entry.kind === 'activity'
            ) {
              return {
                ...entry,
                phase: 'failed' as const,
                activities: entry.activities.map((activity) =>
                  activity.status === 'running'
                    ? { ...activity, status: 'error' as const }
                    : activity,
                ),
              };
            }
            return entry;
          }),
        );
      }
      if (
        !readOnlyCancellation &&
        (!turn.userStopped || turn.unsafeOperationDispatched)
      ) {
        registerTerminalFailure(turn, {
          thrownError: error,
          source: 'approval_exception',
        });
      }
      persistConversation({});
    } finally {
      approvalDispatchRef.current.delete(responseId);
      if (abortRef.current === controller) {
        abortRef.current = undefined;
      }
    }

    if (!mountedRef.current) {
      return;
    }

    if (
      turn.cancelledBeforeDispatchApprovalIds.length > 0 &&
      turn.dispatchedApprovalIds.length > 0
    ) {
      const cancellationNotice =
        turn.cancelledBeforeDispatchReason === 'prior_outcome_uncertain'
          ? 'A later approved operation was not sent because an earlier change may be incomplete. Check DatoCMS before trying again.'
          : 'A later approved change was not sent because the editor state changed.';
      updateEntries((current) =>
        current.map((entry) =>
          entry.id === turn.assistantEntryId &&
          entry.kind === 'message' &&
          !entry.content.includes(cancellationNotice)
            ? {
                ...entry,
                content: entry.content.trim()
                  ? `${entry.content.trim()}\n\n${cancellationNotice}`
                  : cancellationNotice,
              }
            : entry,
        ),
      );
      persistConversation({});
    }

    if (unsafeJournalId && activeTurnRef.current !== turn) {
      const assistantEntry = entriesRef.current.find(
        (entry): entry is Extract<AgentTranscriptEntry, { kind: 'message' }> =>
          entry.id === turn.assistantEntryId && entry.kind === 'message',
      );
      const hasRequiredOutcomeNotice = Boolean(
        durableUnsafeOutcomeNotice(turn, assistantEntry),
      );
      if (result?.status === 'completed' || hasRequiredOutcomeNotice) {
        releaseConfirmedUnsafeJournal(turn);
      }
    }

    updatePendingApprovals((current) => {
      const next = new Map(current);
      for (const item of group) {
        next.delete(item.request.approvalRequestId);
      }
      return next;
    });
    const resultOutcomes = new Map(
      [...turn.approvalOutcomes, ...(result?.approvalOutcomes ?? [])].map(
        (outcome) => [outcome.approvalRequestId, outcome],
      ),
    );
    const confirmedApprovalIds = new Set([
      ...turn.confirmedApprovalIds,
      ...(result?.confirmedApprovalIds ?? []),
    ]);
    updateEntries((current) =>
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Each decision is settled from the definitive runtime result without re-exposing unsafe actions.
      current.map((entry) => {
        if (entry.kind !== 'approval') {
          return entry;
        }
        const item = group.find(
          (pendingItem) =>
            pendingItem.request.approvalRequestId === entry.approval.id,
        );
        if (!item?.decision) {
          return entry;
        }
        if (!item.decision.approve) {
          return {
            ...entry,
            approval: {
              ...entry.approval,
              status: 'rejected' as const,
              error: undefined,
            },
          };
        }
        if (
          turn.cancelledBeforeDispatchApprovalIds.includes(
            item.request.approvalRequestId,
          )
        ) {
          return {
            ...entry,
            approval: {
              ...entry.approval,
              status: 'error' as const,
              error:
                turn.cancelledBeforeDispatchReason === 'prior_outcome_uncertain'
                  ? 'This operation was not sent because an earlier change may be incomplete.'
                  : 'This operation was not sent because the editor state changed.',
            },
          };
        }
        const resultOutcome = resultOutcomes.get(
          item.request.approvalRequestId,
        );
        if (resultOutcome) {
          return {
            ...entry,
            approval: {
              ...entry.approval,
              status: 'approved' as const,
              error: undefined,
              outcome: {
                kind: resultOutcome.kind,
                diagnostic: resultOutcome.diagnostic,
              },
            },
          };
        }
        if (confirmedApprovalIds.has(item.request.approvalRequestId)) {
          return {
            ...entry,
            approval: {
              ...entry.approval,
              status: 'approved' as const,
              error: undefined,
            },
          };
        }
        if (
          !result ||
          result.status === 'failed' ||
          result.status === 'incomplete' ||
          result.status === 'aborted'
        ) {
          if (
            turn.dispatchedApprovalIds.includes(item.request.approvalRequestId)
          ) {
            return {
              ...entry,
              approval: {
                ...entry.approval,
                status: 'approved' as const,
                error: undefined,
                outcome: {
                  kind: 'unknown' as const,
                  diagnostic:
                    thrownMessage ??
                    result?.error?.message ??
                    'The result could not be confirmed.',
                },
              },
            };
          }
          return {
            ...entry,
            approval: {
              ...entry.approval,
              status: 'error' as const,
              error:
                thrownMessage ??
                result?.error?.message ??
                'The result could not be confirmed. Check DatoCMS before making another change.',
            },
          };
        }
        return {
          ...entry,
          approval: {
            ...entry.approval,
            status: 'approved' as const,
            error: undefined,
          },
        };
      }),
    );

    if (result?.status !== 'approval_required') {
      activateUnsafeRepairCandidate(turn);
      settleActivatedRepairTurn(turn);
    }

    if (
      result?.status === 'approval_required' &&
      result.responseId &&
      activeTurnRef.current === turn
    ) {
      persistConversation({});
      const responseApprovals = [
        ...pendingApprovalsRef.current.values(),
      ].filter((item) => item.responseId === result?.responseId);
      if (
        responseApprovals.length > 0 &&
        responseApprovals.every((item) => item.decision)
      ) {
        await dispatchApprovalGroup(result.responseId);
      } else {
        await autoApproveResponse(result.responseId);
      }
      return;
    }

    setRunning(false);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Fail-closed validation, dirty-state protection, bundle caps, and atomic dispatch are kept together for the automatic approval boundary.
  async function autoApproveResponse(
    responseId: string | undefined,
  ): Promise<void> {
    if (
      !responseId ||
      !autoApproveEnabledRef.current ||
      autoApprovalDispatchRef.current.has(responseId)
    ) {
      return;
    }

    const turn = activeTurnRef.current;
    const group = [...pendingApprovalsRef.current.values()].filter(
      (item) => item.responseId === responseId && item.automatic,
    );
    if (!turn || group.length === 0) {
      return;
    }

    if (editorDirtyRef.current) {
      pauseAutomaticApproval(
        responseId,
        'Auto-approve paused. Save or discard the unsaved record changes first.',
      );
      return;
    }

    if (hostActionPendingRef.current) {
      pauseAutomaticApproval(
        responseId,
        'Auto-approve paused. Close the open DatoCMS dialog before continuing.',
      );
      return;
    }

    if (turn.autoApprovalBundleCount >= MAX_AUTO_APPROVAL_BUNDLES_PER_TURN) {
      pauseAutomaticApproval(
        responseId,
        'Auto-approve paused after too many consecutive changes. Review this operation to continue.',
      );
      return;
    }

    for (const pending of group) {
      const validation = validateApprovalScope(
        {
          name: pending.request.name,
          arguments: pending.request.arguments,
          serverLabel: pending.request.serverLabel,
        },
        props,
        { readOnly: readOnlyRef.current },
      );
      if (!validation.allowed) {
        pauseAutomaticApproval(responseId, validation.reason);
        return;
      }
    }

    if (
      editorDirtyRef.current ||
      hostActionPendingRef.current ||
      !autoApproveEnabledRef.current ||
      activeTurnRef.current !== turn
    ) {
      pauseAutomaticApproval(
        responseId,
        'Auto-approve paused. Review this operation to continue.',
      );
      return;
    }

    const decisions = new Map(
      group.map((item) => [
        item.request.approvalRequestId,
        {
          approvalRequestId: item.request.approvalRequestId,
          approve: true,
        } satisfies AgentApprovalDecision,
      ]),
    );
    updatePendingApprovals((current) => {
      const next = new Map(current);
      for (const item of group) {
        const decision = decisions.get(item.request.approvalRequestId);
        if (decision) {
          next.set(item.request.approvalRequestId, {
            ...item,
            decision,
          });
        }
      }
      return next;
    });
    updateEntries((current) =>
      current.map((entry) =>
        entry.kind === 'approval' && decisions.has(entry.approval.id)
          ? {
              ...entry,
              approval: {
                ...entry.approval,
                automatic: true,
                error: undefined,
                status: 'approving' as const,
              },
            }
          : entry,
      ),
    );

    turn.autoApprovalBundleCount += 1;
    autoApprovalDispatchRef.current.add(responseId);
    try {
      await dispatchApprovalGroup(responseId);
    } finally {
      autoApprovalDispatchRef.current.delete(responseId);
    }
  }

  async function decideApproval(
    approvalView: UnsafeApprovalViewModel,
    approve: boolean,
  ): Promise<void> {
    const pending = pendingApprovalsRef.current.get(approvalView.id);
    if (
      !pending ||
      pending.decision ||
      approvalDispatchRef.current.has(pending.responseId)
    ) {
      return;
    }

    if (approve && editorDirtyRef.current) {
      updateEntries((current) =>
        current.map((entry) =>
          entry.id === `approval:${approvalView.id}` &&
          entry.kind === 'approval'
            ? {
                ...entry,
                approval: {
                  ...entry.approval,
                  status: 'pending',
                  error:
                    'Save or discard the unsaved record changes before approving.',
                },
              }
            : entry,
        ),
      );
      return;
    }

    const validation = validateApprovalScope(
      {
        name: pending.request.name,
        arguments: pending.request.arguments,
        serverLabel: pending.request.serverLabel,
      },
      props,
      { readOnly: readOnlyRef.current },
    );
    if (approve && !validation.allowed) {
      updateEntries((current) =>
        current.map((entry) =>
          entry.id === `approval:${approvalView.id}` &&
          entry.kind === 'approval'
            ? {
                ...entry,
                approval: {
                  ...entry.approval,
                  status: 'error',
                  error: validation.reason,
                },
              }
            : entry,
        ),
      );
      return;
    }

    const decision: AgentApprovalDecision = {
      approvalRequestId: approvalView.id,
      approve,
      ...(!approve
        ? { reason: 'The editor rejected this proposed change.' }
        : {}),
    };
    updatePendingApprovals((current) => {
      const next = new Map(current);
      next.set(approvalView.id, {
        ...pending,
        automatic: false,
        decision,
      });
      return next;
    });
    updateEntries((current) =>
      current.map((entry) =>
        entry.id === `approval:${approvalView.id}` && entry.kind === 'approval'
          ? {
              ...entry,
              approval: {
                ...entry.approval,
                automatic: false,
                error: undefined,
                status: approve
                  ? ('approving' as const)
                  : ('rejecting' as const),
              },
            }
          : entry,
      ),
    );

    const group = [...pendingApprovalsRef.current.values()].filter(
      (item) => item.responseId === pending.responseId,
    );
    if (group.some((item) => !item.decision)) {
      return;
    }
    await dispatchApprovalGroup(pending.responseId);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Confirmation, busy-state revalidation, persistence, and fail-closed UI state form one activation transaction.
  async function changeAutoApprove(nextEnabled: boolean): Promise<boolean> {
    if (autoApproveChangeRef.current || hostActionPendingRef.current) {
      return false;
    }

    if (nextEnabled && readOnlyRef.current) {
      return false;
    }

    if (!nextEnabled) {
      autoApproveEnabledRef.current = false;
      setAutoApproveEnabled(false);
      setAutoApproveError(undefined);
      try {
        autoApprovalStore.setEnabled(false);
        return true;
      } catch {
        setAutoApproveError(
          'Auto-approve is off here, but this browser session could not be updated.',
        );
        return false;
      }
    }

    if (
      running ||
      activeTurnRef.current ||
      pendingApprovalsRef.current.size > 0 ||
      approvalDispatchRef.current.size > 0
    ) {
      return false;
    }

    if (!beginHostAction()) {
      return false;
    }

    autoApproveChangeRef.current = true;
    setAutoApproveChanging(true);
    setAutoApproveError(undefined);
    try {
      const confirmed = await props.onConfirmEnableAutoApprove();
      if (
        !mountedRef.current ||
        !confirmed ||
        activeTurnRef.current ||
        pendingApprovalsRef.current.size > 0 ||
        approvalDispatchRef.current.size > 0
      ) {
        return false;
      }

      autoApprovalStore.setEnabled(true);
      autoApproveEnabledRef.current = true;
      setAutoApproveEnabled(true);
      return true;
    } catch {
      setAutoApproveError('Auto-approve could not be turned on.');
      return false;
    } finally {
      autoApproveChangeRef.current = false;
      if (mountedRef.current) {
        setAutoApproveChanging(false);
      }
      finishHostAction();
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The popup, DCR, PKCE, persistence, and cleanup steps are kept together to guarantee one authorization lifecycle.
  const connectDatoCms = async () => {
    setOauthConnecting(true);
    setOauthError(undefined);
    let popup: Window | undefined;
    let pendingState: string | undefined;

    try {
      popup = openOAuthPopup();
      oauthPopupRef.current = popup;
      const redirectUri = computeRedirectUri();
      const existingClient = oauthCredentials?.client;
      const client =
        existingClient &&
        existingClient.redirectUri === redirectUri &&
        isOAuthClientRegistrationFresh(existingClient)
          ? existingClient
          : await registerClient(redirectUri);
      oauthStore.save(createOAuthCredentials(client), {
        remember: true,
      });
      const authorization = await createAuthorizationRequest({
        scope: credentialScope,
        clientId: client.clientId,
        redirectUri: client.redirectUri,
      });
      pendingState = authorization.state;
      navigateOAuthPopup(popup, authorization.authorizationUrl);
      const callback = await waitForOAuthCallback(popup, authorization.state);
      const token = await exchangeAuthorizationCode({
        scope: credentialScope,
        code: callback.code,
        state: callback.state,
      });
      const credentials = createOAuthCredentials(client, token);
      oauthStore.save(credentials, { remember: true });
      setOauthCredentials(credentials);
    } catch (error) {
      if (pendingState) {
        discardPendingAuthorization(credentialScope, pendingState);
      }
      if (popup && !popup.closed) {
        popup.close();
      }
      setOauthError(
        error instanceof Error
          ? error.message
          : 'Could not connect to DatoCMS.',
      );
    } finally {
      oauthPopupRef.current = undefined;
      setOauthConnecting(false);
    }
  };

  const disconnectDatoCms = async () => {
    if (
      running ||
      activeTurnRef.current ||
      pendingApprovalsRef.current.size > 0 ||
      approvalDispatchRef.current.size > 0
    ) {
      setOauthError(
        'Finish or deny the pending operation before disconnecting.',
      );
      return;
    }

    retryCandidateRef.current = undefined;
    retireUnsafeRepairCandidate();
    updateEntries((current) =>
      current.map((entry) =>
        entry.kind === 'message' && entry.failure?.retryable
          ? {
              ...entry,
              failure: { ...entry.failure, retryable: false },
            }
          : entry,
      ),
    );
    await changeAutoApprove(false);
    const credentials = oauthCredentials;
    setOauthConnecting(true);
    setOauthError(undefined);
    try {
      if (credentials?.token) {
        await revokeToken({
          accessToken: credentials.token.accessToken,
          clientId: credentials.client.clientId,
        });
      }
    } catch (error) {
      setOauthError(
        error instanceof Error ? error.message : 'Token revocation failed.',
      );
    } finally {
      try {
        oauthStore.clear();
      } catch {
        // Clear the in-memory credential even when browser storage is blocked.
      }
      setOauthCredentials(null);
      void runtimeRef.current?.dispose?.();
      runtimeRef.current = undefined;
      setOauthConnecting(false);
    }
  };

  const selectConversation = (
    selected: AgentConversationSummaryViewModel,
  ): boolean => {
    if (
      running ||
      activeTurnRef.current ||
      pendingApprovalsRef.current.size > 0 ||
      approvalDispatchRef.current.size > 0
    ) {
      return false;
    }

    if (selected.id === conversationRef.current.id) {
      return true;
    }

    const next = storedConversations.find(
      (candidate) => candidate.id === selected.id,
    );
    if (!next) {
      setStoredConversations(loadStoredConversations(conversationStore));
      return false;
    }

    activateConversation(next);
    setStoredConversations(loadStoredConversations(conversationStore));
    return true;
  };

  const startNewConversation = (): boolean => {
    if (
      running ||
      activeTurnRef.current ||
      pendingApprovalsRef.current.size > 0 ||
      approvalDispatchRef.current.size > 0
    ) {
      return false;
    }

    activateConversation(createEmptyConversation());
    return true;
  };

  const openRecordDirectly = async (record: AgentRecordResultViewModel) => {
    if (!beginHostAction()) return;
    cancelPendingNavigationForExplicitHostAction();
    try {
      await openRecordInHost({
        itemId: record.itemId,
        itemTypeId: record.itemTypeId,
        fieldPath: record.fieldPath,
      });
    } finally {
      finishHostAction();
    }
  };

  const openRecord = async (
    record: AgentRecordResultViewModel,
    entryId?: string,
  ) => {
    if (entryId === undefined) {
      await openRecordDirectly(record);
      return;
    }

    const receipt = entriesRef.current.find(
      (entry) => entry.kind === 'records' && entry.id === entryId,
    );
    if (receipt?.kind !== 'records' || receipt.opening || !beginHostAction()) {
      return;
    }
    cancelPendingNavigationForExplicitHostAction();

    updateEntries((current) => startRecordReceiptOpening(current, entryId));

    let navigationError: string | undefined;
    try {
      await openRecordInHost({
        itemId: record.itemId,
        itemTypeId: record.itemTypeId,
        fieldPath: record.fieldPath,
      });
    } catch (error) {
      const detail = errorMessage(error).trim();
      navigationError = detail
        ? `Could not open this record. ${detail}`
        : 'Could not open this record.';
    } finally {
      if (mountedRef.current) {
        updateEntries((current) =>
          settleRecordReceiptOpening(current, entryId, navigationError),
        );
      }
      finishHostAction();
    }
  };

  const openFieldDirectly = async (field: AgentFieldResultViewModel) => {
    if (!props.openCurrentField || !beginHostAction()) return;
    try {
      await props.openCurrentField({
        fieldPath: field.fieldPath,
        label: field.title,
        locale: field.locale,
      });
    } finally {
      finishHostAction();
    }
  };

  const openField = async (
    field: AgentFieldResultViewModel,
    entryId?: string,
  ) => {
    const openCurrentField = props.openCurrentField;
    if (!openCurrentField || hostActionPendingRef.current) {
      return;
    }

    if (entryId === undefined) {
      await openFieldDirectly(field);
      return;
    }

    const key = `${field.fieldPath}:${field.locale ?? ''}`;
    if (
      !fieldReceiptCanOpen(entriesRef.current, entryId) ||
      !beginHostAction()
    ) {
      return;
    }

    updateEntries((current) => startFieldReceiptOpening(current, entryId, key));

    let fieldError: string | undefined;
    try {
      fieldError = await openFieldInHost(openCurrentField, field);
    } finally {
      if (mountedRef.current) {
        updateEntries((current) =>
          settleFieldReceiptOpening(current, entryId, fieldError),
        );
      }
      finishHostAction();
    }
  };

  const persistCurrentTranscript = () => {
    const current = conversationRef.current;
    persistConversation({
      previousResponseId: current.previousResponseId,
      responseProvider: current.responseProvider,
      responseModel: current.responseModel,
      hostContextFingerprint: current.hostContextFingerprint,
    });
  };

  const openAssetDirectly = async (asset: AgentAssetResultViewModel) => {
    if (!beginHostAction()) return;
    cancelPendingNavigationForExplicitHostAction();
    try {
      await props.navigator.openAsset({
        uploadId: asset.uploadId,
        label: asset.title,
      });
    } finally {
      finishHostAction();
    }
  };

  const openAsset = async (
    asset: AgentAssetResultViewModel,
    entryId?: string,
  ) => {
    const canOpen = directAssetCanOpen(asset, hostActionPendingRef.current);
    if (!canOpen) {
      return;
    }

    if (entryId === undefined) {
      await openAssetDirectly(asset);
      return;
    }

    if (
      !assetReceiptCanOpen(entriesRef.current, entryId) ||
      !beginHostAction()
    ) {
      return;
    }
    cancelPendingNavigationForExplicitHostAction();

    updateEntries((current) =>
      startAssetReceiptOpening(current, entryId, asset.uploadId),
    );

    try {
      const outcome = await openAssetInHost(props.navigator, asset);
      const modalResult = outcome.result;
      const persistAssetChange = assetResultChangesReceipt(modalResult);
      if (persistAssetChange) {
        updateEntries((current) =>
          applyAssetModalResult(current, entryId, asset.uploadId, modalResult),
        );
      }

      if (mountedRef.current) {
        updateEntries((current) =>
          settleAssetReceipt(current, entryId, outcome.error),
        );
        if (persistAssetChange) {
          persistCurrentTranscript();
        }
      }
    } finally {
      finishHostAction();
    }
  };

  const reviewApprovalDetails = async (
    approval: UnsafeApprovalViewModel,
  ): Promise<void> => {
    if (!beginHostAction()) {
      return;
    }

    let decision: ApprovalDetailsDecision | null = null;
    try {
      decision = await props.onReviewApprovalDetails(approval);
    } catch {
      // Closing or failing to open review details must not leave host actions
      // locked or change the approval decision.
    } finally {
      finishHostAction();
    }

    if (!mountedRef.current) {
      return;
    }
    if (decision === 'approve') {
      await decideApproval(approval, true);
    } else if (decision === 'deny') {
      await decideApproval(approval, false);
    }
  };

  const repairUnsafeApproval =
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Recovery activation intentionally keeps every live policy, identity, and dispatch guard in one fail-closed transaction.
    async (approval: UnsafeApprovalViewModel): Promise<void> => {
      const candidate = unsafeRepairCandidateRef.current;
      if (
        !candidate ||
        candidate.approvalRequestId !== approval.id ||
        candidate.state !== 'available'
      ) {
        return;
      }

      const showGuardMessage = (message: string) => {
        updateEntries((current) =>
          current.map((entry) =>
            entry.kind === 'approval' && entry.approval.id === approval.id
              ? {
                  ...entry,
                  approval: { ...entry.approval, error: message },
                }
              : entry,
          ),
        );
      };

      if (readOnlyRef.current) {
        retireUnsafeRepairCandidate(candidate.approvalRequestId);
        return;
      }
      if (
        running ||
        activeTurnRef.current ||
        pendingApprovalsRef.current.size > 0 ||
        approvalDispatchRef.current.size > 0 ||
        autoApprovalDispatchRef.current.size > 0
      ) {
        showGuardMessage(
          'Finish the current request before preparing this fix.',
        );
        return;
      }
      try {
        if (unsafeDispatchJournalStore.read()) {
          showGuardMessage(
            'Check the previous change outcome before preparing another change.',
          );
          return;
        }
      } catch {
        showGuardMessage(
          'The previous change outcome could not be verified. Check DatoCMS before preparing another change.',
        );
        return;
      }
      if (hostActionPendingRef.current || autoApproveChangeRef.current) {
        showGuardMessage('Close the open dialog before preparing this fix.');
        return;
      }
      if (editorDirtyRef.current) {
        showGuardMessage(
          'Save or discard the unsaved record changes before preparing this fix.',
        );
        return;
      }
      if (
        !activeApiKey(props.config).trim() ||
        !activeModel(props.config).trim()
      ) {
        showGuardMessage(
          'Configure the AI provider before preparing this fix.',
        );
        return;
      }
      if (!oauthCredentialsRef.current?.token?.accessToken || oauthConnecting) {
        showGuardMessage('Reconnect DatoCMS before preparing this fix.');
        return;
      }

      const validation = validateApprovalScope(
        {
          name: candidate.request.name,
          arguments: candidate.request.arguments,
          serverLabel: candidate.request.serverLabel,
        },
        props,
        { readOnly: readOnlyRef.current },
      );
      const parsed = validation.parsedArguments;
      const parsedRecord =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : undefined;
      const remoteOutcome = candidate.outcome.remoteOutcome;
      if (
        !validation.allowed ||
        !parsedRecord ||
        parsedRecord.name !== remoteOutcome.scriptName ||
        remoteOutcome.executionState !== 'not_started' ||
        remoteOutcome.projectChangeState !== 'none' ||
        remoteOutcome.recovery !== 'fix_and_review'
      ) {
        retireUnsafeRepairCandidate(candidate.approvalRequestId);
        return;
      }

      if (
        unsafeRepairCandidateRef.current !== candidate ||
        candidate.state !== 'available' ||
        readOnlyRef.current ||
        activeTurnRef.current ||
        approvalDispatchRef.current.size > 0 ||
        hostActionPendingRef.current ||
        editorDirtyRef.current
      ) {
        return;
      }

      const fixWithAuto = autoApproveEnabledRef.current;
      const visibleMessage = fixWithAuto ? 'Fix with Auto' : 'Fix and review';
      const repairContext: AgentRepairContext = {
        failureCode: remoteOutcome.failureCode,
        scriptName: remoteOutcome.scriptName,
        noExecute: parsedRecord.no_execute === true,
        diagnostic: candidate.outcome.diagnostic.slice(0, 4_000),
      };
      const repairPolicy = createAgentRepairPolicy(
        {
          name: candidate.request.name,
          arguments: candidate.request.arguments,
        },
        repairContext,
      );
      if (!repairPolicy) {
        retireUnsafeRepairCandidate(candidate.approvalRequestId);
        return;
      }
      candidate.state = 'starting';
      updateEntries((current) =>
        current.map((entry) =>
          entry.kind === 'approval' &&
          entry.approval.id === candidate.approvalRequestId
            ? {
                ...entry,
                approval: {
                  ...entry.approval,
                  error: undefined,
                  recovery: { status: 'starting' as const },
                },
              }
            : entry,
        ),
      );

      await submit(
        {
          displayText: visibleMessage,
          providerText: visibleMessage,
          segments: [{ type: 'text', content: visibleMessage }],
        },
        undefined,
        repairContext,
        repairPolicy,
      );

      if (
        unsafeRepairCandidateRef.current === candidate &&
        candidate.state === 'starting' &&
        !candidate.repairTurnId
      ) {
        candidate.state = 'available';
        updateEntries((current) =>
          current.map((entry) =>
            entry.kind === 'approval' &&
            entry.approval.id === candidate.approvalRequestId
              ? {
                  ...entry,
                  approval: {
                    ...entry.approval,
                    recovery: { status: 'available' as const },
                  },
                }
              : entry,
          ),
        );
      }
    };

  const hasProviderConfiguration = Boolean(
    activeApiKey(props.config).trim() && activeModel(props.config).trim(),
  );
  const hasDatoCmsConnection = Boolean(oauthCredentials?.token?.accessToken);
  const setupNeeded = !hasProviderConfiguration || !hasDatoCmsConnection;

  return (
    <AgentSurface
      connection={{
        status: oauthConnecting
          ? 'connecting'
          : setupNeeded
            ? oauthError
              ? 'error'
              : 'setup'
            : 'connected',
        providerConfigStatus: hasProviderConfiguration
          ? 'configured'
          : 'missing',
        providerLabel: providerLabel(props.config.provider),
        datoCmsStatus: oauthConnecting
          ? 'connecting'
          : hasDatoCmsConnection
            ? 'connected'
            : oauthError
              ? 'error'
              : 'disconnected',
        datoCmsAccountLabel: hasDatoCmsConnection ? 'DatoCMS' : undefined,
        datoCmsError: oauthError,
      }}
      entries={entries}
      mentionHost={mentionHost}
      isRunning={running}
      autoApproveEnabled={autoApproveEnabled}
      autoApproveChanging={autoApproveChanging}
      autoApproveError={autoApproveError}
      autoApproveDisabledReason={
        props.config.readOnly
          ? 'Auto-approve is unavailable in Read Only mode.'
          : undefined
      }
      persistenceWarning={conversationPersistenceError}
      composerDisabled={
        setupNeeded ||
        pendingApprovals.size > 0 ||
        oauthConnecting ||
        hostActionPending
      }
      composerPlaceholder={
        pendingApprovals.size > 0
          ? autoApproveEnabled && running
            ? 'Running the DatoCMS change…'
            : 'Review the proposed change before continuing'
          : surface === 'record'
            ? 'Ask about this…'
            : 'Ask about this project…'
      }
      onSubmit={(message) => void submit(message)}
      onRetryFailedTurn={retryFailedTurn}
      onCopyFailureDiagnostics={copyFailureDiagnostics}
      onConnectDatoCms={() => void connectDatoCms()}
      onDisconnectDatoCms={() => void disconnectDatoCms()}
      recentConversations={storedConversations.map((stored) => ({
        id: stored.id,
        title: stored.title,
        isCurrent: stored.id === conversation.id,
      }))}
      onSelectConversation={selectConversation}
      onStartNewChat={startNewConversation}
      onStop={stopActiveTurn}
      onOpenAsset={openAsset}
      onOpenField={props.openCurrentField ? openField : undefined}
      onOpenRecord={openRecord}
      currentRecordId={
        surface === 'project' ? currentInspectorRecordId : undefined
      }
      hostActionPending={hostActionPending}
      onReviewUnsafeAction={(approval) => void reviewApprovalDetails(approval)}
      onApproveUnsafeAction={(approval) => void decideApproval(approval, true)}
      onRejectUnsafeAction={(approval) => void decideApproval(approval, false)}
      onRepairUnsafeAction={(approval) => void repairUnsafeApproval(approval)}
      onAutoApproveChange={
        props.config.readOnly ? undefined : changeAutoApprove
      }
    />
  );
}
