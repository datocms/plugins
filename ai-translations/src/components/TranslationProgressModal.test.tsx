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
import type { bulkPublishTranslatedRecords } from '../utils/translation/BulkPublishUtils';
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
import {
  TranslationProgressStore,
  VISIBLE_TRANSLATION_UPDATE_LIMIT,
} from '../utils/translation/TranslationProgressStore';
import TranslationProgressModal from './TranslationProgressModal';

type LoadingOptions = NonNullable<Parameters<typeof loadRecordBatches>[2]>;
type PublishClient = Parameters<typeof bulkPublishTranslatedRecords>[0];
type PublicationRecord = Awaited<
  ReturnType<PublishClient['items']['list']>
>[number];
type PublicationLookup = (query?: {
  filter?: { ids?: string };
}) => Promise<PublicationRecord[]>;

function publicationRecord(
  id: string,
  status = 'published',
  currentVersion = `v-${id}`,
): PublicationRecord {
  // This UI fixture needs only the ID and publication/version metadata.
  return {
    id,
    item_type: { id: 'article', type: 'item_type' },
    meta: { status, current_version: currentVersion },
  } as PublicationRecord;
}

const mocks = vi.hoisted(() => ({
  buildDatoCMSClient: vi.fn(),
  createSchemaRepository: vi.fn(),
  getItemTypeById: vi.fn(),
  getProvider: vi.fn(),
  loadRecordBatches: vi.fn<typeof loadRecordBatches>(),
  translateAndUpdateRecords: vi.fn<typeof translateAndUpdateRecords>(),
  bulkPublish: vi.fn<PublishClient['items']['rawBulkPublish']>(),
  listPublishedRecords: vi.fn<PublicationLookup>(),
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
      currentVersion: `v-${item.id}`,
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
      items: {
        rawBulkPublish: mocks.bulkPublish,
        list: mocks.listPublishedRecords,
      },
    });
    mocks.createSchemaRepository.mockReturnValue({
      getItemTypeById: mocks.getItemTypeById,
    });
    mocks.getItemTypeById.mockResolvedValue({ draft_mode_active: true });
    mocks.getProvider.mockReturnValue({ vendor: 'openai' });
    mocks.bulkPublish.mockImplementation(async ({ data }) => ({
      data: [],
      meta: { successful: data.relationships.items.data.length, failed: 0 },
    }));
    mocks.listPublishedRecords.mockImplementation(async (query) =>
      String(query?.filter?.ids ?? '')
        .split(',')
        .filter(Boolean)
        .map((id) => publicationRecord(id)),
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

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
    const publish = screen.getByRole('button', {
      name: 'Publish all translated records (1)',
    });
    fireEvent.click(publish);
    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith('Published 1 translated record.');
    });
    fireEvent.click(close);
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: false,
        canceled: false,
        summary: expect.objectContaining({
          processedCount: 1,
          successfulCount: 1,
          failedCount: 0,
        }),
      }),
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
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toHaveProperty(
      'disabled',
      true,
    );
    await act(async () => loading.resolve());
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: false,
        canceled: true,
        summary: expect.objectContaining({ processedCount: 0 }),
      }),
    );
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
    expect(ctx.resolve).not.toHaveBeenCalled();
    await act(async () => translation.resolve());

    expect(fetchNext).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(ctx.resolve).toHaveBeenCalledTimes(1);
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: false,
        canceled: true,
        summary: expect.objectContaining({ updatedCount: 1 }),
      }),
    );
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
      body.data.relationships.items.data.map((item) => item.id),
    );
    expect(publishedIds).toEqual(itemIds);
    expect(mocks.bulkPublish).toHaveBeenCalledTimes(15);
    expect(
      mocks.bulkPublish.mock.calls.every(
        ([body]) => body.data.relationships.items.data.length <= 200,
      ),
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

  it('coalesces rapid progress events while counting them immediately', async () => {
    vi.useFakeTimers();
    const translation = deferred();
    const snapshot = vi.spyOn(TranslationProgressStore.prototype, 'snapshot');
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
        for (let index = 0; index < 2_000; index += 1) {
          options.onProgress?.({
            recordId: 'r1',
            recordIndex: 0,
            status: 'processing',
            statusText: `Translating locale ${index}`,
          });
        }
        reportCompleted(records, options);
        await translation.promise;
      },
    );
    await act(async () => {
      renderModal(['r1']);
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(100));
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1 successful, 0 failed')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await act(async () => translation.resolve());
    expect(snapshot).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('bounds massive job details and cancels publication after acknowledging the current batch', async () => {
    const itemIds = Array.from({ length: 6_001 }, (_, index) => `r${index}`);
    mocks.loadRecordBatches.mockImplementation(async function* () {
      for (let offset = 0; offset < itemIds.length; offset += 30) {
        yield batch(itemIds.slice(offset, offset + 30).map(record));
      }
    });
    const publishing = deferred();
    mocks.bulkPublish.mockImplementation(async ({ data }) => {
      await publishing.promise;
      return {
        data: [],
        meta: { successful: data.relationships.items.data.length, failed: 0 },
      };
    });
    const { ctx } = renderModal(itemIds);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Publish all translated records (6001)',
      }),
    );
    await waitFor(() => expect(mocks.bulkPublish).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel publishing' }));
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(ctx.resolve).not.toHaveBeenCalled();

    await act(async () => publishing.resolve());

    expect(mocks.bulkPublish).toHaveBeenCalledTimes(1);
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', {
        name: 'Retry publishing remaining (5801)',
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(
      VISIBLE_TRANSLATION_UPDATE_LIMIT,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: true,
        progressTruncated: true,
        progress: expect.any(Array),
        summary: expect.objectContaining({
          totalRecords: 6_001,
          processedCount: 6_001,
          updatedCount: 6_001,
        }),
      }),
    );
    const result = ctx.resolve.mock.calls[0][0] as {
      progress: ProgressUpdate[];
    };
    expect(result.progress).toHaveLength(VISIBLE_TRANSLATION_UPDATE_LIMIT);
  });

  it('retries only IDs not confirmed by a partially successful publication', async () => {
    const { ctx } = renderModal(['r1', 'r2']);
    mocks.bulkPublish.mockResolvedValueOnce({
      data: [],
      meta: { successful: 1, failed: 1 },
    });
    mocks.listPublishedRecords
      .mockResolvedValueOnce([publicationRecord('r1'), publicationRecord('r2')])
      .mockResolvedValueOnce([
        publicationRecord('r1'),
        publicationRecord('r2', 'draft'),
      ]);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Publish all translated records (2)',
      }),
    );
    await waitFor(() => expect(ctx.alert).toHaveBeenCalledTimes(1));
    expect(ctx.notice).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry publishing remaining (1)' }),
    );
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith(
        'Published 2 translated records.',
      ),
    );
    expect(
      mocks.bulkPublish.mock.calls[1][0].data.relationships.items.data,
    ).toEqual([{ type: 'item', id: 'r2' }]);
  });

  it('retains early publish candidates when a model eligibility lookup recovers in a later batch', async () => {
    mocks.getItemTypeById.mockRejectedValueOnce(
      new Error('Temporary read failure'),
    );
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r1')]);
      yield batch([record('r2')]);
    });
    const { ctx } = renderModal();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Publish all translated records (2)',
      }),
    );
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith(
        'Published 2 translated records.',
      ),
    );
    expect(
      mocks.bulkPublish.mock.calls[0][0].data.relationships.items.data,
    ).toEqual([
      { type: 'item', id: 'r1' },
      { type: 'item', id: 'r2' },
    ]);
  });

  it('passes saved versions into publication and excludes records edited after translation', async () => {
    const { ctx } = renderModal(['r1', 'r2']);
    mocks.listPublishedRecords.mockResolvedValueOnce([
      publicationRecord('r1'),
      publicationRecord('r2', 'updated', 'newer-editor-version'),
    ]);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Publish all translated records (2)',
      }),
    );

    await waitFor(() => expect(ctx.alert).toHaveBeenCalledTimes(1));

    expect(
      mocks.bulkPublish.mock.calls[0][0].data.relationships.items.data,
    ).toEqual([{ type: 'item', id: 'r1' }]);
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Retry publishing remaining (1)' }),
    ).toBeTruthy();
  });

  it('publishes in the job environment even if the host replaces context and parameters', async () => {
    const { ctx, parameters, rerender } = renderModal(['r1']);
    await screen.findByRole('button', {
      name: 'Publish all translated records (1)',
    });
    rerender(
      <TranslationProgressModal
        ctx={{ ...ctx, environment: 'other' } as unknown as RenderModalCtx}
        parameters={{ ...parameters, accessToken: 'other-token' }}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Publish all translated records (1)',
      }),
    );

    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('Published 1 translated record.'),
    );
    expect(mocks.buildDatoCMSClient).toHaveBeenLastCalledWith(
      'cma-token',
      'main',
      'https://cma.example.test',
    );
  });
});
