import { ApiError, type SchemaTypes } from '@datocms/cma-client-browser';
import type { OnBeforeItemUpsertCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import beforeItemUpsert from './beforeItemUpsert';
import { buildTreeClient, readWithRetry } from './cmaRequests';
import updateAllChildrenSlugs, {
  PropagationError,
  type PropagationProgress,
  type TreeClient,
  type TreeRecord,
} from './updateAllChildrenSlugs';

vi.mock('./cmaRequests', async (importOriginal) => {
  const original = await importOriginal<typeof import('./cmaRequests')>();
  return { ...original, buildTreeClient: vi.fn(), readWithRetry: vi.fn() };
});

vi.mock('./updateAllChildrenSlugs', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./updateAllChildrenSlugs')>();
  return { ...original, default: vi.fn() };
});

type PluginFields = Awaited<
  ReturnType<OnBeforeItemUpsertCtx['loadFieldsUsingPlugin']>
>;
const MODEL = 'model-a';
const ROOT_ID = 'root-record';
const TOKEN = 'synthetic-test-token';

function field(
  apiKey = 'slug',
  modelId = MODEL,
  fieldType = 'slug',
): PluginFields[number] {
  return {
    id: `${modelId}-${apiKey}`,
    attributes: { api_key: apiKey, field_type: fieldType },
    relationships: { item_type: { data: { id: modelId } } },
  } as PluginFields[number];
}

function context(
  fields: PluginFields = [field()],
  options: {
    token?: string | null;
    onPublish?: boolean;
    environment?: string;
  } = {},
) {
  const alert = vi.fn<(_message: string) => Promise<void>>(
    async () => undefined,
  );
  const customToast = vi.fn<(_options: unknown) => Promise<void>>(
    async () => undefined,
  );
  const loadFieldsUsingPlugin = vi.fn(async () => fields);
  const ctx = {
    currentUserAccessToken: options.token === undefined ? TOKEN : options.token,
    environment: options.environment ?? 'sandbox',
    cmaBaseUrl: 'https://cma.test',
    plugin: {
      attributes: { parameters: { onPublish: options.onPublish ?? false } },
    },
    alert,
    customToast,
    loadFieldsUsingPlugin,
  } as unknown as OnBeforeItemUpsertCtx;
  return { ctx, alert, customToast, loadFieldsUsingPlugin };
}

function root(
  attributes: Record<string, unknown> = {},
  modelId = MODEL,
): TreeRecord {
  return {
    id: ROOT_ID,
    attributes: { parent_id: null, slug: 'old-prefix', ...attributes },
    relationships: { item_type: { data: { id: modelId } } },
    meta: { current_version: 'version-1' },
  };
}

function payload(
  attributes: Record<string, unknown> = { slug: 'new-prefix' },
  options: {
    id?: string;
    modelId?: string;
    version?: string;
    omitModel?: boolean;
  } = {},
): SchemaTypes.ItemUpdateSchema {
  return {
    data: {
      id: options.id ?? ROOT_ID,
      type: 'item',
      attributes,
      ...(options.omitModel
        ? {}
        : {
            relationships: {
              item_type: {
                data: {
                  id: options.modelId ?? MODEL,
                  type: 'item_type' as const,
                },
              },
            },
          }),
      ...(options.version
        ? { meta: { current_version: options.version } }
        : {}),
    },
  };
}

function progress(
  overrides: Partial<PropagationProgress> = {},
): PropagationProgress {
  return {
    phase: 'complete',
    scanned: 12,
    modelTotal: 12,
    total: 11,
    processed: 11,
    updated: 9,
    unchanged: 2,
    ...overrides,
  };
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) throw new Error('Missing promise resolver');
      resolvePromise(value);
    },
  };
}

function secretApiError(status: number): ApiError {
  return new ApiError({
    request: {
      method: 'GET',
      url: 'https://cma.test/items/root',
      headers: { Authorization: `Bearer ${TOKEN}` },
    },
    response: {
      status,
      statusText: 'Synthetic API failure',
      headers: {},
      body: {
        data: [
          {
            id: 'error',
            type: 'api_error',
            attributes: {
              code: 'SYNTHETIC_ERROR',
              doc_url: '',
              details: { Authorization: `Bearer ${TOKEN}` },
            },
          },
        ],
      },
    },
  });
}

