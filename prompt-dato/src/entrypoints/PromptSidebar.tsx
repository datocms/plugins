import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown, type DropdownHandle } from 'datocms-react-ui/Dropdown';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { dlog, setDebugEnabled } from '../lib/debugLog';
import {
  DEFAULT_REASONING_EFFORT,
  getProviderApiKey,
  getProviderMainModel,
  isFullyConfigured,
  readParams,
} from '../lib/pluginParams';
import {
  applyTurnStreamEvent,
  createProcessTrace,
  failProcessTrace,
  finishProcessTrace,
  interruptProcessTrace,
  markProcessTraceDecision,
  type ProcessEntry,
  type ProcessTrace,
  type TurnStreamEvent,
} from '../lib/processTrace';
import {
  type ChatMessage,
  isLikelyMcpAuthError,
  isLikelyPreviousResponseError,
  type PendingApproval,
  recoverChatTurn,
  type SendChatTurnResult,
  sendChatTurn,
  submitToolResponses,
} from '../lib/providerRuntime';
import {
  buildRecordContext,
  type FieldInfo,
  listFieldsForCurrentItemType,
} from '../lib/recordContext';
import { clearRemovedDiagnosticsStore } from '../lib/removedDiagnostics';
import {
  addSidebarChatThread,
  buildLegacySidebarSessionKey,
  buildSidebarChatHistoryKey,
  createEmptySidebarChatHistory,
  createSidebarChatThread,
  getSidebarThreadTitle,
  INTERRUPTED_TURN_MESSAGE,
  isSidebarThreadEmpty,
  readSidebarChatHistory,
  removeSidebarChatThread,
  type SidebarApprovalItem,
  type SidebarApprovalState,
  type SidebarChatHistory,
  type SidebarChatThread,
  type SidebarConversationItem,
  updateSidebarChatThread,
  writeSidebarChatHistory,
} from '../lib/sidebarChatHistory';
import { buildRecordEditPath, pluginSettingsPath } from '../utils/paths';
import { ChatList } from './chat/ChatList';
import { Composer, focusComposer } from './chat/Composer';
import {
  type FieldNavigationTarget,
  getHashFieldPath,
} from './chat/fieldLinks';
import { Transcript } from './chat/Transcript';
import { AddIcon, RecordIcon, SettingsIcon } from './icons';
import s from './PromptSidebar.module.css';
import { useActivityTimeline } from './useActivityTimeline';

type Props = {
  ctx: RenderItemFormSidebarCtx;
};

const LOCALE_KEY_SEPARATOR = '\u001f';

function resolveFirstName(ctx: RenderItemFormSidebarCtx): string {
  const user = ctx.currentUser;
  if (user.type === 'sso_user' || user.type === 'account') {
    const first = user.attributes.first_name?.trim();
    if (first) return first;
  }
  if (user.type === 'user') {
    const fullName = user.attributes.full_name?.trim();
    if (fullName) {
      const [first] = fullName.split(/\s+/);
      if (first) return first;
    }
  }
  return 'there';
}

/** The CMS path of the form of the open record, for the links to its fields */
function recordEditPathOf(ctx: RenderItemFormSidebarCtx): string | null {
  const recordId = ctx.item?.id;
  return recordId ? buildRecordEditPath(ctx, ctx.itemType.id, recordId) : null;
}

function generateMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const WAIT_FOR_REPLY = { reason: 'Wait for the reply to finish.' };

/**
 * The whole frame, as a box: the positioned parent with a height that the
 * Pane and the area blank slates fill. It keeps the body padding of the host.
 */
function SidebarFrame({ children }: { children: ReactNode }) {
  const { bodyPadding } = useCtx();
  const inset = bodyPadding.map((side) => `${side}px`).join(' ');

  return (
    <div className={s.frame} style={{ inset }}>
      {children}
    </div>
  );
}

function buildApprovalItem(
  approval: PendingApproval,
  sourceResponseId: string,
): ApprovalItem {
  return {
    kind: 'approval',
    id: generateMessageId(),
    approvalRequestId: approval.approvalRequestId,
    sourceResponseId,
    toolName: approval.toolName,
    argumentsJson: approval.argumentsJson,
    state: 'pending',
    detailsOpen: false,
  };
}

function isUnsafeWriteApproval(item: { toolName: string }): boolean {
  return item.toolName === 'upsert_and_execute_unsafe_script';
}

type ApprovalState = SidebarApprovalState;
type ApprovalItem = SidebarApprovalItem;
type ConversationItem = SidebarConversationItem;
type SidebarView = 'list' | 'chat';
type StateUpdate<T> = T | ((previous: T) => T);

type SidebarHistoryScope = {
  scopeKey: string;
  historyKey: string | null;
  legacySessionKey: string;
  savedRecord: boolean;
};

type LoadedSidebarState = {
  history: SidebarChatHistory;
  view: SidebarView;
};

type RecoverableAssistantTurn = {
  messageId: string;
  responseId: string;
};

type DrainResult = {
  text: string;
  responseId: string;
  pendingApprovalCount: number;
};

type TurnLogKind = 'send' | 'recover' | 'approval' | 'auto_approval';

function latestUserRequest(items: ConversationItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'message' && item.role === 'user') {
      return item.text;
    }
  }
  return '(approval continuation)';
}

function groupApprovalItemsByResponse(
  items: ApprovalItem[],
): Map<string, ApprovalItem[]> {
  const groups = new Map<string, ApprovalItem[]>();
  for (const item of items) {
    const existing = groups.get(item.sourceResponseId);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.sourceResponseId, [item]);
    }
  }
  return groups;
}

function findRecoverableAssistantTurn(
  items: ConversationItem[],
): RecoverableAssistantTurn | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item?.kind === 'message' &&
      item.role === 'assistant' &&
      item.process?.status === 'running' &&
      item.responseId
    ) {
      return { messageId: item.id, responseId: item.responseId };
    }
  }
  return null;
}

function logTurnStart(args: {
  kind: TurnLogKind;
  ctx: RenderItemFormSidebarCtx;
  requestLength: number;
  historyLength?: number;
  snapshotJson?: string;
  scopedFieldCount: number;
  hasPreviousResponseId?: boolean;
  decisionCount?: number;
}) {
  dlog('Turn', 'turn:start', {
    kind: args.kind,
    requestLength: args.requestLength,
    historyLength: args.historyLength ?? null,
    siteId: args.ctx.site.id,
    environment: args.ctx.environment,
    record: {
      hasRecord: Boolean(args.ctx.item),
      itemId: args.ctx.item?.id ?? null,
      itemType: args.ctx.itemType.attributes.api_key,
    },
    scopedFieldCount: args.scopedFieldCount,
    hasPreviousResponseId: Boolean(args.hasPreviousResponseId),
    decisionCount: args.decisionCount ?? 0,
    snapshot: snapshotStats(args.snapshotJson),
  });
}

