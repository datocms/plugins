import { buildClient } from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDeletedItemsWithoutLambda } from './lambdaLessCapture';
import { ensureRecordBinModel } from './recordBinModel';

vi.mock('@datocms/cma-client-browser', () => ({ buildClient: vi.fn() }));
vi.mock('./recordBinModel', () => ({ ensureRecordBinModel: vi.fn() }));
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
  overrides: { read?: (id: string, nested: boolean) => unknown } = {},
) {
  const archive: unknown[] = [];
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
    if (method !== 'POST' || url !== '/items' || !body)
      throw new Error('Unexpected request');
    writes++;
    activeWrites++;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    await Promise.resolve();
    activeWrites--;
    archive.push(body.data);
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
const run = (ids: string[], ctx = context()) =>
  captureDeletedItemsWithoutLambda(
    ids.map((id) => ({ id })),
    ctx as never,
  );
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('pre-deletion capture', () => {
  it('captures records completely in bounded nested batches', async () => {
    const mock = setup();
    const ids = Array.from({ length: 41 }, (_, i) => `item-${i}`);
    const result = await run(ids);
    expect(result).toEqual({
      capturedCount: 41,
      failedItemIds: [],
      skippedRecordBinItems: 0,
      allowDeletion: true,
    });
    expect(mock.archive).toHaveLength(41);
    expect(mock.batches.filter((batch) => batch.nested)).toHaveLength(3);
    expect(mock.batches.filter((batch) => !batch.nested)).toHaveLength(3);
    expect(Math.max(...mock.batches.map((batch) => batch.count))).toBe(20);
    expect(mock.maxActiveWrites()).toBeLessThanOrEqual(4);
    const first = mock.archive[0] as ReturnType<typeof source>;
    const archived = JSON.parse(
      (first.attributes as unknown as { record_body: string }).record_body,
    ).entity;
    expect(archived).toEqual(source(archived.id));
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'token',
      environment: 'main',
      baseUrl: 'https://example.invalid',
    });
  });
  it('deduplicates IDs', async () => {
    const mock = setup();
    expect((await run(['one', 'one'])).capturedCount).toBe(1);
    expect(mock.writes()).toBe(1);
  });
  it('archives a valid large opaque JSON field through compression', async () => {
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
    const archived = mock.archive[0] as {
      attributes: { record_body: string };
    };
    expect(
      JSON.parse(archived.attributes.record_body).__record_bin_archive.format,
    ).toBe('gzip/base64');
  });
  it('blocks partial captures and missing records', async () => {
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
  it('rejects sources without version metadata', async () => {
    setup({ read: (id) => ({ ...source(id), meta: {} }) });
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
  it('blocks deletion without an access token', async () => {
    const ctx = context();
    ctx.currentUserAccessToken = undefined;
    const result = await run(['one', 'two'], ctx);
    expect(result.failedItemIds).toEqual(['one', 'two']);
    expect(result.allowDeletion).toBe(false);
    expect(buildClient).not.toHaveBeenCalled();
  });
  it('does not create anything for empty selections', async () => {
    expect((await run([])).allowDeletion).toBe(true);
    expect(buildClient).not.toHaveBeenCalled();
  });
});
