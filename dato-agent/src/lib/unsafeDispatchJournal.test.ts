import { describe, expect, it } from 'vitest';
import type { StorageLike } from './conversations';
import {
  createUnsafeDispatchJournalStore,
  MAX_UNSAFE_DISPATCH_ARGUMENT_CHARACTERS,
  unsafeDispatchJournalStorageKey,
} from './unsafeDispatchJournal';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const context = {
  pluginId: 'plugin',
  siteId: 'site',
  environment: 'primary',
  currentUserId: 'user',
  scope: { type: 'project' as const },
};

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: 'journal-1',
    conversation: {
      id: 'conversation-1',
      title: 'Update title',
      createdAt: '2026-07-30T10:00:00.000Z',
    },
    turn: {
      id: 'turn-1',
      userEntryId: 'user-1',
      assistantEntryId: 'assistant-1',
      userMessage: 'Update the title',
      provider: 'openai' as const,
      model: 'gpt-test',
      startedAt: '2026-07-30T10:00:01.000Z',
    },
    responseId: 'response-1',
    scope: context.scope,
    operations: [
      {
        approvalRequestId: 'approval-1',
        name: 'upsert_and_execute_unsafe_script',
        arguments: '{"site_id":"site"}',
        automatic: false,
      },
    ],
    ...overrides,
  };
}

describe('unsafe dispatch journal', () => {
  it('isolates journals by user, environment, and conversation scope', () => {
    expect(unsafeDispatchJournalStorageKey(context)).not.toBe(
      unsafeDispatchJournalStorageKey({
        ...context,
        currentUserId: 'another-user',
      }),
    );
    expect(unsafeDispatchJournalStorageKey(context)).not.toBe(
      unsafeDispatchJournalStorageKey({
        ...context,
        environment: 'sandbox',
      }),
    );
    expect(unsafeDispatchJournalStorageKey(context)).not.toBe(
      unsafeDispatchJournalStorageKey({
        ...context,
        scope: { type: 'record', recordId: 'record-1' },
      }),
    );
  });

  it('persists monotonic armed, dispatched, and confirmed states', () => {
    const storage = new MemoryStorage();
    const store = createUnsafeDispatchJournalStore(context, storage);

    expect(store.claim(claim()).operations[0]?.state).toBe('armed');
    expect(
      store.markDispatched('journal-1', ['approval-1']).operations[0]?.state,
    ).toBe('dispatched');
    expect(
      store.markConfirmed('journal-1', ['approval-1']).operations[0]?.state,
    ).toBe('confirmed');
    expect(
      store.markDispatched('journal-1', ['approval-1']).operations[0]?.state,
    ).toBe('confirmed');
    expect(
      store.appendArmed('journal-1', 'response-2', [
        {
          approvalRequestId: 'approval-2',
          name: 'upsert_and_execute_unsafe_script',
          arguments: '{"site_id":"site"}',
          automatic: true,
        },
      ]),
    ).toMatchObject({
      responseId: 'response-2',
      operations: [
        { approvalRequestId: 'approval-1', state: 'confirmed' },
        { approvalRequestId: 'approval-2', state: 'armed' },
      ],
    });

    store.clear('journal-1');
    expect(store.read()).toBeUndefined();
  });

  it('bounds stored arguments and refuses to overwrite an unresolved claim', () => {
    const storage = new MemoryStorage();
    const store = createUnsafeDispatchJournalStore(context, storage);
    const longArguments = 'x'.repeat(
      MAX_UNSAFE_DISPATCH_ARGUMENT_CHARACTERS + 100,
    );
    const first = store.claim(
      claim({
        operations: [
          {
            approvalRequestId: 'approval-1',
            name: 'upsert_and_execute_unsafe_script',
            arguments: longArguments,
            automatic: true,
          },
        ],
      }),
    );

    expect(first.operations[0]).toMatchObject({
      argumentsTruncated: true,
      automatic: true,
    });
    expect(first.operations[0]?.argumentsPreview).toHaveLength(
      MAX_UNSAFE_DISPATCH_ARGUMENT_CHARACTERS,
    );
    expect(() => store.claim(claim({ id: 'journal-2' }))).toThrow(
      /previous approved change/i,
    );
  });

  it('discards only operations that were cancelled before dispatch', () => {
    const storage = new MemoryStorage();
    const store = createUnsafeDispatchJournalStore(context, storage);
    store.claim(
      claim({
        operations: [
          ...claim().operations,
          {
            approvalRequestId: 'approval-2',
            name: 'upsert_and_execute_unsafe_script',
            arguments: '{"site_id":"site"}',
            automatic: false,
          },
        ],
      }),
    );
    store.markDispatched('journal-1', ['approval-1']);
    store.markConfirmed('journal-1', ['approval-1']);

    expect(store.discardArmed('journal-1', ['approval-2'])).toMatchObject({
      operations: [{ approvalRequestId: 'approval-1', state: 'confirmed' }],
    });
    expect(() => store.discardArmed('journal-1', ['approval-1'])).toThrow(
      /only armed/i,
    );

    store.clear('journal-1');
    store.claim(claim());
    expect(store.discardArmed('journal-1', ['approval-1'])).toBeUndefined();
    expect(store.read()).toBeUndefined();
  });

  it('fails closed when a durable write cannot be verified', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {};
    const store = createUnsafeDispatchJournalStore(context, storage);

    expect(() => store.claim(claim())).toThrow(/was not sent/i);
    expect(store.read()).toBeUndefined();
  });

  it('refuses invalid transitions and never clears a newer journal', () => {
    const storage = new MemoryStorage();
    const store = createUnsafeDispatchJournalStore(context, storage);
    store.claim(claim());

    expect(() => store.markConfirmed('journal-1', ['approval-1'])).toThrow(
      /before it is dispatched/i,
    );
    expect(() => store.markDispatched('journal-1', ['missing'])).toThrow(
      /transition is invalid/i,
    );
    expect(() => store.clear('journal-2')).toThrow(/newer/i);
    expect(store.read()?.id).toBe('journal-1');
  });

  it('treats corrupted persisted state as an unresolved safety condition', () => {
    const storage = new MemoryStorage();
    const store = createUnsafeDispatchJournalStore(context, storage);
    storage.setItem(store.key, '{not json');

    expect(() => store.read()).toThrow(/could not be read/i);
    expect(() => store.claim(claim())).toThrow(/could not be read/i);
    expect(storage.getItem(store.key)).toBe('{not json');
  });
});