function logTurnDone(args: {
  kind: TurnLogKind;
  startedAt: number;
  responseId: string;
  replyText: string;
  pendingApprovalCount: number;
  trace: ProcessTrace;
}) {
  const payload = {
    kind: args.kind,
    durationMs: Date.now() - args.startedAt,
    responseId: args.responseId,
    replyLength: args.replyText.length,
    pendingApprovalCount: args.pendingApprovalCount,
    mcpActions: summarizeMcpActions(args.trace),
    firstProblem: firstProblemAction(args.trace),
    missingMethodTokens: missingMethodTokenHints(args.trace),
    recentReasoning: recentReasoningSummary(args.trace),
  };
  dlog(
    'Turn',
    finalReplyLooksBlocked(args.trace, args.replyText)
      ? 'turn:blocked'
      : 'turn:done',
    payload,
  );
}

function logTurnError(args: {
  kind: TurnLogKind;
  startedAt: number;
  error: unknown;
  trace: ProcessTrace;
}) {
  const message =
    args.error instanceof Error ? args.error.message : String(args.error);
  dlog('Turn', 'turn:error', {
    kind: args.kind,
    durationMs: Date.now() - args.startedAt,
    error: previewText(message),
    authLike: isLikelyMcpAuthError(args.error),
    mcpActions: summarizeMcpActions(args.trace),
    firstProblem: firstProblemAction(args.trace),
    missingMethodTokens: missingMethodTokenHints(args.trace),
    recentReasoning: recentReasoningSummary(args.trace),
  });
}

function snapshotStats(snapshotJson: string | undefined): {
  chars: number;
  isFormDirty: boolean | null;
  dirtyFieldCount: number | null;
  writeBlockerCount: number | null;
} {
  if (!snapshotJson) {
    return {
      chars: 0,
      isFormDirty: null,
      dirtyFieldCount: null,
      writeBlockerCount: null,
    };
  }

  try {
    const parsed = JSON.parse(snapshotJson) as unknown;
    const live =
      parsed && typeof parsed === 'object' && 'live' in parsed
        ? (parsed as { live?: unknown }).live
        : null;
    const liveObject =
      live && typeof live === 'object' ? (live as Record<string, unknown>) : {};
    const dirtyFields = liveObject.dirty_fields;
    const writeBlockers = liveObject.write_blockers;
    return {
      chars: snapshotJson.length,
      isFormDirty:
        typeof liveObject.is_form_dirty === 'boolean'
          ? liveObject.is_form_dirty
          : null,
      dirtyFieldCount:
        dirtyFields && typeof dirtyFields === 'object'
          ? Object.keys(dirtyFields).length
          : null,
      writeBlockerCount: Array.isArray(writeBlockers)
        ? writeBlockers.length
        : null,
    };
  } catch {
    return {
      chars: snapshotJson.length,
      isFormDirty: null,
      dirtyFieldCount: null,
      writeBlockerCount: null,
    };
  }
}

function summarizeMcpActions(trace: ProcessTrace): Array<{
  kind: ProcessEntry['kind'];
  status: ProcessEntry['status'];
  toolName?: string;
  problem?: string;
}> {
  return trace.entries
    .filter(
      (entry) =>
        entry.kind === 'mcp_list' ||
        entry.kind === 'mcp_call' ||
        entry.kind === 'approval',
    )
    .slice(-10)
    .map((entry) => ({
      kind: entry.kind,
      status: entry.status,
      ...(entry.toolName ? { toolName: entry.toolName } : {}),
      ...problemPreviewForEntry(entry),
    }));
}

function firstProblemAction(trace: ProcessTrace): {
  toolName?: string;
  status: ProcessEntry['status'];
  problem: string;
} | null {
  for (const entry of trace.entries) {
    if (
      entry.kind !== 'mcp_call' &&
      entry.kind !== 'mcp_list' &&
      entry.kind !== 'error'
    ) {
      continue;
    }
    const problem = problemPreviewForEntry(entry).problem;
    if (problem) {
      return {
        ...(entry.toolName ? { toolName: entry.toolName } : {}),
        status: entry.status,
        problem,
      };
    }
  }
  return null;
}

function problemPreviewForEntry(entry: ProcessEntry): { problem?: string } {
  if (entry.error) return { problem: previewText(entry.error) };
  if (entry.status === 'failed') return { problem: entry.title };
  if (entry.output && outputLooksLikeProblem(entry.output)) {
    return { problem: previewText(entry.output) };
  }
  return {};
}

function outputLooksLikeProblem(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('script saved, but') ||
    lower.includes('client calls are unverified') ||
    lower.includes('validation errors') ||
    lower.includes('execution failed') ||
    lower.includes('compilation failed') ||
    lower.includes('no matching verification token') ||
    lower.includes('method_tokens')
  );
}

