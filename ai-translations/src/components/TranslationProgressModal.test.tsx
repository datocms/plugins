import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import type {
  loadRecordBatches,
  RecordBatch,
} from '../utils/translation/BulkRecordLoader';
import type {
  DatoCMSRecordFromAPI,
  ProgressUpdate,
  TranslateBatchOptions,
  translateAndUpdateRecords,
} from '../utils/translation/ItemsDropdownUtils';
import TranslationProgressModal from './TranslationProgressModal';

type LoadingOptions = NonNullable<Parameters<typeof loadRecordBatches>[2]>;

const mocks = vi.hoisted(() => ({
  buildDatoCMSClient: vi.fn(),
  createSchemaRepository: vi.fn(),
  getItemTypeById: vi.fn(),
  getProvider: vi.fn(),
  loadRecordBatches: vi.fn<typeof loadRecordBatches>(),
  translateAndUpdateRecords: vi.fn<typeof translateAndUpdateRecords>(),
  bulkPublish:
    vi.fn<
      (body: { items: { id: string; type: 'item' }[] }) => Promise<unknown>
    >(),
}));

vi.mock('../utils/clients', () => ({
  buildDatoCMSClient: mocks.buildDatoCMSClient,
}));

vi.mock('../utils/schemaRepository', () => ({
  createSchemaRepository: mocks.createSchemaRepository,
}));

vi.mock('../utils/translation/ProviderFactory', () => ({
  getProvider: mocks.getProvider,
}));

vi.mock('../utils/translation/BulkRecordLoader', () => ({
  loadRecordBatches: mocks.loadRecordBatches,
}));

vi.mock('../utils/translation/ItemsDropdownUtils', () => ({
  translateAndUpdateRecords: mocks.translateAndUpdateRecords,
  buildFieldTypeDictionaryWithRepo: vi.fn().mockResolvedValue({}),
}));

const pluginParams: ctxParamsType = {
  vendor: 'openai',
  apiKey: 'provider-key',
  gptModel: 'test-model',
  translationFields: ['single_line'],
  translateWholeRecord: true,
  translateBulkRecords: true,
  prompt: '',
  modelsToBeExcludedFromThisPlugin: [],
  rolesToBeExcludedFromThisPlugin: [],
  apiKeysToBeExcludedFromThisPlugin: [],
  enableDebugging: false,
};

function record(id: string): DatoCMSRecordFromAPI {
  return {
    id,
    item_type: { id: 'article' },
    title: { en: `Article ${id}` },
  };
}

