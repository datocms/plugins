import {
  type ConversationScope,
  type ConversationStorageContext,
  conversationStorageKey,
  MAX_CONVERSATION_MESSAGE_CHARACTERS,
  type StorageLike,
} from './conversations';

export const UNSAFE_DISPATCH_JOURNAL_VERSION = 1;
export const MAX_UNSAFE_DISPATCH_OPERATIONS = 20;
export const MAX_UNSAFE_DISPATCH_NAME_CHARACTERS = 200;
export const MAX_UNSAFE_DISPATCH_ARGUMENT_CHARACTERS = 20_000;
const MAX_JOURNAL_ID_CHARACTERS = 512;
const MAX_MODEL_CHARACTERS = 512;
const MAX_TITLE_CHARACTERS = 120;

export type UnsafeDispatchOperationState = 'armed' | 'dispatched' | 'confirmed';

export interface UnsafeDispatchJournalOperation {
  approvalRequestId: string;
  name: string;
  argumentsPreview: string;
  argumentsTruncated: boolean;
  automatic: boolean;
  state: UnsafeDispatchOperationState;
}

export interface UnsafeDispatchJournal {
  version: typeof UNSAFE_DISPATCH_JOURNAL_VERSION;
  id: string;
  conversation: {
    id: string;
    title: string;
    createdAt: string;
  };
  turn: {
    id: string;
    userEntryId: string;
    assistantEntryId: string;
    userMessage: string;
    provider: 'openai' | 'anthropic';
    model: string;
    startedAt: string;
  };
  responseId: string;
  scope: ConversationScope;
  operations: UnsafeDispatchJournalOperation[];
  createdAt: string;
  updatedAt: string;
}

export interface UnsafeDispatchJournalClaim {
  id: string;
  conversation: UnsafeDispatchJournal['conversation'];
  turn: UnsafeDispatchJournal['turn'];
  responseId: string;
  scope: ConversationScope;
  operations: UnsafeDispatchJournalOperationClaim[];
}

export interface UnsafeDispatchJournalOperationClaim {
  approvalRequestId: string;
  name: string;
  arguments: string;
  automatic: boolean;
}

export interface UnsafeDispatchJournalStore {
  readonly key: string;
  read(): UnsafeDispatchJournal | undefined;
  claim(claim: UnsafeDispatchJournalClaim): UnsafeDispatchJournal;
  appendArmed(
    journalId: string,
    responseId: string,
    operations: UnsafeDispatchJournalOperationClaim[],
  ): UnsafeDispatchJournal;
  discardArmed(
    journalId: string,
    approvalRequestIds: readonly string[],
  ): UnsafeDispatchJournal | undefined;
  markDispatched(
    journalId: string,
    approvalRequestIds: readonly string[],
  ): UnsafeDispatchJournal;
  markConfirmed(
    journalId: string,
    approvalRequestIds: readonly string[],
  ): UnsafeDispatchJournal;
  clear(journalId: string): void;
}

function boundedRequiredString(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  return value.trim().slice(0, maximum);
}

function safeIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fallback;
  }

  return new Date(value).toISOString();
}

function normalizeScope(value: unknown): ConversationScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The unsafe dispatch scope is invalid.');
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'project') {
    return { type: 'project' };
  }
  if (candidate.type === 'record') {
    return {
      type: 'record',
      recordId: boundedRequiredString(
        candidate.recordId,
        'Record ID',
        MAX_JOURNAL_ID_CHARACTERS,
      ),
    };
  }
  if (candidate.type === 'custom') {
    return {
      type: 'custom',
      id: boundedRequiredString(
        candidate.id,
        'Custom scope ID',
        MAX_JOURNAL_ID_CHARACTERS,
      ),
    };
  }

  throw new Error('The unsafe dispatch scope is invalid.');
}

