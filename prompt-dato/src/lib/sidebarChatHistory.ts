import { derror } from './debugLog';
import type { ChatMessage } from './providerRuntime';
import {
  interruptProcessTrace,
  readProcessTrace,
  sanitizeProcessTrace,
} from './processTrace';

export type SidebarApprovalState =
  | 'pending'
  | 'submitting'
  | 'approved'
  | 'denied';

export type SidebarApprovalItem = {
  kind: 'approval';
  id: string;
  approvalRequestId: string;
  sourceResponseId: string;
  toolName: string;
  argumentsJson: string;
  state: SidebarApprovalState;
  detailsOpen: boolean;
};

export type SidebarConversationItem =
  | (ChatMessage & { kind: 'message' })
  | { kind: 'pending'; id: string }
  | { kind: 'error'; id: string; message: string; reauth: boolean }
  | SidebarApprovalItem;

export type SidebarChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  conversation: SidebarConversationItem[];
  lastResponseId: string | null;
  text: string;
  scopedFieldIds: string[];
};

export type SidebarChatHistory = {
  version: 1;
  activeThreadId: string | null;
  threads: SidebarChatThread[];
};

export type SidebarChatHistoryKeyParts = {
  pluginId: string;
  siteId: string;
  environment: string;
  itemTypeId: string;
  itemId: string;
};

type LegacySidebarSessionState = {
  version: 1;
  conversation: SidebarConversationItem[];
  lastResponseId: string | null;
  text: string;
  scopedFieldIds: string[];
  updatedAt: number;
};

type ConversationReadResult = {
  conversation: SidebarConversationItem[];
  interrupted: boolean;
};

