import { redactForLog } from './debugLog';

export type ProcessTraceStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'interrupted';

export type ProcessEntryStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'approved'
  | 'denied'
  | 'interrupted';

export type ProcessEntryKind =
  | 'status'
  | 'reasoning'
  | 'mcp_list'
  | 'mcp_call'
  | 'approval'
  | 'error';

export type ProcessEntry = {
  id: string;
  kind: ProcessEntryKind;
  title: string;
  status: ProcessEntryStatus;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  itemId?: string;
  approvalRequestId?: string;
  toolName?: string;
  text?: string;
  argumentsJson?: string;
  output?: string;
  error?: string;
};

export type ProcessRawEvent = {
  id: string;
  at: number;
  type: string;
  json: string;
  truncated?: boolean;
};

export type ProcessTrace = {
  status: ProcessTraceStatus;
  summary: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  entries: ProcessEntry[];
  rawEvents: ProcessRawEvent[];
  truncated?: boolean;
};

export type StreamApproval = {
  approvalRequestId: string;
  toolName: string;
  serverLabel: string;
  argumentsJson: string;
};

export type TurnStreamEvent =
  | {
      kind: 'response_started';
      responseId: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'text_delta';
      delta: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'reasoning_delta';
      itemId: string;
      summaryIndex: number;
      delta: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'reasoning_done';
      itemId: string;
      summaryIndex: number;
      text: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'mcp_list_started';
      itemId: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'mcp_list_completed';
      itemId: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'mcp_list_failed';
      itemId: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'mcp_call_started';
      itemId: string;
      toolName?: string;
      argumentsJson?: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'mcp_call_arguments';
      itemId: string;
      argumentsJson: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'mcp_call_completed';
      itemId: string;
      toolName?: string;
      argumentsJson?: string;
      output?: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'mcp_call_failed';
      itemId: string;
      toolName?: string;
      argumentsJson?: string;
      error?: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'approval_request';
      approval: StreamApproval;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'completed';
      responseId: string;
      rawEvent?: ProcessRawEvent;
    }
  | {
      kind: 'failed';
      message: string;
      rawEvent?: ProcessRawEvent;
    };

const MAX_RAW_EVENTS = 240;
const MAX_RAW_EVENT_CHARS = 6000;
const MAX_RAW_TOTAL_CHARS = 80000;
const MAX_ENTRIES = 80;
const MAX_FIELD_CHARS = 12000;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createProcessTrace(now = Date.now()): ProcessTrace {
  return {
    status: 'running',
    summary: 'Preparing response',
    startedAt: now,
    updatedAt: now,
    entries: [],
    rawEvents: [],
  };
}

