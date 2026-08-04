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
  type AgentApprovalRequest,
  type AgentRuntimeEvent,
  type AgentTurnResult,
  type AgentTurnStatus,
  createAgentRuntime,
  type FieldReferenceInput,
  type GetModelSchemaCallback,
  type NavigationCallbackResult,
  type PresentFieldsInput,
  type PresentModelsInput,
  type PresentUsersInput,
  type ReadCurrentRecordLiveFormStateInput,
} from '../lib/agentRuntime';
import { validateApprovalScope } from '../lib/approval';
import {
  type AutoApprovalScope,
  createAutoApprovalStore,
} from '../lib/autoApproval';
import {
  type AgentConfig,
  type AgentProvider,
  activeApiKey,
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
import type { AgentMentionHost } from '../lib/mentionHost';
import {
  type AgentComposerSubmission,
  type CommentSegment,
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
  ) => Promise<unknown>;
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
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  entriesBefore: AgentTranscriptEntry[];
  conversationBefore: Conversation;
  userEntryId: string;
  assistantEntryId: string;
  activityEntryId: string;
  autoApprovalBundleCount: number;
  userStopped: boolean;
  unsafeOperationDispatched: boolean;
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
  hostContexts: Array<{
    capturedAt: string;
    text: string;
    fingerprint: string;
  }>;
  previousResponseId?: string;
  injectHostContext?: boolean;
  hostContextFingerprint?: string;
};