const SIDEBAR_CHAT_HISTORY_VERSION = 1;
export const SIDEBAR_CHAT_MAX_ITEMS = 80;
export const SIDEBAR_CHAT_MAX_THREADS = 20;
export const INTERRUPTED_TURN_MESSAGE =
  'The page refreshed before the final reply was saved. The DatoCMS action may still have completed, so check the record before sending the request again.';

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeApprovalState(value: unknown): SidebarApprovalState | null {
  if (value === 'pending' || value === 'approved' || value === 'denied') {
    return value;
  }
  if (value === 'submitting') return 'pending';
  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function readConversationItem(
  value: unknown,
): SidebarConversationItem | 'pending' | null {
  if (!isObject(value)) return null;
  const { kind } = value;
  if (kind === 'pending') return 'pending';

  const id = typeof value.id === 'string' ? value.id : null;
  if (!id) return null;

  if (kind === 'message') {
    const role = value.role;
    const text = typeof value.text === 'string' ? value.text : null;
    if ((role !== 'user' && role !== 'assistant') || text === null) {
      return null;
    }
    const process = readProcessTrace(value.process);
    const processOpen =
      typeof value.processOpen === 'boolean' ? value.processOpen : false;
    const responseId =
      typeof value.responseId === 'string' && value.responseId.trim()
        ? value.responseId
        : null;
    return {
      kind,
      id,
      role,
      text,
      ...(responseId ? { responseId } : {}),
      ...(process ? { process } : {}),
      ...(processOpen ? { processOpen } : {}),
    };
  }

  if (kind === 'error') {
    const message = typeof value.message === 'string' ? value.message : null;
    const reauth = typeof value.reauth === 'boolean' ? value.reauth : false;
    if (message === null) return null;
    return { kind, id, message, reauth };
  }

  if (kind === 'approval') {
    const approvalRequestId =
      typeof value.approvalRequestId === 'string'
        ? value.approvalRequestId
        : null;
    const sourceResponseId =
      typeof value.sourceResponseId === 'string' ? value.sourceResponseId : null;
    const toolName = typeof value.toolName === 'string' ? value.toolName : null;
    const argumentsJson =
      typeof value.argumentsJson === 'string' ? value.argumentsJson : null;
    const state = normalizeApprovalState(value.state);
    const detailsOpen =
      typeof value.detailsOpen === 'boolean' ? value.detailsOpen : false;

    if (
      approvalRequestId === null ||
      sourceResponseId === null ||
      toolName === null ||
      argumentsJson === null ||
      state === null
    ) {
      return null;
    }

    return {
      kind,
      id,
      approvalRequestId,
      sourceResponseId,
      toolName,
      argumentsJson,
      state,
      detailsOpen,
    };
  }

  return null;
}

function readConversationItems(value: unknown): ConversationReadResult {
  if (!Array.isArray(value)) {
    return { conversation: [], interrupted: false };
  }

  const items: SidebarConversationItem[] = [];
  let hadPending = false;
  let hadInterruptedTurn = false;
  for (const rawItem of value) {
    const item = readConversationItem(rawItem);
    if (item === null) continue;
    if (item === 'pending') {
      hadPending = true;
      continue;
    }
    if (
      item.kind === 'message' &&
      item.role === 'assistant' &&
      item.process?.status === 'running'
    ) {
      if (item.responseId) {
        items.push(item);
        continue;
      }

      hadInterruptedTurn = true;
      items.push({
        ...item,
        text: item.text.trim() ? item.text : INTERRUPTED_TURN_MESSAGE,
        process: interruptProcessTrace(item.process, INTERRUPTED_TURN_MESSAGE),
      });
      continue;
    }
    items.push(item);
  }

  if (hadPending) {
    items.push({
      kind: 'error',
      id: generateId('m'),
      message:
        'The previous request was interrupted by an editor reload. Your messages were restored; check the record before sending the request again.',
      reauth: false,
    });
  }

  return {
    conversation: items.slice(-SIDEBAR_CHAT_MAX_ITEMS),
    interrupted: hadPending || hadInterruptedTurn,
  };
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function titleFromText(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ');
  if (!compact) return 'New chat';
  return compact.length > 64 ? `${compact.slice(0, 61)}…` : compact;
}

function deriveThreadTitle(
  rawTitle: unknown,
  conversation: SidebarConversationItem[],
  text: string,
): string {
  if (typeof rawTitle === 'string' && rawTitle.trim()) {
    return titleFromText(rawTitle);
  }

  const firstUserMessage = conversation.find(
    (item) => item.kind === 'message' && item.role === 'user',
  );
  if (firstUserMessage?.kind === 'message') {
    return titleFromText(firstUserMessage.text);
  }

  return titleFromText(text);
}

function readThread(value: unknown): SidebarChatThread | null {
  if (!isObject(value)) return null;

  const id = typeof value.id === 'string' ? value.id : null;
  if (!id) return null;

  const now = Date.now();
  const conversationResult = readConversationItems(value.conversation);
  const { conversation } = conversationResult;
  const createdAt = normalizeTimestamp(value.createdAt, now);
  const updatedAt = normalizeTimestamp(value.updatedAt, createdAt);

  return {
    id,
    title: deriveThreadTitle(value.title, conversation, ''),
    createdAt,
    updatedAt,
    conversation,
    lastResponseId:
      !conversationResult.interrupted && typeof value.lastResponseId === 'string'
        ? value.lastResponseId
        : null,
    text: '',
    scopedFieldIds: readStringArray(value.scopedFieldIds),
  };
}

function sortThreads(threads: SidebarChatThread[]): SidebarChatThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

function trimThreads(
  threads: SidebarChatThread[],
  activeThreadId: string | null,
  limit: number,
): SidebarChatThread[] {
  const sorted = sortThreads(threads);
  if (sorted.length <= limit) return sorted;

  const trimmed = sorted.slice(0, limit);
  if (
    activeThreadId === null ||
    trimmed.some((thread) => thread.id === activeThreadId)
  ) {
    return trimmed;
  }

  const activeThread = sorted.find((thread) => thread.id === activeThreadId);
  if (!activeThread) return trimmed;

  return [...trimmed.slice(0, Math.max(0, limit - 1)), activeThread];
}

export function sanitizeSidebarChatHistory(
  history: SidebarChatHistory,
): SidebarChatHistory {
  const deduped = new Map<string, SidebarChatThread>();
  for (const thread of history.threads) {
    deduped.set(thread.id, {
      ...thread,
      title: titleFromText(thread.title),
      conversation: thread.conversation
        .slice(-SIDEBAR_CHAT_MAX_ITEMS)
        .map((item) =>
          item.kind === 'message' && item.process
            ? { ...item, process: sanitizeProcessTrace(item.process) }
            : item,
        ),
      scopedFieldIds: [...new Set(thread.scopedFieldIds)],
    });
  }

  const threads = trimThreads(
    [...deduped.values()],
    history.activeThreadId,
    SIDEBAR_CHAT_MAX_THREADS,
  );
  const activeThreadId = threads.some(
    (thread) => thread.id === history.activeThreadId,
  )
    ? history.activeThreadId
    : null;

  return {
    version: SIDEBAR_CHAT_HISTORY_VERSION,
    activeThreadId,
    threads,
  };
}

function readHistoryPayload(value: unknown): SidebarChatHistory | null {
  if (!isObject(value) || value.version !== SIDEBAR_CHAT_HISTORY_VERSION) {
    return null;
  }
  if (!Array.isArray(value.threads)) return null;

  const threads = value.threads
    .map(readThread)
    .filter((thread): thread is SidebarChatThread => Boolean(thread))
    .filter((thread) => !isSidebarThreadEmpty(thread));

  const activeThreadId =
    typeof value.activeThreadId === 'string' ? value.activeThreadId : null;

  return sanitizeSidebarChatHistory({
    version: SIDEBAR_CHAT_HISTORY_VERSION,
    activeThreadId,
    threads,
  });
}

function readLegacySession(key: string): LegacySidebarSessionState | null {
  try {
    const stored = window.sessionStorage.getItem(key);
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (!isObject(parsed) || parsed.version !== 1) return null;

    const conversationResult = readConversationItems(parsed.conversation);

    return {
      version: 1,
      conversation: conversationResult.conversation,
      lastResponseId:
        !conversationResult.interrupted &&
        typeof parsed.lastResponseId === 'string'
          ? parsed.lastResponseId
          : null,
      text: typeof parsed.text === 'string' ? parsed.text : '',
      scopedFieldIds: readStringArray(parsed.scopedFieldIds),
      updatedAt: normalizeTimestamp(parsed.updatedAt, Date.now()),
    };
  } catch (error) {
    derror('Sidebar', 'legacy_history_restore_failed', error);
    return null;
  }
}

function legacySessionHasContent(session: LegacySidebarSessionState): boolean {
  return (
    session.conversation.length > 0 ||
    session.scopedFieldIds.length > 0 ||
    session.lastResponseId !== null
  );
}

function historyFromLegacySession(
  session: LegacySidebarSessionState,
): SidebarChatHistory {
  const now = Date.now();
  const thread: SidebarChatThread = {
    id: generateId('t'),
    title: deriveThreadTitle(null, session.conversation, ''),
    createdAt: session.updatedAt || now,
    updatedAt: session.updatedAt || now,
    conversation: session.conversation,
    lastResponseId: session.lastResponseId,
    text: '',
    scopedFieldIds: session.scopedFieldIds,
  };

  return {
    version: SIDEBAR_CHAT_HISTORY_VERSION,
    activeThreadId: thread.id,
    threads: [thread],
  };
}

export function createEmptySidebarChatHistory(): SidebarChatHistory {
  return {
    version: SIDEBAR_CHAT_HISTORY_VERSION,
    activeThreadId: null,
    threads: [],
  };
}

export function createSidebarChatThread(): SidebarChatThread {
  const now = Date.now();
  return {
    id: generateId('t'),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    conversation: [],
    lastResponseId: null,
    text: '',
    scopedFieldIds: [],
  };
}

export function buildSidebarChatHistoryKey(
  parts: SidebarChatHistoryKeyParts,
): string {
  return [
    'prompt-dato',
    'sidebar-history',
    `v${SIDEBAR_CHAT_HISTORY_VERSION}`,
    parts.pluginId,
    parts.siteId,
    parts.environment,
    parts.itemTypeId,
    parts.itemId,
  ]
    .map(encodeURIComponent)
    .join(':');
}

export function buildLegacySidebarSessionKey(
  parts: SidebarChatHistoryKeyParts,
): string {
  return [
    'prompt-dato',
    'sidebar',
    'v1',
    parts.pluginId,
    parts.siteId,
    parts.environment,
    parts.itemTypeId,
    parts.itemId,
  ]
    .map(encodeURIComponent)
    .join(':');
}

export function readSidebarChatHistory(
  key: string,
  legacySessionKey: string,
): SidebarChatHistory {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      const history = readHistoryPayload(parsed);
      if (history) return history;
    }
  } catch (error) {
    derror('Sidebar', 'history_restore_failed', error);
  }

  const legacySession = readLegacySession(legacySessionKey);
  if (legacySession && legacySessionHasContent(legacySession)) {
    return historyFromLegacySession(legacySession);
  }

  return createEmptySidebarChatHistory();
}