const buildClientMock = vi.mocked(buildTreeClient);
const readMock = vi.mocked(readWithRetry);
const propagateMock = vi.mocked(updateAllChildrenSlugs);
let client: TreeClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = {
    items: {
      rawFind: vi
        .fn<TreeClient['items']['rawFind']>()
        .mockResolvedValue({ data: root() }),
      rawList: vi.fn<TreeClient['items']['rawList']>(),
      rawUpdate: vi.fn<TreeClient['items']['rawUpdate']>(),
    },
  };
  buildClientMock.mockReturnValue(
    client as unknown as ReturnType<typeof buildTreeClient>,
  );
  readMock.mockImplementation(async (operation) => operation());
  propagateMock.mockResolvedValue(progress());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('beforeItemUpsert eligibility and reads', () => {
  it('skips a new record without an ID before loading fields or accessing the API', async () => {
    const { ctx, loadFieldsUsingPlugin } = context();
    const creation: SchemaTypes.ItemCreateSchema = {
      data: {
        type: 'item',
        attributes: { slug: 'new' },
        relationships: {
          item_type: { data: { id: MODEL, type: 'item_type' } },
        },
      },
    };
    expect(await beforeItemUpsert(creation, ctx)).toBe(true);
    expect(loadFieldsUsingPlugin).not.toHaveBeenCalled();
    expect(buildClientMock).not.toHaveBeenCalled();
  });

  it('allows a preallocated ID only after an actual 404', async () => {
    const { ctx, alert } = context();
    vi.mocked(client.items.rawFind).mockRejectedValue(secretApiError(404));
    const id = 'fe399a8a-3562-43fc-b757-e8f041edbe69';
    expect(await beforeItemUpsert(payload({ slug: 'new' }, { id }), ctx)).toBe(
      true,
    );
    expect(client.items.rawFind).toHaveBeenCalledWith(id, {
      nested: false,
      version: 'current',
    });
    expect(propagateMock).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', secretApiError(401)],
    ['forbidden', secretApiError(403)],
    ['network', new TypeError(`Network failed: ${TOKEN}`)],
  ])('blocks a %s failure instead of treating an existing ID as new', async (_name, error) => {
    const { ctx, alert } = context();
    vi.mocked(client.items.rawFind).mockRejectedValue(error);
    expect(await beforeItemUpsert(payload(), ctx)).toBe(false);
    expect(propagateMock).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]?.[0]).toContain('The parent was not saved');
    expect(alert.mock.calls[0]?.[0]).not.toContain(TOKEN);
    expect(alert.mock.calls[0]?.[0]).not.toContain('Authorization');
  });

  it('preserves the onPublish flag and skips the save hook entirely', async () => {
    const { ctx, loadFieldsUsingPlugin, alert } = context([], {
      onPublish: true,
      token: null,
    });
    expect(await beforeItemUpsert(payload(), ctx)).toBe(true);
    expect(loadFieldsUsingPlugin).not.toHaveBeenCalled();
    expect(buildClientMock).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('requires a token for relevant changes but permits unrelated saves', async () => {
    const { ctx, alert } = context([field()], { token: null });
    expect(await beforeItemUpsert(payload({ title: 'Title' }), ctx)).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(await beforeItemUpsert(payload(), ctx)).toBe(false);
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('currentUserAccessToken'),
    );
    expect(buildClientMock).not.toHaveBeenCalled();
  });

  it('ignores fields assigned to another model even when API keys match', async () => {
    const { ctx, alert } = context([field('slug', 'other-model')], {
      token: null,
    });
    expect(await beforeItemUpsert(payload(), ctx)).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(buildClientMock).not.toHaveBeenCalled();
  });

  it('ignores a non-slug field when another model uses the same key for a slug', async () => {
    const { ctx, alert } = context(
      [field('slug', MODEL, 'string'), field('slug', 'other-model')],
      { token: null },
    );
    expect(await beforeItemUpsert(payload(), ctx)).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(buildClientMock).not.toHaveBeenCalled();
  });

  it.each([
    'ordinary content',
    null,
    { en: 'localized content' },
  ])('ignores an unrelated custom parent field %j without requiring a token', async (parent) => {
    const { ctx, alert } = context(
      [field(), field('parent', MODEL, 'string')],
      {
        token: null,
      },
    );
    const save = payload({ parent });
    expect(await beforeItemUpsert(save, ctx)).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(buildClientMock).not.toHaveBeenCalled();
    expect(propagateMock).not.toHaveBeenCalled();
    expect(save.data.attributes).toEqual({ parent });
  });

  it('passes the environment and base URL to the shared client and retries its root read', async () => {
    const { ctx } = context();
    expect(await beforeItemUpsert(payload(), ctx)).toBe(true);
    expect(buildClientMock).toHaveBeenCalledWith({
      apiToken: TOKEN,
      environment: 'sandbox',
      baseUrl: 'https://cma.test',
    });
    expect(readMock).toHaveBeenCalledOnce();
    expect(client.items.rawFind).toHaveBeenCalledWith(ROOT_ID, {
      nested: false,
      version: 'current',
    });
  });
});