export function createRawStreamEvent(
  type: string,
  payload: unknown,
  at = Date.now(),
): ProcessRawEvent {
  let json: string;
  let truncated = false;
  try {
    json = JSON.stringify(redactForLog(payload), null, 2);
  } catch (error) {
    json = JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (json.length > MAX_RAW_EVENT_CHARS) {
    json = `${json.slice(0, MAX_RAW_EVENT_CHARS)}\n… truncated`;
    truncated = true;
  }

  return {
    id: makeId('raw'),
    at,
    type,
    json,
    ...(truncated ? { truncated } : {}),
  };
}

export function applyTurnStreamEvent(
  trace: ProcessTrace | undefined,
  event: TurnStreamEvent,
): ProcessTrace {
  const base = trace ? cloneTrace(trace) : createProcessTrace();
  const now = Date.now();
  base.updatedAt = now;
  if (base.status !== 'failed' && base.status !== 'interrupted') {
    base.status = 'running';
    delete base.endedAt;
  }

  if (event.rawEvent) {
    base.rawEvents = appendRawEvent(base.rawEvents, event.rawEvent);
  }

  switch (event.kind) {
    case 'response_started':
      base.summary = 'Preparing response';
      break;
    case 'text_delta':
      if (base.summary === 'Preparing response') {
        base.summary = 'Writing response';
      }
      break;
    case 'reasoning_delta': {
      const id = reasoningEntryId(event.itemId, event.summaryIndex);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'reasoning',
        title: 'Reasoning summary',
        status: 'running',
        itemId: event.itemId,
        text: truncateField(`${entry.text ?? ''}${event.delta}`),
        updatedAt: now,
      }));
      base.summary = 'Reviewing context';
      break;
    }
    case 'reasoning_done': {
      const id = reasoningEntryId(event.itemId, event.summaryIndex);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'reasoning',
        title: 'Reasoning summary',
        status: 'completed',
        itemId: event.itemId,
        text: truncateField(event.text),
        updatedAt: now,
        endedAt: now,
      }));
      break;
    }
    case 'mcp_list_started': {
      const id = listEntryId(event.itemId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'mcp_list',
        title: 'Loading DatoCMS actions',
        status: 'running',
        itemId: event.itemId,
        updatedAt: now,
      }));
      base.summary = 'Loading DatoCMS actions';
      break;
    }
    case 'mcp_list_completed': {
      const id = listEntryId(event.itemId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'mcp_list',
        title: 'Loaded DatoCMS actions',
        status: 'completed',
        itemId: event.itemId,
        updatedAt: now,
        endedAt: now,
      }));
      break;
    }
    case 'mcp_list_failed': {
      const id = listEntryId(event.itemId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'mcp_list',
        title: 'Could not load DatoCMS actions',
        status: 'failed',
        itemId: event.itemId,
        updatedAt: now,
        endedAt: now,
      }));
      base.summary = 'Action lookup failed';
      break;
    }
    case 'mcp_call_started': {
      const id = callEntryId(event.itemId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'mcp_call',
        title: entryTitleForAction('Running DatoCMS action', event.toolName),
        status: 'running',
        itemId: event.itemId,
        toolName: event.toolName ?? entry.toolName,
        argumentsJson: truncateField(
          event.argumentsJson ?? entry.argumentsJson ?? '',
        ),
        updatedAt: now,
      }));
      base.summary = entryTitleForAction('Running DatoCMS action', event.toolName);
      break;
    }
    case 'mcp_call_arguments': {
      const id = callEntryId(event.itemId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'mcp_call',
        title: entry.title || 'Preparing DatoCMS action',
        status: entry.status === 'completed' ? entry.status : 'running',
        itemId: event.itemId,
        argumentsJson: truncateField(event.argumentsJson),
        updatedAt: now,
      }));
      base.summary = 'Preparing DatoCMS action';
      break;
    }
    case 'mcp_call_completed': {
      const id = callEntryId(event.itemId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'mcp_call',
        title: entryTitleForAction('Completed DatoCMS action', event.toolName),
        status: 'completed',
        itemId: event.itemId,
        toolName: event.toolName ?? entry.toolName,
        argumentsJson: truncateField(
          event.argumentsJson ?? entry.argumentsJson ?? '',
        ),
        output: truncateField(event.output ?? entry.output ?? ''),
        updatedAt: now,
        endedAt: now,
      }));
      base.summary = 'Writing response';
      break;
    }
    case 'mcp_call_failed': {
      const id = callEntryId(event.itemId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'mcp_call',
        title: entryTitleForAction('Failed DatoCMS action', event.toolName),
        status: 'failed',
        itemId: event.itemId,
        toolName: event.toolName ?? entry.toolName,
        argumentsJson: truncateField(
          event.argumentsJson ?? entry.argumentsJson ?? '',
        ),
        error: truncateField(event.error ?? entry.error ?? ''),
        updatedAt: now,
        endedAt: now,
      }));
      base.summary = 'DatoCMS action failed';
      break;
    }
    case 'approval_request': {
      const id = approvalEntryId(event.approval.approvalRequestId);
      base.entries = upsertEntry(base.entries, id, (entry) => ({
        ...entry,
        kind: 'approval',
        title: 'Approval needed',
        status: 'pending',
        approvalRequestId: event.approval.approvalRequestId,
        itemId: event.approval.approvalRequestId,
        toolName: event.approval.toolName,
        argumentsJson: truncateField(event.approval.argumentsJson),
        updatedAt: now,
      }));
      base.summary = 'Approval needed';
      break;
    }
    case 'completed':
      return finishProcessTrace(base, now);
    case 'failed':
      return failProcessTrace(base, event.message, now);
  }

  return sanitizeProcessTrace(base);
}

export function markProcessTraceDecision(
  trace: ProcessTrace | undefined,
  approvalRequestId: string,
  approve: boolean,
  options?: { continueRunning?: boolean },
): ProcessTrace | undefined {
  if (!trace) return undefined;
  const now = Date.now();
  const next = cloneTrace(trace);
  let matched = false;
  next.updatedAt = now;
  next.entries = next.entries.map((entry) => {
    if (entry.approvalRequestId !== approvalRequestId) return entry;
    matched = true;
    return {
      ...entry,
      title: approve ? 'Approved action' : 'Denied action',
      status: approve ? 'approved' : 'denied',
      updatedAt: now,
      endedAt: now,
    };
  });
  if (!matched) return undefined;
  if (options?.continueRunning) {
    next.status = 'running';
    delete next.endedAt;
    next.summary = 'Continuing work';
  } else {
    next.summary = approve ? 'Approved action' : 'Denied action';
  }
  return sanitizeProcessTrace(next);
}

