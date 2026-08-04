import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_SCOPE_INDEX_VERSION,
  type Conversation,
  ConversationStorageError,
  conversationScopeIndexStorageKey,
  conversationStorageKey,
  createConversationStore,
  DEFAULT_MAX_AGGREGATE_CHARACTERS,
  DEFAULT_MAX_CONVERSATIONS,
  DEFAULT_MAX_SCOPE_CHARACTERS,
  DEFAULT_MAX_TRACKED_SCOPES,
  MAX_ASSET_RESULT_GROUPS_PER_MESSAGE,
  MAX_ASSET_RESULTS_PER_GROUP,
  MAX_FIELD_RESULT_GROUPS_PER_MESSAGE,
  MAX_FIELD_RESULTS_PER_GROUP,
  MAX_RECORD_RESULT_GROUPS_PER_MESSAGE,
  MAX_RECORD_RESULTS_PER_GROUP,
  redactConversationSecrets,
  type StorageLike,
  withoutLegacyDemoTranscript,
} from './conversations';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class QuotaStorage extends MemoryStorage {
  maxCharacters = Number.POSITIVE_INFINITY;

  override setItem(key: string, value: string): void {
    const next = new Map(this.values);
    next.set(key, value);
    const characters = [...next.entries()].reduce(
      (total, [storedKey, storedValue]) =>
        total + storedKey.length + storedValue.length,
      0,
    );
    if (characters > this.maxCharacters) {
      throw new Error('QuotaExceededError');
    }
    super.setItem(key, value);
  }
}

const baseContext = {
  pluginId: 'plugin-1',
  siteId: 'site-1',
  environment: 'main',
  currentUserId: 'user-1',
  scope: { type: 'project' as const },
};

function conversation(
  id: string,
  updatedAt: string,
  messages: Conversation['messages'] = [],
): Conversation {
  return {
    id,
    title: `Conversation ${id}`,
    createdAt: updatedAt,
    updatedAt,
    previousResponseId: `resp_${id}`,
    messages,
  };
}