export function writeSidebarChatHistory(
  key: string,
  history: SidebarChatHistory,
): void {
  let next = sanitizeSidebarChatHistory({
    ...history,
    threads: history.threads
      .map((thread) => ({
        ...thread,
        text: '',
      }))
      .filter((thread) => !isSidebarThreadEmpty(thread)),
  });

  while (true) {
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      return;
    } catch (error) {
      if (next.threads.length <= 1) {
        derror('Sidebar', 'history_persist_failed', error);
        return;
      }

      next = {
        ...next,
        threads: trimThreads(
          next.threads,
          next.activeThreadId,
          next.threads.length - 1,
        ),
      };
    }
  }
}

export function getSidebarThreadTitle(value: string): string {
  return titleFromText(value);
}

export function getSidebarThreadPreview(thread: SidebarChatThread): string {
  const draft = thread.text.trim().replace(/\s+/g, ' ');
  if (draft) return `Draft: ${draft}`;

  for (let index = thread.conversation.length - 1; index >= 0; index -= 1) {
    const item = thread.conversation[index];
    if (item?.kind === 'message') {
      return item.text.trim().replace(/\s+/g, ' ') || 'No message text';
    }
    if (item?.kind === 'error') return 'Ended with an error';
    if (item?.kind === 'approval') return 'Waiting for an action decision';
  }

  return 'No messages yet';
}

export function isSidebarThreadEmpty(thread: SidebarChatThread): boolean {
  return (
    thread.conversation.length === 0 &&
    thread.scopedFieldIds.length === 0 &&
    thread.lastResponseId === null
  );
}

export function addSidebarChatThread(
  history: SidebarChatHistory,
  thread: SidebarChatThread,
): SidebarChatHistory {
  return sanitizeSidebarChatHistory({
    ...history,
    activeThreadId: thread.id,
    threads: [thread, ...history.threads],
  });
}

export function removeSidebarChatThread(
  history: SidebarChatHistory,
  threadId: string,
): SidebarChatHistory {
  return sanitizeSidebarChatHistory({
    ...history,
    activeThreadId:
      history.activeThreadId === threadId ? null : history.activeThreadId,
    threads: history.threads.filter((thread) => thread.id !== threadId),
  });
}

export function updateSidebarChatThread(
  history: SidebarChatHistory,
  threadId: string,
  updater: (thread: SidebarChatThread) => SidebarChatThread,
): SidebarChatHistory {
  let found = false;
  const threads = history.threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    found = true;
    return updater(thread);
  });

  if (!found) return history;

  return sanitizeSidebarChatHistory({
    ...history,
    threads,
  });
}