describe('beforeItemUpsert changes and conflicts', () => {
  it('propagates every changed slug field once, scoped to the root model', async () => {
    const fields = [
      field(),
      field('path'),
      field('unchanged'),
      field('title', MODEL, 'string'),
      field('foreign', 'other-model'),
    ];
    const { ctx } = context(fields);
    const record = root({
      path: 'old-path',
      unchanged: 'same',
      title: 'old title',
    });
    vi.mocked(client.items.rawFind).mockResolvedValue({ data: record });
    const save = payload({
      slug: 'new-prefix',
      path: 'new-path',
      unchanged: 'same',
      title: 'new title',
      foreign: 'other',
    });
    expect(await beforeItemUpsert(save, ctx)).toBe(true);
    expect(propagateMock).toHaveBeenCalledOnce();
    expect(propagateMock).toHaveBeenCalledWith(
      client,
      MODEL,
      record,
      { slug: 'new-prefix', path: 'new-path' },
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(save.data.attributes).toEqual({
      slug: 'new-prefix',
      path: 'new-path',
      unchanged: 'same',
      title: 'new title',
      foreign: 'other',
    });
    expect(record.attributes.slug).toBe('old-prefix');
  });

  it('uses the root model for field scoping when the update omits item_type', async () => {
    const { ctx } = context([field(), field('foreign', 'other-model')]);
    expect(
      await beforeItemUpsert(
        payload({ slug: 'new-prefix', foreign: 'other' }, { omitModel: true }),
        ctx,
      ),
    ).toBe(true);
    expect(propagateMock.mock.calls[0]?.[3]).toEqual({ slug: 'new-prefix' });
  });

  it('propagates only locales that changed, including explicit nulls', async () => {
    const { ctx } = context();
    const record = root({ slug: { en: 'old', fr: 'same', es: 'untouched' } });
    vi.mocked(client.items.rawFind).mockResolvedValue({ data: record });
    expect(
      await beforeItemUpsert(
        payload({ slug: { en: 'new', fr: 'same', ja: null } }),
        ctx,
      ),
    ).toBe(true);
    expect(propagateMock.mock.calls[0]?.[3]).toEqual({
      slug: { en: 'new', ja: null },
    });
    expect(record.attributes.slug).toEqual({
      en: 'old',
      fr: 'same',
      es: 'untouched',
    });
  });

  it.each([
    [{ slug: 'old-prefix', parent_id: null }, {}],
    [{ parent_id: 'same-parent' }, { parent_id: 'same-parent' }],
    [{ slug: { fr: 'same', en: 'old' } }, { slug: { en: 'old', fr: 'same' } }],
    [{ slug: null }, { slug: null }],
  ])('skips propagation when all supplied prefixes and the parent are unchanged', async (attributes, stored) => {
    const { ctx } = context();
    vi.mocked(client.items.rawFind).mockResolvedValue({ data: root(stored) });
    expect(await beforeItemUpsert(payload(attributes), ctx)).toBe(true);
    expect(propagateMock).not.toHaveBeenCalled();
  });

  it.each([
    42,
    [],
    { en: 42 },
  ])('blocks an invalid incoming slug %j', async (slug) => {
    const { ctx, alert } = context();
    expect(await beforeItemUpsert(payload({ slug }), ctx)).toBe(false);
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('slug value is invalid'),
    );
    expect(propagateMock).not.toHaveBeenCalled();
  });

  it('blocks an obsolete expected parent version before touching children', async () => {
    const { ctx, alert } = context();
    expect(
      await beforeItemUpsert(
        payload({ slug: 'new' }, { version: 'obsolete-version' }),
        ctx,
      ),
    ).toBe(false);
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('parent record changed'),
    );
    expect(propagateMock).not.toHaveBeenCalled();
  });

  it('asks the engine to validate a parent-only change and blocks a cycle', async () => {
    const { ctx, alert } = context();
    propagateMock.mockRejectedValue(
      new PropagationError(
        'The tree parent would create a cycle.',
        progress({ total: 0, processed: 0, updated: 0 }),
      ),
    );
    expect(
      await beforeItemUpsert(payload({ parent_id: 'descendant' }), ctx),
    ).toBe(false);
    expect(propagateMock).toHaveBeenCalledWith(
      client,
      MODEL,
      expect.any(Object),
      {},
      expect.objectContaining({ newParent: 'descendant' }),
    );
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('cycle'));
  });

  it('passes a move to the tree root as an explicit null parent', async () => {
    const { ctx } = context();
    vi.mocked(client.items.rawFind).mockResolvedValue({
      data: root({ parent_id: 'former-parent' }),
    });
    expect(await beforeItemUpsert(payload({ parent_id: null }), ctx)).toBe(
      true,
    );
    expect(propagateMock.mock.calls[0]?.[4]).toMatchObject({ newParent: null });
  });

  it('does not interpret a custom parent field as a tree move during a slug save', async () => {
    const { ctx, alert } = context([field(), field('parent', MODEL, 'string')]);
    const stored = root({ parent_id: 'tree-parent', parent: 'old content' });
    vi.mocked(client.items.rawFind).mockResolvedValue({ data: stored });
    const save = payload({ slug: 'new-prefix', parent: { en: 'new content' } });
    expect(await beforeItemUpsert(save, ctx)).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(propagateMock).toHaveBeenCalledWith(
      client,
      MODEL,
      stored,
      { slug: 'new-prefix' },
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(propagateMock.mock.calls[0]?.[4]).not.toHaveProperty('newParent');
    expect(save.data.attributes).toEqual({
      slug: 'new-prefix',
      parent: { en: 'new content' },
    });
  });

  it('rejects a malformed parent before any child propagation', async () => {
    const { ctx, alert } = context();
    expect(
      await beforeItemUpsert(payload({ parent_id: { id: 'parent' } }), ctx),
    ).toBe(false);
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('tree parent is invalid'),
    );
    expect(propagateMock).not.toHaveBeenCalled();
  });
});