function normalizeOperation(
  value: unknown,
  defaultState: UnsafeDispatchOperationState,
): UnsafeDispatchJournalOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The unsafe dispatch operation is invalid.');
  }

  const candidate = value as Record<string, unknown>;
  const rawArguments =
    typeof candidate.arguments === 'string'
      ? candidate.arguments
      : typeof candidate.argumentsPreview === 'string'
        ? candidate.argumentsPreview
        : '';
  const state =
    candidate.state === 'armed' ||
    candidate.state === 'dispatched' ||
    candidate.state === 'confirmed'
      ? candidate.state
      : defaultState;

  return {
    approvalRequestId: boundedRequiredString(
      candidate.approvalRequestId,
      'Approval request ID',
      MAX_JOURNAL_ID_CHARACTERS,
    ),
    name: boundedRequiredString(
      candidate.name,
      'Unsafe operation name',
      MAX_UNSAFE_DISPATCH_NAME_CHARACTERS,
    ),
    argumentsPreview: rawArguments.slice(
      0,
      MAX_UNSAFE_DISPATCH_ARGUMENT_CHARACTERS,
    ),
    argumentsTruncated:
      candidate.argumentsTruncated === true ||
      rawArguments.length > MAX_UNSAFE_DISPATCH_ARGUMENT_CHARACTERS,
    automatic: candidate.automatic === true,
    state,
  };
}

function normalizeJournal(value: unknown): UnsafeDispatchJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The unsafe dispatch journal is invalid.');
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== UNSAFE_DISPATCH_JOURNAL_VERSION) {
    throw new Error('The unsafe dispatch journal version is unsupported.');
  }
  if (
    !candidate.conversation ||
    typeof candidate.conversation !== 'object' ||
    Array.isArray(candidate.conversation) ||
    !candidate.turn ||
    typeof candidate.turn !== 'object' ||
    Array.isArray(candidate.turn) ||
    !Array.isArray(candidate.operations) ||
    candidate.operations.length === 0 ||
    candidate.operations.length > MAX_UNSAFE_DISPATCH_OPERATIONS
  ) {
    throw new Error('The unsafe dispatch journal is invalid.');
  }

  const now = new Date().toISOString();
  const conversation = candidate.conversation as Record<string, unknown>;
  const turn = candidate.turn as Record<string, unknown>;
  const provider =
    turn.provider === 'openai' || turn.provider === 'anthropic'
      ? turn.provider
      : undefined;
  if (!provider) {
    throw new Error('The unsafe dispatch provider is invalid.');
  }

  const operations = candidate.operations.map((operation) =>
    normalizeOperation(operation, 'armed'),
  );
  if (
    new Set(operations.map((operation) => operation.approvalRequestId)).size !==
    operations.length
  ) {
    throw new Error('Unsafe dispatch approval request IDs must be unique.');
  }

  const createdAt = safeIsoDate(candidate.createdAt, now);
  return {
    version: UNSAFE_DISPATCH_JOURNAL_VERSION,
    id: boundedRequiredString(
      candidate.id,
      'Unsafe dispatch journal ID',
      MAX_JOURNAL_ID_CHARACTERS,
    ),
    conversation: {
      id: boundedRequiredString(
        conversation.id,
        'Conversation ID',
        MAX_JOURNAL_ID_CHARACTERS,
      ),
      title:
        typeof conversation.title === 'string'
          ? conversation.title.trim().slice(0, MAX_TITLE_CHARACTERS) ||
            'New conversation'
          : 'New conversation',
      createdAt: safeIsoDate(conversation.createdAt, createdAt),
    },
    turn: {
      id: boundedRequiredString(turn.id, 'Turn ID', MAX_JOURNAL_ID_CHARACTERS),
      userEntryId: boundedRequiredString(
        turn.userEntryId,
        'User entry ID',
        MAX_JOURNAL_ID_CHARACTERS,
      ),
      assistantEntryId: boundedRequiredString(
        turn.assistantEntryId,
        'Assistant entry ID',
        MAX_JOURNAL_ID_CHARACTERS,
      ),
      userMessage: boundedRequiredString(
        turn.userMessage,
        'User message',
        MAX_CONVERSATION_MESSAGE_CHARACTERS,
      ),
      provider,
      model: boundedRequiredString(
        turn.model,
        'Provider model',
        MAX_MODEL_CHARACTERS,
      ),
      startedAt: safeIsoDate(turn.startedAt, createdAt),
    },
    responseId: boundedRequiredString(
      candidate.responseId,
      'Provider response ID',
      MAX_JOURNAL_ID_CHARACTERS,
    ),
    scope: normalizeScope(candidate.scope),
    operations,
    createdAt,
    updatedAt: safeIsoDate(candidate.updatedAt, createdAt),
  };
}