function missingMethodTokenHints(trace: ProcessTrace): string[] {
  const names = new Set<string>();
  for (const entry of trace.entries) {
    const text = `${entry.error ?? ''}\n${entry.output ?? ''}`;
    if (!/method_tokens|verification token|unverified/i.test(text)) continue;
    const matches = text.matchAll(
      /client\.([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)/g,
    );
    for (const match of matches) {
      const resource = match[1];
      const method = match[2];
      if (resource && method) names.add(`${resource}.${method}`);
    }
  }
  return [...names].slice(0, 8);
}

function recentReasoningSummary(trace: ProcessTrace): string | null {
  for (let index = trace.entries.length - 1; index >= 0; index -= 1) {
    const entry = trace.entries[index];
    if (entry?.kind === 'reasoning' && entry.text?.trim()) {
      return previewText(entry.text.trim(), 800);
    }
  }
  return null;
}

function finalReplyLooksBlocked(
  trace: ProcessTrace,
  replyText: string,
): boolean {
  if (trace.status === 'failed' || trace.status === 'interrupted') return true;
  if (replyText.length === 0 && firstProblemAction(trace)) return true;
  const lower = replyText.toLowerCase();
  if (
    firstProblemAction(trace) &&
    (lower.includes('cannot complete') ||
      lower.includes('can’t complete') ||
      lower.includes("can't complete") ||
      lower.includes('unable to complete') ||
      lower.includes('could not complete') ||
      lower.includes("couldn't complete") ||
      lower.includes('blocked'))
  ) {
    return true;
  }
  const finalErrors = trace.entries.filter((entry) => entry.kind === 'error');
  return finalErrors.length > 0;
}

function previewText(value: string, maxLength = 500): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength)}…`;
}

function resolveStateUpdate<T>(update: StateUpdate<T>, previous: T): T {
  if (typeof update === 'function') {
    return (update as (value: T) => T)(previous);
  }
  return update;
}

function buildSidebarHistoryScope(
  ctx: RenderItemFormSidebarCtx,
): SidebarHistoryScope {
  const itemId = ctx.item?.id ?? null;
  const keyParts = {
    pluginId: ctx.plugin.id,
    siteId: ctx.site.id,
    environment: ctx.environment,
    itemTypeId: ctx.itemType.id,
    itemId: itemId ?? 'new',
  };
  const legacySessionKey = buildLegacySidebarSessionKey(keyParts);

  if (!itemId) {
    return {
      scopeKey: `temporary:${legacySessionKey}`,
      historyKey: null,
      legacySessionKey,
      savedRecord: false,
    };
  }

  const historyKey = buildSidebarChatHistoryKey({ ...keyParts, itemId });
  return {
    scopeKey: historyKey,
    historyKey,
    legacySessionKey,
    savedRecord: true,
  };
}

function createTemporarySidebarHistory(): SidebarChatHistory {
  return addSidebarChatThread(
    createEmptySidebarChatHistory(),
    createSidebarChatThread(),
  );
}

function buildSidebarViewStateKey(scope: SidebarHistoryScope): string {
  return `${scope.scopeKey}:view:v1`;
}

function readSidebarViewState(
  scope: SidebarHistoryScope,
  history: SidebarChatHistory,
): SidebarView {
  if (!scope.savedRecord) return 'chat';

  try {
    const stored = window.sessionStorage.getItem(
      buildSidebarViewStateKey(scope),
    );
    if (stored === 'chat' && history.activeThreadId) return 'chat';
    if (stored === 'list') return 'list';
  } catch {
    return 'list';
  }

  return 'list';
}

function writeSidebarViewState(
  scope: SidebarHistoryScope,
  view: SidebarView,
): void {
  if (!scope.savedRecord) return;

  try {
    window.sessionStorage.setItem(buildSidebarViewStateKey(scope), view);
  } catch {
    // Nothing useful to recover here.
  }
}

function loadSidebarState(scope: SidebarHistoryScope): LoadedSidebarState {
  if (!scope.historyKey) {
    return { history: createTemporarySidebarHistory(), view: 'chat' };
  }

  const history = readSidebarChatHistory(
    scope.historyKey,
    scope.legacySessionKey,
  );

  return {
    history,
    view: readSidebarViewState(scope, history),
  };
}

function UnsavedRecordNotice() {
  return (
    <SidebarFrame>
      <BlankSlate
        placement="area"
        small
        icon={<RecordIcon />}
        title="Save the record first"
        description="Chat works on records that were saved at least once."
      />
    </SidebarFrame>
  );
}

function SetupNotice({ ctx }: Props) {
  return (
    <SidebarFrame>
      <BlankSlate
        placement="area"
        small
        icon={<SettingsIcon />}
        title="Prompt Dato isn't set up"
        description="Connect to DatoCMS and add an API key for a chat provider in the plugin settings."
        actions={
          <Button
            tone="primary"
            label="Open plugin settings"
            to={pluginSettingsPath(ctx)}
          />
        }
      />
    </SidebarFrame>
  );
}

/**
 * The title of an open chat. A long title ends with an ellipsis: its full
 * text then shows in a tooltip.
 */
function ChatTitle({ title }: { title: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const { width } = useElementLayout(textRef);
  const [isCut, setIsCut] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is measured again when it or its width changes
  useLayoutEffect(() => {
    const element = textRef.current;
    setIsCut(element ? element.scrollWidth > element.clientWidth : false);
  }, [title, width]);

  return (
    <Toolbar.Title>
      <Tooltip label={isCut ? title : null} placement="bottom-start">
        <span ref={textRef} className={s.chatTitle}>
          {title}
        </span>
      </Tooltip>
    </Toolbar.Title>
  );
}

type ChatHeaderProps = {
  /** The open chat, or null before the first message of a new one */
  thread: SidebarChatThread | null;
  isSending: boolean;
  onBack: () => void;
  onDelete: () => unknown;
  onNewChat: () => void;
};

/**
 * The bar of an open chat: back to the list, the title, the "⋮" with the
 * delete, and a new chat. Leaving the chat waits for the reply to finish,
 * because the reply writes to this chat.
 */
function ChatHeader({
  thread,
  isSending,
  onBack,
  onDelete,
  onNewChat,
}: ChatHeaderProps) {
  const waitForReply = isSending ? WAIT_FOR_REPLY : undefined;
  // An empty chat has nothing to delete: Back removes it
  const canDelete = thread !== null && !isSidebarThreadEmpty(thread);
  const title = thread?.title ?? 'New chat';

  return (
    <Toolbar>
      {!isSending && (
        <Toolbar.GoBack onClick={onBack} ariaLabel="Back to chats" />
      )}
      <ChatTitle title={title} />
      <Toolbar.DotsDropdown hidden={!canDelete} label={`Actions for ${title}`}>
        <Dropdown.Option
          alert
          disabled={waitForReply}
          onPick={() => {
            void onDelete();
          }}
        >
          Delete chat
        </Dropdown.Option>
      </Toolbar.DotsDropdown>
      <Toolbar.Space />
      <Toolbar.Button
        icon={AddIcon}
        label="New chat"
        disabled={waitForReply}
        onClick={onNewChat}
      />
    </Toolbar>
  );
}

function PromptSidebarChat({ ctx }: Props) {
  const currentItemId = ctx.item?.id ?? null;
  // ctx is a new object on every render: the scope changes only with these ids
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  const sidebarScope = useMemo(
    () => buildSidebarHistoryScope(ctx),
    [
      ctx.plugin.id,
      ctx.site.id,
      ctx.environment,
      ctx.itemType.id,
      currentItemId,
    ],
  );
  const [initialSidebarState] = useState(() => loadSidebarState(sidebarScope));
  const [history, setHistory] = useState<SidebarChatHistory>(
    initialSidebarState.history,
  );
  const [historyScopeKey, setHistoryScopeKey] = useState(sidebarScope.scopeKey);
  const [view, setView] = useState<SidebarView>(initialSidebarState.view);
  const [isSending, setIsSending] = useState(false);
  const [autoApproveEdits, setAutoApproveEdits] = useState(false);
  const [draftTextByThreadId, setDraftTextByThreadId] = useState<
    Record<string, string>
  >({});
  const messagesRef = useRef<HTMLDivElement>(null);
  // Opens the field picker from code, when the user types `@`
  const fieldPickerRef = useRef<DropdownHandle>(null);
  const ctxRef = useRef(ctx);
  // Mirrored ref: async drain loops read this without React closure staleness.
  const autoApproveRef = useRef(false);
  const activeThreadIdRef = useRef<string | null>(
    initialSidebarState.view === 'chat'
      ? initialSidebarState.history.activeThreadId
      : null,
  );
  const historyRef = useRef<SidebarChatHistory>(initialSidebarState.history);
  const loadedScopeKeyRef = useRef(sidebarScope.scopeKey);
  const recoveringResponseIdsRef = useRef<Set<string>>(new Set());
  const skipNextPersistRef = useRef(false);
  ctxRef.current = ctx;
  historyRef.current = history;

  const params = readParams(ctx);
  const configured = isFullyConfigured(params);
  const configuredProvider = params.provider ?? 'current';
  const configuredApiKey = getProviderApiKey(params);
  const configuredModel = getProviderMainModel(params);
  const configuredReasoningEffort =
    params.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const supportsWriteApprovals = configuredProvider === 'current';
  setDebugEnabled(params.debugMode === true);

  useEffect(() => {
    clearRemovedDiagnosticsStore({
      pluginId: ctx.plugin.id,
      siteId: ctx.site.id,
      environment: ctx.environment,
    });
  }, [ctx.environment, ctx.plugin.id, ctx.site.id]);

  const activeThreadId = view === 'chat' ? history.activeThreadId : null;
  const activeThread = useMemo(
    () =>
      activeThreadId
        ? (history.threads.find((thread) => thread.id === activeThreadId) ??
          null)
        : null,
    [activeThreadId, history.threads],
  );
  const conversation = activeThread?.conversation ?? [];
  const activityMessages = useMemo(
    () =>
      conversation.flatMap((item) =>
        item.kind === 'message' && item.role === 'assistant' && item.process
          ? [{ id: item.id, process: item.process }]
          : [],
      ),
    [conversation],
  );
  const { isActivityOpen, toggleActivity } =
    useActivityTimeline(activityMessages);
  const conversationRef = useRef<ConversationItem[]>(conversation);
  conversationRef.current = conversation;
  const text = activeThreadId
    ? (draftTextByThreadId[activeThreadId] ?? '')
    : '';
  const scopedFieldIds = activeThread?.scopedFieldIds ?? [];
  const lastResponseId = activeThread?.lastResponseId ?? null;
  const isChatView = view === 'chat';
  const showHistoryList =
    configured && sidebarScope.savedRecord && view === 'list';
  const localeKey = ctx.site.attributes.locales.join(LOCALE_KEY_SEPARATOR);
  const siteLocales = useMemo(
    () => (localeKey.length > 0 ? localeKey.split(LOCALE_KEY_SEPARATOR) : []),
    [localeKey],
  );

  useEffect(() => {
    autoApproveRef.current = autoApproveEdits;
  }, [autoApproveEdits]);

  useEffect(() => {
    if (supportsWriteApprovals) return;
    autoApproveRef.current = false;
    setAutoApproveEdits(false);
  }, [supportsWriteApprovals]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const firstName = resolveFirstName(ctx);

  const resetTransientChatState = useCallback(() => {
    setAutoApproveEdits(false);
    autoApproveRef.current = false;
  }, []);

  useEffect(() => {
    if (loadedScopeKeyRef.current === sidebarScope.scopeKey) return;

    const loaded = loadSidebarState(sidebarScope);
    loadedScopeKeyRef.current = sidebarScope.scopeKey;
    skipNextPersistRef.current = true;
    setHistory(loaded.history);
    setHistoryScopeKey(sidebarScope.scopeKey);
    setView(loaded.view);
    setIsSending(false);
    setDraftTextByThreadId({});
    resetTransientChatState();
  }, [sidebarScope, resetTransientChatState]);

  useEffect(() => {
    if (!sidebarScope.historyKey) return;
    if (loadedScopeKeyRef.current !== sidebarScope.scopeKey) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    const { historyKey } = sidebarScope;
    let flushed = false;
    const flush = () => {
      if (flushed) return;
      flushed = true;
      writeSidebarChatHistory(historyKey, history);
    };
    const timeout = window.setTimeout(flush, 200);
    return () => {
      window.clearTimeout(timeout);
      flush();
    };
  }, [history, sidebarScope]);

  useEffect(() => {
    const flushCurrentHistory = () => {
      if (!sidebarScope.historyKey) return;
      if (loadedScopeKeyRef.current !== sidebarScope.scopeKey) return;
      writeSidebarChatHistory(sidebarScope.historyKey, historyRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushCurrentHistory();
    };
    window.addEventListener('pagehide', flushCurrentHistory);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushCurrentHistory);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushCurrentHistory();
    };
  }, [sidebarScope]);

  useEffect(() => {
    if (loadedScopeKeyRef.current !== sidebarScope.scopeKey) return;
    writeSidebarViewState(sidebarScope, view);
  }, [sidebarScope, view]);

  useEffect(() => {
    if (view === 'chat' && history.activeThreadId && !activeThread) {
      setView('list');
    }
  }, [activeThread, history.activeThreadId, view]);

  const updateActiveThread = useCallback(
    (updater: (thread: SidebarChatThread) => SidebarChatThread) => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;

      setHistory((previous) =>
        updateSidebarChatThread(previous, threadId, (thread) => ({
          ...updater(thread),
          updatedAt: Date.now(),
        })),
      );
    },
    [],
  );

  const setConversation = useCallback(
    (update: StateUpdate<ConversationItem[]>) => {
      updateActiveThread((thread) => ({
        ...thread,
        conversation: resolveStateUpdate(update, thread.conversation),
      }));
    },
    [updateActiveThread],
  );

  const clearDraftForThread = useCallback((threadId: string | null) => {
    if (!threadId) return;
    setDraftTextByThreadId((previous) => {
      if (!Object.hasOwn(previous, threadId)) return previous;
      const next = { ...previous };
      delete next[threadId];
      return next;
    });
  }, []);

  const setText = useCallback((update: StateUpdate<string>) => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;

    setDraftTextByThreadId((previous) => {
      const previousText = previous[threadId] ?? '';
      const nextText = resolveStateUpdate(update, previousText);
      if (nextText === previousText) return previous;
      if (nextText.length === 0) {
        const next = { ...previous };
        delete next[threadId];
        return next;
      }
      return { ...previous, [threadId]: nextText };
    });
  }, []);

  const setScopedFieldIds = useCallback(
    (update: StateUpdate<string[]>) => {
      updateActiveThread((thread) => ({
        ...thread,
        scopedFieldIds: resolveStateUpdate(update, thread.scopedFieldIds),
      }));
    },
    [updateActiveThread],
  );

  const setLastResponseId = useCallback(
    (update: StateUpdate<string | null>) => {
      updateActiveThread((thread) => ({
        ...thread,
        lastResponseId: resolveStateUpdate(update, thread.lastResponseId),
      }));
    },
    [updateActiveThread],
  );

  const applyStreamEventToMessage = useCallback(
    (messageId: string, event: TurnStreamEvent) => {
      setConversation((prev) =>
        prev.map((item) => {
          if (
            item.kind !== 'message' ||
            item.role !== 'assistant' ||
            item.id !== messageId
          ) {
            return item;
          }

          return {
            ...item,
            ...(event.kind === 'response_started'
              ? { responseId: event.responseId }
              : {}),
            text:
              event.kind === 'text_delta'
                ? `${item.text}${event.delta}`
                : item.text,
            process: applyTurnStreamEvent(item.process, event),
          };
        }),
      );
    },
    [setConversation],
  );

  const finishAssistantProcess = useCallback(
    (messageId: string, textOverride?: string, emptyFallback = true) => {
      setConversation((prev) =>
        prev.map((item) => {
          if (
            item.kind !== 'message' ||
            item.role !== 'assistant' ||
            item.id !== messageId
          ) {
            return item;
          }

          const nextText =
            textOverride && textOverride.trim().length > 0
              ? textOverride.trim()
              : item.text.trim().length > 0
                ? item.text
                : emptyFallback
                  ? '(empty response)'
                  : item.text;

          return {
            ...item,
            text: nextText,
            process: finishProcessTrace(item.process),
          };
        }),
      );
    },
    [setConversation],
  );

  const failAssistantProcess = useCallback(
    (messageId: string | null, message: string) => {
      if (!messageId) return;
      setConversation((prev) =>
        prev.map((item) => {
          if (
            item.kind !== 'message' ||
            item.role !== 'assistant' ||
            item.id !== messageId
          ) {
            return item;
          }
          return {
            ...item,
            process: failProcessTrace(item.process, message),
          };
        }),
      );
    },
    [setConversation],
  );

  const markApprovalInProcess = useCallback(
    (
      approvalRequestId: string,
      approve: boolean,
      options?: { continueRunning?: boolean },
    ) => {
      setConversation((prev) =>
        prev.map((item) =>
          item.kind === 'message' && item.process
            ? {
                ...item,
                process:
                  markProcessTraceDecision(
                    item.process,
                    approvalRequestId,
                    approve,
                    options,
                  ) ?? item.process,
              }
            : item,
        ),
      );
    },
    [setConversation],
  );

  // ctx.fields is a stable reference within a render of this hook; rebuild
  // only when the model changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  const allFields = useMemo<FieldInfo[]>(
    () => listFieldsForCurrentItemType(ctx),
    [ctx.itemType.id],
  );

  const handleScrollToField = useCallback(
    async (target: FieldNavigationTarget) => {
      const currentCtx = ctxRef.current;

      try {
        const recordId = currentCtx.item?.id;

        if (!recordId) {
          await currentCtx.scrollToField(
            target.fieldPath,
            target.localized ? (target.locale ?? currentCtx.locale) : undefined,
          );
          return;
        }

        if (target.localized) {
          const effectiveLocale = target.locale ?? currentCtx.locale;
          const localizedTarget = {
            ...target,
            locale: effectiveLocale,
          };

          await currentCtx.scrollToField(
            localizedTarget.fieldPath,
            effectiveLocale,
          );
          await currentCtx.navigateTo(
            `${buildRecordEditPath(
              currentCtx,
              currentCtx.itemType.id,
              recordId,
            )}#fieldPath=${getHashFieldPath(localizedTarget)}`,
          );
          return;
        }

        await currentCtx.navigateTo(
          `${buildRecordEditPath(
            currentCtx,
            currentCtx.itemType.id,
            recordId,
          )}#fieldPath=${target.fieldPath}`,
        );
      } catch {
        // Field navigation is best-effort.
      }
    },
    [],
  );

  const scopedFields = useMemo(
    () =>
      scopedFieldIds
        .map((id) => allFields.find((f) => f.id === id))
        .filter((f): f is FieldInfo => Boolean(f)),
    [scopedFieldIds, allFields],
  );

  const unscopedFields = useMemo(
    () => allFields.filter((f) => !scopedFieldIds.includes(f.id)),
    [allFields, scopedFieldIds],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the log scrolls to the last message on every change of the conversation
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversation]);

  const handleChange = (next: string | null) => {
    const value = next ?? '';
    setText(value);

    // Open the field picker when the user types `@` either at the start of
    // the input or right after whitespace.
    if (
      value.endsWith('@') &&
      (value.length === 1 || /\s@$/.test(value)) &&
      unscopedFields.length > 0
    ) {
      fieldPickerRef.current?.open();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (text.trim() && !isSending) handleSend();
    }
  };

  const drainResult = async (
    initial: SendChatTurnResult,
    draftId: string,
    onStreamEvent: (event: TurnStreamEvent) => void,
    onApprovalDecision: (
      approvalRequestId: string,
      approve: boolean,
      options?: { continueRunning?: boolean },
    ) => void,
  ): Promise<DrainResult> => {
    let result: SendChatTurnResult = initial;

    const insertAfterDraft = (items: ConversationItem[]) => {
      if (items.length === 0) return;
      setConversation((prev) => {
        const idx = prev.findIndex((item) => item.id === draftId);
        if (idx < 0) return [...prev, ...items];
        const next = [...prev];
        next.splice(idx + 1, 0, ...items);
        return next;
      });
    };

    while (true) {
      setLastResponseId(result.responseId);

      const autoApprove =
        autoApproveRef.current && result.pendingApprovals.length > 0;

      if (!autoApprove) {
        insertAfterDraft(
          result.pendingApprovals.map((approval) =>
            buildApprovalItem(approval, result.responseId),
          ),
        );
      }

      const decisions = autoApprove
        ? result.pendingApprovals.map((approval) => ({
            approvalRequestId: approval.approvalRequestId,
            approve: true,
          }))
        : [];

      const willContinue = decisions.length > 0;
      for (const decision of decisions) {
        markApprovalInProcess(decision.approvalRequestId, decision.approve, {
          continueRunning: willContinue,
        });
        onApprovalDecision(decision.approvalRequestId, decision.approve, {
          continueRunning: willContinue,
        });
      }

      if (!willContinue) {
        finishAssistantProcess(
          draftId,
          result.text,
          result.pendingApprovals.length === 0,
        );
        return {
          text: result.text,
          responseId: result.responseId,
          pendingApprovalCount: result.pendingApprovals.length,
        };
      }

      result = await submitToolResponses({
        provider: configuredProvider,
        apiKey: configuredApiKey,
        model: configuredModel,
        reasoningEffort: configuredReasoningEffort,
        datoAccessToken: params.datoAccessToken as string,
        recordId: ctx.item?.id ?? null,
        previousResponseId: result.responseId,
        decisions,
        onStreamEvent,
      });
    }
  };

  const recordTurnError = (error: unknown, draftId: string | null) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const reauth = isLikelyMcpAuthError(error);
    failAssistantProcess(draftId, message);
    const errorItem: ConversationItem = {
      kind: 'error',
      id: generateMessageId(),
      message,
      reauth,
    };
    setConversation((prev) => [...prev, errorItem]);
  };

  const interruptAssistantProcess = useCallback(
    (messageId: string, message: string) => {
      setConversation((prev) =>
        prev.map((item) => {
          if (
            item.kind !== 'message' ||
            item.role !== 'assistant' ||
            item.id !== messageId
          ) {
            return item;
          }

          return {
            ...item,
            text: item.text.trim() ? item.text : message,
            process: interruptProcessTrace(item.process, message),
          };
        }),
      );
    },
    [setConversation],
  );

  const sweepOrphanPending = () => {
    setConversation((prev) => {
      const filtered = prev.filter((item) => item.kind !== 'pending');
      return filtered;
    });
  };

  const settleRunningAssistantProcesses = () => {
    setConversation((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (
          item.kind !== 'message' ||
          item.role !== 'assistant' ||
          !item.process ||
          item.process.status !== 'running'
        ) {
          return item;
        }

        changed = true;
        return {
          ...item,
          process: finishProcessTrace(item.process),
        };
      });

      return changed ? next : prev;
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: this only runs when a restored thread becomes active
  useEffect(() => {
    if (!isChatView || !activeThreadId) return;
    if (historyScopeKey !== sidebarScope.scopeKey) return;

    const turn = findRecoverableAssistantTurn(conversationRef.current);
    if (!turn) return;

    if (!configured || configuredProvider !== 'current' || !configuredApiKey) {
      interruptAssistantProcess(turn.messageId, INTERRUPTED_TURN_MESSAGE);
      return;
    }

    if (recoveringResponseIdsRef.current.has(turn.responseId)) return;
    recoveringResponseIdsRef.current.add(turn.responseId);

    const controller = new AbortController();
    const turnRequestLabel = `${latestUserRequest(
      conversationRef.current,
    )}\n\nRecovered after editor reload`;
    const turnStartedAt = Date.now();
    let turnTrace = createProcessTrace();
    const handleStreamEvent = (event: TurnStreamEvent) => {
      turnTrace = applyTurnStreamEvent(turnTrace, event);
      applyStreamEventToMessage(turn.messageId, event);
    };
    const markTurnApproval = (
      approvalRequestId: string,
      approve: boolean,
      options?: { continueRunning?: boolean },
    ) => {
      turnTrace =
        markProcessTraceDecision(
          turnTrace,
          approvalRequestId,
          approve,
          options,
        ) ?? turnTrace;
    };

    setIsSending(true);
    logTurnStart({
      kind: 'recover',
      ctx,
      requestLength: turnRequestLabel.length,
      historyLength: conversationRef.current.length,
      scopedFieldCount: scopedFields.length,
      hasPreviousResponseId: true,
    });
    void (async () => {
      try {
        const result = await recoverChatTurn({
          apiKey: configuredApiKey,
          responseId: turn.responseId,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        for (const approval of result.pendingApprovals) {
          handleStreamEvent({ kind: 'approval_request', approval });
        }

        const finalReply = await drainResult(
          result,
          turn.messageId,
          handleStreamEvent,
          markTurnApproval,
        );
        if (controller.signal.aborted) return;

        turnTrace = finishProcessTrace(turnTrace);
        logTurnDone({
          kind: 'recover',
          startedAt: turnStartedAt,
          responseId: finalReply.responseId,
          replyText: finalReply.text,
          pendingApprovalCount: finalReply.pendingApprovalCount,
          trace: turnTrace,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error ? error.message : 'Unknown error';
        if (turnTrace.status !== 'failed') {
          turnTrace = failProcessTrace(turnTrace, message);
        }
        logTurnError({
          kind: 'recover',
          startedAt: turnStartedAt,
          error,
          trace: turnTrace,
        });
        interruptAssistantProcess(turn.messageId, INTERRUPTED_TURN_MESSAGE);
      } finally {
        recoveringResponseIdsRef.current.delete(turn.responseId);
        if (!controller.signal.aborted) {
          setIsSending(false);
          sweepOrphanPending();
          settleRunningAssistantProcesses();
        }
      }
    })();

    return () => controller.abort();
  }, [
    activeThreadId,
    configured,
    configuredApiKey,
    configuredProvider,
    historyScopeKey,
    isChatView,
    sidebarScope.scopeKey,
  ]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    if (!activeThread) return;
    if (!configured) {
      ctx.navigateTo(pluginSettingsPath(ctx));
      return;
    }

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      text: trimmed,
    };
    const draftId = generateMessageId();

    updateActiveThread((thread) => ({
      ...thread,
      title:
        thread.conversation.length === 0
          ? getSidebarThreadTitle(trimmed)
          : thread.title,
      conversation: [
        ...thread.conversation,
        { ...userMessage, kind: 'message' as const },
        {
          kind: 'message' as const,
          id: draftId,
          role: 'assistant' as const,
          text: '',
          process: createProcessTrace(),
        },
      ],
      text: '',
    }));
    setText('');
    setIsSending(true);
    const turnStartedAt = Date.now();
    let turnTrace = createProcessTrace();
    const handleStreamEvent = (event: TurnStreamEvent) => {
      turnTrace = applyTurnStreamEvent(turnTrace, event);
      applyStreamEventToMessage(draftId, event);
    };
    const markTurnApproval = (
      approvalRequestId: string,
      approve: boolean,
      options?: { continueRunning?: boolean },
    ) => {
      turnTrace =
        markProcessTraceDecision(
          turnTrace,
          approvalRequestId,
          approve,
          options,
        ) ?? turnTrace;
    };

    try {
      const messageHistory: ChatMessage[] = [
        ...conversation.flatMap<ChatMessage>((item) =>
          item.kind === 'message'
            ? [{ id: item.id, role: item.role, text: item.text }]
            : [],
        ),
        userMessage,
      ];

      const snapshot = await buildRecordContext(ctx);
      logTurnStart({
        kind: 'send',
        ctx,
        requestLength: trimmed.length,
        historyLength: messageHistory.length,
        snapshotJson: snapshot.json,
        scopedFieldCount: scopedFields.length,
        hasPreviousResponseId: Boolean(
          configuredProvider === 'current' && lastResponseId,
        ),
      });

      const request = {
        provider: configuredProvider,
        apiKey: configuredApiKey,
        model: configuredModel,
        reasoningEffort: configuredReasoningEffort,
        datoAccessToken: params.datoAccessToken as string,
        history: messageHistory,
        recordId: ctx.item?.id ?? null,
        previousResponseId:
          configuredProvider === 'current'
            ? (lastResponseId ?? undefined)
            : undefined,
        onStreamEvent: handleStreamEvent,
      };

      let result: SendChatTurnResult;
      try {
        result = await sendChatTurn(request);
      } catch (error) {
        if (!lastResponseId || !isLikelyPreviousResponseError(error)) {
          throw error;
        }

        setLastResponseId(null);
        result = await sendChatTurn({
          ...request,
          previousResponseId: undefined,
        });
      }

      const finalReply = await drainResult(
        result,
        draftId,
        handleStreamEvent,
        markTurnApproval,
      );
      turnTrace = finishProcessTrace(turnTrace);
      logTurnDone({
        kind: 'send',
        startedAt: turnStartedAt,
        responseId: finalReply.responseId,
        replyText: finalReply.text,
        pendingApprovalCount: finalReply.pendingApprovalCount,
        trace: turnTrace,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (turnTrace.status !== 'failed') {
        turnTrace = failProcessTrace(turnTrace, message);
      }
      logTurnError({
        kind: 'send',
        startedAt: turnStartedAt,
        error,
        trace: turnTrace,
      });
      recordTurnError(error, draftId);
    } finally {
      setIsSending(false);
      sweepOrphanPending();
      settleRunningAssistantProcesses();
    }
  };

  const setApprovalState = (
    approvalRequestId: string,
    mutator: (item: ApprovalItem) => ApprovalItem,
  ) => {
    setConversation((prev) =>
      prev.map((item) =>
        item.kind === 'approval' && item.approvalRequestId === approvalRequestId
          ? mutator(item)
          : item,
      ),
    );
  };

  const resolveApproval = async (
    approvalRequestId: string,
    approve: boolean,
  ) => {
    if (!supportsWriteApprovals) return;
    if (isSending) return;
    const approvalItem = conversation.find(
      (item): item is ApprovalItem =>
        item.kind === 'approval' &&
        item.approvalRequestId === approvalRequestId,
    );
    if (!approvalItem) return;

    setApprovalState(approvalRequestId, (item) => ({
      ...item,
      state: 'submitting',
    }));
    setIsSending(true);
    const draftId = generateMessageId();
    const turnRequestLabel = `${latestUserRequest(
      conversation,
    )}\n\nApproval decision: ${approve ? 'approved' : 'denied'} ${
      approvalItem.toolName
    }`;
    const turnStartedAt = Date.now();
    let turnTrace = createProcessTrace();
    const handleStreamEvent = (event: TurnStreamEvent) => {
      turnTrace = applyTurnStreamEvent(turnTrace, event);
      applyStreamEventToMessage(draftId, event);
    };
    const markTurnApproval = (
      approvalRequestId: string,
      approved: boolean,
      options?: { continueRunning?: boolean },
    ) => {
      turnTrace =
        markProcessTraceDecision(
          turnTrace,
          approvalRequestId,
          approved,
          options,
        ) ?? turnTrace;
    };
    setConversation((prev) => [
      ...prev,
      {
        kind: 'message',
        id: draftId,
        role: 'assistant',
        text: '',
        process: createProcessTrace(),
      },
    ]);

    try {
      const snapshot = await buildRecordContext(ctx);
      logTurnStart({
        kind: 'approval',
        ctx,
        requestLength: turnRequestLabel.length,
        historyLength: conversation.length,
        snapshotJson: snapshot.json,
        scopedFieldCount: scopedFields.length,
        hasPreviousResponseId: true,
        decisionCount: 1,
      });
      const effectiveApprove =
        approve &&
        isUnsafeWriteApproval(approvalItem) &&
        snapshot.writeBlockers.length > 0
          ? false
          : approve;

      markApprovalInProcess(approvalRequestId, effectiveApprove);

      const result = await submitToolResponses({
        provider: configuredProvider,
        apiKey: configuredApiKey,
        model: configuredModel,
        reasoningEffort: configuredReasoningEffort,
        datoAccessToken: params.datoAccessToken as string,
        recordId: ctx.item?.id ?? null,
        previousResponseId: approvalItem.sourceResponseId,
        decisions: [{ approvalRequestId, approve: effectiveApprove }],
        onStreamEvent: handleStreamEvent,
      });

      setApprovalState(approvalRequestId, (item) => ({
        ...item,
        state: effectiveApprove ? 'approved' : 'denied',
      }));
      const finalReply = await drainResult(
        result,
        draftId,
        handleStreamEvent,
        markTurnApproval,
      );
      turnTrace = finishProcessTrace(turnTrace);
      logTurnDone({
        kind: 'approval',
        startedAt: turnStartedAt,
        responseId: finalReply.responseId,
        replyText: finalReply.text,
        pendingApprovalCount: finalReply.pendingApprovalCount,
        trace: turnTrace,
      });
    } catch (error) {
      setApprovalState(approvalRequestId, (item) => ({
        ...item,
        state: 'pending',
      }));
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (turnTrace.status !== 'failed') {
        turnTrace = failProcessTrace(turnTrace, message);
      }
      logTurnError({
        kind: 'approval',
        startedAt: turnStartedAt,
        error,
        trace: turnTrace,
      });
      recordTurnError(error, draftId);
    } finally {
      setIsSending(false);
      sweepOrphanPending();
      settleRunningAssistantProcesses();
    }
  };

  const toggleApprovalDetails = (approvalRequestId: string) => {
    setApprovalState(approvalRequestId, (item) => ({
      ...item,
      detailsOpen: !item.detailsOpen,
    }));
  };

  /**
   * Sweeps every pending approval already on screen, marks them submitting,
   * approves them as a client-side continuation, then removes them from the
   * conversation. Failures revert the items to `pending` so the user can
   * retry manually. Called when the user flips the toggle on.
   */
  const flushPendingApprovalsAuto = async () => {
    if (!supportsWriteApprovals) return;
    if (isSending) return;
    const pendingApprovalItems = conversation.flatMap<ApprovalItem>((item) =>
      item.kind === 'approval' && item.state === 'pending' ? [item] : [],
    );
    if (pendingApprovalItems.length === 0) return;

    const removedIds = new Set(pendingApprovalItems.map((it) => it.id));
    setConversation((prev) =>
      prev.map((item) =>
        item.kind === 'approval' && removedIds.has(item.id)
          ? { ...item, state: 'submitting' as ApprovalState }
          : item,
      ),
    );

    setIsSending(true);
    const draftId = generateMessageId();
    const turnStartedAt = Date.now();
    let turnTrace = createProcessTrace();
    const handleStreamEvent = (event: TurnStreamEvent) => {
      turnTrace = applyTurnStreamEvent(turnTrace, event);
      applyStreamEventToMessage(draftId, event);
    };
    const markTurnApproval = (
      approvalRequestId: string,
      approve: boolean,
      options?: { continueRunning?: boolean },
    ) => {
      turnTrace =
        markProcessTraceDecision(
          turnTrace,
          approvalRequestId,
          approve,
          options,
        ) ?? turnTrace;
    };
    setConversation((prev) => [
      ...prev,
      {
        kind: 'message',
        id: draftId,
        role: 'assistant',
        text: '',
        process: createProcessTrace(),
      },
    ]);

    try {
      logTurnStart({
        kind: 'auto_approval',
        ctx,
        requestLength: 0,
        historyLength: conversation.length,
        scopedFieldCount: scopedFields.length,
        hasPreviousResponseId: true,
        decisionCount: pendingApprovalItems.length,
      });

      const groups = groupApprovalItemsByResponse(pendingApprovalItems);
      let finalReplyText = '';
      let finalResponseId = '';
      for (const [sourceResponseId, items] of groups) {
        for (const item of items) {
          markApprovalInProcess(item.approvalRequestId, true);
        }
        const result = await submitToolResponses({
          provider: configuredProvider,
          apiKey: configuredApiKey,
          model: configuredModel,
          reasoningEffort: configuredReasoningEffort,
          datoAccessToken: params.datoAccessToken as string,
          recordId: ctx.item?.id ?? null,
          previousResponseId: sourceResponseId,
          decisions: items.map((it) => ({
            approvalRequestId: it.approvalRequestId,
            approve: true,
          })),
          onStreamEvent: handleStreamEvent,
        });
        const finalReply = await drainResult(
          result,
          draftId,
          handleStreamEvent,
          markTurnApproval,
        );
        if (finalReply.text.trim()) finalReplyText = finalReply.text;
        finalResponseId = finalReply.responseId;
      }
      turnTrace = finishProcessTrace(turnTrace);
      logTurnDone({
        kind: 'auto_approval',
        startedAt: turnStartedAt,
        responseId: finalResponseId,
        replyText: finalReplyText,
        pendingApprovalCount: 0,
        trace: turnTrace,
      });

      setConversation((prev) =>
        prev.filter(
          (item) => !(item.kind === 'approval' && removedIds.has(item.id)),
        ),
      );
    } catch (error) {
      setConversation((prev) =>
        prev.map((item) =>
          item.kind === 'approval' && removedIds.has(item.id)
            ? { ...item, state: 'pending' as ApprovalState }
            : item,
        ),
      );
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (turnTrace.status !== 'failed') {
        turnTrace = failProcessTrace(turnTrace, message);
      }
      logTurnError({
        kind: 'auto_approval',
        startedAt: turnStartedAt,
        error,
        trace: turnTrace,
      });
      recordTurnError(error, draftId);
    } finally {
      setIsSending(false);
      sweepOrphanPending();
      settleRunningAssistantProcesses();
    }
  };

  const handleAutoApproveClick = async () => {
    if (!supportsWriteApprovals) return;
    if (autoApproveEdits) {
      autoApproveRef.current = false;
      setAutoApproveEdits(false);
      return;
    }
    const confirmed = await ctx.openConfirm({
      title: 'Auto-approve every change?',
      content:
        'Changes run in your project without your review: creating, updating and deleting records, changing the schema and running scripts. Auto-approve stays on until you turn it off, go back to the chats, start or open another chat, or leave this record.',
      choices: [
        {
          label: 'Auto-approve changes',
          value: true,
          intent: 'negative',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    if (confirmed === true) {
      autoApproveRef.current = true;
      setAutoApproveEdits(true);
      await flushPendingApprovalsAuto();
    }
  };

  const hasPendingApproval =
    supportsWriteApprovals &&
    conversation.some(
      (item) => item.kind === 'approval' && item.state === 'pending',
    );

  const handleSuggestion = (prompt: string) => {
    setText(prompt);
    focusComposer();
  };

  const handleNewChat = () => {
    if (isSending) return;
    const thread = createSidebarChatThread();
    const currentEmptyThreadId =
      activeThread && isSidebarThreadEmpty(activeThread)
        ? activeThread.id
        : null;
    setHistory((previous) => {
      const currentThreadId = activeThreadIdRef.current;
      const currentThread = currentThreadId
        ? (previous.threads.find((item) => item.id === currentThreadId) ?? null)
        : null;
      const baseHistory =
        currentThread && isSidebarThreadEmpty(currentThread)
          ? removeSidebarChatThread(previous, currentThread.id)
          : previous;

      return addSidebarChatThread(baseHistory, thread);
    });
    clearDraftForThread(currentEmptyThreadId);
    setView('chat');
    resetTransientChatState();
    focusComposer();
  };

  const handleOpenThread = (threadId: string) => {
    if (isSending) return;
    setHistory((previous) => ({
      ...previous,
      activeThreadId: threadId,
    }));
    setView('chat');
    resetTransientChatState();
    focusComposer();
  };

  const handleBackToList = () => {
    if (isSending || !sidebarScope.savedRecord) return;
    if (activeThread && isSidebarThreadEmpty(activeThread)) {
      setHistory((previous) =>
        removeSidebarChatThread(previous, activeThread.id),
      );
      clearDraftForThread(activeThread.id);
    }
    setView('list');
    resetTransientChatState();
  };

  /** Asks, then removes the chat. Resolves to true when it was removed. */
  const handleDeleteThread = async (threadId: string): Promise<boolean> => {
    if (isSending) return false;

    const confirmed = await ctx.openConfirm({
      title: 'Delete this chat?',
      content: "It's removed from this browser. This can't be undone.",
      choices: [
        {
          label: 'Delete chat',
          value: true,
          intent: 'negative',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });

    if (confirmed === true) {
      setHistory((previous) => removeSidebarChatThread(previous, threadId));
      clearDraftForThread(threadId);
      resetTransientChatState();
      return true;
    }
    return false;
  };

  // The removal leaves no active thread, and the chat view does not leave by
  // itself in that case: go back to the list.
  const handleDeleteActiveThread = async () => {
    if (!activeThread) return;
    if (await handleDeleteThread(activeThread.id)) {
      setView('list');
    }
  };

  const handleClearAllChats = async () => {
    if (isSending || history.threads.length === 0) return;

    const confirmed = await ctx.openConfirm({
      title: 'Delete all chats?',
      content:
        "Every chat about this record is removed from this browser. This can't be undone.",
      choices: [
        {
          label: 'Delete all chats',
          value: true,
          intent: 'negative',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });

    if (confirmed === true) {
      setHistory(createEmptySidebarChatHistory());
      setDraftTextByThreadId({});
      resetTransientChatState();
    }
  };

  const addScope = (fieldId: string) => {
    setScopedFieldIds((prev) =>
      prev.includes(fieldId) ? prev : [...prev, fieldId],
    );
    // If the user opened the picker by typing `@`, strip the trailing `@`.
    setText((prev) => prev.replace(/@$/, '').trimEnd());
    focusComposer();
  };

  const removeScope = (fieldId: string) => {
    setScopedFieldIds((prev) => prev.filter((id) => id !== fieldId));
  };

  const showEmptyState = isChatView && configured && conversation.length === 0;
  const recordEditPath = recordEditPathOf(ctx);

  if (!configured) {
    return <SetupNotice ctx={ctx} />;
  }

  if (showHistoryList) {
    return (
      <SidebarFrame>
        <ChatList
          threads={history.threads}
          isSending={isSending}
          onNewChat={handleNewChat}
          onOpenThread={handleOpenThread}
          onDeleteAll={handleClearAllChats}
        />
      </SidebarFrame>
    );
  }

  return (
    <SidebarFrame>
      {/* A new record or scope starts a new pane, thus the menus of the old
          one (the field picker, the "⋮") do not stay open */}
      <Pane
        key={sidebarScope.scopeKey}
        header={
          <ChatHeader
            thread={activeThread}
            isSending={isSending}
            onBack={handleBackToList}
            onDelete={handleDeleteActiveThread}
            onNewChat={handleNewChat}
          />
        }
        footer={
          <Composer
            text={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            isSending={isSending}
            hasPendingApproval={hasPendingApproval}
            scopedFields={scopedFields}
            unscopedFields={unscopedFields}
            onAddScope={addScope}
            onRemoveScope={removeScope}
            fieldPickerRef={fieldPickerRef}
            supportsWriteApprovals={supportsWriteApprovals}
            autoApproveEdits={autoApproveEdits}
            onAutoApproveClick={() => {
              void handleAutoApproveClick();
            }}
          />
        }
      >
        <div
          ref={messagesRef}
          role="log"
          aria-label="Messages"
          aria-busy={isSending}
          className={s.log}
        >
          <Transcript
            conversation={conversation}
            showGreeting={showEmptyState}
            firstName={firstName}
            onStarter={handleSuggestion}
            fields={allFields}
            locales={siteLocales}
            recordEditPath={recordEditPath}
            onScrollToField={handleScrollToField}
            isActivityOpen={isActivityOpen}
            toggleActivity={toggleActivity}
            supportsWriteApprovals={supportsWriteApprovals}
            isSending={isSending}
            resolveApproval={resolveApproval}
            toggleApprovalDetails={toggleApprovalDetails}
            settingsPath={pluginSettingsPath(ctx)}
          />
        </div>
      </Pane>
    </SidebarFrame>
  );
}

export default function PromptSidebar({ ctx }: Props) {
  if (!ctx.item?.id) {
    return <UnsavedRecordNotice />;
  }

  return <PromptSidebarChat ctx={ctx} />;
}
