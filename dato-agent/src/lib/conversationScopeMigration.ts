import {
  CONVERSATION_STORAGE_VERSION,
  type Conversation,
  type ConversationStorageContext,
  conversationScopeIndexStorageKey,
  conversationStorageKey,
  createConversationStore,
  DEFAULT_MAX_CONVERSATIONS,
  type StorageLike,
} from './conversations';

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
 * The source is only cleared after every copied conversation is read back.
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

  const sourceStore = createConversationStore(sourceContext, storage);
  const targetStore = createConversationStore(targetContext, storage);

  try {
    const source = sourceStore.list();
    if (source.length === 0) {
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