function resolveDurableStorage(storage?: StorageLike): StorageLike {
  if (storage) {
    return storage;
  }

  if (typeof window === 'undefined') {
    throw new Error('Durable browser storage is unavailable.');
  }

  try {
    return window.localStorage;
  } catch {
    throw new Error('Durable browser storage is unavailable.');
  }
}

function readRawJournal(
  target: StorageLike,
  key: string,
): UnsafeDispatchJournal | undefined {
  const raw = target.getItem(key);
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'A previous approved change could not be read from browser storage.',
    );
  }

  try {
    return normalizeJournal(parsed);
  } catch {
    throw new Error(
      'A previous approved change could not be read from browser storage.',
    );
  }
}

function verifiedWrite(
  target: StorageLike,
  key: string,
  journal: UnsafeDispatchJournal,
): UnsafeDispatchJournal {
  const normalized = normalizeJournal(journal);
  const serialized = JSON.stringify(normalized);

  try {
    target.setItem(key, serialized);
    if (target.getItem(key) !== serialized) {
      throw new Error('The journal write could not be verified.');
    }
  } catch {
    throw new Error(
      'This approved change was not sent because durable browser storage is unavailable.',
    );
  }

  return normalized;
}

export function unsafeDispatchJournalStorageKey(
  context: ConversationStorageContext,
): string {
  return `${conversationStorageKey(context)}:unsafe-dispatch:v${UNSAFE_DISPATCH_JOURNAL_VERSION}`;
}

