import {
  CONVERSATION_STORAGE_VERSION,
  type Conversation,
  type ConversationScope,
  type ConversationStorageContext,
  conversationScopeIndexStorageKey,
  conversationStorageKey,
  createConversationStore,
  DEFAULT_MAX_CONVERSATIONS,
  type StorageLike,
} from './conversations';

const PENDING_SCOPE_MIGRATION_VERSION = 1;

type NewRecordConversationScope = Extract<
  ConversationScope,
  { type: 'custom' }
>;

interface PendingScopeMigrationEnvelope {
  version: typeof PENDING_SCOPE_MIGRATION_VERSION;
  sourceScope: NewRecordConversationScope;
}

export type ConversationScopeMigrationResult =
  | 'migrated'
  | 'not-needed'
  | 'failed';

function hasSupportedEnvelope(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (
      parsed.version === CONVERSATION_STORAGE_VERSION &&
      Array.isArray(parsed.conversations)
    );
  } catch {
    return false;
  }
}

function isNewRecordScope(
  scope: ConversationScope,
): scope is NewRecordConversationScope {
  return scope.type === 'custom' && scope.id.startsWith('new:');
}

function isRecoverableNewRecordMigration(
  sourceContext: ConversationStorageContext,
  targetContext: ConversationStorageContext,
): sourceContext is ConversationStorageContext & {
  scope: NewRecordConversationScope;
} {
  return (
    isNewRecordScope(sourceContext.scope) &&
    targetContext.scope.type === 'record'
  );
}

function pendingScopeMigrationStorageKey(
  targetContext: ConversationStorageContext,
): string {
  return `datocms-agent-pending-scope-migration:v${PENDING_SCOPE_MIGRATION_VERSION}:${encodeURIComponent(
    conversationStorageKey(targetContext),
  )}`;
}

function readPendingScopeMigration(
  targetContext: ConversationStorageContext,
  storage: StorageLike,
): NewRecordConversationScope | undefined {
  const key = pendingScopeMigrationStorageKey(targetContext);
  let raw: string | null;

  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingScopeMigrationEnvelope>;
    const sourceScope = parsed.sourceScope;
    if (
      parsed.version === PENDING_SCOPE_MIGRATION_VERSION &&
      sourceScope &&
      isNewRecordScope(sourceScope)
    ) {
      return sourceScope;
    }
  } catch {
    // Remove malformed recovery metadata below.
  }

  try {
    storage.removeItem(key);
  } catch {
    // Invalid recovery metadata is ignored when browser storage is blocked.
  }
  return undefined;
}

function rememberPendingScopeMigration(
  sourceContext: ConversationStorageContext & {
    scope: NewRecordConversationScope;
  },
  targetContext: ConversationStorageContext,
  storage: StorageLike,
): void {
  const envelope: PendingScopeMigrationEnvelope = {
    version: PENDING_SCOPE_MIGRATION_VERSION,
    sourceScope: sourceContext.scope,
  };
  const key = pendingScopeMigrationStorageKey(targetContext);
  const value = JSON.stringify(envelope);

  try {
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) {
      storage.removeItem(key);
    }
  } catch {
    // Migration can still succeed when only its recovery marker is blocked.
  }
}

function clearPendingScopeMigration(
  sourceContext: ConversationStorageContext,
  targetContext: ConversationStorageContext,
  storage: StorageLike,
): void {
  if (
    readPendingScopeMigration(targetContext, storage)?.id !==
    (sourceContext.scope.type === 'custom' ? sourceContext.scope.id : undefined)
  ) {
    return;
  }

  try {
    storage.removeItem(pendingScopeMigrationStorageKey(targetContext));
  } catch {
    // A stale marker is harmless: the next retry becomes a no-op and clears it.
  }
}

export function pendingConversationScopeMigrationSource(
  targetContext: ConversationStorageContext,
  storage: StorageLike,
): NewRecordConversationScope | undefined {
  return readPendingScopeMigration(targetContext, storage);
}

