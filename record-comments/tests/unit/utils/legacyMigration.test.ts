import type { Client } from '@datocms/cma-client-browser';
import { ApiError } from '@datocms/cma-client-browser';
import {
  assertMigrationMatches,
  buildLegacyUserIdsByEmail,
  emptyMigrationResults,
  MAX_MIGRATION_DETAILS,
  MIGRATION_PAGE_SIZE,
  prepareLegacyComments,
  retryMigrationRead,
  runLegacyMigration,
} from '@utils/legacyMigration';
import { afterEach, describe, expect, it, vi } from 'vitest';

const model = {
  modelId: 'source-model',
  modelName: 'Articles',
  modelApiKey: 'article',
  fieldId: 'legacy-field',
};
const legacy = () => ({
  dateISO: '2024-01-01T00:00:00.000Z',
  content: 'Preserve me',
  author: { name: 'Jane', email: 'jane@example.com' },
  usersWhoUpvoted: [],
  replies: [],
});
const userIdsByEmail = new Map([['jane@example.com', 'user-1']]);
const source = (id: string, value: unknown = [legacy()]) => ({
  id,
  attributes: { comment_log: value },
});

function setup(records = [source('record-1')]) {
  const destinations: Array<{
    id: string;
    attributes: Record<string, unknown>;
  }> = [];
  const rawList = vi.fn(
    async (query: {
      filter: { type: string; fields?: { record_id: { in: string[] } } };
      page: { offset?: number; limit: number };
    }) => {
      const data =
        query.filter.type === model.modelId
          ? records
          : destinations.filter((record) =>
              query.filter.fields?.record_id.in.includes(
                String(record.attributes.record_id),
              ),
            );
      return {
        data: data.slice(
          query.page.offset ?? 0,
          (query.page.offset ?? 0) + query.page.limit,
        ),
        meta: { total_count: data.length },
      };
    },
  );
  const create = vi.fn(async (body: Record<string, unknown>) => {
    destinations.push({ id: String(body.id), attributes: { ...body } });
    return body;
  });
  const list = vi.fn(async () =>
    destinations.map((record) => ({ id: record.id, ...record.attributes })),
  );
  const client = {
    items: { rawList, create, list },
    fields: {
      list: vi.fn(async () => [
        {
          api_key: 'record_id',
          localized: false,
          field_type: 'string',
          validators: { unique: {} },
        },
        {
          api_key: 'model_id',
          localized: false,
          field_type: 'string',
          validators: {},
        },
        {
          api_key: 'content',
          localized: false,
          field_type: 'json',
          validators: {},
        },
      ]),
    },
  } as unknown as Client;
  const onProgress = vi.fn();
  const options = {
    client,
    commentsModelId: 'comments-model',
    models: [model],
    userIdsByEmail,
    signal: new AbortController().signal,
    onProgress,
  };
  return { options, client, rawList, create, destinations, onProgress, list };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('legacy migration integrity', () => {
  it('preserves ambiguous historical emails without selecting an arbitrary user', () => {
    const users = buildLegacyUserIdsByEmail([
      { id: 'user-1', email: 'JANE@example.com' },
      { id: 'user-1', email: 'jane@example.com' },
      { id: 'user-2', email: 'jane@example.com' },
      { id: 'user-1', email: 'jane@example.com' },
      { id: 'other', email: 'other@example.com' },
    ]);
    expect(users.get('other@example.com')).toBe('other');
    expect(users.has('jane@example.com')).toBe(false);
    const prepared = prepareLegacyComments([legacy()], false, users);
    expect(prepared[0].authorId).toBe('legacy-email:jane%40example.com');
    expect(prepared[0]).toHaveProperty(
      'legacyAuthor.email',
      'jane@example.com',
    );
  });

  it('produces readable current comments, retaining author and voter history', () => {
    const comments = prepareLegacyComments([legacy()], false, userIdsByEmail);
    expect(comments[0]).toMatchObject({
      authorId: 'user-1',
      upvoterIds: [],
      authorEmail: 'jane@example.com',
      legacyAuthor: { name: 'Jane', email: 'jane@example.com' },
      content: [{ type: 'text', content: 'Preserve me' }],
    });
  });

  it('preserves all localized arrays and deleted authors', () => {
    const comments = prepareLegacyComments(
      { en: [legacy()], pt: [legacy()] },
      true,
      new Map(),
    );
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({
      legacyLocale: 'en',
      authorId: 'legacy-email:jane%40example.com',
    });
    expect(comments[1]).toMatchObject({ legacyLocale: 'pt' });
    expect(comments[0].id).not.toBe(comments[1].id);
  });

  it('preserves active votes when authors already use IDs but voters still use emails', () => {
    const comments = prepareLegacyComments(
      [
        {
          ...legacy(),
          authorId: 'user-1',
          usersWhoUpvoted: ['voter@example.com'],
        },
      ],
      false,
      new Map([...userIdsByEmail, ['voter@example.com', 'voter-1']]),
    );
    expect(comments[0].upvoterIds).toEqual(['voter-1']);
  });

  it('rejects conflicting locale metadata instead of overwriting it', () => {
    expect(() =>
      prepareLegacyComments(
        { en: [{ ...legacy(), legacyLocale: 'different-locale' }] },
        true,
        userIdsByEmail,
      ),
    ).toThrow();
  });

  it('requires stable modern comment IDs to match the destination', () => {
    const comments = prepareLegacyComments(
      [
        {
          id: 'modern-id',
          dateISO: legacy().dateISO,
          content: [],
          authorId: 'user-1',
          upvoterIds: [],
        },
      ],
      false,
      userIdsByEmail,
    );
    expect(() =>
      assertMigrationMatches(comments, [
        { ...comments[0], id: 'different-id' },
      ]),
    ).toThrow();
  });

  it.each([
    '{bad json',
    {},
    false,
    [legacy(), {}],
    [{ ...legacy(), replies: [{}] }],
  ])(
    'fails complete malformed records without discarding data: %j',
    (value) => {
      expect(() =>
        prepareLegacyComments(value, false, userIdsByEmail),
      ).toThrow();
    },
  );

  it('verifies content and parent references, accepting only identifier conversion', () => {
    const comments = prepareLegacyComments(
      [
        {
          ...legacy(),
          replies: [{ ...legacy(), dateISO: '2024-01-01T00:01:00.000Z' }],
        },
      ],
      false,
      userIdsByEmail,
    );
    const other = prepareLegacyComments(
      [
        {
          ...legacy(),
          replies: [{ ...legacy(), dateISO: '2024-01-01T00:01:00.000Z' }],
        },
      ],
      false,
      userIdsByEmail,
    );
    expect(() =>
      assertMigrationMatches(comments, JSON.stringify(other)),
    ).not.toThrow();
    other[0].content = [{ type: 'text', content: 'Concurrent edit' }];
    expect(() => assertMigrationMatches(comments, other)).toThrow('differs');
  });

  it('is idempotent and never overwrites an existing destination', async () => {
    const state = setup();
    const first = emptyMigrationResults();
    await runLegacyMigration(state.options, first);
    const second = emptyMigrationResults();
    await runLegacyMigration(state.options, second);
    expect(first.success).toBe(1);
    expect(second.skipped).toBe(1);
    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it('reconciles a committed create whose response was lost', async () => {
    const state = setup();
    state.create.mockImplementationOnce(async (body) => {
      state.destinations.push({ id: String(body.id), attributes: { ...body } });
      throw new TypeError('Failed to fetch');
    });
    const results = emptyMigrationResults();
    await runLegacyMigration(state.options, results);
    expect(results.success).toBe(1);
    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it('keeps counters accurate and caps retained error details', async () => {
    const state = setup(
      Array.from({ length: 35 }, (_, index) => source(`record-${index}`, '{}')),
    );
    const results = emptyMigrationResults();
    await runLegacyMigration(state.options, results);
    expect(results.failed).toBe(35);
    expect(results.errors).toHaveLength(MAX_MIGRATION_DETAILS);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentRecord: 35, totalRecords: 35 }),
    );
  });

  it('refuses cleanup if any nonempty source differs or has no destination', async () => {
    const state = setup();
    const onModelVerified = vi.fn();
    const results = emptyMigrationResults();
    await runLegacyMigration(
      { ...state.options, verifyOnly: true, onModelVerified },
      results,
    );
    expect(results.failed).toBe(1);
    expect(state.create).not.toHaveBeenCalled();
    expect(onModelVerified).not.toHaveBeenCalled();
  });

  it('refuses duplicate aggregate records before writing or cleaning', async () => {
    const state = setup();
    state.destinations.push(
      { id: 'a', attributes: { record_id: 'record-1' } },
      { id: 'b', attributes: { record_id: 'record-1' } },
    );
    await expect(
      runLegacyMigration(state.options, emptyMigrationResults()),
    ).rejects.toThrow('Duplicate destination');
    expect(state.create).not.toHaveBeenCalled();
  });

  it('blocks cleanup if records change during the verification scan', async () => {
    const state = setup();
    await runLegacyMigration(state.options, emptyMigrationResults());
    const original = state.rawList.getMockImplementation();
    if (!original) throw new Error('Mock implementation missing');
    let snapshots = 0;
    state.rawList.mockImplementation(async (query) => {
      const page = await original(query);
      if (query.filter.type !== model.modelId) return page;
      snapshots++;
      return {
        ...page,
        data: page.data.map((record) => ({
          ...record,
          meta: { updated_at: snapshots < 3 ? '2026-01-01' : '2026-01-02' },
        })),
      };
    });
    const onModelVerified = vi.fn();
    await expect(
      runLegacyMigration(
        { ...state.options, verifyOnly: true, onModelVerified },
        emptyMigrationResults(),
      ),
    ).rejects.toThrow('changed during verification');
    expect(onModelVerified).not.toHaveBeenCalled();
  });

  it('stops safely on abort while a request is in flight', async () => {
    const state = setup();
    const controller = new AbortController();
    state.rawList.mockImplementationOnce(async () => {
      controller.abort();
      return { data: [source('record-1')], meta: { total_count: 1 } };
    });
    await expect(
      runLegacyMigration(
        { ...state.options, signal: controller.signal },
        emptyMigrationResults(),
      ),
    ).rejects.toThrow('stopped');
    expect(state.create).not.toHaveBeenCalled();
  });

  function quotaError(status = 422, code = 'PLAN_UPGRADE_REQUIRED') {
    return new ApiError({
      request: { url: '/items', method: 'POST', headers: {} },
      response: {
        status, statusText: 'Quota failure', headers: {},
        body: { data: [{ id: 'error', type: 'api_error', attributes: { code, details: {} } }] },
      },
    });
  }

  it.each([
    [402, 'PAYMENT_REQUIRED'],
    [422, 'PLAN_UPGRADE_REQUIRED'],
    [429, 'MONTHLY_USAGE_QUOTA_EXCEEDED'],
  ])('stops the batch on quota HTTP %s without reconciliation or another write', async (status, code) => {
    const state = setup([source('record-1'), source('record-2')]);
    const error = quotaError(status, code);
    state.create.mockRejectedValue(error);
    await expect(runLegacyMigration(state.options, emptyMigrationResults())).rejects.toBe(error);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.list).not.toHaveBeenCalled();
  });

  it('does not retry a quota read even when it has HTTP 429 and Retry-After', async () => {
    vi.useFakeTimers();
    const error = quotaError(429, 'MONTHLY_USAGE_QUOTA_EXCEEDED');
    error.response.headers['retry-after'] = '3';
    const read = vi.fn().mockRejectedValue(error);
    const result = expect(retryMigrationRead(read, new AbortController().signal)).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await result;
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('honors the server rate limit delay automatically', async () => {
    vi.useFakeTimers();
    const limited = new ApiError({
      request: { url: '/items', method: 'GET', headers: {} },
      response: {
        status: 429,
        statusText: 'Too many requests',
        headers: { 'x-ratelimit-reset': '3' },
      },
    });
    const read = vi.fn().mockRejectedValueOnce(limited).mockResolvedValue('ok');
    const promise = retryMigrationRead(read, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toBe('ok');
  });

  it('streams a synthetic 200,000-record model without retaining a project-sized array', async () => {
    const state = setup([]);
    const total = 200000;
    let sourceCalls = 0;
    state.rawList.mockImplementation(async (query) => {
      expect(query.page.limit).toBe(MIGRATION_PAGE_SIZE);
      if (query.filter.type !== model.modelId)
        return { data: [], meta: { total_count: 0 } };
      sourceCalls++;
      const offset = query.page.offset ?? 0;
      // Only the current 100 fixtures exist at any time.
      return {
        data: Array.from(
          { length: Math.min(MIGRATION_PAGE_SIZE, total - offset) },
          (_, index) => source(`record-${offset + index}`, null),
        ),
        meta: { total_count: total },
      };
    });
    const results = emptyMigrationResults();
    await runLegacyMigration(state.options, results);
    expect(sourceCalls).toBe(total / MIGRATION_PAGE_SIZE);
    expect(results.empty).toBe(total);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentRecord: total, totalRecords: total }),
    );
  });
});
