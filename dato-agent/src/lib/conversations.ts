export const CONVERSATION_STORAGE_VERSION = 1;
export const DEFAULT_MAX_CONVERSATIONS = 6;
export const DEFAULT_MAX_MESSAGES = 80;
export const MAX_CONVERSATION_MESSAGE_CHARACTERS = 20_000;
export const DEFAULT_MAX_MESSAGE_CHARACTERS =
  MAX_CONVERSATION_MESSAGE_CHARACTERS;
export const DEFAULT_MAX_TITLE_CHARACTERS = 120;
/**
 * localStorage is commonly limited to roughly 5 MiB for an origin. Keep
 * conversation history well below that shared quota: at most ~0.5 MiB of
 * UTF-16 data for one scope and ~3 MiB across the Dato Agent origin.
 */
export const DEFAULT_MAX_SCOPE_CHARACTERS = 256_000;
export const DEFAULT_MAX_AGGREGATE_CHARACTERS = 1_500_000;
export const DEFAULT_MAX_TRACKED_SCOPES = 24;
export const CONVERSATION_SCOPE_INDEX_VERSION = 1;
export const MAX_RECORD_RESULT_GROUPS_PER_MESSAGE = 4;
export const MAX_RECORD_RESULTS_PER_GROUP = 20;
export const MAX_FIELD_RESULT_GROUPS_PER_MESSAGE = 4;
export const MAX_FIELD_RESULTS_PER_GROUP = 20;
export const MAX_ASSET_RESULT_GROUPS_PER_MESSAGE = 4;
export const MAX_ASSET_RESULTS_PER_GROUP = 20;
export const MAX_MENTION_RESULT_GROUPS_PER_MESSAGE = 4;
export const MAX_MENTION_RESULTS_PER_GROUP = 20;
export const MAX_RECORD_RESULT_TITLE_CHARACTERS = 200;
export const MAX_RECORD_RESULT_REFERENCE_CHARACTERS = 512;

export type ConversationScope =
  | { type: 'project' }
  | { type: 'record'; recordId: string }
  | { type: 'custom'; id: string };

export interface ConversationStorageContext {
  pluginId: string;
  siteId: string;
  environment: string;
  currentUserId: string;
  scope: ConversationScope;
}

export interface ConversationRecordResult {
  itemId: string;
  itemTypeId?: string;
  title: string;
  fieldPath?: string;
  mention?: Extract<Mention, { type: 'record' }>;
}

export interface ConversationRecordResultGroup {
  id: string;
  title?: string;
  records: ConversationRecordResult[];
}

export interface ConversationFieldResult {
  fieldPath: string;
  title: string;
  locale?: string;
  mention?: Extract<Mention, { type: 'field' }>;
}

export interface ConversationFieldResultGroup {
  id: string;
  title?: string;
  fields: ConversationFieldResult[];
}

export interface ConversationAssetResult {
  uploadId: string;
  title: string;
  deleted?: boolean;
  mention?: Extract<Mention, { type: 'asset' }>;
}

export interface ConversationAssetResultGroup {
  id: string;
  title?: string;
  assets: ConversationAssetResult[];
}

export interface ConversationMentionResultGroup {
  id: string;
  title?: string;
  mentions: Mention[];
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  /**
   * A partial assistant response that remains visible in chat history but must
   * never be replayed to a provider as a completed assistant turn.
   */
  interrupted?: boolean;
  /** Exact host-picked references used to render a user message. */
  segments?: CommentSegment[];
  /**
   * Bounded, presentation-only record receipts emitted during this assistant
   * turn. They are restored in the chat UI but never replayed to a provider.
   */
  recordResults?: ConversationRecordResultGroup[];
  /**
   * Bounded, presentation-only field receipts. They restore clickable links
   * for the current record sidebar but are never replayed to a provider.
   */
  fieldResults?: ConversationFieldResultGroup[];
  /**
   * Bounded, presentation-only upload receipts. Deleted state is retained so a
   * stale upload cannot be opened again after the chat is restored.
   */
  assetResults?: ConversationAssetResultGroup[];
  /** Tool-verified model and user references emitted by the assistant. */
  mentionResults?: ConversationMentionResultGroup[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  previousResponseId?: string;
  /**
   * Provider/model identity for the transient response chain. Visible chat text
   * remains portable across providers; opaque provider state never is.
   */
  responseProvider?: 'openai' | 'anthropic';
  responseModel?: string;
  /**
   * Identifies the most recent host-provided CMS context snapshot already
   * present in the stored Responses chain. The snapshot itself is never stored
   * in browser persistence.
   */
  hostContextFingerprint?: string;
  messages: ConversationMessage[];
}

export interface ConversationStoreOptions {
  maxConversations?: number;
  maxMessages?: number;
  maxMessageCharacters?: number;
  maxTitleCharacters?: number;
  maxScopeCharacters?: number;
  maxAggregateCharacters?: number;
  maxTrackedScopes?: number;
}

export interface StorageLike {
  readonly length?: number;
  getItem(key: string): string | null;
  key?(index: number): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ConversationStore {
  readonly key: string;
  list(): Conversation[];
  get(id: string): Conversation | undefined;
  save(conversation: Conversation): Conversation;
  remove(id: string): void;
  clear(): void;
}

const LEGACY_DEMO_TRANSCRIPT = [
  {
    role: 'user',
    text: 'Update the Homepage title to “A clearer title”.',
  },
  {
    role: 'assistant',
    text: 'I found the relevant content and prepared a focused change. Please review the exact target and script before it runs.',
  },
  {
    role: 'assistant',
    text: 'Demo mode: the approval flow completed successfully. No playground content was changed.',
  },
] as const;

interface StoredConversationEnvelope {
  version: typeof CONVERSATION_STORAGE_VERSION;
  conversations: unknown[];
}

interface ConversationScopeIndexEntry {
  key: string;
  accessedAt: string;
  characters: number;
}

interface StoredConversationScopeIndex {
  version: typeof CONVERSATION_SCOPE_INDEX_VERSION;
  scopes: ConversationScopeIndexEntry[];
}

export class ConversationStorageError extends Error {
  override readonly name = 'ConversationStorageError';
}

const SECRET_KEY_VALUE_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?token|authorization|client[_-]?secret|password|secret|token)["']?\s*[:=]\s*["']?)([^"',\s}\]]+)/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const PROVIDER_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;