function restoreValue(
  storage: StorageLike,
  key: string,
  previousValue: string | null,
): boolean {
  try {
    if (previousValue === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, previousValue);
    }
    return storage.getItem(key) === previousValue;
  } catch {
    return false;
  }
}

function mergeConversations(
  source: readonly Conversation[],
  target: readonly Conversation[],
): Conversation[] {
  const sourceIds = new Set(source.map((conversation) => conversation.id));
  const targetFillers = target
    .filter((conversation) => !sourceIds.has(conversation.id))
    .slice(0, Math.max(0, DEFAULT_MAX_CONVERSATIONS - source.length));

  return [...source.slice(0, DEFAULT_MAX_CONVERSATIONS), ...targetFillers];
}

/**
 * Copies a conversation scope through the regular stores, so their compaction,
 * aggregate quota, LRU index, and verified-write rules remain authoritative.
 * The source is only cleared after every copied conversation is read back. A
 * small recovery marker lets a saved record retry an interrupted migration
 * after its original form iframe has closed.
 */
export function migrateConversationScope(
  sourceContext: ConversationStorageContext,
  targetContext: ConversationStorageContext,
  storage: StorageLike,
): ConversationScopeMigrationResult {
  let sourceKey: string;
  let targetKey: string;
  let indexKey: string;
  let sourceRaw: string | null;
  let targetRaw: string | null;
  let indexRaw: string | null;

  try {
    sourceKey = conversationStorageKey(sourceContext);
    targetKey = conversationStorageKey(targetContext);
    indexKey = conversationScopeIndexStorageKey(sourceContext);
    if (sourceKey === targetKey) {
      return 'not-needed';
    }
    sourceRaw = storage.getItem(sourceKey);
    if (sourceRaw === null) {
      clearPendingScopeMigration(sourceContext, targetContext, storage);
      return 'not-needed';
    }
    targetRaw = storage.getItem(targetKey);
    indexRaw = storage.getItem(indexKey);
  } catch {
    return 'failed';
  }

  if (
    !hasSupportedEnvelope(sourceRaw) ||
    (targetRaw !== null && !hasSupportedEnvelope(targetRaw))
  ) {
    return 'failed';
  }

  if (isRecoverableNewRecordMigration(sourceContext, targetContext)) {
    rememberPendingScopeMigration(sourceContext, targetContext, storage);
  }

  const sourceStore = createConversationStore(sourceContext, storage);
  const targetStore = createConversationStore(targetContext, storage);

  try {
    const source = sourceStore.list();
    if (source.length === 0) {
      clearPendingScopeMigration(sourceContext, targetContext, storage);
      return 'not-needed';
    }
    const merged = mergeConversations(source, targetStore.list());

    targetStore.clear();
    for (const conversation of merged) {
      targetStore.save(conversation);
    }

    const copiedIds = new Set(
      targetStore.list().map((conversation) => conversation.id),
    );
    if (source.some((conversation) => !copiedIds.has(conversation.id))) {
      throw new Error('Not every new-record conversation was copied.');
    }

    sourceStore.clear();
    clearPendingScopeMigration(sourceContext, targetContext, storage);
    return 'migrated';
  } catch {
    const sourceRecovered = restoreValue(storage, sourceKey, sourceRaw);
    if (sourceRecovered) {
      restoreValue(storage, targetKey, targetRaw);
      restoreValue(storage, indexKey, indexRaw);
    }
    return 'failed';
  }
}

export function pendingConversationScopeMigrationSourceInBrowser(
  targetContext: ConversationStorageContext,
): NewRecordConversationScope | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return pendingConversationScopeMigrationSource(
      targetContext,
      window.localStorage,
    );
  } catch {
    return undefined;
  }
}

export function migrateConversationScopeInBrowser(
  sourceContext: ConversationStorageContext,
  targetContext: ConversationStorageContext,
): ConversationScopeMigrationResult {
  if (typeof window === 'undefined') {
    return 'failed';
  }

  try {
    return migrateConversationScope(
      sourceContext,
      targetContext,
      window.localStorage,
    );
  } catch {
    return 'failed';
  }
}