type RetryCandidate = {
  failureId: string;
  submission: AgentComposerSubmission;
  history: ActiveTurn['history'];
  entriesBefore: AgentTranscriptEntry[];
  conversationBefore: Conversation;
  userEntryId: string;
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
  },
): UnsafeApprovalViewModel {
  const parsed =
    typeof pending.request.parsedArguments === 'object' &&
    pending.request.parsedArguments !== null &&
    !Array.isArray(pending.request.parsedArguments)
      ? (pending.request.parsedArguments as Record<string, unknown>)
      : {};
  const body =
    typeof parsed.body === 'object' && parsed.body !== null
      ? (parsed.body as Record<string, unknown>)
      : {};
  const validation = validateApprovalScope(
    {
      name: pending.request.name,
      arguments: pending.request.arguments,
      serverLabel: pending.request.serverLabel,
    },
    scope,
  );
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
      ...(typeof body.content === 'string'
        ? [{ label: 'Generated TypeScript', value: body.content }]
        : []),
      ...(Array.isArray(body.replacements)
        ? [
            {
              label: 'Script patch',
              value: stringifyDetail(body.replacements) ?? 'Patch details',
            },
          ]
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

function conversationMessageFromTranscript(
  entries: readonly AgentTranscriptEntry[],
  entry: Extract<AgentTranscriptEntry, { kind: 'message' }>,
  index: number,
  createdAt: string,
): ConversationMessage | undefined {
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
    !entry.content.trim() &&
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
    text: entry.content,
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
    return segmentsProviderText(message.segments);
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
  const hasUnsentOperation = journal.operations.some(
    (operation) => operation.state === 'armed',
  );

  if (hasUnknownOutcome) {
    return 'An approved DatoCMS change may already have run, but the chat closed before its result was confirmed. Check the affected content before trying the same change again.';
  }
  if (hasConfirmedOutcome && hasUnsentOperation) {
    return 'Part of the approved DatoCMS change finished before the chat closed. The remaining operations were not sent. Check the affected content before trying it again.';
  }
  if (hasConfirmedOutcome) {
    return 'The approved DatoCMS change finished, but the final reply was interrupted. Check DatoCMS for the result.';
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
  const mentionHost =
    props.mentionHost ??
    ({
      currentUser: {
        id: props.currentUserId,
        name: 'You',
        email: '',
        avatarUrl: null,
        userType: 'user',
      },
      projectModels: [],
      recordModels: [],
      canMentionFields: false,
      canMentionAssets: false,
      canMentionModels: false,
      loadProjectUsers: async () => [],
      selectAsset: async () => undefined,
      selectRecord: async () => undefined,
      openUser: () => undefined,
      openModel: () => undefined,
    } satisfies AgentMentionHost);
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
  const failureDiagnosticsRef = useRef(new Map<string, string>());
  const pendingNavigationRef = useRef<PendingNavigation[]>([]);
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
      failureDiagnosticsRef.current.clear();
      if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
        oauthPopupRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    const synchronizeAutoApproval = (event: StorageEvent) => {
      if (event.key !== autoApprovalStore.key) {
        return;
      }

      let enabled = false;
      try {
        enabled = autoApprovalStore.isEnabled();
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

  const updatePendingApprovals = (
    updater: (
      current: Map<string, PendingApproval>,
    ) => Map<string, PendingApproval>,
  ) => {
    const next = updater(pendingApprovalsRef.current);
    pendingApprovalsRef.current = next;
    setPendingApprovals(next);
  };

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

  const checkpointInterruptedTurn = (
    turn: ActiveTurn,
    updateState: boolean,
  ) => {
    if (turn.unsafeOperationDispatched) {
      return;
    }

    const interruptedText = 'The response was interrupted before it completed.';
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
          autoApprovalBundleCount: turn.autoApprovalBundleCount,
          approvalSubmissions: turn.approvalSubmissions,
          completionResult: result,
          events: turn.events,
          thrownError,
          systemPrompt: buildSystemPrompt(systemContext, {
            additionalInstructions: props.config.additionalInstructions,
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
          },
          history: turn.history,
          entriesBefore: turn.entriesBefore,
          conversationBefore: turn.conversationBefore,
          userEntryId: turn.userEntryId,
        }
      : undefined;
  };

  const appendRecordResults = (
    title: string,
    records: readonly RecordTarget[],
  ) => {
    updateEntries((current) => [
      ...current,
      {
        id: uid('records'),
        kind: 'records',
        title,
        records: records.map((record) => ({
          itemId: record.itemId,
          title: record.label || `Record ${record.itemId}`,
          ...(record.itemTypeId ? { itemTypeId: record.itemTypeId } : {}),
          ...(record.fieldPath ? { fieldPath: record.fieldPath } : {}),
        })),
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
        fields: fields.map((field) => ({
          fieldPath: field.fieldPath,
          title: field.label || field.fieldPath,
          ...(field.locale ? { locale: field.locale } : {}),
        })),
      },
    ]);
  };

  const appendAssetResults = (
    title: string,
    assets: readonly { uploadId: string; label?: string }[],
  ) => {
    updateEntries((current) => [
      ...current,
      {
        id: uid('assets'),
        kind: 'assets',
        title,
        assets: assets.map((asset) => ({
          uploadId: asset.uploadId,
          title: asset.label || `Asset ${asset.uploadId}`,
        })),
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

  const flushPendingNavigation = async (turn: ActiveTurn) => {
    const pending = pendingNavigationRef.current.at(-1);
    pendingNavigationRef.current = [];

    if (!pending) {
      return;
    }

    try {
      if (pending.type === 'openRecord') {
        await props.navigator.openRecord(pending.target);
        return;
      }

      await props.navigator.showRecords(pending.target);
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
    }
  };

  const createRuntime = (hostContext?: string) =>
    createAgentRuntime({
      provider: props.config.provider,
      apiKey: activeApiKey(props.config),
      mcpAccessToken: oauthCredentials?.token?.accessToken ?? '',
      model: activeModel(props.config),
      modelMaxOutputTokens: activeModelMaxOutputTokens(props.config),
      reasoningEffort: activeReasoningEffort(props.config),
      additionalInstructions: props.config.additionalInstructions,
      hostContext,
      getModelSchema: props.getModelSchema,
      context: runtimeSystemContext(),
      navigation: {
        presentRecords: ({ title, records }) => {
          appendRecordResults(title, records);
          return {
            presented: true,
            count: records.length,
            message:
              'Clickable record results were added to the chat without changing the current CMS view.',
          };
        },
        openRecord: ({ itemId, itemTypeId, fieldPath }) => {
          const target = { itemId, itemTypeId, fieldPath };
          appendRecordResults('Record found', [target]);
          return queuePendingNavigation({ type: 'openRecord', target });
        },
        showRecords: ({ title, records }) => {
          appendRecordResults(title, records);
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
        presentAssets: ({ title, assets }) => {
          appendAssetResults(title, assets);
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
    const pending: PendingApproval = {
      responseId,
      request: approval,
      automatic: autoApproveEnabledRef.current,
    };
    updatePendingApprovals((current) => {
      const next = new Map(current);
      next.set(approval.approvalRequestId, pending);
      return next;
    });
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
          approval: approvalViewModel(pending, props),
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
          return settledTurnStatus === 'aborted'
            ? settled.filter(
                (entry) =>
                  !(
                    entry.id === turn.assistantEntryId &&
                    entry.kind === 'message' &&
                    !entry.content.trim()
                  ),
              )
            : settled;
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
  ): Promise<void> {
    const submission: AgentComposerSubmission =
      typeof rawSubmission === 'string'
        ? {
            displayText: rawSubmission.trim(),
            providerText: rawSubmission.trim(),
            segments: [{ type: 'text', content: rawSubmission.trim() }],
          }
        : rawSubmission;
    const message = submission.providerText.trim();
    const displayMessage = submission.displayText.trim();
    if (running || !message || !displayMessage) {
      return;
    }

    const history =
      retryCandidate?.history ??
      conversationRef.current.messages
        .filter(
          (historyMessage) =>
            historyMessage.role === 'user' ||
            (!historyMessage.interrupted &&
              Boolean(historyMessage.text.trim())),
        )
        .map((historyMessage) => ({
          role: historyMessage.role,
          text: conversationProviderText(historyMessage),
        }));
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
      entriesBefore,
      conversationBefore,
      userEntryId,
      assistantEntryId,
      activityEntryId,
      autoApprovalBundleCount: 0,
      userStopped: false,
      unsafeOperationDispatched: false,
      provider: props.config.provider,
      model: activeModel(props.config),
      startedAt,
      textDeltaCount: 0,
      textDeltaCharacters: 0,
      diagnosticEventOutputCharacters: 0,
      diagnosticEventsDropped: 0,
      events: [],
      approvalSubmissions: [],
      hostContexts: [],
    };
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
      const previousResponseId = reusableOpenAiResponseId(
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
            previousResponseId,
            injectHostContext,
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
            previousResponseId: undefined,
            injectHostContext: Boolean(retryHostContext),
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
          await autoApproveResponse(result.responseId);
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Group dispatch preserves one atomic, idempotent unsafe continuation and its outcome-unknown handling.
  async function dispatchApprovalGroup(responseId: string): Promise<void> {
    if (approvalDispatchRef.current.has(responseId)) {
      return;
    }

    const group = [...pendingApprovalsRef.current.values()].filter(
      (item) => item.responseId === responseId,
    );
    if (group.length === 0 || group.some((item) => !item.decision)) {
      return;
    }

    const runtime = runtimeRef.current;
    const turn = activeTurnRef.current;
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
      turn.approvalSubmissions.push({
        capturedAt: new Date().toISOString(),
        responseId,
        decisions,
      });
      if (unsafeJournalId) {
        // Retry must become unavailable as soon as an approved continuation is
        // handed to the runtime. The journal still distinguishes an armed call
        // from one that crossed the provider/Remote MCP transport boundary.
        turn.unsafeOperationDispatched = true;
      }
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
                    unsafeDispatchJournalStore.markDispatched(
                      unsafeJournalId,
                      dispatchedApprovalIds,
                    );
                    turn.unsafeOperationDispatched = true;
                  },
                  confirmed: (confirmedApprovalIds: readonly string[]) => {
                    unsafeDispatchJournalStore.markConfirmed(
                      unsafeJournalId,
                      confirmedApprovalIds,
                    );
                  },
                },
              }
            : {}),
        },
        (event) => observeRuntimeEvent(event, turn),
      );
      if (unsafeJournalId) {
        const confirmedApprovalIds =
          result.status === 'completed'
            ? approvedItems.map((item) => item.request.approvalRequestId)
            : (result.confirmedApprovalIds ?? []);
        if (confirmedApprovalIds.length > 0) {
          try {
            unsafeDispatchJournalStore.markConfirmed(
              unsafeJournalId,
              confirmedApprovalIds,
            );
          } catch {
            // Provider callbacks already record the narrowest durable state.
            // A stale dispatch marker is deliberately treated as uncertain.
          }
        }
      }
    } catch (error) {
      thrownMessage =
        error instanceof Error
          ? error.message
          : 'The result of this operation could not be confirmed.';
      if (runtimeRef.current === runtime) {
        runtimeRef.current = undefined;
      }
      void runtime.dispose?.();
      pendingNavigationRef.current = [];
      if (activeTurnRef.current === turn) {
        activeTurnRef.current = undefined;
      }
      updateEntries((current) =>
        current.map((entry) => {
          if (entry.id === turn.assistantEntryId && entry.kind === 'message') {
            return {
              ...entry,
              streaming: false,
              interrupted: true,
              error: thrownMessage,
            };
          }
          if (entry.id === turn.activityEntryId && entry.kind === 'activity') {
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
      if (!turn.userStopped || turn.unsafeOperationDispatched) {
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
      unsafeJournalId &&
      result?.status === 'completed' &&
      activeTurnRef.current !== turn
    ) {
      try {
        const durableJournal = unsafeDispatchJournalStore.read();
        const durableConversation = conversationStore.get(
          conversationRef.current.id,
        );
        const durableAssistantReply = durableConversation?.messages.find(
          (message) => message.id === turn.assistantEntryId,
        );
        if (
          durableJournal?.id === unsafeJournalId &&
          durableJournal.operations.every(
            (operation) => operation.state === 'confirmed',
          ) &&
          durableAssistantReply?.text.trim()
        ) {
          unsafeDispatchJournalStore.clear(unsafeJournalId);
          turn.unsafeJournalId = undefined;
        }
      } catch {
        // Keep the journal. Recovery must remain conservative if either the
        // terminal reply or the journal cleanup cannot be verified.
      }
    }

    updatePendingApprovals((current) => {
      const next = new Map(current);
      for (const item of group) {
        next.delete(item.request.approvalRequestId);
      }
      return next;
    });
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
          result?.confirmedApprovalIds?.includes(item.request.approvalRequestId)
        ) {
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

    if (
      result?.status === 'approval_required' &&
      result.responseId &&
      activeTurnRef.current === turn
    ) {
      persistConversation({});
      await autoApproveResponse(result.responseId);
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
      );
      if (!validation.allowed) {
        pauseAutomaticApproval(responseId, validation.reason);
        return;
      }
    }

    if (
      editorDirtyRef.current ||
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
    if (!pending || approvalDispatchRef.current.has(pending.responseId)) {
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
    try {
      await props.navigator.openRecord({
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

    updateEntries((current) => startRecordReceiptOpening(current, entryId));

    let navigationError: string | undefined;
    try {
      await props.navigator.openRecord({
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

    try {
      await props.onReviewApprovalDetails(approval);
    } catch {
      // Closing or failing to open review details must not leave host actions
      // locked or change the approval decision.
    } finally {
      finishHostAction();
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
            ? 'Ask about this record…'
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
      hostActionPending={hostActionPending}
      onReviewUnsafeAction={(approval) => void reviewApprovalDetails(approval)}
      onApproveUnsafeAction={(approval) => void decideApproval(approval, true)}
      onRejectUnsafeAction={(approval) => void decideApproval(approval, false)}
      onAutoApproveChange={changeAutoApprove}
    />
  );
}