export function createUnsafeDispatchJournalStore(
  context: ConversationStorageContext,
  storage?: StorageLike,
): UnsafeDispatchJournalStore {
  const key = unsafeDispatchJournalStorageKey(context);
  const target = () => resolveDurableStorage(storage);

  const transition = (
    journalId: string,
    approvalRequestIds: readonly string[],
    nextState: 'dispatched' | 'confirmed',
  ): UnsafeDispatchJournal => {
    const current = readRawJournal(target(), key);
    if (!current || current.id !== journalId) {
      throw new Error(
        'The approved change no longer has a matching durable dispatch journal.',
      );
    }

    const requested = new Set(approvalRequestIds);
    if (
      requested.size === 0 ||
      requested.size !== approvalRequestIds.length ||
      [...requested].some(
        (id) =>
          !current.operations.some(
            (operation) => operation.approvalRequestId === id,
          ),
      )
    ) {
      throw new Error('The unsafe dispatch journal transition is invalid.');
    }

    const updatedAt = new Date().toISOString();
    const operations = current.operations.map((operation) => {
      if (!requested.has(operation.approvalRequestId)) {
        return operation;
      }
      if (nextState === 'dispatched') {
        return operation.state === 'armed'
          ? { ...operation, state: 'dispatched' as const }
          : operation;
      }
      if (operation.state === 'armed') {
        throw new Error(
          'An unsafe operation cannot be confirmed before it is dispatched.',
        );
      }
      return { ...operation, state: 'confirmed' as const };
    });

    return verifiedWrite(target(), key, {
      ...current,
      operations,
      updatedAt,
    });
  };

  return {
    key,
    read() {
      return readRawJournal(target(), key);
    },
    claim(claim) {
      if (readRawJournal(target(), key)) {
        throw new Error(
          'A previous approved change is still being recovered. Check its outcome before approving another change.',
        );
      }

      const now = new Date().toISOString();
      return verifiedWrite(
        target(),
        key,
        normalizeJournal({
          version: UNSAFE_DISPATCH_JOURNAL_VERSION,
          ...claim,
          operations: claim.operations.map((operation) => ({
            ...operation,
            state: 'armed',
          })),
          createdAt: now,
          updatedAt: now,
        }),
      );
    },
    appendArmed(journalId, responseId, operations) {
      const storageTarget = target();
      const current = readRawJournal(storageTarget, key);
      if (!current || current.id !== journalId) {
        throw new Error(
          'The approved change no longer has a matching durable dispatch journal.',
        );
      }
      if (
        current.operations.some((operation) => operation.state !== 'confirmed')
      ) {
        throw new Error(
          'A previous approved operation still has an unconfirmed outcome.',
        );
      }
      if (
        operations.length === 0 ||
        current.operations.length + operations.length >
          MAX_UNSAFE_DISPATCH_OPERATIONS
      ) {
        throw new Error('The unsafe dispatch journal is full.');
      }

      const existingIds = new Set(
        current.operations.map((operation) => operation.approvalRequestId),
      );
      const appended = operations.map((operation) =>
        normalizeOperation({ ...operation, state: 'armed' }, 'armed'),
      );
      if (
        new Set(appended.map((operation) => operation.approvalRequestId))
          .size !== appended.length ||
        appended.some((operation) =>
          existingIds.has(operation.approvalRequestId),
        )
      ) {
        throw new Error('Unsafe dispatch approval request IDs must be unique.');
      }

      return verifiedWrite(storageTarget, key, {
        ...current,
        responseId: boundedRequiredString(
          responseId,
          'Provider response ID',
          MAX_JOURNAL_ID_CHARACTERS,
        ),
        operations: [...current.operations, ...appended],
        updatedAt: new Date().toISOString(),
      });
    },
    discardArmed(journalId, approvalRequestIds) {
      const storageTarget = target();
      const current = readRawJournal(storageTarget, key);
      if (!current || current.id !== journalId) {
        throw new Error(
          'The approved change no longer has a matching durable dispatch journal.',
        );
      }

      const requested = new Set(approvalRequestIds);
      if (
        requested.size === 0 ||
        requested.size !== approvalRequestIds.length ||
        [...requested].some(
          (id) =>
            !current.operations.some(
              (operation) =>
                operation.approvalRequestId === id &&
                operation.state === 'armed',
            ),
        )
      ) {
        throw new Error('Only armed unsafe operations can be discarded.');
      }

      const operations = current.operations.filter(
        (operation) => !requested.has(operation.approvalRequestId),
      );
      if (operations.length === 0) {
        storageTarget.removeItem(key);
        if (storageTarget.getItem(key) !== null) {
          throw new Error(
            'The cancelled change journal could not be cleared from browser storage.',
          );
        }
        return undefined;
      }

      return verifiedWrite(storageTarget, key, {
        ...current,
        operations,
        updatedAt: new Date().toISOString(),
      });
    },
    markDispatched(journalId, approvalRequestIds) {
      return transition(journalId, approvalRequestIds, 'dispatched');
    },
    markConfirmed(journalId, approvalRequestIds) {
      return transition(journalId, approvalRequestIds, 'confirmed');
    },
    clear(journalId) {
      const storageTarget = target();
      const current = readRawJournal(storageTarget, key);
      if (!current) {
        return;
      }
      if (current.id !== journalId) {
        throw new Error(
          'A newer unsafe dispatch journal cannot be cleared by this turn.',
        );
      }

      try {
        storageTarget.removeItem(key);
        if (storageTarget.getItem(key) !== null) {
          throw new Error('The journal removal could not be verified.');
        }
      } catch {
        throw new Error(
          'The completed change journal could not be cleared from browser storage.',
        );
      }
    },
  };
}