export function finishProcessTrace(
  trace: ProcessTrace | undefined,
  now = Date.now(),
): ProcessTrace {
  const next = trace ? cloneTrace(trace) : createProcessTrace(now);
  next.updatedAt = now;
  if (next.entries.some((entry) => entry.status === 'pending')) {
    next.status = 'waiting';
    delete next.endedAt;
    next.summary = 'Approval needed';
    return sanitizeProcessTrace(next);
  }
  next.status = 'completed';
  next.endedAt = now;
  next.summary = 'Completed';
  return sanitizeProcessTrace(next);
}

export function failProcessTrace(
  trace: ProcessTrace | undefined,
  message: string,
  now = Date.now(),
): ProcessTrace {
  const next = trace ? cloneTrace(trace) : createProcessTrace(now);
  next.status = 'failed';
  next.summary = 'Request failed';
  next.updatedAt = now;
  next.endedAt = now;
  next.entries = [
    ...next.entries,
    {
      id: makeId('err'),
      kind: 'error' as const,
      title: 'Request failed',
      status: 'failed' as const,
      error: truncateField(message),
      startedAt: now,
      updatedAt: now,
      endedAt: now,
    },
  ].slice(-MAX_ENTRIES);
  return sanitizeProcessTrace(next);
}

export function interruptProcessTrace(
  trace: ProcessTrace | undefined,
  message: string,
  now = Date.now(),
): ProcessTrace {
  const next = trace ? cloneTrace(trace) : createProcessTrace(now);
  next.status = 'interrupted';
  next.summary = 'Interrupted before final reply';
  next.updatedAt = now;
  next.endedAt = now;
  next.entries = next.entries.map((entry) =>
    entry.status === 'running'
      ? {
          ...entry,
          title: `Status unknown: ${entry.title || 'Recorded action'}`,
          status: 'interrupted' as const,
          error: truncateField(message),
          updatedAt: now,
          endedAt: now,
        }
      : entry,
  );
  if (!next.entries.some((entry) => entry.kind === 'error')) {
    next.entries = [
      ...next.entries,
      {
        id: makeId('interrupt'),
        kind: 'error' as const,
        title: 'Final reply was not saved',
        status: 'interrupted' as const,
        error: truncateField(message),
        startedAt: now,
        updatedAt: now,
        endedAt: now,
      },
    ].slice(-MAX_ENTRIES);
  }
  return sanitizeProcessTrace(next);
}

export function sanitizeProcessTrace(trace: ProcessTrace): ProcessTrace {
  const entries = trace.entries.slice(-MAX_ENTRIES).map((entry) => ({
    ...entry,
    text: truncateOptional(entry.text),
    argumentsJson: truncateOptional(entry.argumentsJson),
    output: truncateOptional(entry.output),
    error: truncateOptional(entry.error),
  }));

  return {
    status: trace.status,
    summary: trace.summary || 'Preparing response',
    startedAt: safeTimestamp(trace.startedAt),
    updatedAt: safeTimestamp(trace.updatedAt),
    ...(trace.endedAt ? { endedAt: safeTimestamp(trace.endedAt) } : {}),
    entries,
    rawEvents: [],
    ...(trace.truncated ? { truncated: true } : {}),
  };
}

export function readProcessTrace(value: unknown): ProcessTrace | null {
  if (!isObject(value)) return null;
  const status =
    value.status === 'running' ||
    value.status === 'waiting' ||
    value.status === 'completed' ||
    value.status === 'failed' ||
    value.status === 'interrupted'
      ? value.status
      : null;
  if (!status) return null;
  const startedAt =
    typeof value.startedAt === 'number' ? safeTimestamp(value.startedAt) : null;
  const updatedAt =
    typeof value.updatedAt === 'number' ? safeTimestamp(value.updatedAt) : null;
  if (startedAt === null || updatedAt === null) return null;

  const entries = Array.isArray(value.entries)
    ? value.entries.flatMap((entry) => {
        const normalized = readProcessEntry(entry);
        return normalized ? [normalized] : [];
      })
    : [];
  const rawEvents = Array.isArray(value.rawEvents)
    ? value.rawEvents.flatMap((event) => {
        const normalized = readRawEvent(event);
        return normalized ? [normalized] : [];
      })
    : [];

  return sanitizeProcessTrace({
    status,
    summary:
      typeof value.summary === 'string' && value.summary.trim()
        ? value.summary
        : 'Preparing response',
    startedAt,
    updatedAt,
    ...(typeof value.endedAt === 'number'
      ? { endedAt: safeTimestamp(value.endedAt) }
      : {}),
    entries,
    rawEvents,
    ...(value.truncated === true ? { truncated: true } : {}),
  });
}

