import { describe, expect, it } from 'vitest';
import { migrateConversationScope } from './conversationScopeMigration';
import {
  type Conversation,
  type ConversationStorageContext,
  conversationStorageKey,
  createConversationStore,
  type StorageLike,
} from './conversations';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failSetFor?: string;
  failRemoveFor?: string;

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
    if (key === this.failSetFor) {
      throw new Error('set failed');
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (key === this.failRemoveFor) {
      throw new Error('remove failed');
    }
    this.values.delete(key);
  }
}

const baseContext = {
  pluginId: 'plugin',
  siteId: 'site',
  environment: 'primary',
  currentUserId: 'user',
};

const sourceContext: ConversationStorageContext = {
  ...baseContext,
  scope: { type: 'custom', id: 'new:model' },
};

const targetContext: ConversationStorageContext = {
  ...baseContext,
  scope: { type: 'record', recordId: 'record-1' },
};

function conversation(id: string, updatedAt: string): Conversation {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messages: [
      {
        id: `message-${id}`,
        role: 'user',
        text: `Message from ${id}`,
        createdAt: updatedAt,
      },
    ],
  };
}

describe('conversation scope migration', () => {
  it('copies new-record history to the saved record before clearing its source', () => {
    const storage = new MemoryStorage();
    const sourceStore = createConversationStore(sourceContext, storage);
    const targetStore = createConversationStore(targetContext, storage);
    sourceStore.save(
      conversation('new-record-chat', '2026-07-30T10:00:00.000Z'),
    );

    expect(
      migrateConversationScope(sourceContext, targetContext, storage),
    ).toBe('migrated');
    expect(targetStore.list().map((item) => item.id)).toEqual([
      'new-record-chat',
    ]);
    expect(storage.getItem(sourceStore.key)).toBeNull();
  });

  it('prioritizes all source chats while retaining destination history that fits', () => {
    const storage = new MemoryStorage();
    const sourceStore = createConversationStore(sourceContext, storage);
    const targetStore = createConversationStore(targetContext, storage);
    sourceStore.save(conversation('source-older', '2026-07-30T08:00:00.000Z'));
    sourceStore.save(conversation('source-newer', '2026-07-30T09:00:00.000Z'));
    targetStore.save(conversation('target-newest', '2026-07-30T11:00:00.000Z'));
    targetStore.save(conversation('target-older', '2026-07-30T07:00:00.000Z'));

    expect(
      migrateConversationScope(sourceContext, targetContext, storage),
    ).toBe('migrated');
    expect(new Set(targetStore.list().map((item) => item.id))).toEqual(
      new Set(['source-older', 'source-newer', 'target-newest']),
    );
  });

  it('leaves the source intact when the destination copy fails', () => {
    const storage = new MemoryStorage();
    const sourceStore = createConversationStore(sourceContext, storage);
    const targetStore = createConversationStore(targetContext, storage);
    sourceStore.save(conversation('source-chat', '2026-07-30T09:00:00.000Z'));
    const sourceBefore = storage.getItem(sourceStore.key);
    const targetBefore = storage.getItem(targetStore.key);
    storage.failSetFor = targetStore.key;

    expect(
      migrateConversationScope(sourceContext, targetContext, storage),
    ).toBe('failed');
    expect(storage.getItem(sourceStore.key)).toBe(sourceBefore);
    expect(storage.getItem(targetStore.key)).toBe(targetBefore);
  });

  it('rolls back the destination and index when clearing the source fails', () => {
    const storage = new MemoryStorage();
    const sourceStore = createConversationStore(sourceContext, storage);
    const targetStore = createConversationStore(targetContext, storage);
    const sourceConversation = conversation(
      'source-chat',
      '2026-07-30T09:00:00.000Z',
    );
    sourceStore.save(sourceConversation);
    targetStore.save(conversation('target-chat', '2026-07-30T08:00:00.000Z'));
    const sourceBefore = storage.getItem(sourceStore.key);
    const targetBefore = storage.getItem(targetStore.key);
    storage.failRemoveFor = conversationStorageKey(sourceContext);

    expect(
      migrateConversationScope(sourceContext, targetContext, storage),
    ).toBe('failed');
    expect(storage.getItem(sourceStore.key)).toBe(sourceBefore);
    expect(storage.getItem(targetStore.key)).toBe(targetBefore);
  });

  it('does not modify malformed source or destination data', () => {
    const storage = new MemoryStorage();
    const sourceKey = conversationStorageKey(sourceContext);
    const targetKey = conversationStorageKey(targetContext);
    storage.setItem(sourceKey, '{"version":1,"conversations":"invalid"}');
    storage.setItem(targetKey, '{"version":1,"conversations":[]}');

    expect(
      migrateConversationScope(sourceContext, targetContext, storage),
    ).toBe('failed');
    expect(storage.getItem(sourceKey)).toBe(
      '{"version":1,"conversations":"invalid"}',
    );
    expect(storage.getItem(targetKey)).toBe('{"version":1,"conversations":[]}');
  });
});
