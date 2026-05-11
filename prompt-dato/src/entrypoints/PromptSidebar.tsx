import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dlog, setDebugEnabled } from '../lib/debugLog';
import {
  type ChatMessage,
  isLikelyMcpAuthError,
  isLikelyPreviousResponseError,
  type PendingApproval,
  recoverChatTurn,
  sendChatTurn,
  type SendChatTurnResult,
  submitToolResponses,
} from '../lib/providerRuntime';
import {
  DEFAULT_REASONING_EFFORT,
  getProviderApiKey,
  getProviderMainModel,
  isFullyConfigured,
  readParams,
} from '../lib/pluginParams';
import {
  buildRecordContext,
  type FieldInfo,
  listFieldsForCurrentItemType,
} from '../lib/recordContext';
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
import { clearRemovedDiagnosticsStore } from '../lib/removedDiagnostics';
import {
  addSidebarChatThread,
  buildLegacySidebarSessionKey,
  buildSidebarChatHistoryKey,
  createEmptySidebarChatHistory,
  createSidebarChatThread,
  getSidebarThreadPreview,
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
import { SendActivityGlyph, WorkingInline } from './ActivityGlyphs';
import { type IconKey, iconPaths } from './icons';
import { JsonPreview } from './JsonPreview';
import { ProcessTraceView } from './ProcessTraceView';
import { useActivityTimeline } from './useActivityTimeline';
import s from './styles.module.css';

type Props = {
  ctx: RenderItemFormSidebarCtx;
};

type Suggestion = {
  prompt: string;
  title: string;
  hint: string;
  icon: IconKey;
};

const STATIC_SUGGESTIONS: Suggestion[] = [
  {
    prompt: 'Write a compelling excerpt from the body of this record.',
    title: 'Generate an excerpt',
    hint: 'from the body',
    icon: 'edit',
  },
  {
    prompt: 'Rewrite the title so it is more engaging and under 60 characters.',
    title: 'Punch up the title',
    hint: 'for SEO and click-through',
    icon: 'title',
  },
  {
    prompt: 'Summarize the body into 5 bullet points.',
    title: 'Summarize to bullets',
    hint: '5 key takeaways',
    icon: 'bullets',
  },
  {
    prompt: 'Prepare this record for publish.',
    title: 'Prepare for publish',
    hint: 'fill meta, slug, and excerpt',
    icon: 'check',
  },
];

const LOCALE_KEY_SEPARATOR = '\u001f';
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

const fieldUrlTransform: UrlTransform = (url) =>
  url.startsWith('field:') ? url : defaultUrlTransform(url);

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

function generateMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function NewChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/**
 * Parses a `field:` pseudo-URL (e.g. `field:title`, `field:title.en`,
 * `field://title.en`) into the current record editor field target.
 */
type FieldNavigationTarget = {
  fieldPath: string;
  localized: boolean;
  locale: string | null;
};

function parseFieldHref(
  href: string,
  fields: FieldInfo[],
  locales: string[],
): FieldNavigationTarget | null {
  if (!href.startsWith('field:')) return null;
  const encoded = href.slice('field:'.length).replace(/^\/+/, '');
  const raw = safeDecodeURIComponent(encoded);
  if (raw.length === 0) return null;

  for (const field of fields) {
    if (raw === field.apiKey) {
      return {
        fieldPath: raw,
        localized: field.localized,
        locale: null,
      };
    }

    if (!field.localized) continue;

    for (const locale of locales) {
      if (raw === `${field.apiKey}.${locale}`) {
        return {
          fieldPath: field.apiKey,
          localized: true,
          locale,
        };
      }

      if (raw.startsWith(`${field.apiKey}.${locale}.`)) {
        return {
          fieldPath: raw,
          localized: true,
          locale,
        };
      }
    }
  }

  const [topLevelApiKey] = raw.split('.');
  const topLevelField = fields.find((field) => field.apiKey === topLevelApiKey);
  const locale = getLocaleFromFieldPath(raw, locales);

  return {
    fieldPath: raw,
    localized: Boolean(topLevelField?.localized || locale),
    locale,
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type RecordEditPathContext = {
  environment: string;
  isEnvironmentPrimary: boolean;
};

function getEnvironmentPrefix(ctx: RecordEditPathContext): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

function buildRecordEditPath(
  ctx: RecordEditPathContext,
  modelId: string,
  recordId: string,
): string {
  return `${getEnvironmentPrefix(
    ctx,
  )}/editor/item_types/${modelId}/items/${recordId}/edit`;
}

function getLocaleFromFieldPath(
  fieldPath: string,
  locales: string[],
): string | null {
  return fieldPath.split('.').find((part) => locales.includes(part)) ?? null;
}

function fieldPathIncludesLocale(fieldPath: string, locale: string): boolean {
  return fieldPath.split('.').includes(locale);
}

function getHashFieldPath(target: FieldNavigationTarget): string {
  if (!target.localized || !target.locale) return target.fieldPath;
  return fieldPathIncludesLocale(target.fieldPath, target.locale)
    ? target.fieldPath
    : `${target.fieldPath}.${target.locale}`;
}

type FieldMentionPillProps = {
  target: FieldNavigationTarget;
  children: React.ReactNode;
  onScrollToField: (target: FieldNavigationTarget) => void;
};

function FieldMentionPill({
  target,
  children,
  onScrollToField,
}: FieldMentionPillProps) {
  return (
    <button
      type="button"
      className={`${s.contextPill} ${s.fieldMentionPill}`}
      onClick={() => onScrollToField(target)}
      title={
        target.locale
          ? `Scroll to @${target.fieldPath}`
          : `Scroll to @${target.fieldPath}`
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
      </svg>
      <span>{children}</span>
      {target.locale ? (
        <span className={s.fieldMentionLocale}>
          {target.locale.toUpperCase()}
        </span>
      ) : null}
    </button>
  );
}

type AssistantMarkdownProps = {
  text: string;
  fields: FieldInfo[];
  locales: string[];
  onScrollToField: (target: FieldNavigationTarget) => void;
};

const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  fields,
  locales,
  onScrollToField,
}: AssistantMarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a: ({ children, href, ...props }) => {
        if (typeof href === 'string' && href.startsWith('field:')) {
          const target = parseFieldHref(href, fields, locales);
          if (!target) return <span>{children}</span>;

          return (
            <FieldMentionPill
              target={target}
              onScrollToField={onScrollToField}
            >
              {children}
            </FieldMentionPill>
          );
        }

        return (
          <a {...props} href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
    }),
    [fields, locales, onScrollToField],
  );

  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      urlTransform={fieldUrlTransform}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

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

function approvalTitle(toolName: string): string {
  if (toolName === 'upsert_and_execute_unsafe_script') {
    return 'Apply project changes?';
  }
  return 'Run project action?';
}

function approvalSummary(toolName: string): string {
  if (toolName === 'upsert_and_execute_unsafe_script') {
    return 'This will apply changes to your project.';
  }
  return 'This will run a project action.';
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
    const matches = text.matchAll(/client\.([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)/g);
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

function finalReplyLooksBlocked(trace: ProcessTrace, replyText: string): boolean {
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

function formatThreadTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';

  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  try {
    if (sameDay) {
      return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function UnsavedRecordNotice({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <div className={s.sidebar}>
        <div className={s.unsavedRecordNotice}>
          <div className={s.unsavedRecordTitle}>Save this record first</div>
          <div className={s.unsavedRecordText}>
            This record needs to have been saved at least once before chat
            becomes available.
          </div>
        </div>
      </div>
    </Canvas>
  );
}

function PromptSidebarChat({ ctx }: Props) {
  const currentItemId = ctx.item?.id ?? null;
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
  const [initialSidebarState] = useState(() =>
    loadSidebarState(sidebarScope),
  );
  const [history, setHistory] = useState<SidebarChatHistory>(
    initialSidebarState.history,
  );
  const [historyScopeKey, setHistoryScopeKey] = useState(sidebarScope.scopeKey);
  const [view, setView] = useState<SidebarView>(initialSidebarState.view);
  const [isSending, setIsSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [autoApproveEdits, setAutoApproveEdits] = useState(false);
  const [draftTextByThreadId, setDraftTextByThreadId] = useState<
    Record<string, string>
  >({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);
  const mentionToggleRef = useRef<HTMLButtonElement>(null);
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
        ? history.threads.find((thread) => thread.id === activeThreadId) ?? null
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
  const text = activeThreadId ? (draftTextByThreadId[activeThreadId] ?? '') : '';
  const scopedFieldIds = activeThread?.scopedFieldIds ?? [];
  const lastResponseId = activeThread?.lastResponseId ?? null;
  const isChatView = view === 'chat';
  const showHistoryList = configured && sidebarScope.savedRecord && view === 'list';
  const localeKey = ctx.site.attributes.locales.join(LOCALE_KEY_SEPARATOR);
  const siteLocales = useMemo(
    () =>
      localeKey.length > 0
        ? localeKey.split(LOCALE_KEY_SEPARATOR)
        : [],
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
    setMentionOpen(false);
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

  const allFields = useMemo<FieldInfo[]>(
    () => listFieldsForCurrentItemType(ctx),
    // ctx.fields is a stable reference within a render of this hook; rebuild
    // only when the model changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
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
            target.localized
              ? (target.locale ?? currentCtx.locale)
              : undefined,
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

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversation]);

  // Close the mention popover on outside click.
  useEffect(() => {
    if (!mentionOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        mentionRef.current?.contains(target) ||
        mentionToggleRef.current?.contains(target)
      ) {
        return;
      }
      setMentionOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [mentionOpen]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setText(value);
    autoGrow();

    // Open popover when the user types `@` either at the start of the input
    // or right after whitespace (matches the design's behavior).
    if (value.endsWith('@') && (value.length === 1 || /\s@$/.test(value))) {
      if (unscopedFields.length > 0) setMentionOpen(true);
    } else if (!value.includes('@')) {
      setMentionOpen(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && event.key === 'Escape') {
      event.preventDefault();
      setMentionOpen(false);
      return;
    }
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

  const recordTurnError = (
    error: unknown,
    draftId: string | null,
  ) => {
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

        const message = error instanceof Error ? error.message : 'Unknown error';
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
      ctx.navigateTo(
        `${getEnvironmentPrefix(ctx)}/configuration/plugins/${ctx.plugin.id}/edit`,
      );
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
    requestAnimationFrame(autoGrow);
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
        item.kind === 'approval' &&
        item.approvalRequestId === approvalRequestId
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
      title: 'Auto-approve every action?',
      content:
        'With "Accept all edits" enabled, write proposals will be approved automatically and applied to your project without you reviewing them first. This can create, update, and delete records, change schema, and run arbitrary scripts on your behalf. Only enable this if you trust the current task and want to skim. The toggle resets when you reload or switch records.',
      choices: [
        {
          label: 'Yes, auto-approve',
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
    requestAnimationFrame(() => {
      autoGrow();
      textareaRef.current?.focus();
    });
  };

  const openSettings = () => {
    ctx.navigateTo(
      `${getEnvironmentPrefix(ctx)}/configuration/plugins/${ctx.plugin.id}/edit`,
    );
  };

  const handleNewChat = () => {
    if (isSending) return;
    const thread = createSidebarChatThread();
    const currentEmptyThreadId =
      activeThread && isSidebarThreadEmpty(activeThread) ? activeThread.id : null;
    setHistory((previous) => {
      const currentThreadId = activeThreadIdRef.current;
      const currentThread = currentThreadId
        ? previous.threads.find((item) => item.id === currentThreadId) ?? null
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
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleOpenThread = (threadId: string) => {
    if (isSending) return;
    setHistory((previous) => ({
      ...previous,
      activeThreadId: threadId,
    }));
    setView('chat');
    resetTransientChatState();
    requestAnimationFrame(() => textareaRef.current?.focus());
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

  const handleDeleteThread = async (threadId: string) => {
    if (isSending) return;

    const confirmed = await ctx.openConfirm({
      title: 'Delete chat?',
      content: 'This removes the selected chat from this browser.',
      choices: [
        {
          label: 'Delete',
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
    }
  };

  const handleClearAllChats = async () => {
    if (isSending || history.threads.length === 0) return;

    const confirmed = await ctx.openConfirm({
      title: 'Clear all chats?',
      content: 'This removes every chat saved for this record from this browser.',
      choices: [
        {
          label: 'Clear all',
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

  const toggleMention = () => {
    if (unscopedFields.length === 0) return;
    setMentionOpen((open) => !open);
  };

  const addScope = (fieldId: string) => {
    setScopedFieldIds((prev) =>
      prev.includes(fieldId) ? prev : [...prev, fieldId],
    );
    setMentionOpen(false);
    // If the user opened the popover by typing `@`, strip the trailing `@`.
    setText((prev) => prev.replace(/@$/, '').trimEnd());
    requestAnimationFrame(() => {
      autoGrow();
      textareaRef.current?.focus();
    });
  };

  const removeScope = (fieldId: string) => {
    setScopedFieldIds((prev) => prev.filter((id) => id !== fieldId));
  };

  const showEmptyState = isChatView && configured && conversation.length === 0;

  return (
    <Canvas ctx={ctx}>
      <div className={s.sidebar}>
        {showHistoryList ? (
          <div className={s.historyView}>
            <div className={s.historyHeader}>
              <div className={s.historyHeading}>
                <div className={s.historyTitle}>Chats</div>
                <div className={s.historySubtitle}>This record</div>
              </div>
              <div className={s.historyHeaderActions}>
                {history.threads.length > 0 ? (
                  <button
                    type="button"
                    className={s.clearChatsButton}
                    onClick={handleClearAllChats}
                    disabled={isSending}
                  >
                    Clear all
                  </button>
                ) : null}
                <button
                  type="button"
                  className={s.newChatButton}
                  onClick={handleNewChat}
                  disabled={isSending}
                >
                  <NewChatIcon />
                  New chat
                </button>
              </div>
            </div>

            {history.threads.length === 0 ? (
              <div className={s.historyEmpty}>
                <div className={s.historyEmptyTitle}>
                  No chats for this record
                </div>
                <div className={s.historyEmptyText}>
                  Start a chat to keep a local history for this record.
                </div>
              </div>
            ) : (
              <div className={s.historyList}>
                {history.threads.map((thread) => (
                  <div key={thread.id} className={s.historyRow}>
                    <button
                      type="button"
                      className={s.historyRowMain}
                      onClick={() => handleOpenThread(thread.id)}
                      disabled={isSending}
                    >
                      <span className={s.historyRowTitle}>
                        {thread.title}
                      </span>
                      <span className={s.historyRowPreview}>
                        {getSidebarThreadPreview(thread)}
                      </span>
                    </button>
                    <div className={s.historyRowSide}>
                      <span className={s.historyRowTime}>
                        {formatThreadTimestamp(thread.updatedAt)}
                      </span>
                      <button
                        type="button"
                        className={s.historyDelete}
                        aria-label={`Delete ${thread.title}`}
                        title="Delete chat"
                        disabled={isSending}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteThread(thread.id);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v5" />
                          <path d="M14 11v5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {configured && sidebarScope.savedRecord ? (
              <div className={s.chatTopbar}>
                <button
                  type="button"
                  className={s.chatBackBtn}
                  onClick={handleBackToList}
                  disabled={isSending}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Back
                </button>
                <div
                  className={s.chatTopbarTitle}
                  title={activeThread?.title ?? 'New chat'}
                >
                  {activeThread?.title ?? 'New chat'}
                </div>
                <button
                  type="button"
                  className={s.newChatButton}
                  onClick={handleNewChat}
                  disabled={isSending}
                >
                  <NewChatIcon />
                  New chat
                </button>
              </div>
            ) : null}
        <div className={s.messages} ref={messagesRef}>
          {!configured ? (
            <div className={s.empty}>
              <div className={s.emptyHead}>Set up Prompt Dato</div>
              <div className={s.emptySub}>
                Connect to DatoCMS and add an OpenAI API key in the plugin
                settings to start chatting.
              </div>
              <button
                type="button"
                className={s.primaryAction}
                onClick={openSettings}
              >
                Open plugin settings
              </button>
            </div>
          ) : null}

          {showEmptyState ? (
            <div className={s.empty}>
              <div className={s.emptyHead}>
                <span className={s.wave}>👋</span> Hi {firstName}
              </div>
              <div className={s.emptySub}>
                I can help with this record — rewrite, summarize, or generate
                fields from what you've already written. What are we working
                on?
              </div>
              <div className={s.suggestions}>
                {STATIC_SUGGESTIONS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    className={s.suggestion}
                    onClick={() => handleSuggestion(item.prompt)}
                  >
                    <span className={s.sIcon}>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {iconPaths[item.icon] ?? iconPaths.sparkle}
                      </svg>
                    </span>
                    <span>
                      <b>{item.title}</b>
                      {item.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {conversation.map((item) => {
            if (item.kind === 'message') {
              const isAssistant = item.role === 'assistant';
              const showBubble =
                !isAssistant ||
                item.text.trim().length > 0 ||
                item.process === undefined;
              return (
                <div
                  key={item.id}
                  className={`${s.msg} ${
                    isAssistant ? s.msgAssistant : s.msgUser
                  }`}
                >
                  <div className={s.msgRow}>
                    <div className={s.messageStack}>
                      {showBubble ? (
                        <div
                          className={`${s.bubble} ${
                            isAssistant ? s.markdownBubble : ''
                          }`}
                        >
                          {isAssistant ? (
                            <AssistantMarkdown
                              text={item.text}
                              fields={allFields}
                              locales={siteLocales}
                              onScrollToField={handleScrollToField}
                            />
                          ) : (
                            item.text
                          )}
                        </div>
                      ) : null}
                      {isAssistant && item.process ? (
                        <ProcessTraceView
                          trace={item.process}
                          open={isActivityOpen(item.id, item.process)}
                          onToggle={() => toggleActivity(item.id, item.process)}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            }
            if (item.kind === 'pending') {
              return (
                <div key={item.id} className={`${s.msg} ${s.msgAssistant}`}>
                  <div className={s.msgRow}>
                    <WorkingInline label="Preparing response" />
                  </div>
                </div>
              );
            }
            if (item.kind === 'approval') {
              const resolved = item.state === 'approved' || item.state === 'denied';
              const submitting = item.state === 'submitting';
              return (
                <div
                  key={item.id}
                  className={`${s.msg} ${s.msgAssistant}`}
                >
                  <div className={s.msgRow}>
                    <div className={s.proposal}>
                      <div className={s.proposalHead}>
                        <span className={s.proposalLabel}>Action proposal</span>
                      </div>
                      <div className={s.proposalBody}>
                        <div className={s.proposalTitle}>
                          {approvalTitle(item.toolName)}
                        </div>
                        <div className={s.proposalSub}>
                          {approvalSummary(item.toolName)} Review details before
                          approving.
                        </div>
                      </div>
                      {item.detailsOpen ? (
                        <div className={s.proposalDetails}>
                          <div className={s.proposalToolLine}>
                            Project action <code>{item.toolName}</code>
                          </div>
                          <JsonPreview
                            className={s.proposalArgs}
                            value={item.argumentsJson}
                          />
                        </div>
                      ) : null}
                      {!resolved ? (
                        <div className={s.proposalActions}>
                          <button
                            type="button"
                            className={`${s.proposalBtn} ${s.proposalBtnDetails}`}
                            onClick={() =>
                              toggleApprovalDetails(item.approvalRequestId)
                            }
                            disabled={submitting}
                          >
                            {item.detailsOpen
                              ? 'Hide details'
                              : 'See details'}
                          </button>
                          <button
                            type="button"
                            className={`${s.proposalBtn} ${s.proposalBtnDeny}`}
                            onClick={() =>
                              resolveApproval(item.approvalRequestId, false)
                            }
                            disabled={submitting}
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            className={`${s.proposalBtn} ${s.proposalBtnApprove}`}
                            onClick={() =>
                              resolveApproval(item.approvalRequestId, true)
                            }
                            disabled={submitting}
                          >
                            {submitting ? 'Applying…' : 'Approve'}
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`${s.proposalStatus} ${
                            item.state === 'approved'
                              ? s.proposalStatusOk
                              : s.proposalStatusNo
                          }`}
                        >
                          {item.state === 'approved'
                            ? 'Approved — call completed'
                            : 'Denied — call not run'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={item.id} className={`${s.msg} ${s.msgAssistant}`}>
                <div className={s.msgRow}>
                  <div className={s.errorBubble}>
                    <strong>Something went wrong.</strong>
                    <div className={s.errorDetail}>{item.message}</div>
                    {item.reauth ? (
                      <button
                        type="button"
                        className={s.linkAction}
                        onClick={openSettings}
                      >
                        Reconnect to DatoCMS
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {configured ? (
          <div className={s.pillBar} aria-label="Chat context">
            <div
              className={s.pillBarLabel}
              title="Items the chat will pay extra attention to"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8z" />
                <path d="M19 14l.7 1.8L21.5 17l-1.8.7L19 19l-.7-1.3L16.5 17l1.8-1.2z" />
              </svg>
              Emphasized context
            </div>
            <div className={s.pillBarRow}>
            <span
              className={`${s.contextPill} ${s.lockedPill}`}
              title="The current record is always shared with chat"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              Current record
            </span>
            {scopedFields.map((field) => (
              <span
                key={field.id}
                className={`${s.contextPill} ${s.scopePill}`}
                title={`Focused on ${field.label}`}
              >
                <span className={s.scopeName}>@{field.label}</span>
                <button
                  type="button"
                  onClick={() => removeScope(field.id)}
                  aria-label={`Remove ${field.label} from context`}
                  title="Remove from context"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ))}
            </div>
          </div>
        ) : null}

        <div className={s.composerWrap}>
          {configured && mentionOpen && unscopedFields.length > 0 ? (
            <div
              ref={mentionRef}
              className={`${s.mentionPop} ${s.open}`}
              role="listbox"
            >
              <div className={s.mhead}>Add field to context</div>
              {unscopedFields.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  className={s.mopt}
                  onClick={() => addScope(field.id)}
                >
                  <span className={s.micon}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 6h16" />
                      <path d="M4 12h10" />
                      <path d="M4 18h16" />
                    </svg>
                  </span>
                  <span className={s.mmain}>
                    {field.label}
                    <small>{field.fieldType}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className={s.composer}>
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={
                !configured
                  ? 'Configure the plugin to start chatting…'
                  : hasPendingApproval
                    ? 'Approve or deny the pending action first…'
                    : 'Ask anything about this record…'
              }
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              disabled={!configured || hasPendingApproval}
            />
            <div className={s.composerBottom}>
              <div className={s.composerTools}>
                {supportsWriteApprovals ? (
                  <button
                    type="button"
                    className={`${s.autoApproveToggle} ${
                      autoApproveEdits ? s.autoApproveToggleActive : ''
                    }`}
                    title={
                      autoApproveEdits
                        ? 'Auto-approving every MCP write. Click to turn off.'
                        : 'Auto-approve every MCP write for this session (asks for confirmation)'
                    }
                    aria-pressed={autoApproveEdits}
                    disabled={!configured}
                    onClick={handleAutoApproveClick}
                  >
                    {autoApproveEdits ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        stroke="none"
                        aria-hidden="true"
                      >
                        <path d="M13 2L4 14h6l-1 8 10-12h-7l1-8z" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    )}
                    <span>
                      {autoApproveEdits
                        ? 'Auto-approving edits'
                        : 'Asking before edits'}
                    </span>
                  </button>
                ) : null}
                <button
                  ref={mentionToggleRef}
                  type="button"
                  className={`${s.toolBtn} ${
                    mentionOpen ? s.toolBtnPressed : ''
                  }`}
                  title="Add a field to the chat context (@)"
                  aria-label="Add a field to the chat context"
                  disabled={!configured || unscopedFields.length === 0}
                  onClick={toggleMention}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                className={`${s.sendBtn} ${isSending ? s.sendBtnBusy : ''}`}
                disabled={
                  !configured ||
                  !text.trim() ||
                  isSending ||
                  hasPendingApproval
                }
                onClick={handleSend}
                title={isSending ? 'Sending' : 'Send'}
                aria-label={isSending ? 'Sending' : 'Send'}
              >
                <SendActivityGlyph active={isSending} />
              </button>
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </Canvas>
  );
}

export default function PromptSidebar({ ctx }: Props) {
  if (!ctx.item?.id) {
    return <UnsavedRecordNotice ctx={ctx} />;
  }

  return <PromptSidebarChat ctx={ctx} />;
}
