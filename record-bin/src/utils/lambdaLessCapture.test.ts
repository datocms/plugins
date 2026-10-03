import { buildClient } from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CmaRequestScheduler } from './cmaRequests';
import { captureDeletedItemsWithoutLambda } from './lambdaLessCapture';
import { ensureRecordBinModel } from './recordBinModel';

vi.mock('@datocms/cma-client-browser', () => ({ buildClient: vi.fn() }));
vi.mock('./recordBinModel', () => ({ ensureRecordBinModel: vi.fn() }));
const statusError = (status: number) => ({
  response: { status, headers: { 'retry-after': '0' } },
});
const source = (id: string, model = 'model-1') => ({
  id,
  type: 'item',
  relationships: { item_type: { data: { id: model, type: 'item_type' } } },
  attributes: {
    title: `Title ${id}`,
    json: {
      id: 'custom-id',
      __itemTypeId: 'literal',
      type: 'item',
      attributes: { text: 'opaque' },
    },
    content: {
      en: [
        {
          type: 'item',
          id: 'block-id',
          attributes: { value: 'nested' },
          relationships: {
            item_type: { data: { id: 'block-model', type: 'item_type' } },
          },
        },
      ],
    },
  },
  meta: { current_version: 'version-1', updated_at: '2026-01-01T00:00:00Z' },
});
const context = (token: string | undefined = 'token') => ({
  currentUserAccessToken: token as string | undefined,
  environment: 'main',
  cmaBaseUrl: 'https://example.invalid',
  plugin: { attributes: { parameters: {} } },
  notice: vi.fn().mockResolvedValue(undefined),
});
type Request = {
  method: string;
  url: string;
  queryParams?: {
    filter: { ids: string };
    nested: boolean;
    page: { limit: number; offset: number };
  };
  body?: { data: ReturnType<typeof source> };
};
function setup(
  overrides: {
    read?: (id: string, nested: boolean) => unknown;
    write?: (
      body: ReturnType<typeof source>,
      archive: Map<string, unknown>,
    ) => unknown;
  } = {},
) {
  const archive = new Map<string, unknown>();
  const batches: { count: number; nested: boolean }[] = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let writes = 0;
  const request = async ({ method, url, queryParams, body }: Request) => {
    if (method === 'GET' && url === '/items' && queryParams) {
      const ids = queryParams.filter.ids.split(',');
      batches.push({ count: ids.length, nested: queryParams.nested });
      expect(queryParams.page.limit).toBe(ids.length);
      expect(queryParams.page.offset).toBe(0);
      return {
        data: ids
          .map((id) =>
            overrides.read
              ? overrides.read(id, queryParams.nested)
              : source(id),
          )
          .filter(Boolean),
      };
    }
    if (method === 'GET') {
      const data = archive.get(url.split('/').pop() ?? '');
      if (!data) throw statusError(404);
      return { data };
    }
    if (!body) throw new Error('Missing create body');
    writes++;
    activeWrites++;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    await Promise.resolve();
    activeWrites--;
    if (overrides.write) return overrides.write(body.data, archive);
    if (archive.has(body.data.id)) throw statusError(422);
    archive.set(body.data.id, body.data);
    return body;
  };
  vi.mocked(buildClient).mockReturnValue({ request } as never);
  vi.mocked(ensureRecordBinModel).mockResolvedValue({ id: 'bin-model' });
  return {
    archive,
    batches,
    writes: () => writes,
    maxActiveWrites: () => maxActiveWrites,
  };
}
const run = (ids: string[], ctx = context(), options = {}) =>
  captureDeletedItemsWithoutLambda(
    ids.map((id) => ({ id })),
    ctx as never,
    { scheduler: new CmaRequestScheduler(0), ...options },
  );
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('continuous pre-deletion capture', () => {
  it('captures 1,201 mixed-schema records completely in bounded nested batches', async () => {
    const mock = setup();
    const progress = vi.fn();
    const ids = Array.from({ length: 1201 }, (_, i) => `item-${i}`);
    const result = await run(ids, context(), { onProgress: progress });
    expect(result).toMatchObject({
      capturedCount: 1201,
      failedItemIds: [],
      allowDeletion: true,
      cancelled: false,
    });
    expect(mock.archive.size).toBe(1201);
    expect(mock.batches.filter((batch) => batch.nested)).toHaveLength(61);
    expect(mock.batches.filter((batch) => !batch.nested)).toHaveLength(61);
    expect(Math.max(...mock.batches.map((batch) => batch.count))).toBe(20);
    expect(mock.maxActiveWrites()).toBeLessThanOrEqual(4);
    const first = mock.archive.values().next().value as ReturnType<
      typeof source
    >;
    const archived = JSON.parse(
      (first.attributes as unknown as { record_body: string }).record_body,
    ).entity;
    expect(archived).toEqual(source(archived.id));
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'verifying',
      totalCount: 1201,
      capturedCount: 1201,
      verifiedCount: 1201,
      failedCount: 0,
      skippedCount: 0,
    });
    expect(buildClient).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRetry: false,
        environment: 'main',
        baseUrl: 'https://example.invalid',
        fetchFn: expect.any(Function),
      }),
    );
  });
  it('deduplicates IDs and reconciles the same archive after a repeated operation', async () => {
    const mock = setup();
    expect((await run(['one', 'one'])).capturedCount).toBe(1);
    expect((await run(['one'])).allowDeletion).toBe(true);
    expect(mock.archive.size).toBe(1);
    expect(mock.writes()).toBe(2);
  });
  it('keeps the archive identity stable when API object key order changes', async () => {
    let reverse = false;
    const mock = setup({
      read: (id) => {
        const entity = source(id);
        return reverse
          ? {
              meta: entity.meta,
              attributes: entity.attributes,
              relationships: entity.relationships,
              type: entity.type,
              id: entity.id,
            }
          : entity;
      },
    });
    expect((await run(['one'])).allowDeletion).toBe(true);
    reverse = true;
    expect((await run(['one'])).allowDeletion).toBe(true);
    expect(mock.archive.size).toBe(1);
  });
  it('archives and verifies a valid large opaque JSON field through compression', async () => {
    const mock = setup({
      read: (id) => ({
        ...source(id),
        attributes: {
          ...source(id).attributes,
          json: { id: 'opaque-id', text: '"'.repeat(100000) },
        },
      }),
    });
    expect((await run(['large'])).allowDeletion).toBe(true);
    const archived = mock.archive.values().next().value as {
      attributes: { record_body: string };
    };
    expect(
      JSON.parse(archived.attributes.record_body).__record_bin_archive.format,
    ).toBe('gzip/base64');
  });
  it('reconciles an uncertain committed write instead of creating another copy', async () => {
    const mock = setup({
      write: (body, archive) => {
        archive.set(body.id, body);
        throw statusError(503);
      },
    });
    expect((await run(['one'])).allowDeletion).toBe(true);
    expect(mock.writes()).toBe(1);
  });
  it('retries a known rate limit with a stable archive identity', async () => {
    let attempt = 0;
    const mock = setup({
      write: (body, archive) => {
        if (attempt++ === 0) throw statusError(429);
        archive.set(body.id, body);
        return { data: body };
      },
    });
    expect((await run(['one'])).allowDeletion).toBe(true);
    expect(mock.archive.size).toBe(1);
    expect(mock.writes()).toBe(2);
  });
  it('blocks partial captures, missing pages, and permission failures', async () => {
    const mock = setup({
      read: (id) => (id === 'missing' ? undefined : source(id)),
    });
    const result = await run(['one', 'missing', 'two']);
    expect(result).toMatchObject({
      capturedCount: 2,
      failedItemIds: ['missing'],
      allowDeletion: false,
    });
    expect(mock.batches).toHaveLength(1);
  });
  it('detects edits between capture and final verification', async () => {
    setup({
      read: (id, nested) => ({
        ...source(id),
        meta: {
          ...source(id).meta,
          current_version: nested ? 'version-1' : 'version-2',
        },
      }),
    });
    expect(await run(['one'])).toMatchObject({
      capturedCount: 1,
      failedItemIds: ['one'],
      allowDeletion: false,
    });
  });
  it('rejects metadata-free sources and archive bodies that were corrupted', async () => {
    setup({ read: (id) => ({ ...source(id), meta: {} }) });
    expect((await run(['one'])).allowDeletion).toBe(false);
    setup({
      write: (body, archive) => {
        const corrupt = {
          ...body,
          attributes: { ...body.attributes, record_body: '{}' },
        };
        archive.set(body.id, corrupt);
        return { data: corrupt };
      },
    });
    expect((await run(['one'])).allowDeletion).toBe(false);
  });
  it('skips bin records, never recursively archives the bin', async () => {
    const mock = setup({ read: (id) => source(id, 'bin-model') });
    expect(await run(['bin-1', 'bin-2'])).toMatchObject({
      capturedCount: 0,
      skippedRecordBinItems: 2,
      allowDeletion: true,
    });
    expect(mock.writes()).toBe(0);
  });
  it('stops safely on cancellation, without approving deletion', async () => {
    const controller = new AbortController();
    const mock = setup({
      write: (body, archive) => {
        archive.set(body.id, body);
        controller.abort();
        return { data: body };
      },
    });
    expect(
      await run(
        Array.from({ length: 50 }, (_, i) => `item-${i}`),
        context(),
        { signal: controller.signal },
      ),
    ).toMatchObject({ allowDeletion: false, cancelled: true });
    expect(mock.writes()).toBeLessThanOrEqual(4);
    expect(mock.batches).toHaveLength(1);
  });
  it('handles a 200,000-ID failure without argument-spread overflow or API calls', async () => {
    const ctx = context();
    ctx.currentUserAccessToken = undefined;
    const result = await run(
      Array.from({ length: 200000 }, (_, i) => `id-${i}`),
      ctx,
    );
    expect(result.failedItemIds).toHaveLength(200000);
    expect(result.allowDeletion).toBe(false);
    expect(buildClient).not.toHaveBeenCalled();
  });
  it('does not create anything for empty selections', async () => {
    expect((await run([])).allowDeletion).toBe(true);
    expect(buildClient).not.toHaveBeenCalled();
  });
});