describe('beforeItemUpsert failures, feedback and serialization', () => {
  it('reports confirmed partial updates and prevents saving the parent', async () => {
    const { ctx, alert } = context();
    propagateMock.mockRejectedValue(
      new PropagationError(
        'A child record changed during propagation.',
        progress({
          phase: 'updating',
          total: 200_000,
          processed: 12_345,
          updated: 12_300,
        }),
      ),
    );
    expect(await beforeItemUpsert(payload(), ctx)).toBe(false);
    const message = alert.mock.calls[0]?.[0];
    expect(message).toContain((12_345).toLocaleString());
    expect(message).toContain((200_000).toLocaleString());
    expect(message).toContain(`${(12_300).toLocaleString()} updates confirmed`);
    expect(message).toContain(
      'Confirmed child updates have already been saved',
    );
    expect(message).toContain(
      'unconfirmed request may also have reached the server',
    );
  });

  it('sanitizes SDK API errors from both field loading and propagation', async () => {
    const error = secretApiError(503);
    expect(error.message).toContain(TOKEN);
    const { ctx, alert, loadFieldsUsingPlugin } = context();
    loadFieldsUsingPlugin.mockRejectedValueOnce(error);
    expect(await beforeItemUpsert(payload(), ctx)).toBe(false);
    propagateMock.mockRejectedValueOnce(error);
    expect(await beforeItemUpsert(payload(), ctx)).toBe(false);
    expect(alert).toHaveBeenCalledTimes(2);
    for (const [message] of alert.mock.calls) {
      expect(message).toContain('The parent was not saved');
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain('Authorization');
      expect(message).not.toContain(error.message);
    }
  });

  it('stops progress notifications when tree loading fails before updates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const { ctx, customToast, alert } = context();
    propagateMock.mockImplementationOnce(
      async (_client, _model, _root, _prefixes, options) => {
        const loading = progress({
          phase: 'loading',
          scanned: 100,
          modelTotal: 200_000,
          total: 0,
          processed: 0,
          updated: 0,
          unchanged: 0,
        });
        options?.onProgress?.(loading);
        throw new PropagationError('The tree changed while loading.', loading);
      },
    );
    expect(await beforeItemUpsert(payload(), ctx)).toBe(false);
    expect(alert.mock.calls[0]?.[0]).not.toContain(
      'Confirmed child updates have already been saved',
    );
    const notifications = customToast.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(customToast).toHaveBeenCalledTimes(notifications);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps small operations silent even after enough time for a progress notification', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const { ctx, customToast } = context();
    propagateMock.mockImplementationOnce(
      async (_client, _model, _root, _prefixes, options) => {
        options?.onProgress?.(
          progress({
            phase: 'loading',
            scanned: 100,
            modelTotal: 999,
            total: 0,
          }),
        );
        options?.onProgress?.(progress({ phase: 'updating', total: 999 }));
        options?.onProgress?.(progress({ phase: 'complete', total: 999 }));
        return progress({ total: 999 });
      },
    );
    expect(await beforeItemUpsert(payload(), ctx)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(customToast).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows large-volume progress without waiting for toast dismissal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const { ctx, customToast } = context();
    customToast.mockImplementation(() => new Promise<void>(() => undefined));
    const entered = deferred<void>();
    const finish = deferred<void>();
    propagateMock.mockImplementationOnce(
      async (_client, _model, _root, _prefixes, options) => {
        options?.onProgress?.(
          progress({
            phase: 'loading',
            scanned: 1000,
            modelTotal: 200_000,
            total: 0,
          }),
        );
        entered.resolve(undefined);
        await finish.promise;
        const completed = progress({
          scanned: 200_000,
          modelTotal: 200_000,
          total: 199_999,
          processed: 199_999,
          updated: 199_999,
          unchanged: 0,
        });
        options?.onProgress?.(completed);
        return completed;
      },
    );
    const save = beforeItemUpsert(payload(), ctx);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(5000);
    expect(customToast).toHaveBeenCalledTimes(2);
    expect(customToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notice',
        message: expect.stringContaining((200_000).toLocaleString()),
      }),
    );
    finish.resolve(undefined);
    let settled = false;
    void save.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(await save).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not fail the save when a large-volume toast rejects', async () => {
    const { ctx, customToast, alert } = context();
    customToast.mockRejectedValue(new Error('Dashboard navigation'));
    propagateMock.mockImplementationOnce(
      async (_client, _model, _root, _prefixes, options) => {
        const completed = progress({ total: 1000, processed: 1000 });
        options?.onProgress?.(completed);
        return completed;
      },
    );
    expect(await beforeItemUpsert(payload(), ctx)).toBe(true);
    expect(customToast).toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('serializes overlapping operations on the same model and releases the queue after failure', async () => {
    const { ctx, alert } = context();
    const entered = deferred<void>();
    const finish = deferred<void>();
    let active = 0;
    let peak = 0;
    let invocations = 0;
    propagateMock.mockImplementation(async () => {
      invocations++;
      active++;
      peak = Math.max(peak, active);
      try {
        if (invocations === 1) {
          entered.resolve(undefined);
          await finish.promise;
          throw new PropagationError('Synthetic child conflict.', progress());
        }
        return progress();
      } finally {
        active--;
      }
    });
    const first = beforeItemUpsert(payload({ slug: 'first' }), ctx);
    await entered.promise;
    const second = beforeItemUpsert(payload({ slug: 'second' }), ctx);
    await Promise.resolve();
    await Promise.resolve();
    expect(propagateMock).toHaveBeenCalledOnce();
    expect(client.items.rawFind).toHaveBeenCalledOnce();
    finish.resolve(undefined);
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(peak).toBe(1);
    expect(propagateMock).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledOnce();
    expect(propagateMock.mock.calls.map((call) => call[3])).toEqual([
      { slug: 'first' },
      { slug: 'second' },
    ]);
  });
});