export function formatDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  return `${seconds}s`;
}

function cloneTrace(trace: ProcessTrace): ProcessTrace {
  return {
    ...trace,
    entries: trace.entries.map((entry) => ({ ...entry })),
    rawEvents: trace.rawEvents.map((event) => ({ ...event })),
  };
}

function appendRawEvent(
  events: ProcessRawEvent[],
  event: ProcessRawEvent,
): ProcessRawEvent[] {
  const next = [...events, event].slice(-MAX_RAW_EVENTS);
  let total = 0;
  const kept: ProcessRawEvent[] = [];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = next[index];
    if (!item) continue;
    total += item.json.length;
    if (total > MAX_RAW_TOTAL_CHARS) break;
    kept.unshift(item);
  }
  return kept;
}

function upsertEntry(
  entries: ProcessEntry[],
  id: string,
  updater: (entry: ProcessEntry) => ProcessEntry,
): ProcessEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    const next = [...entries];
    const existing = next[index];
    if (existing) next[index] = updater(existing);
    return next.slice(-MAX_ENTRIES);
  }

  const now = Date.now();
  return [
    ...entries,
    updater({
      id,
      kind: 'status',
      title: '',
      status: 'running',
      startedAt: now,
      updatedAt: now,
    }),
  ].slice(-MAX_ENTRIES);
}

function reasoningEntryId(itemId: string, summaryIndex: number): string {
  return `reasoning:${itemId}:${summaryIndex}`;
}

function listEntryId(itemId: string): string {
  return `list:${itemId}`;
}

function callEntryId(itemId: string): string {
  return `call:${itemId}`;
}

function approvalEntryId(approvalRequestId: string): string {
  return `approval:${approvalRequestId}`;
}

function entryTitleForAction(fallback: string, toolName?: string): string {
  return toolName ? `${fallback}: ${toolName}` : fallback;
}

function truncateOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : truncateField(value);
}

function truncateField(value: unknown): string {
  const text = stringifyFieldValue(value);
  if (text.length <= MAX_FIELD_CHARS) return text;
  return `${text.slice(0, MAX_FIELD_CHARS)}\n… truncated`;
}

function stringifyFieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';

  try {
    const json = JSON.stringify(value, null, 2);
    return typeof json === 'string' ? json : String(value);
  } catch {
    return String(value);
  }
}

function safeTimestamp(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

function readProcessEntry(value: unknown): ProcessEntry | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (
    value.kind !== 'status' &&
    value.kind !== 'reasoning' &&
    value.kind !== 'mcp_list' &&
    value.kind !== 'mcp_call' &&
    value.kind !== 'approval' &&
    value.kind !== 'error'
  ) {
    return null;
  }
  if (
    value.status !== 'pending' &&
    value.status !== 'running' &&
    value.status !== 'completed' &&
    value.status !== 'failed' &&
    value.status !== 'approved' &&
    value.status !== 'denied' &&
    value.status !== 'interrupted'
  ) {
    return null;
  }
  if (typeof value.title !== 'string') return null;
  const startedAt =
    typeof value.startedAt === 'number' ? safeTimestamp(value.startedAt) : null;
  const updatedAt =
    typeof value.updatedAt === 'number' ? safeTimestamp(value.updatedAt) : null;
  if (startedAt === null || updatedAt === null) return null;
  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    status: value.status,
    startedAt,
    updatedAt,
    ...(typeof value.endedAt === 'number'
      ? { endedAt: safeTimestamp(value.endedAt) }
      : {}),
    ...(typeof value.itemId === 'string' ? { itemId: value.itemId } : {}),
    ...(typeof value.approvalRequestId === 'string'
      ? { approvalRequestId: value.approvalRequestId }
      : {}),
    ...(typeof value.toolName === 'string' ? { toolName: value.toolName } : {}),
    ...(typeof value.text === 'string'
      ? { text: truncateField(value.text) }
      : {}),
    ...(typeof value.argumentsJson === 'string'
      ? { argumentsJson: truncateField(value.argumentsJson) }
      : {}),
    ...(typeof value.output === 'string'
      ? { output: truncateField(value.output) }
      : {}),
    ...(typeof value.error === 'string'
      ? { error: truncateField(value.error) }
      : {}),
  };
}

function readRawEvent(value: unknown): ProcessRawEvent | null {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.at !== 'number' ||
    typeof value.type !== 'string' ||
    typeof value.json !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    at: safeTimestamp(value.at),
    type: value.type,
    json:
      value.json.length > MAX_RAW_EVENT_CHARS
        ? `${value.json.slice(0, MAX_RAW_EVENT_CHARS)}\n… truncated`
        : value.json,
    ...(value.truncated === true ? { truncated: true } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