describe('conversation persistence', () => {
  it('keys data by plugin, site, environment, current user, and scope', () => {
    const projectKey = conversationStorageKey(baseContext);
    const otherUserKey = conversationStorageKey({
      ...baseContext,
      currentUserId: 'user-2',
    });
    const recordKey = conversationStorageKey({
      ...baseContext,
      scope: { type: 'record', recordId: 'item-1' },
    });

    expect(projectKey).not.toBe(otherUserKey);
    expect(projectKey).not.toBe(recordKey);
    expect(projectKey).toContain('plugin-1');
    expect(projectKey).toContain('site-1');
    expect(projectKey).toContain('user-1');
  });

  it('keeps only the three newest conversations in each scoped path by default', () => {
    expect(DEFAULT_MAX_CONVERSATIONS).toBe(3);

    const storage = new MemoryStorage();
    const retentionContext = { ...baseContext, siteId: 'retention-site' };
    const contexts = [
      { name: 'project', context: retentionContext },
      {
        name: 'record',
        context: {
          ...retentionContext,
          scope: { type: 'record' as const, recordId: 'item-1' },
        },
      },
      {
        name: 'custom',
        context: {
          ...retentionContext,
          scope: { type: 'custom' as const, id: '/content/calendar' },
        },
      },
    ];

    for (const { name, context } of contexts) {
      const store = createConversationStore(context, storage);

      for (const [index, hour] of [10, 11, 12, 13].entries()) {
        store.save(
          conversation(`${name}-${index + 1}`, `2026-07-28T${hour}:00:00.000Z`),
        );
      }

      const expectedIds = [`${name}-4`, `${name}-3`, `${name}-2`];
      expect(store.list().map((item) => item.id)).toEqual(expectedIds);

      const persisted = JSON.parse(storage.getItem(store.key) ?? '{}') as {
        conversations?: Conversation[];
      };
      expect(persisted.conversations?.map((item) => item.id)).toEqual(
        expectedIds,
      );
    }
  });

  it('physically prunes browser data written before the three-chat limit', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(
      { ...baseContext, siteId: 'legacy-retention-site' },
      storage,
    );
    const conversations = [10, 11, 12, 13].map((hour, index) =>
      conversation(`legacy-${index + 1}`, `2026-07-28T${hour}:00:00.000Z`),
    );
    storage.setItem(
      store.key,
      JSON.stringify({
        version: 1,
        conversations,
      }),
    );

    expect(store.list().map((item) => item.id)).toEqual([
      'legacy-4',
      'legacy-3',
      'legacy-2',
    ]);

    const persisted = JSON.parse(storage.getItem(store.key) ?? '{}') as {
      conversations?: Conversation[];
    };
    expect(persisted.conversations?.map((item) => item.id)).toEqual([
      'legacy-4',
      'legacy-3',
      'legacy-2',
    ]);
  });

  it('never mixes project, record, or custom scoped paths', () => {
    const storage = new MemoryStorage();
    const isolationContext = { ...baseContext, siteId: 'isolation-site' };
    const stores = [
      {
        id: 'project',
        store: createConversationStore(isolationContext, storage),
      },
      {
        id: 'record-one',
        store: createConversationStore(
          {
            ...isolationContext,
            scope: { type: 'record', recordId: 'item-1' },
          },
          storage,
        ),
      },
      {
        id: 'record-two',
        store: createConversationStore(
          {
            ...isolationContext,
            scope: { type: 'record', recordId: 'item-2' },
          },
          storage,
        ),
      },
      {
        id: 'custom-one',
        store: createConversationStore(
          {
            ...isolationContext,
            scope: { type: 'custom', id: '/content/calendar' },
          },
          storage,
        ),
      },
      {
        id: 'custom-two',
        store: createConversationStore(
          {
            ...isolationContext,
            scope: { type: 'custom', id: '/content/campaigns' },
          },
          storage,
        ),
      },
    ];

    for (const { id, store } of stores) {
      store.save(conversation(id, '2026-07-28T10:00:00.000Z'));
    }

    for (const { id, store } of stores) {
      expect(store.list().map((item) => item.id)).toEqual([id]);
    }
  });

  it('redacts common credential forms before writing text', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    store.save({
      ...conversation('one', '2026-07-28T10:00:00.000Z'),
      title: 'Bearer very-secret-token',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          text: 'api_key=sk-ant-abcdefghijklmnopqrstuvwxyz token=private-value',
          createdAt: '2026-07-28T10:00:00.000Z',
        },
      ],
    });

    const serialized = storage.getItem(store.key) ?? '';
    expect(serialized).not.toContain('very-secret-token');
    expect(serialized).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz');
    expect(serialized).not.toContain('private-value');
    expect(serialized).toContain('[redacted]');
    expect(store.list()[0].messages[0].text).toContain('[redacted]');
  });

  it('preserves interrupted assistant state without accepting it on user messages', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    store.save({
      ...conversation('interrupted', '2026-07-28T10:00:00.000Z'),
      messages: [
        {
          id: 'user-message',
          role: 'user',
          text: 'Try this',
          createdAt: '2026-07-28T10:00:00.000Z',
          interrupted: true,
        },
        {
          id: 'assistant-message',
          role: 'assistant',
          text: 'A partial response',
          createdAt: '2026-07-28T10:00:01.000Z',
          interrupted: true,
        },
      ],
    });

    const messages = store.list()[0]?.messages ?? [];
    expect(messages[0]).toMatchObject({ id: 'user-message' });
    expect(messages[0]).not.toHaveProperty('interrupted');
    expect(messages[1]).toMatchObject({
      id: 'assistant-message',
      interrupted: true,
    });
  });

  it('persists normalized record receipts on assistant messages in storage version 1', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    const saved = store.save({
      ...conversation('records', '2026-07-28T10:00:00.000Z'),
      messages: [
        {
          id: 'assistant-message',
          role: 'assistant',
          text: 'I found the relevant records.',
          createdAt: '2026-07-28T10:00:00.000Z',
          recordResults: [
            {
              id: '  result-group  ',
              title: 'Bearer very-secret-group-token',
              records: [
                {
                  itemId: '  item-1  ',
                  itemTypeId: '  article  ',
                  title:
                    'API key: sk-ant-abcdefghijklmnopqrstuvwxyz — First article',
                  fieldPath: '  title  ',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(saved.messages[0]).toMatchObject({
      id: 'assistant-message',
      recordResults: [
        {
          id: 'result-group',
          title: 'Bearer [redacted]',
          records: [
            {
              itemId: 'item-1',
              itemTypeId: 'article',
              title: 'API key: [redacted] — First article',
              fieldPath: 'title',
            },
          ],
        },
      ],
    });

    const persisted = JSON.parse(storage.getItem(store.key) ?? '{}') as {
      version?: number;
      conversations?: Conversation[];
    };
    expect(persisted.version).toBe(1);
    expect(persisted.conversations?.[0]?.messages[0]).toEqual(
      saved.messages[0],
    );
  });

  it('caps record receipt groups and records per group', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    const saved = store.save({
      ...conversation('bounded-records', '2026-07-28T10:00:00.000Z'),
      messages: [
        {
          id: 'assistant-message',
          role: 'assistant',
          text: 'Records',
          createdAt: '2026-07-28T10:00:00.000Z',
          recordResults: Array.from(
            { length: MAX_RECORD_RESULT_GROUPS_PER_MESSAGE + 2 },
            (_, groupIndex) => ({
              id: `group-${groupIndex}`,
              title: `Group ${groupIndex}`,
              records: Array.from(
                { length: MAX_RECORD_RESULTS_PER_GROUP + 2 },
                (_, recordIndex) => ({
                  itemId: `item-${groupIndex}-${recordIndex}`,
                  title: `Record ${recordIndex}`,
                }),
              ),
            }),
          ),
        },
      ],
    });

    const recordResults = saved.messages[0]?.recordResults ?? [];
    expect(recordResults).toHaveLength(MAX_RECORD_RESULT_GROUPS_PER_MESSAGE);
    expect(
      recordResults.every(
        (group) => group.records.length === MAX_RECORD_RESULTS_PER_GROUP,
      ),
    ).toBe(true);
  });

  it('discards malformed, empty, duplicate, and user-owned record receipts', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    storage.setItem(
      store.key,
      JSON.stringify({
        version: 1,
        conversations: [
          {
            ...conversation('raw-records', '2026-07-28T10:00:00.000Z'),
            messages: [
              {
                id: 'user-message',
                role: 'user',
                text: 'Show records',
                createdAt: '2026-07-28T10:00:00.000Z',
                recordResults: [
                  {
                    id: 'must-not-survive',
                    records: [{ itemId: 'item-user', title: 'User record' }],
                  },
                ],
              },
              {
                id: 'assistant-message',
                role: 'assistant',
                text: 'Here they are',
                createdAt: '2026-07-28T10:00:01.000Z',
                recordResults: [
                  null,
                  { id: '', records: [] },
                  {
                    id: 'empty-group',
                    records: [{ itemId: '', title: 'Missing item ID' }],
                  },
                  {
                    id: 'valid-group',
                    records: [
                      null,
                      { itemId: 'item-without-title' },
                      {
                        itemId: 'item-1',
                        itemTypeId: 'model-1',
                        title: 'First record',
                        fieldPath: 'content.title',
                      },
                      {
                        itemId: 'item-1',
                        title: 'Duplicate record',
                      },
                      {
                        itemId: 'item-2',
                        itemTypeId: `model-${'x'.repeat(600)}`,
                        title: 'Second record',
                        fieldPath: `content.${'x'.repeat(600)}`,
                      },
                    ],
                  },
                  {
                    id: 'valid-group',
                    records: [{ itemId: 'item-3', title: 'Duplicate group' }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const messages = store.list()[0]?.messages ?? [];
    expect(messages[0]).not.toHaveProperty('recordResults');
    expect(messages[1]?.recordResults).toEqual([
      {
        id: 'valid-group',
        records: [
          {
            itemId: 'item-1',
            itemTypeId: 'model-1',
            title: 'First record',
            fieldPath: 'content.title',
          },
          {
            itemId: 'item-2',
            title: 'Second record',
          },
        ],
      },
    ]);
  });

  it('leaves messages without record receipts structurally unchanged', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    const messages: Conversation['messages'] = [
      {
        id: 'user-message',
        role: 'user',
        text: 'What is this project?',
        createdAt: '2026-07-28T10:00:00.000Z',
      },
      {
        id: 'assistant-message',
        role: 'assistant',
        text: 'A project description.',
        createdAt: '2026-07-28T10:00:01.000Z',
      },
    ];

    const saved = store.save(
      conversation('without-records', '2026-07-28T10:00:00.000Z', messages),
    );

    expect(saved.messages).toEqual(messages);
    const persisted = JSON.parse(storage.getItem(store.key) ?? '{}') as {
      conversations?: Conversation[];
    };
    const persistedConversation = persisted.conversations?.find(
      (item) => item.id === saved.id,
    );
    expect(persistedConversation?.messages).toEqual(messages);
  });

  it('persists bounded field and asset receipts only on assistant messages', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    const saved = store.save({
      ...conversation('references', '2026-07-28T10:00:00.000Z'),
      messages: [
        {
          id: 'user-message',
          role: 'user',
          text: 'Show me these references',
          createdAt: '2026-07-28T10:00:00.000Z',
          fieldResults: [
            {
              id: 'user-field-group',
              fields: [{ fieldPath: 'title', title: 'Title' }],
            },
          ],
          assetResults: [
            {
              id: 'user-asset-group',
              assets: [{ uploadId: 'upload-user', title: 'User asset' }],
            },
          ],
        },
        {
          id: 'assistant-message',
          role: 'assistant',
          text: '',
          createdAt: '2026-07-28T10:00:01.000Z',
          fieldResults: [
            {
              id: ' fields ',
              title: 'Fields',
              fields: [
                { fieldPath: ' title ', title: 'Title', locale: ' en ' },
                {
                  fieldPath: 'title',
                  title: 'Duplicate',
                  locale: 'en',
                },
                { fieldPath: '', title: 'Invalid' },
              ],
            },
          ],
          assetResults: [
            {
              id: ' assets ',
              title: 'Bearer secret-upload-token',
              assets: [
                {
                  uploadId: ' upload-1 ',
                  title: 'sk-abcdefghijklmnopqrstuvwxyz image.jpg',
                  deleted: true,
                },
                {
                  uploadId: 'upload-1',
                  title: 'Duplicate image.jpg',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(saved.messages[0]).not.toHaveProperty('fieldResults');
    expect(saved.messages[0]).not.toHaveProperty('assetResults');
    expect(saved.messages[1]).toMatchObject({
      fieldResults: [
        {
          id: 'fields',
          fields: [{ fieldPath: 'title', title: 'Title', locale: 'en' }],
        },
      ],
      assetResults: [
        {
          id: 'assets',
          title: 'Bearer [redacted]',
          assets: [
            {
              uploadId: 'upload-1',
              title: '[redacted] image.jpg',
              deleted: true,
            },
          ],
        },
      ],
    });
  });

  it('caps field and asset receipt groups and entries', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    const saved = store.save({
      ...conversation('bounded-references', '2026-07-28T10:00:00.000Z'),
      messages: [
        {
          id: 'assistant-message',
          role: 'assistant',
          text: '',
          createdAt: '2026-07-28T10:00:00.000Z',
          fieldResults: Array.from(
            { length: MAX_FIELD_RESULT_GROUPS_PER_MESSAGE + 2 },
            (_, groupIndex) => ({
              id: `fields-${groupIndex}`,
              fields: Array.from(
                { length: MAX_FIELD_RESULTS_PER_GROUP + 2 },
                (_, fieldIndex) => ({
                  fieldPath: `field_${groupIndex}_${fieldIndex}`,
                  title: `Field ${fieldIndex}`,
                }),
              ),
            }),
          ),
          assetResults: Array.from(
            { length: MAX_ASSET_RESULT_GROUPS_PER_MESSAGE + 2 },
            (_, groupIndex) => ({
              id: `assets-${groupIndex}`,
              assets: Array.from(
                { length: MAX_ASSET_RESULTS_PER_GROUP + 2 },
                (_, assetIndex) => ({
                  uploadId: `upload-${groupIndex}-${assetIndex}`,
                  title: `Asset ${assetIndex}`,
                }),
              ),
            }),
          ),
        },
      ],
    });

    expect(saved.messages[0]?.fieldResults).toHaveLength(
      MAX_FIELD_RESULT_GROUPS_PER_MESSAGE,
    );
    expect(
      saved.messages[0]?.fieldResults?.every(
        (group) => group.fields.length === MAX_FIELD_RESULTS_PER_GROUP,
      ),
    ).toBe(true);
    expect(saved.messages[0]?.assetResults).toHaveLength(
      MAX_ASSET_RESULT_GROUPS_PER_MESSAGE,
    );
    expect(
      saved.messages[0]?.assetResults?.every(
        (group) => group.assets.length === MAX_ASSET_RESULTS_PER_GROUP,
      ),
    ).toBe(true);
  });

  it('bounds conversations, messages, titles, and message text', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage, {
      maxConversations: 2,
      maxMessages: 2,
      maxMessageCharacters: 5,
      maxTitleCharacters: 8,
    });
    const messages: Conversation['messages'] = [1, 2, 3].map((index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'assistant' : 'user',
      text: `message-${index}`,
      createdAt: `2026-07-28T10:0${index}:00.000Z`,
    }));

    store.save(conversation('one', '2026-07-28T10:00:00.000Z', messages));
    store.save(conversation('two', '2026-07-28T11:00:00.000Z'));
    store.save(conversation('three', '2026-07-28T12:00:00.000Z'));

    expect(store.list().map((item) => item.id)).toEqual(['three', 'two']);

    const boundedStore = createConversationStore(
      { ...baseContext, scope: { type: 'custom', id: 'bounded' } },
      storage,
      {
        maxConversations: 2,
        maxMessages: 2,
        maxMessageCharacters: 5,
        maxTitleCharacters: 8,
      },
    );
    const saved = boundedStore.save(
      conversation('bounded', '2026-07-28T12:00:00.000Z', messages),
    );
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages.map((message) => message.id)).toEqual([
      'message-2',
      'message-3',
    ]);
    expect(saved.messages.every((message) => message.text.length <= 5)).toBe(
      true,
    );
    expect(saved.title.length).toBeLessThanOrEqual(8);
  });

  it('keeps every serialized scope and aggregate below conservative defaults', () => {
    expect(DEFAULT_MAX_SCOPE_CHARACTERS).toBeLessThan(
      DEFAULT_MAX_AGGREGATE_CHARACTERS,
    );
    expect(DEFAULT_MAX_TRACKED_SCOPES).toBeLessThanOrEqual(24);

    const storage = new MemoryStorage();
    const scopeContext = {
      ...baseContext,
      siteId: 'default-budget-site',
      scope: { type: 'record' as const, recordId: 'record-1' },
    };
    const store = createConversationStore(scopeContext, storage);
    const messages: Conversation['messages'] = Array.from(
      { length: 80 },
      (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        text: `${index}:${'x'.repeat(20_000)}`,
        createdAt: `2026-07-28T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
      }),
    );

    const saved = store.save(
      conversation('large', '2026-07-28T12:00:00.000Z', messages),
    );
    const serialized = storage.getItem(store.key) ?? '';

    expect(serialized.length).toBeLessThanOrEqual(DEFAULT_MAX_SCOPE_CHARACTERS);
    expect(saved.messages.at(-1)?.id).toBe('message-79');
    expect(saved.messages[0]?.role).toBe('user');
    expect(saved.messages.length).toBeLessThan(messages.length);
  });

  it('trims oldest complete turns before newer useful content', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(
      {
        ...baseContext,
        siteId: 'scope-compaction-site',
        scope: { type: 'record', recordId: 'record-1' },
      },
      storage,
      {
        maxScopeCharacters: 2_400,
        maxAggregateCharacters: 20_000,
      },
    );
    const messages: Conversation['messages'] = Array.from(
      { length: 8 },
      (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        text: `${index}:${String.fromCharCode(97 + index).repeat(420)}`,
        createdAt: `2026-07-28T10:0${index}:00.000Z`,
      }),
    );

    const saved = store.save(
      conversation('compacted', '2026-07-28T12:00:00.000Z', messages),
    );

    expect(saved.messages.map((message) => message.id)).toEqual([
      'message-4',
      'message-5',
      'message-6',
      'message-7',
    ]);
    expect(saved.messages[0]?.role).toBe('user');
    expect(storage.getItem(store.key)?.length).toBeLessThanOrEqual(2_400);
  });

  it('drops bounded presentation receipts before losing the newest turn', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(
      {
        ...baseContext,
        siteId: 'receipt-compaction-site',
        scope: { type: 'record', recordId: 'record-1' },
      },
      storage,
      {
        maxScopeCharacters: 1_500,
        maxAggregateCharacters: 20_000,
      },
    );
    const saved = store.save({
      ...conversation('receipts', '2026-07-28T12:00:00.000Z'),
      messages: [
        {
          id: 'latest-user',
          role: 'user',
          text: 'Show me the matching records',
          createdAt: '2026-07-28T12:00:00.000Z',
        },
        {
          id: 'latest-assistant',
          role: 'assistant',
          text: 'These are the matching records.',
          createdAt: '2026-07-28T12:00:01.000Z',
          recordResults: Array.from({ length: 4 }, (_, groupIndex) => ({
            id: `group-${groupIndex}`,
            records: Array.from({ length: 20 }, (_, recordIndex) => ({
              itemId: `record-${groupIndex}-${recordIndex}`,
              title: `Result ${'x'.repeat(180)} ${recordIndex}`,
            })),
          })),
        },
      ],
    });

    expect(saved.messages.map((message) => message.id)).toEqual([
      'latest-user',
      'latest-assistant',
    ]);
    expect(saved.messages[1]?.text).toBe('These are the matching records.');
    expect(saved.messages[1]?.recordResults?.length ?? 0).toBeLessThan(4);
    expect(storage.getItem(store.key)?.length).toBeLessThanOrEqual(1_500);
  });

  it('evicts least-recently-used scope keys and refreshes recency on reads', () => {
    const storage = new MemoryStorage();
    const commonContext = { ...baseContext, siteId: 'lru-site' };
    const options = {
      maxTrackedScopes: 2,
      maxAggregateCharacters: 50_000,
    };
    const first = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'first' },
      },
      storage,
      options,
    );
    const second = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'second' },
      },
      storage,
      options,
    );
    const third = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'third' },
      },
      storage,
      options,
    );
    first.save(conversation('first', '2026-07-28T10:00:00.000Z'));
    second.save(conversation('second', '2026-07-28T11:00:00.000Z'));

    expect(first.list().map((item) => item.id)).toEqual(['first']);
    third.save(conversation('third', '2026-07-28T12:00:00.000Z'));

    expect(storage.getItem(first.key)).not.toBeNull();
    expect(storage.getItem(second.key)).toBeNull();
    expect(storage.getItem(third.key)).not.toBeNull();

    const index = JSON.parse(
      storage.getItem(conversationScopeIndexStorageKey(commonContext)) ?? '{}',
    ) as { version?: number; scopes?: Array<{ key: string }> };
    expect(index.version).toBe(CONVERSATION_SCOPE_INDEX_VERSION);
    expect(index.scopes?.map((entry) => entry.key)).toEqual([
      third.key,
      first.key,
    ]);
  });

  it('evicts old scopes before crossing the aggregate character budget', () => {
    const storage = new MemoryStorage();
    const commonContext = { ...baseContext, siteId: 'aggregate-budget-site' };
    const options = {
      maxScopeCharacters: 3_000,
      maxAggregateCharacters: 4_500,
      maxTrackedScopes: 10,
    };
    const stores = ['first', 'second', 'third'].map((recordId) =>
      createConversationStore(
        {
          ...commonContext,
          scope: { type: 'record' as const, recordId },
        },
        storage,
        options,
      ),
    );

    stores.forEach((store, index) => {
      store.save(
        conversation(
          `conversation-${index}`,
          `2026-07-28T1${index}:00:00.000Z`,
          [
            {
              id: `message-${index}`,
              role: 'user',
              text: 'x'.repeat(1_250),
              createdAt: `2026-07-28T1${index}:00:00.000Z`,
            },
          ],
        ),
      );
    });

    const indexRaw =
      storage.getItem(conversationScopeIndexStorageKey(commonContext)) ?? '';
    const index = JSON.parse(indexRaw) as {
      scopes: Array<{ key: string; characters: number }>;
    };
    const aggregateCharacters =
      indexRaw.length +
      index.scopes.reduce((sum, entry) => sum + entry.characters, 0);

    expect(aggregateCharacters).toBeLessThanOrEqual(4_500);
    expect(index.scopes).toHaveLength(2);
    expect(storage.getItem(stores[0].key)).toBeNull();
    expect(storage.getItem(stores[1].key)).not.toBeNull();
    expect(storage.getItem(stores[2].key)).not.toBeNull();
  });

  it('recovers from browser quota pressure by evicting indexed old scopes', () => {
    const storage = new QuotaStorage();
    const commonContext = { ...baseContext, siteId: 'quota-recovery-site' };
    const options = {
      maxAggregateCharacters: 100_000,
      maxTrackedScopes: 10,
    };
    const first = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'first' },
      },
      storage,
      options,
    );
    const second = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'second' },
      },
      storage,
      options,
    );
    const third = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'third' },
      },
      storage,
      options,
    );
    const payload = (id: string, hour: number) =>
      conversation(id, `2026-07-28T${hour}:00:00.000Z`, [
        {
          id: `message-${id}`,
          role: 'user',
          text: 'x'.repeat(700),
          createdAt: `2026-07-28T${hour}:00:00.000Z`,
        },
      ]);
    first.save(payload('first', 10));
    second.save(payload('second', 11));
    storage.maxCharacters = 2_650;

    expect(third.save(payload('third', 12)).id).toBe('third');
    expect(storage.getItem(first.key)).toBeNull();
    expect(storage.getItem(second.key)).not.toBeNull();
    expect(storage.getItem(third.key)).not.toBeNull();
  });

  it('rebuilds a corrupted index without deleting isolated or recent scopes', () => {
    const storage = new MemoryStorage();
    const commonContext = { ...baseContext, siteId: 'corrupt-index-site' };
    const options = {
      maxTrackedScopes: 2,
      maxAggregateCharacters: 50_000,
    };
    const first = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'first' },
      },
      storage,
      options,
    );
    const second = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'second' },
      },
      storage,
      options,
    );
    const third = createConversationStore(
      {
        ...commonContext,
        scope: { type: 'record', recordId: 'third' },
      },
      storage,
      options,
    );
    first.save(conversation('first', '2026-07-28T10:00:00.000Z'));
    second.save(conversation('second', '2026-07-28T11:00:00.000Z'));
    storage.setItem(conversationScopeIndexStorageKey(commonContext), '{broken');

    first.list();
    third.save(conversation('third', '2026-07-28T12:00:00.000Z'));

    expect(storage.getItem(first.key)).not.toBeNull();
    expect(storage.getItem(second.key)).toBeNull();
    expect(storage.getItem(third.key)).not.toBeNull();
  });

  it('discovers orphaned scope keys omitted from an otherwise valid index', () => {
    const storage = new MemoryStorage();
    const commonContext = { ...baseContext, siteId: 'orphan-index-site' };
    const options = {
      maxTrackedScopes: 2,
      maxAggregateCharacters: 50_000,
    };
    const stores = ['first', 'second', 'third'].map((recordId) =>
      createConversationStore(
        {
          ...commonContext,
          scope: { type: 'record' as const, recordId },
        },
        storage,
        options,
      ),
    );
    stores[0].save(conversation('first', '2026-07-28T10:00:00.000Z'));
    stores[1].save(conversation('second', '2026-07-28T11:00:00.000Z'));
    storage.setItem(
      conversationScopeIndexStorageKey(commonContext),
      JSON.stringify({
        version: CONVERSATION_SCOPE_INDEX_VERSION,
        scopes: [],
      }),
    );

    stores[2].save(conversation('third', '2026-07-28T12:00:00.000Z'));

    expect(storage.getItem(stores[0].key)).toBeNull();
    expect(storage.getItem(stores[1].key)).not.toBeNull();
    expect(storage.getItem(stores[2].key)).not.toBeNull();
  });

  it('shares only opaque LRU metadata while keeping conversation payloads isolated', () => {
    const storage = new MemoryStorage();
    const userOneContext = { ...baseContext, siteId: 'index-isolation-site' };
    const userTwoContext = {
      ...userOneContext,
      currentUserId: 'user-2',
      scope: { type: 'record' as const, recordId: 'private-record' },
    };
    const otherUserStore = createConversationStore(userTwoContext, storage);
    otherUserStore.save(conversation('other-user', '2026-07-28T10:00:00.000Z'));

    const currentStore = createConversationStore(
      {
        ...userOneContext,
        scope: { type: 'record', recordId: 'current-record' },
      },
      storage,
      { maxTrackedScopes: 10, maxAggregateCharacters: 50_000 },
    );
    storage.setItem('unrelated-application-key', 'must remain');
    storage.setItem(
      conversationScopeIndexStorageKey(userOneContext),
      JSON.stringify({
        version: CONVERSATION_SCOPE_INDEX_VERSION,
        scopes: [
          {
            key: otherUserStore.key,
            accessedAt: '2026-07-28T10:00:00.000Z',
            characters: storage.getItem(otherUserStore.key)?.length ?? 0,
          },
          {
            key: 'unrelated-application-key',
            accessedAt: '2026-07-28T09:00:00.000Z',
            characters: 11,
          },
        ],
      }),
    );

    currentStore.save(conversation('current-user', '2026-07-28T11:00:00.000Z'));

    expect(storage.getItem(otherUserStore.key)).not.toBeNull();
    expect(otherUserStore.list().map((item) => item.id)).toEqual([
      'other-user',
    ]);
    expect(currentStore.list().map((item) => item.id)).toEqual([
      'current-user',
    ]);
    expect(storage.getItem('unrelated-application-key')).toBe('must remain');
  });

  it('enforces one origin-wide LRU across different sites and users', () => {
    const storage = new MemoryStorage();
    const options = {
      maxTrackedScopes: 2,
      maxAggregateCharacters: 50_000,
    };
    const first = createConversationStore(
      {
        ...baseContext,
        siteId: 'site-a',
        currentUserId: 'user-a',
        scope: { type: 'record', recordId: 'record-a' },
      },
      storage,
      options,
    );
    const second = createConversationStore(
      {
        ...baseContext,
        siteId: 'site-b',
        currentUserId: 'user-b',
        scope: { type: 'record', recordId: 'record-b' },
      },
      storage,
      options,
    );
    const third = createConversationStore(
      {
        ...baseContext,
        siteId: 'site-c',
        currentUserId: 'user-c',
        scope: { type: 'record', recordId: 'record-c' },
      },
      storage,
      options,
    );

    first.save(conversation('first', '2026-07-28T10:00:00.000Z'));
    second.save(conversation('second', '2026-07-28T11:00:00.000Z'));
    third.save(conversation('third', '2026-07-28T12:00:00.000Z'));

    expect(storage.getItem(first.key)).toBeNull();
    expect(storage.getItem(second.key)).not.toBeNull();
    expect(storage.getItem(third.key)).not.toBeNull();
    expect(conversationScopeIndexStorageKey(baseContext)).toBe(
      conversationScopeIndexStorageKey({
        ...baseContext,
        siteId: 'another-site',
        currentUserId: 'another-user',
      }),
    );
  });

  it('fails explicitly when a scope cannot fit or persistence cannot be verified', () => {
    const tinyStorage = new MemoryStorage();
    const tinyStore = createConversationStore(
      { ...baseContext, siteId: 'tiny-budget-site' },
      tinyStorage,
      {
        maxScopeCharacters: 100,
        maxAggregateCharacters: 5_000,
      },
    );
    expect(() =>
      tinyStore.save(
        conversation('too-large', '2026-07-28T10:00:00.000Z', [
          {
            id: 'message',
            role: 'user',
            text: 'A useful newest message',
            createdAt: '2026-07-28T10:00:00.000Z',
          },
        ]),
      ),
    ).toThrow(ConversationStorageError);
    expect(tinyStorage.getItem(tinyStore.key)).toBeNull();

    const unverifiedStorage = new MemoryStorage();
    unverifiedStorage.setItem = () => {};
    const unverifiedStore = createConversationStore(
      { ...baseContext, siteId: 'unverified-site' },
      unverifiedStorage,
    );
    expect(() =>
      unverifiedStore.save(
        conversation('unverified', '2026-07-28T10:00:00.000Z'),
      ),
    ).toThrow(/could not be saved/i);
    expect(unverifiedStore.list()).toEqual([]);
  });

  it('rolls back a new scope when its shared index write cannot be verified', () => {
    const storage = new MemoryStorage();
    const context = { ...baseContext, siteId: 'index-write-failure-site' };
    const indexKey = conversationScopeIndexStorageKey(context);
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key !== indexKey) {
        originalSetItem(key, value);
      }
    };
    const store = createConversationStore(context, storage);

    expect(() =>
      store.save(conversation('one', '2026-07-28T10:00:00.000Z')),
    ).toThrow(/could not be saved/i);
    expect(storage.getItem(store.key)).toBeNull();
    expect(storage.getItem(indexKey)).toBeNull();
  });

  it('ignores invalid envelopes and does not persist arbitrary response IDs', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    storage.setItem(store.key, '{"version":999,"conversations":[]}');
    expect(store.list()).toEqual([]);

    const saved = store.save({
      ...conversation('one', '2026-07-28T10:00:00.000Z'),
      previousResponseId: 'not-a-response',
    });
    expect(saved.previousResponseId).toBeUndefined();
  });

  it('persists only bounded host-context fingerprints, never the snapshot', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    const saved = store.save({
      ...conversation('context', '2026-07-28T10:00:00.000Z'),
      hostContextFingerprint: 'v1:record:9b0a12ef',
    });

    expect(saved.hostContextFingerprint).toBe('v1:record:9b0a12ef');
    expect(storage.getItem(store.key)).not.toContain('HOST CONTEXT SNAPSHOT');

    const invalid = store.save({
      ...conversation('invalid-context', '2026-07-28T11:00:00.000Z'),
      hostContextFingerprint: 'spaces and arbitrary content',
    });
    expect(invalid.hostContextFingerprint).toBeUndefined();
  });

  it('persists only recognized provider/model response-chain identity', () => {
    const storage = new MemoryStorage();
    const store = createConversationStore(baseContext, storage);
    const saved = store.save({
      ...conversation('claude', '2026-07-28T10:00:00.000Z'),
      responseProvider: 'anthropic',
      responseModel: 'claude-sonnet-4-6',
    });

    expect(saved).toMatchObject({
      responseProvider: 'anthropic',
      responseModel: 'claude-sonnet-4-6',
    });

    const invalid = store.save({
      ...conversation('invalid-chain', '2026-07-28T11:00:00.000Z'),
      responseProvider: 'other' as 'openai',
      responseModel: 'invalid model with spaces',
    });
    expect(invalid.responseProvider).toBeUndefined();
    expect(invalid.responseModel).toBeUndefined();
  });
});

describe('legacy demo cleanup', () => {
  it('removes only the canned demo prefix and preserves later user history', () => {
    const contaminated = conversation('demo', '2026-07-28T10:00:00.000Z', [
      {
        id: 'demo-user',
        role: 'user',
        text: 'Update the Homepage title to “A clearer title”.',
        createdAt: '2026-07-28T10:00:00.000Z',
      },
      {
        id: 'demo-assistant',
        role: 'assistant',
        text: 'I found the relevant content and prepared a focused change. Please review the exact target and script before it runs.',
        createdAt: '2026-07-28T10:00:01.000Z',
      },
      {
        id: 'demo-result',
        role: 'assistant',
        text: 'Demo mode: the approval flow completed successfully. No playground content was changed.',
        createdAt: '2026-07-28T10:00:02.000Z',
      },
      {
        id: 'real-user',
        role: 'user',
        text: 'Can you describe this project?',
        createdAt: '2026-07-28T10:01:00.000Z',
      },
    ]);

    const cleaned = withoutLegacyDemoTranscript(contaminated);

    expect(cleaned.messages.map((message) => message.id)).toEqual([
      'real-user',
    ]);
    expect(cleaned.title).toBe('Can you describe this project?');
    expect(cleaned.previousResponseId).toBe('resp_demo');
  });

  it('leaves similar editorial conversations untouched', () => {
    const legitimate = conversation('real', '2026-07-28T10:00:00.000Z', [
      {
        id: 'real-user',
        role: 'user',
        text: 'Update the Homepage title to “A clearer title”.',
        createdAt: '2026-07-28T10:00:00.000Z',
      },
      {
        id: 'real-assistant',
        role: 'assistant',
        text: 'I updated the title.',
        createdAt: '2026-07-28T10:00:01.000Z',
      },
    ]);

    expect(withoutLegacyDemoTranscript(legitimate)).toBe(legitimate);
  });
});

describe('redactConversationSecrets', () => {
  it('leaves normal editorial text intact', () => {
    expect(redactConversationSecrets('Publish the summer article.')).toBe(
      'Publish the summer article.',
    );
  });
});