function batch(
  records: DatoCMSRecordFromAPI[],
  missingItemIds: string[] = [],
): RecordBatch {
  return {
    records,
    requestedItemIds: [...records.map((item) => item.id), ...missingItemIds],
    missingItemIds,
  };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function reportCompleted(
  records: DatoCMSRecordFromAPI[],
  options: TranslateBatchOptions,
) {
  for (const [localIndex, item] of records.entries()) {
    const update: ProgressUpdate = {
      recordIndex: options.getRecordIndex?.(item.id, localIndex) ?? localIndex,
      recordId: item.id,
      itemTypeId: item.item_type.id,
      recordLabel: `Article ${item.id}`,
      status: 'completed',
      statusText: 'Translated',
      translatedFieldApiKeys: ['title'],
    };
    options.onProgress?.({ ...update, status: 'processing' });
    options.onProgress?.(update);
  }
}

function renderModal(
  itemIds = ['r1', 'r2'],
  { strictMode = false }: { strictMode?: boolean } = {},
) {
  const ctx = {
    environment: 'main',
    cmaBaseUrl: 'https://cma.example.test',
    isEnvironmentPrimary: true,
    site: { attributes: { internal_domain: 'example' } },
    resolve: vi.fn(),
    notice: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
  };
  const parameters = {
    totalRecords: itemIds.length,
    fromLocale: 'en',
    toLocales: ['it'],
    accessToken: 'cma-token',
    pluginParams,
    itemIds,
    selectedFieldsByModel: { article: ['title'] },
  };
  const modal = (
    <TranslationProgressModal
      ctx={ctx as unknown as RenderModalCtx}
      parameters={parameters}
    />
  );
  const view = render(strictMode ? <StrictMode>{modal}</StrictMode> : modal);
  return { ctx, parameters, ...view };
}

describe('TranslationProgressModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buildDatoCMSClient.mockReturnValue({
      items: { bulkPublish: mocks.bulkPublish },
    });
    mocks.createSchemaRepository.mockReturnValue({
      getItemTypeById: mocks.getItemTypeById,
    });
    mocks.getItemTypeById.mockResolvedValue({ draft_mode_active: true });
    mocks.getProvider.mockReturnValue({ vendor: 'openai' });
    mocks.bulkPublish.mockResolvedValue(undefined);
    mocks.translateAndUpdateRecords.mockImplementation(
      async (
        records,
        _client,
        _provider,
        _from,
        _to,
        _fields,
        _params,
        _ctx,
        _token,
        options = {},
      ) => reportCompleted(records, options),
    );
    mocks.loadRecordBatches.mockImplementation(
      async function* (_client, itemIds, options) {
        options?.onProgress?.({
          loaded: itemIds.length,
          total: itemIds.length,
        });
        yield batch(itemIds.map(record));
      },
    );
  });

  afterEach(cleanup);

  it('starts a single uncancelled job inside the host StrictMode wrapper', async () => {
    renderModal(['r1'], { strictMode: true });

    await screen.findByRole('button', { name: 'Close' });

    expect(mocks.loadRecordBatches).toHaveBeenCalledTimes(1);
    expect(mocks.translateAndUpdateRecords).toHaveBeenCalledTimes(1);
    const options = mocks.loadRecordBatches.mock.calls[0][2];
    expect(options?.abortSignal?.aborted).toBe(false);
    expect(options?.checkCancellation?.()).toBe(false);
    expect(screen.getByText('1 successful, 0 failed')).toBeTruthy();
  });

  it('continues the running job when the host supplies new context and parameter objects', async () => {
    const translation = deferred();
    let translationOptions: TranslateBatchOptions | undefined;
    mocks.translateAndUpdateRecords.mockImplementation(
      async (
        records,
        _client,
        _provider,
        _from,
        _to,
        _fields,
        _params,
        _ctx,
        _token,
        options = {},
      ) => {
        translationOptions = options;
        await translation.promise;
        reportCompleted(records, options);
      },
    );
    const { ctx, parameters, rerender } = renderModal(['r1']);
    await waitFor(() => {
      expect(translationOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    });

    rerender(
      <TranslationProgressModal
        ctx={{ ...ctx } as unknown as RenderModalCtx}
        parameters={{
          ...parameters,
          itemIds: [...parameters.itemIds],
          toLocales: [...parameters.toLocales],
          pluginParams: { ...parameters.pluginParams },
        }}
      />,
    );

    expect(translationOptions?.abortSignal?.aborted).toBe(false);
    expect(translationOptions?.checkCancellation?.()).toBe(false);
    await act(async () => translation.resolve());
    expect(await screen.findByRole('button', { name: 'Close' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(mocks.loadRecordBatches).toHaveBeenCalledTimes(1);
    expect(mocks.translateAndUpdateRecords).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1 successful, 0 failed')).toBeTruthy();
  });

  it('translates the first batch before fetching the next and reports loading progress', async () => {
    const translation = deferred();
    const events: string[] = [];
    mocks.loadRecordBatches.mockImplementation(
      async function* (_client, _itemIds, options) {
        events.push('fetch first');
        options?.onProgress?.({ loaded: 1, total: 2 });
        yield batch([record('r1')]);
        events.push('fetch second');
        options?.onProgress?.({ loaded: 2, total: 2 });
        yield batch([record('r2')]);
      },
    );
    mocks.translateAndUpdateRecords.mockImplementation(
      async (
        records,
        _client,
        _provider,
        _from,
        _to,
        _fields,
        _params,
        _ctx,
        _token,
        options = {},
      ) => {
        events.push(`translate ${records[0].id}`);
        if (records[0].id === 'r1') await translation.promise;
        reportCompleted(records, options);
      },
    );

    renderModal();

    expect(await screen.findByText('Records loaded: 1 of 2')).toBeTruthy();
    await waitFor(() => {
      expect(events).toEqual(['fetch first', 'translate r1']);
    });
    expect(
      screen.getByRole('button', { name: 'Please wait...' }),
    ).toHaveProperty('disabled', true);

    await act(async () => translation.resolve());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty(
        'disabled',
        false,
      );
    });
    expect(events).toEqual([
      'fetch first',
      'translate r1',
      'fetch second',
      'translate r2',
    ]);
    expect(screen.getByText(/Progress: 2 of 2 records processed/)).toBeTruthy();
    expect(screen.getByText('2 successful, 0 failed')).toBeTruthy();
  });

  it('keeps Close disabled until loading and translation finish, even when every record reports completion', async () => {
    const loading = deferred();
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r1')]);
      await loading.promise;
    });

    renderModal(['r1']);

    expect(await screen.findByText('1 successful, 0 failed')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Please wait...' }),
    ).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /Publish all/ })).toBeNull();

    await act(async () => loading.resolve());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty(
        'disabled',
        false,
      );
    });
  });

  it('assigns stable indexes by selected record ID across unordered batches', async () => {
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r2'), record('r1')]);
      yield batch([record('r3')]);
    });
    const { ctx } = renderModal(['r1', 'r2', 'r3']);

    const close = await screen.findByRole('button', { name: 'Close' });
    fireEvent.click(close);

    const result = ctx.resolve.mock.calls[0][0] as {
      completed: boolean;
      progress: ProgressUpdate[];
    };
    expect(result.completed).toBe(true);
    expect(result.progress).toHaveLength(3);
    expect(
      result.progress
        .map((update) => [update.recordId, update.recordIndex])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ['r1', 0],
      ['r2', 1],
      ['r3', 2],
    ]);
    expect(screen.getByText('3 successful, 0 failed')).toBeTruthy();
  });

  it('finishes with a failed record when a selected record was deleted', async () => {
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r2')], ['r1']);
    });
    const { ctx } = renderModal();

    const close = await screen.findByRole('button', { name: 'Close' });
    expect(screen.getByText(/Record is no longer available/)).toBeTruthy();
    expect(screen.getByText('1 successful, 1 failed')).toBeTruthy();
    expect(screen.getByText(/Progress: 2 of 2 records processed/)).toBeTruthy();
    fireEvent.click(close);

    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: false,
        canceled: false,
        progress: expect.arrayContaining([
          expect.objectContaining({
            recordId: 'r1',
            recordIndex: 0,
            status: 'error',
          }),
        ]),
      }),
    );
  });

  it('attributes fetch failures to DatoCMS without counting the fatal message as a failed record', async () => {
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r1')]);
      throw new Error(
        'DatoCMS error: Could not load records: Failed to fetch',
        {
          cause: new TypeError('Failed to fetch'),
        },
      );
    });
    const { ctx } = renderModal();

    const close = await screen.findByRole('button', { name: 'Close' });
    expect(screen.getByText(/DatoCMS error:/)).toBeTruthy();
    expect(screen.queryByText(/Translation provider error/)).toBeNull();
    expect(screen.getByText('1 successful, 0 failed')).toBeTruthy();
    expect(
      screen.getByText(/Progress: 1 of 2 records processed \(50%\)/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Publish all/ })).toBeNull();
    fireEvent.click(close);
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ completed: false, canceled: false }),
    );
  });

  it('cancels an in-flight record load and does not start translating after it settles', async () => {
    const loading = deferred();
    let loadingOptions: LoadingOptions | undefined;
    mocks.loadRecordBatches.mockImplementation(
      async function* (_client, _itemIds, options) {
        loadingOptions = options;
        await loading.promise;
        if (options?.abortSignal?.aborted) {
          throw new DOMException('Cancelled', 'AbortError');
        }
        yield batch([record('r1')]);
      },
    );
    const { ctx } = renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(loadingOptions?.abortSignal?.aborted).toBe(true);
    expect(loadingOptions?.checkCancellation?.()).toBe(true);
    expect(ctx.resolve).toHaveBeenCalledWith({
      completed: false,
      canceled: true,
    });
    await act(async () => loading.resolve());
    expect(mocks.translateAndUpdateRecords).not.toHaveBeenCalled();
    expect(screen.queryByText(/Translation failed/)).toBeNull();
    expect(ctx.resolve).toHaveBeenCalledTimes(1);
  });

  it('passes the loading AbortSignal into translation and stops before the next batch after cancellation', async () => {
    const translation = deferred();
    const fetchNext = vi.fn();
    let loadingOptions: LoadingOptions | undefined;
    let translationOptions: TranslateBatchOptions | undefined;
    mocks.loadRecordBatches.mockImplementation(
      async function* (_client, _itemIds, options) {
        loadingOptions = options;
        yield batch([record('r1')]);
        fetchNext();
        yield batch([record('r2')]);
      },
    );
    mocks.translateAndUpdateRecords.mockImplementation(
      async (
        records,
        _client,
        _provider,
        _from,
        _to,
        _fields,
        _params,
        _ctx,
        _token,
        options = {},
      ) => {
        translationOptions = options;
        await translation.promise;
        reportCompleted(records, options);
      },
    );
    const { ctx } = renderModal();
    await waitFor(() => {
      expect(translationOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    });
    expect(translationOptions?.abortSignal).toBe(loadingOptions?.abortSignal);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(translationOptions?.abortSignal?.aborted).toBe(true);
    expect(translationOptions?.checkCancellation?.()).toBe(true);
    await act(async () => translation.resolve());

    expect(fetchNext).not.toHaveBeenCalled();
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(ctx.resolve).toHaveBeenCalledTimes(1);
  });

  it('aborts pending record loading when the modal unmounts', async () => {
    const loading = deferred();
    let loadingOptions: LoadingOptions | undefined;
    mocks.loadRecordBatches.mockImplementation(
      async function* (_client, _itemIds, options) {
        loadingOptions = options;
        await loading.promise;
        yield batch([record('r1')]);
      },
    );
    const { unmount, ctx } = renderModal();
    await waitFor(() => {
      expect(loadingOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    });

    unmount();

    expect(loadingOptions?.abortSignal?.aborted).toBe(true);
    expect(loadingOptions?.checkCancellation?.()).toBe(true);
    await act(async () => loading.resolve());
    expect(mocks.translateAndUpdateRecords).not.toHaveBeenCalled();
    expect(ctx.resolve).not.toHaveBeenCalled();
  });

  it('limits visible updates while retaining all 2882 results for totals, publishing, and the modal result', async () => {
    const itemIds = Array.from({ length: 2882 }, (_, index) => `r${index}`);
    mocks.loadRecordBatches.mockImplementation(async function* () {
      for (let offset = 0; offset < itemIds.length; offset += 100) {
        yield batch(itemIds.slice(offset, offset + 100).map(record));
      }
    });
    const { ctx } = renderModal(itemIds);

    const publish = await screen.findByRole('button', {
      name: 'Publish all translated records (2882)',
    });
    expect(screen.getByText('2882 successful, 0 failed')).toBeTruthy();
    expect(
      screen.getByText(/Progress: 2882 of 2882 records processed/),
    ).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    expect(screen.queryByText('Article r0')).toBeNull();
    expect(screen.getByText('Article r2881')).toBeTruthy();
    expect(
      screen.getByText('Showing the latest 100 of 2882 updates.'),
    ).toBeTruthy();

    fireEvent.click(publish);

    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith(
        'Published 2882 translated records.',
      );
    });
    const publishedIds = mocks.bulkPublish.mock.calls.flatMap(([body]) =>
      body.items.map((item) => item.id),
    );
    expect(publishedIds).toEqual(itemIds);
    expect(mocks.bulkPublish).toHaveBeenCalledTimes(15);
    expect(
      mocks.bulkPublish.mock.calls.every(([body]) => body.items.length <= 200),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: true,
        progress: expect.arrayContaining([
          expect.objectContaining({ recordId: 'r0', status: 'completed' }),
          expect.objectContaining({ recordId: 'r2881', status: 'completed' }),
        ]),
      }),
    );
    const result = ctx.resolve.mock.calls[0][0] as {
      progress: ProgressUpdate[];
    };
    expect(result.progress).toHaveLength(2882);
  });
});