function normalizeRequiredKeyPart(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} is required for conversation storage.`);
  }

  return normalized;
}

function scopeKey(scope: ConversationScope): string {
  switch (scope.type) {
    case 'project':
      return 'project';
    case 'record':
      return `record:${normalizeRequiredKeyPart(scope.recordId, 'Record ID')}`;
    case 'custom':
      return `custom:${normalizeRequiredKeyPart(scope.id, 'Scope ID')}`;
  }
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function conversationStorageIdentityKey(
  context: ConversationStorageContext,
): string {
  const parts = [
    normalizeRequiredKeyPart(context.pluginId, 'Plugin ID'),
    normalizeRequiredKeyPart(context.siteId, 'Site ID'),
    normalizeRequiredKeyPart(context.environment, 'Environment ID'),
    normalizeRequiredKeyPart(context.currentUserId, 'Current user ID'),
  ];

  return `datocms-agent:v${CONVERSATION_STORAGE_VERSION}:${parts
    .map(encodeKeyPart)
    .join(':')}`;
}

export function conversationStorageKey(
  context: ConversationStorageContext,
): string {
  return `${conversationStorageIdentityKey(context)}:${encodeKeyPart(
    scopeKey(context.scope),
  )}`;
}

export function conversationScopeIndexStorageKey(
  _context?: ConversationStorageContext,
): string {
  return `datocms-agent:v${CONVERSATION_STORAGE_VERSION}:scope-index`;
}

/**
 * Persistence accepts conversation text and bounded record-navigation receipts,
 * and redacts common credential forms from user-facing labels. Tool arguments,
 * tool output, provider configuration, and OAuth tokens are deliberately absent
 * from the persisted schema.
 */
export function redactConversationSecrets(value: string): string {
  return value
    .replace(BEARER_PATTERN, '$1[redacted]')
    .replace(PROVIDER_KEY_PATTERN, '[redacted]')
    .replace(SECRET_KEY_VALUE_PATTERN, '$1[redacted]');
}

/**
 * An early playground build stored its canned demo in the same namespace as
 * real conversations. Remove only that exact leading signature, leaving any
 * genuine messages written after it intact.
 */
export function withoutLegacyDemoTranscript(
  conversation: Conversation,
): Conversation {
  const hasLegacyPrefix = LEGACY_DEMO_TRANSCRIPT.every(
    (expected, index) =>
      conversation.messages[index]?.role === expected.role &&
      conversation.messages[index]?.text === expected.text,
  );

  if (!hasLegacyPrefix) {
    return conversation;
  }

  const messages = conversation.messages.slice(LEGACY_DEMO_TRANSCRIPT.length);
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const { previousResponseId, ...rest } = conversation;

  return {
    ...rest,
    title: firstUserMessage
      ? firstUserMessage.text.slice(0, 80)
      : 'New conversation',
    messages,
    ...(messages.length > 0 && previousResponseId
      ? { previousResponseId }
      : {}),
  };
}

function positiveIntegerOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : fallback;
}

function safeIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : fallback;
}

function normalizePreviousResponseId(value: unknown): string | undefined {
  return typeof value === 'string' && /^resp_[A-Za-z0-9_-]+$/.test(value)
    ? value
    : undefined;
}

function normalizeHostContextFingerprint(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : undefined;
}

function normalizeResponseProvider(
  value: unknown,
): Conversation['responseProvider'] {
  return value === 'openai' || value === 'anthropic' ? value : undefined;
}

function normalizeResponseModel(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,200}$/.test(value)
    ? value
    : undefined;
}

function normalizeRecordResultReference(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });

  return normalized &&
    normalized.length <= MAX_RECORD_RESULT_REFERENCE_CHARACTERS &&
    !hasControlCharacter
    ? normalized
    : undefined;
}

function normalizeRecordResultTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return (
    redactConversationSecrets(value)
      .trim()
      .slice(0, MAX_RECORD_RESULT_TITLE_CHARACTERS) || undefined
  );
}

function normalizeRecordResult(
  value: unknown,
): ConversationRecordResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const itemId = normalizeRecordResultReference(candidate.itemId);
  const title = normalizeRecordResultTitle(candidate.title);

  if (!itemId || !title) {
    return undefined;
  }

  const itemTypeId = normalizeRecordResultReference(candidate.itemTypeId);
  const fieldPath = normalizeRecordResultReference(candidate.fieldPath);
  const candidateMention = normalizeMention(candidate.mention);
  const mention =
    candidateMention?.type === 'record' &&
    candidateMention.id === itemId &&
    (!itemTypeId || candidateMention.modelId === itemTypeId)
      ? candidateMention
      : undefined;

  return {
    itemId,
    title,
    ...(itemTypeId ? { itemTypeId } : {}),
    ...(fieldPath ? { fieldPath } : {}),
    ...(mention ? { mention } : {}),
  };
}

function normalizeRecordResultGroup(
  value: unknown,
): ConversationRecordResultGroup | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const id = normalizeRecordResultReference(candidate.id);
  if (!id || !Array.isArray(candidate.records)) {
    return undefined;
  }

  const records = candidate.records
    .flatMap((record): ConversationRecordResult[] => {
      const normalized = normalizeRecordResult(record);
      return normalized ? [normalized] : [];
    })
    .filter(
      (record, index, all) =>
        all.findIndex((candidate) => candidate.itemId === record.itemId) ===
        index,
    )
    .slice(0, MAX_RECORD_RESULTS_PER_GROUP);

  if (records.length === 0) {
    return undefined;
  }

  const title = normalizeRecordResultTitle(candidate.title);

  return {
    id,
    ...(title ? { title } : {}),
    records,
  };
}

function normalizeRecordResults(
  value: unknown,
): ConversationRecordResultGroup[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups = value
    .flatMap((group): ConversationRecordResultGroup[] => {
      const normalized = normalizeRecordResultGroup(group);
      return normalized ? [normalized] : [];
    })
    .filter(
      (group, index, all) =>
        all.findIndex((candidate) => candidate.id === group.id) === index,
    )
    .slice(0, MAX_RECORD_RESULT_GROUPS_PER_MESSAGE);

  return groups.length > 0 ? groups : undefined;
}

function normalizeFieldResult(
  value: unknown,
): ConversationFieldResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const fieldPath = normalizeRecordResultReference(candidate.fieldPath);
  const title = normalizeRecordResultTitle(candidate.title);
  const locale = normalizeRecordResultReference(candidate.locale);

  if (!fieldPath || !title) {
    return undefined;
  }

  const candidateMention = normalizeMention(candidate.mention);
  const mention =
    candidateMention?.type === 'field' &&
    candidateMention.fieldPath === fieldPath &&
    candidateMention.locale === locale
      ? candidateMention
      : undefined;

  return {
    fieldPath,
    title,
    ...(locale ? { locale } : {}),
    ...(mention ? { mention } : {}),
  };
}

function normalizeFieldResultGroup(
  value: unknown,
): ConversationFieldResultGroup | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const id = normalizeRecordResultReference(candidate.id);
  if (!id || !Array.isArray(candidate.fields)) {
    return undefined;
  }

  const fields = candidate.fields
    .flatMap((field): ConversationFieldResult[] => {
      const normalized = normalizeFieldResult(field);
      return normalized ? [normalized] : [];
    })
    .filter(
      (field, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.fieldPath === field.fieldPath &&
            candidate.locale === field.locale,
        ) === index,
    )
    .slice(0, MAX_FIELD_RESULTS_PER_GROUP);

  if (fields.length === 0) {
    return undefined;
  }

  const title = normalizeRecordResultTitle(candidate.title);
  return {
    id,
    ...(title ? { title } : {}),
    fields,
  };
}

function normalizeFieldResults(
  value: unknown,
): ConversationFieldResultGroup[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups = value
    .flatMap((group): ConversationFieldResultGroup[] => {
      const normalized = normalizeFieldResultGroup(group);
      return normalized ? [normalized] : [];
    })
    .filter(
      (group, index, all) =>
        all.findIndex((candidate) => candidate.id === group.id) === index,
    )
    .slice(0, MAX_FIELD_RESULT_GROUPS_PER_MESSAGE);

  return groups.length > 0 ? groups : undefined;
}

function normalizeAssetResult(
  value: unknown,
): ConversationAssetResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const uploadId = normalizeRecordResultReference(candidate.uploadId);
  const title = normalizeRecordResultTitle(candidate.title);

  if (!uploadId || !title) {
    return undefined;
  }

  const candidateMention = normalizeMention(candidate.mention);
  const mention =
    candidateMention?.type === 'asset' && candidateMention.id === uploadId
      ? candidateMention
      : undefined;

  return {
    uploadId,
    title,
    ...(candidate.deleted === true ? { deleted: true } : {}),
    ...(mention ? { mention } : {}),
  };
}

function normalizeAssetResultGroup(
  value: unknown,
): ConversationAssetResultGroup | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const id = normalizeRecordResultReference(candidate.id);
  if (!id || !Array.isArray(candidate.assets)) {
    return undefined;
  }

  const assets = candidate.assets
    .flatMap((asset): ConversationAssetResult[] => {
      const normalized = normalizeAssetResult(asset);
      return normalized ? [normalized] : [];
    })
    .filter(
      (asset, index, all) =>
        all.findIndex((candidate) => candidate.uploadId === asset.uploadId) ===
        index,
    )
    .slice(0, MAX_ASSET_RESULTS_PER_GROUP);

  if (assets.length === 0) {
    return undefined;
  }

  const title = normalizeRecordResultTitle(candidate.title);
  return {
    id,
    ...(title ? { title } : {}),
    assets,
  };
}

function normalizeAssetResults(
  value: unknown,
): ConversationAssetResultGroup[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups = value
    .flatMap((group): ConversationAssetResultGroup[] => {
      const normalized = normalizeAssetResultGroup(group);
      return normalized ? [normalized] : [];
    })
    .filter(
      (group, index, all) =>
        all.findIndex((candidate) => candidate.id === group.id) === index,
    )
    .slice(0, MAX_ASSET_RESULT_GROUPS_PER_MESSAGE);

  return groups.length > 0 ? groups : undefined;
}

function normalizeMentionResultGroup(
  value: unknown,
): ConversationMentionResultGroup | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const id = normalizeRecordResultReference(candidate.id);
  if (!id || !Array.isArray(candidate.mentions)) return undefined;

  const mentions = candidate.mentions
    .flatMap((mention): Mention[] => {
      const normalized = normalizeMention(mention);
      return normalized ? [normalized] : [];
    })
    .filter((mention, index, all) => {
      const key =
        mention.type === 'field'
          ? `${mention.type}:${mention.fieldPath}:${mention.locale ?? ''}`
          : `${mention.type}:${mention.id}`;
      return (
        all.findIndex((candidateMention) => {
          const candidateKey =
            candidateMention.type === 'field'
              ? `${candidateMention.type}:${candidateMention.fieldPath}:${candidateMention.locale ?? ''}`
              : `${candidateMention.type}:${candidateMention.id}`;
          return candidateKey === key;
        }) === index
      );
    })
    .slice(0, MAX_MENTION_RESULTS_PER_GROUP);
  if (mentions.length === 0) return undefined;

  const title = normalizeRecordResultTitle(candidate.title);
  return { id, ...(title ? { title } : {}), mentions };
}

function normalizeMentionResults(
  value: unknown,
): ConversationMentionResultGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = value
    .flatMap((group): ConversationMentionResultGroup[] => {
      const normalized = normalizeMentionResultGroup(group);
      return normalized ? [normalized] : [];
    })
    .filter(
      (group, index, all) =>
        all.findIndex((candidate) => candidate.id === group.id) === index,
    )
    .slice(0, MAX_MENTION_RESULT_GROUPS_PER_MESSAGE);
  return groups.length > 0 ? groups : undefined;
}

function assistantReceiptResults(
  message: Record<string, unknown>,
): Pick<
  ConversationMessage,
  'recordResults' | 'fieldResults' | 'assetResults' | 'mentionResults'
> {
  return {
    recordResults: normalizeRecordResults(message.recordResults),
    fieldResults: normalizeFieldResults(message.fieldResults),
    assetResults: normalizeAssetResults(message.assetResults),
    mentionResults: normalizeMentionResults(message.mentionResults),
  };
}

function normalizeConversationMessage(
  rawMessage: unknown,
  createdAt: string,
  options: Required<ConversationStoreOptions>,
): ConversationMessage | undefined {
  if (
    !rawMessage ||
    typeof rawMessage !== 'object' ||
    Array.isArray(rawMessage)
  ) {
    return undefined;
  }

  const message = rawMessage as Record<string, unknown>;
  if (
    typeof message.id !== 'string' ||
    !message.id.trim() ||
    (message.role !== 'user' && message.role !== 'assistant') ||
    typeof message.text !== 'string'
  ) {
    return undefined;
  }

  const normalized: ConversationMessage = {
    id: message.id.trim(),
    role: message.role,
    text: redactConversationSecrets(message.text).slice(
      0,
      options.maxMessageCharacters,
    ),
    createdAt: safeIsoDate(message.createdAt, createdAt),
  };

  const segments = normalizeCommentSegments(
    message.segments,
    options.maxMessageCharacters,
  );
  if (segments) {
    normalized.segments = segments;
  }

  if (message.role !== 'assistant') {
    return normalized;
  }

  if (message.interrupted === true) {
    normalized.interrupted = true;
  }
  const { recordResults, fieldResults, assetResults, mentionResults } =
    assistantReceiptResults(message);
  if (recordResults) {
    normalized.recordResults = recordResults;
  }
  if (fieldResults) {
    normalized.fieldResults = fieldResults;
  }
  if (assetResults) {
    normalized.assetResults = assetResults;
  }
  if (mentionResults) {
    normalized.mentionResults = mentionResults;
  }

  return normalized;
}

function normalizeConversation(
  value: unknown,
  options: Required<ConversationStoreOptions>,
): Conversation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return undefined;
  }

  const now = new Date().toISOString();
  const createdAt = safeIsoDate(candidate.createdAt, now);
  const updatedAt = safeIsoDate(candidate.updatedAt, createdAt);
  const rawMessages = Array.isArray(candidate.messages)
    ? candidate.messages
    : [];
  const messages = rawMessages
    .flatMap((rawMessage) => {
      const normalized = normalizeConversationMessage(
        rawMessage,
        createdAt,
        options,
      );
      return normalized ? [normalized] : [];
    })
    .slice(-options.maxMessages);
  const titleSource =
    typeof candidate.title === 'string' ? candidate.title : 'New conversation';
  const previousResponseId = normalizePreviousResponseId(
    candidate.previousResponseId,
  );
  const hostContextFingerprint = normalizeHostContextFingerprint(
    candidate.hostContextFingerprint,
  );
  const responseProvider = normalizeResponseProvider(
    candidate.responseProvider,
  );
  const responseModel = normalizeResponseModel(candidate.responseModel);

  return {
    id: candidate.id.trim(),
    title:
      redactConversationSecrets(titleSource)
        .trim()
        .slice(0, options.maxTitleCharacters) || 'New conversation',
    createdAt,
    updatedAt,
    ...(previousResponseId ? { previousResponseId } : {}),
    ...(responseProvider ? { responseProvider } : {}),
    ...(responseModel ? { responseModel } : {}),
    ...(hostContextFingerprint ? { hostContextFingerprint } : {}),
    messages,
  };
}

function normalizeStoredConversations(
  conversations: readonly unknown[],
  options: Required<ConversationStoreOptions>,
): Conversation[] {
  return conversations.flatMap((conversation) => {
    const normalized = normalizeConversation(conversation, options);
    return normalized ? [normalized] : [];
  });
}

const memoryValues = new Map<string, string>();
const memoryStorage: StorageLike = {
  get length() {
    return memoryValues.size;
  },
  getItem: (key) => memoryValues.get(key) ?? null,
  key: (index) => [...memoryValues.keys()][index] ?? null,
  setItem: (key, value) => {
    memoryValues.set(key, value);
  },
  removeItem: (key) => {
    memoryValues.delete(key);
  },
};

const unavailableBrowserStorage: StorageLike = {
  getItem() {
    throw new ConversationStorageError(
      'Conversation browser storage is unavailable.',
    );
  },
  setItem() {
    throw new ConversationStorageError(
      'Conversation browser storage is unavailable.',
    );
  },
  removeItem() {
    throw new ConversationStorageError(
      'Conversation browser storage is unavailable.',
    );
  },
};

function resolveStorage(storage: StorageLike | undefined): StorageLike {
  if (storage) {
    return storage;
  }

  if (typeof window !== 'undefined') {
    try {
      if (!window.localStorage) {
        return unavailableBrowserStorage;
      }
      return window.localStorage;
    } catch {
      return unavailableBrowserStorage;
    }
  }

  return memoryStorage;
}

function storageRead(target: StorageLike, key: string): string | null {
  try {
    return target.getItem(key);
  } catch {
    throw new ConversationStorageError(
      'Conversation history could not be read from browser storage.',
    );
  }
}

function parseStoredConversationEnvelope(
  raw: string,
): StoredConversationEnvelope | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).version !==
      CONVERSATION_STORAGE_VERSION ||
    !Array.isArray((parsed as Record<string, unknown>).conversations)
  ) {
    return undefined;
  }

  return parsed as StoredConversationEnvelope;
}

function serializeConversations(conversations: Conversation[]): string {
  const envelope: StoredConversationEnvelope = {
    version: CONVERSATION_STORAGE_VERSION,
    conversations,
  };
  return JSON.stringify(envelope);
}

function cloneConversations(
  conversations: readonly Conversation[],
): Conversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => {
      const cloned: ConversationMessage = { ...message };
      if (message.segments) {
        cloned.segments = message.segments.map((segment) =>
          segment.type === 'text'
            ? { ...segment }
            : { type: 'mention', mention: { ...segment.mention } },
        );
      }
      if (message.recordResults) {
        cloned.recordResults = message.recordResults.map((group) => ({
          ...group,
          records: group.records.map((record) => ({
            ...record,
            ...(record.mention ? { mention: { ...record.mention } } : {}),
          })),
        }));
      }
      if (message.fieldResults) {
        cloned.fieldResults = message.fieldResults.map((group) => ({
          ...group,
          fields: group.fields.map((field) => ({
            ...field,
            ...(field.mention ? { mention: { ...field.mention } } : {}),
          })),
        }));
      }
      if (message.assetResults) {
        cloned.assetResults = message.assetResults.map((group) => ({
          ...group,
          assets: group.assets.map((asset) => ({
            ...asset,
            ...(asset.mention ? { mention: { ...asset.mention } } : {}),
          })),
        }));
      }
      if (message.mentionResults) {
        cloned.mentionResults = message.mentionResults.map((group) => ({
          ...group,
          mentions: group.mentions.map((mention) => ({ ...mention })),
        }));
      }
      return cloned;
    }),
  }));
}

/**
 * Remove one complete oldest turn while retaining a user-led suffix. This
 * avoids restoring an orphaned assistant answer after history is compacted.
 */
function removeOldestCompleteTurn(messages: ConversationMessage[]): boolean {
  const firstUserIndex = messages.findIndex(
    (message) => message.role === 'user',
  );

  if (firstUserIndex > 0) {
    messages.splice(0, firstUserIndex);
    return true;
  }

  if (firstUserIndex === 0) {
    const nextUserIndex = messages.findIndex(
      (message, index) => index > 0 && message.role === 'user',
    );
    if (nextUserIndex > 0) {
      messages.splice(0, nextUserIndex);
      return true;
    }
    return false;
  }

  if (messages.length > 1) {
    messages.shift();
    return true;
  }

  return false;
}

function removeOldestReceiptGroup(messages: ConversationMessage[]): boolean {
  const receiptKeys = [
    'recordResults',
    'fieldResults',
    'assetResults',
    'mentionResults',
  ] as const;

  for (const message of messages) {
    for (const receiptKey of receiptKeys) {
      const groups = message[receiptKey];
      if (!groups?.length) {
        continue;
      }

      groups.shift();
      if (groups.length === 0) {
        delete message[receiptKey];
      }
      return true;
    }
  }

  return false;
}

function fitConversationsToCharacterBudget(
  source: readonly Conversation[],
  maxCharacters: number,
): { conversations: Conversation[]; serialized: string } {
  const conversations = cloneConversations(source);
  let serialized = serializeConversations(conversations);

  while (serialized.length > maxCharacters) {
    const oldestConversation =
      conversations.length > 1
        ? conversations[conversations.length - 1]
        : undefined;

    if (oldestConversation) {
      if (removeOldestCompleteTurn(oldestConversation.messages)) {
        serialized = serializeConversations(conversations);
        continue;
      }

      conversations.pop();
      serialized = serializeConversations(conversations);
      continue;
    }

    const newestConversation = conversations[0];
    if (
      newestConversation &&
      removeOldestCompleteTurn(newestConversation.messages)
    ) {
      serialized = serializeConversations(conversations);
      continue;
    }

    if (
      newestConversation &&
      removeOldestReceiptGroup(newestConversation.messages)
    ) {
      serialized = serializeConversations(conversations);
      continue;
    }

    throw new ConversationStorageError(
      'The newest conversation is too large to fit in browser storage.',
    );
  }

  return { conversations, serialized };
}

function storageSetVerified(
  target: StorageLike,
  key: string,
  value: string,
): void {
  try {
    target.setItem(key, value);
    if (target.getItem(key) !== value) {
      throw new Error('The browser storage write could not be verified.');
    }
  } catch {
    throw new ConversationStorageError(
      'Conversation history could not be saved in browser storage.',
    );
  }
}

function storageRemoveVerified(target: StorageLike, key: string): void {
  try {
    target.removeItem(key);
    if (target.getItem(key) !== null) {
      throw new Error('The browser storage removal could not be verified.');
    }
  } catch {
    throw new ConversationStorageError(
      'Conversation history could not be cleared from browser storage.',
    );
  }
}

function storageKeys(target: StorageLike): string[] {
  if (typeof target.key !== 'function') {
    return [];
  }

  try {
    const length = target.length;
    if (!Number.isInteger(length) || (length ?? 0) < 0) {
      return [];
    }

    const keys: string[] = [];
    for (let index = 0; index < (length ?? 0); index += 1) {
      const key = target.key(index);
      if (key) {
        keys.push(key);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

function latestConversationDate(envelope: StoredConversationEnvelope): string {
  return envelope.conversations.reduce<string>((latest, conversation) => {
    const candidate =
      conversation &&
      typeof conversation === 'object' &&
      !Array.isArray(conversation)
        ? safeIsoDate(
            (conversation as Record<string, unknown>).updatedAt,
            latest,
          )
        : latest;
    return candidate > latest ? candidate : latest;
  }, '1970-01-01T00:00:00.000Z');
}

function normalizeScopeIndexEntries(
  target: StorageLike,
  rawEntries: readonly unknown[],
  identityPrefix: string,
  indexKey: string,
): ConversationScopeIndexEntry[] {
  const seen = new Set<string>();

  return rawEntries.slice(0, DEFAULT_MAX_TRACKED_SCOPES).flatMap((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      return [];
    }

    const candidate = rawEntry as Record<string, unknown>;
    if (
      typeof candidate.key !== 'string' ||
      !candidate.key.startsWith(identityPrefix) ||
      candidate.key === indexKey ||
      seen.has(candidate.key)
    ) {
      return [];
    }

    const persisted = storageRead(target, candidate.key);
    if (!persisted) {
      return [];
    }
    const envelope = parseStoredConversationEnvelope(persisted);
    if (!envelope) {
      return [];
    }

    seen.add(candidate.key);
    return [
      {
        key: candidate.key,
        accessedAt: safeIsoDate(
          candidate.accessedAt,
          latestConversationDate(envelope),
        ),
        characters: persisted.length,
      },
    ];
  });
}

function rebuildScopeIndex(
  target: StorageLike,
  identityPrefix: string,
  indexKey: string,
): ConversationScopeIndexEntry[] {
  return storageKeys(target)
    .filter((key) => key.startsWith(identityPrefix) && key !== indexKey)
    .flatMap((key) => {
      const persisted = storageRead(target, key);
      const envelope = persisted
        ? parseStoredConversationEnvelope(persisted)
        : undefined;
      return persisted && envelope
        ? [
            {
              key,
              accessedAt: latestConversationDate(envelope),
              characters: persisted.length,
            },
          ]
        : [];
    })
    .sort((left, right) => right.accessedAt.localeCompare(left.accessedAt));
}

function readScopeIndex(
  target: StorageLike,
  identityPrefix: string,
  indexKey: string,
): ConversationScopeIndexEntry[] {
  const raw = storageRead(target, indexKey);
  const discovered = rebuildScopeIndex(target, identityPrefix, indexKey);
  if (!raw) {
    return discovered;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredConversationScopeIndex>;
    if (
      parsed.version !== CONVERSATION_SCOPE_INDEX_VERSION ||
      !Array.isArray(parsed.scopes)
    ) {
      return discovered;
    }
    const indexed = normalizeScopeIndexEntries(
      target,
      parsed.scopes,
      identityPrefix,
      indexKey,
    );
    const indexedKeys = new Set(indexed.map((entry) => entry.key));
    return [
      ...indexed,
      ...discovered.filter((entry) => !indexedKeys.has(entry.key)),
    ];
  } catch {
    return discovered;
  }
}

function serializeScopeIndex(scopes: ConversationScopeIndexEntry[]): string {
  const index: StoredConversationScopeIndex = {
    version: CONVERSATION_SCOPE_INDEX_VERSION,
    scopes,
  };
  return JSON.stringify(index);
}

export function createConversationStore(
  context: ConversationStorageContext,
  storage?: StorageLike,
  storeOptions: ConversationStoreOptions = {},
): ConversationStore {
  const target = resolveStorage(storage);
  const key = conversationStorageKey(context);
  const indexKey = conversationScopeIndexStorageKey(context);
  const identityPrefix = `datocms-agent:v${CONVERSATION_STORAGE_VERSION}:`;
  const options: Required<ConversationStoreOptions> = {
    maxConversations: Math.min(
      positiveIntegerOrDefault(
        storeOptions.maxConversations,
        DEFAULT_MAX_CONVERSATIONS,
      ),
      DEFAULT_MAX_CONVERSATIONS,
    ),
    maxMessages: Math.min(
      positiveIntegerOrDefault(storeOptions.maxMessages, DEFAULT_MAX_MESSAGES),
      DEFAULT_MAX_MESSAGES,
    ),
    maxMessageCharacters: Math.min(
      positiveIntegerOrDefault(
        storeOptions.maxMessageCharacters,
        DEFAULT_MAX_MESSAGE_CHARACTERS,
      ),
      DEFAULT_MAX_MESSAGE_CHARACTERS,
    ),
    maxTitleCharacters: Math.min(
      positiveIntegerOrDefault(
        storeOptions.maxTitleCharacters,
        DEFAULT_MAX_TITLE_CHARACTERS,
      ),
      DEFAULT_MAX_TITLE_CHARACTERS,
    ),
    maxScopeCharacters: Math.min(
      positiveIntegerOrDefault(
        storeOptions.maxScopeCharacters,
        DEFAULT_MAX_SCOPE_CHARACTERS,
      ),
      DEFAULT_MAX_SCOPE_CHARACTERS,
    ),
    maxAggregateCharacters: Math.min(
      positiveIntegerOrDefault(
        storeOptions.maxAggregateCharacters,
        DEFAULT_MAX_AGGREGATE_CHARACTERS,
      ),
      DEFAULT_MAX_AGGREGATE_CHARACTERS,
    ),
    maxTrackedScopes: Math.min(
      positiveIntegerOrDefault(
        storeOptions.maxTrackedScopes,
        DEFAULT_MAX_TRACKED_SCOPES,
      ),
      DEFAULT_MAX_TRACKED_SCOPES,
    ),
  };

  function evictOldestScope(entries: ConversationScopeIndexEntry[]): boolean {
    const evicted = entries.pop();
    if (!evicted) {
      return false;
    }
    storageRemoveVerified(target, evicted.key);
    memoryStorage.removeItem(evicted.key);
    return true;
  }

  function withinAggregateBudget(
    current: ConversationScopeIndexEntry,
    otherEntries: ConversationScopeIndexEntry[],
  ): boolean {
    const scopes = [current, ...otherEntries];
    return (
      scopes.length <= options.maxTrackedScopes &&
      scopes.reduce((sum, entry) => sum + entry.characters, 0) +
        serializeScopeIndex(scopes).length <=
        options.maxAggregateCharacters
    );
  }

  function restoreAfterFailedCommit(
    previousScope: string | null,
    previousIndex: string | null,
  ): void {
    try {
      if (previousScope === null) {
        target.removeItem(key);
      } else {
        target.setItem(key, previousScope);
      }
      if (previousIndex === null) {
        target.removeItem(indexKey);
      } else {
        target.setItem(indexKey, previousIndex);
      }
    } catch {
      // The original explicit persistence error is more useful to the caller.
    }
  }

  function writeIndex(scopes: ConversationScopeIndexEntry[]): void {
    if (scopes.length === 0) {
      if (storageRead(target, indexKey) !== null) {
        storageRemoveVerified(target, indexKey);
      }
      return;
    }
    storageSetVerified(target, indexKey, serializeScopeIndex(scopes));
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The verified storage transaction handles deterministic compaction, LRU eviction, quota retries, and rollback in one atomic-looking boundary.
  function write(conversations: Conversation[]): Conversation[] {
    const conservativeScopeLimit = Math.min(
      options.maxScopeCharacters,
      Math.max(1, options.maxAggregateCharacters - 1_024),
    );
    const fitted = fitConversationsToCharacterBudget(
      conversations,
      conservativeScopeLimit,
    );
    const accessedAt = new Date().toISOString();
    const previousScope = storageRead(target, key);
    const previousIndex = storageRead(target, indexKey);
    const otherEntries = readScopeIndex(
      target,
      identityPrefix,
      indexKey,
    ).filter((entry) => entry.key !== key);
    const current: ConversationScopeIndexEntry = {
      key,
      accessedAt,
      characters: fitted.serialized.length,
    };

    while (!withinAggregateBudget(current, otherEntries)) {
      if (!evictOldestScope(otherEntries)) {
        throw new ConversationStorageError(
          'The newest conversation is too large to fit in browser storage.',
        );
      }
    }

    while (true) {
      try {
        storageSetVerified(target, key, fitted.serialized);
        break;
      } catch (error) {
        if (!evictOldestScope(otherEntries)) {
          restoreAfterFailedCommit(previousScope, previousIndex);
          throw error;
        }
      }
    }

    while (true) {
      try {
        writeIndex([current, ...otherEntries]);
        memoryStorage.setItem(key, fitted.serialized);
        return fitted.conversations;
      } catch (error) {
        if (evictOldestScope(otherEntries)) {
          continue;
        }
        restoreAfterFailedCommit(previousScope, previousIndex);
        throw error;
      }
    }
  }

  function touch(serializedCharacters: number): void {
    const entries = readScopeIndex(target, identityPrefix, indexKey).filter(
      (entry) => entry.key !== key,
    );
    const current: ConversationScopeIndexEntry = {
      key,
      accessedAt: new Date().toISOString(),
      characters: serializedCharacters,
    };

    while (!withinAggregateBudget(current, entries)) {
      if (!evictOldestScope(entries)) {
        throw new ConversationStorageError(
          'Conversation history exceeds its browser storage budget.',
        );
      }
    }
    while (true) {
      try {
        writeIndex([current, ...entries]);
        return;
      } catch (error) {
        if (!evictOldestScope(entries)) {
          throw error;
        }
      }
    }
  }

  function removeCurrentScope(): void {
    const entries = readScopeIndex(target, identityPrefix, indexKey).filter(
      (entry) => entry.key !== key,
    );
    if (storageRead(target, key) !== null) {
      storageRemoveVerified(target, key);
    }
    memoryStorage.removeItem(key);
    writeIndex(entries);
  }

  function list(): Conversation[] {
    const raw = storageRead(target, key);
    if (!raw) {
      return [];
    }
    const envelope = parseStoredConversationEnvelope(raw);
    if (!envelope) {
      removeCurrentScope();
      return [];
    }

    const conversations = normalizeStoredConversations(
      envelope.conversations,
      options,
    )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, options.maxConversations);
    const fitted = fitConversationsToCharacterBudget(
      conversations,
      Math.min(
        options.maxScopeCharacters,
        Math.max(1, options.maxAggregateCharacters - 1_024),
      ),
    );

    if (raw !== fitted.serialized) {
      return write(fitted.conversations);
    }

    touch(raw.length);
    return fitted.conversations;
  }

  return {
    key,
    list,
    get(id) {
      return list().find((conversation) => conversation.id === id);
    },
    save(conversation) {
      const normalized = normalizeConversation(conversation, options);
      if (!normalized) {
        throw new Error('Cannot save an invalid conversation.');
      }

      const conversations = [
        normalized,
        ...list().filter((item) => item.id !== normalized.id),
      ]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, options.maxConversations);
      const persisted = write(conversations).find(
        (item) => item.id === normalized.id,
      );
      if (!persisted) {
        throw new ConversationStorageError(
          'The conversation could not be retained in browser storage.',
        );
      }
      return persisted;
    },
    remove(id) {
      const conversations = list().filter(
        (conversation) => conversation.id !== id,
      );
      if (conversations.length === 0) {
        removeCurrentScope();
      } else {
        write(conversations);
      }
    },
    clear() {
      removeCurrentScope();
    },
  };
}

import type { CommentSegment, Mention } from './mentions';
import { normalizeCommentSegments, normalizeMention } from './mentions';
