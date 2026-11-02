import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { dropFocus } from '../test/dropFocus';
import { makeCtx, renderWithCanvas } from '../test/renderWithCanvas';
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
import { TranslationProgressStore } from '../utils/translation/TranslationProgressStore';
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
  const modalCtx = makeCtx<RenderModalCtx>(ctx);
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
    <TranslationProgressModal ctx={modalCtx} parameters={parameters} />
  );
  const view = renderWithCanvas(
    strictMode ? <StrictMode>{modal}</StrictMode> : modal,
    modalCtx,
  );
  return { ctx, modalCtx, parameters, ...view };
}

function closeButton() {
  return screen.getByRole('button', { name: 'Close' });
}

/**
 * Waits until the run is over and Close works. A button disabled with a
 * reason sits in the kit's tooltip trigger, so the element changes when the
 * reason goes: query it again each time.
 */
async function waitForClose() {
  return waitFor(() => {
    const close = closeButton();
    expect(close).not.toHaveAttribute('aria-disabled');
    return close;
  });
}

/** Close is disabled with a reason (it keeps the focus, for the tooltip). */
function expectCloseBlocked() {
  expect(closeButton()).toHaveAttribute('aria-disabled', 'true');
}

/** The cancellation signal that the modal gave the record loader. */
function loadingAbortSignal() {
  return mocks.loadRecordBatches.mock.calls[0]?.[2]?.abortSignal;
}

/** The value of an InfoList row, found by its title. */
function rowValue(title: string) {
  const term = screen
    .queryAllByRole('term')
    .find((element) => element.textContent === title);
  return term?.nextElementSibling?.textContent;
}

/**
 * The Translated and Failed counts of the InfoList, which shows once the run
 * ended. Failed shows only when some record failed.
 */
function counts() {
  return { translated: rowValue('Translated'), failed: rowValue('Failed') };
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

    await waitForClose();

    expect(mocks.loadRecordBatches).toHaveBeenCalledTimes(1);
    expect(mocks.translateAndUpdateRecords).toHaveBeenCalledTimes(1);
    const options = mocks.loadRecordBatches.mock.calls[0][2];
    expect(options?.abortSignal?.aborted).toBe(false);
    expect(options?.checkCancellation?.()).toBe(false);
    expect(counts()).toEqual({ translated: '1', failed: undefined });
    expect(screen.getByText('Translation finished')).toBeTruthy();
    // The locales were confirmed before the run: no row repeats them.
    expect(rowValue('From')).toBeUndefined();
    expect(rowValue('To')).toBeUndefined();
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
    const { modalCtx, parameters, rerender } = renderModal(['r1']);
    await waitFor(() => {
      expect(translationOptions?.abortSignal).toBeInstanceOf(AbortSignal);
    });

    const nextCtx = { ...modalCtx };
    rerender(
      <TranslationProgressModal
        ctx={nextCtx}
        parameters={{
          ...parameters,
          itemIds: [...parameters.itemIds],
          toLocales: [...parameters.toLocales],
          pluginParams: { ...parameters.pluginParams },
        }}
      />,
      nextCtx,
    );

    expect(translationOptions?.abortSignal?.aborted).toBe(false);
    expect(translationOptions?.checkCancellation?.()).toBe(false);
    expectCloseBlocked();
    await act(async () => translation.resolve());
    await waitForClose();
    expect(mocks.loadRecordBatches).toHaveBeenCalledTimes(1);
    expect(mocks.translateAndUpdateRecords).toHaveBeenCalledTimes(1);
    expect(counts()).toEqual({ translated: '1', failed: undefined });
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

    expect(await screen.findByText('0 of 2 records')).toBeTruthy();
    // The counts of the result wait for the end: the bar shows the progress.
    expect(counts()).toEqual({ translated: undefined, failed: undefined });
    await waitFor(() => {
      expect(events).toEqual(['fetch first', 'translate r1']);
    });
    // The status line says the task; the count under the bar says how far.
    expect(screen.getByText('Translating…')).toBeTruthy();
    // The bar has the name of the status line next to it.
    expect(
      screen.getByRole('progressbar', { name: 'Translating…' }),
    ).toBeTruthy();
    expectCloseBlocked();

    await act(async () => translation.resolve());

    await waitForClose();
    expect(events).toEqual([
      'fetch first',
      'translate r1',
      'fetch second',
      'translate r2',
    ]);
    // Once the run ended, the counts of the result say it.
    expect(screen.queryByText('2 of 2 records')).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Translation finished' }),
    ).toHaveAttribute('aria-valuenow', '100');
    expect(counts()).toEqual({ translated: '2', failed: undefined });
  });

  it('keeps Close disabled until loading and translation finish, even when every record reports completion', async () => {
    const loading = deferred();
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r1')]);
      await loading.promise;
    });

    const { ctx } = renderModal(['r1']);

    await waitFor(() => {
      expect(screen.getByText('1 of 1 record')).toBeTruthy();
    });
    expectCloseBlocked();
    act(() => closeButton().focus());
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'The translation is still running. Wait for it to finish, or cancel it.',
    );
    fireEvent.click(closeButton());
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull();

    await act(async () => loading.resolve());

    await waitForClose();
  });

  describe('the focus when the run ends', () => {
    /** A run whose loading goes on until the test ends it. */
    function renderOpenRun() {
      const loading = deferred();
      mocks.loadRecordBatches.mockImplementation(async function* () {
        yield batch([record('r1')]);
        await loading.promise;
      });
      const view = renderModal(['r1']);
      return { ...view, endRun: () => act(async () => loading.resolve()) };
    }

    // jsdom drops `hasFocus()` with the focused element; a browser keeps
    // it while the focus is in the frame.
    beforeEach(() => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    });

    it('gives a focus on Close back to the enabled Close', async () => {
      const { endRun } = renderOpenRun();
      await screen.findByRole('button', { name: 'Cancel translation' });
      act(() => closeButton().focus());

      await endRun();

      const close = await waitForClose();
      expect(document.activeElement).toBe(close);
    });

    it('moves a focus on Cancel, which goes, to Close', async () => {
      const { endRun } = renderOpenRun();
      const cancel = await screen.findByRole('button', {
        name: 'Cancel translation',
      });
      act(() => cancel.focus());

      await endRun();

      const close = await waitForClose();
      expect(
        screen.queryByRole('button', { name: 'Cancel translation' }),
      ).toBeNull();
      expect(document.activeElement).toBe(close);
    });

    it('leaves the focus where it is when the frame does not have it', async () => {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      const { endRun } = renderOpenRun();
      await screen.findByRole('button', { name: 'Cancel translation' });

      await endRun();

      await waitForClose();
      expect(document.activeElement).toBe(document.body);
    });
  });

  it('closes on Escape once the run ends, and only says why while it runs', async () => {
    const loading = deferred();
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r1')]);
      await loading.promise;
    });
    const { ctx, modalCtx } = renderModal(['r1']);
    await screen.findByRole('button', { name: 'Cancel translation' });
    const pressEscape = () =>
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    // Escape never stops the run: it shows why Close is disabled.
    pressEscape();
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(modalCtx.customToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        message:
          'The translation is still running. Wait for it to finish, or cancel it.',
      }),
    );
    expect(loadingAbortSignal()?.aborted).toBe(false);

    await act(async () => loading.resolve());
    await waitForClose();

    pressEscape();
    expect(ctx.resolve).toHaveBeenCalledTimes(1);
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: true,
        canceled: false,
        summary: expect.objectContaining({ successfulCount: 1 }),
      }),
    );
  });

  it('assigns stable indexes by selected record ID across unordered batches', async () => {
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r2'), record('r1')]);
      yield batch([record('r3')]);
    });
    const { ctx } = renderModal(['r1', 'r2', 'r3']);

    const close = await waitForClose();
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
    expect(counts()).toEqual({ translated: '3', failed: undefined });
  });

  it('finishes with a failed record when a selected record was deleted', async () => {
    mocks.loadRecordBatches.mockImplementation(async function* () {
      yield batch([record('r2')], ['r1']);
    });
    const { ctx } = renderModal();

    const close = await waitForClose();
    expect(screen.getByText('Deleted record')).toBeTruthy();
    expect(
      screen.getByText('Failed. It was deleted, or is no longer available.'),
    ).toBeTruthy();
    expect(counts()).toEqual({ translated: '1', failed: '1' });
    expect(screen.queryByText('2 of 2 records')).toBeNull();
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

    await waitForClose();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Translation stopped',
    );
    // A screen reader hears the progress from a line that changes only with
    // the percentage.
    expect(screen.getByText(/% of the records done$/)).toHaveAttribute(
      'role',
      'status',
    );
    expect(
      screen.getByRole('progressbar', { name: 'Translation stopped' }),
    ).toBeTruthy();
    // The Callout says the error; the counts under it say how far the run
    // got.
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/^DatoCMS error:/)).toBeTruthy();
    expect(alert.textContent).not.toContain('Stopped after');
    expect(alert.textContent).not.toContain('Translation failed:');
    expect(screen.queryByText(/Translation provider error/)).toBeNull();
    // The fatal error is a message of the run, not a row of a record.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    // No failed record: no "Failed 0" row contradicts the stop. The record
    // that the run never reached counts as not translated.
    expect(counts()).toEqual({ translated: '1', failed: undefined });
    expect(rowValue('Not translated')).toBe('1');
    expect(screen.queryByText('1 of 2 records')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 record' }));
    await waitFor(() => {
      expect(ctx.notice).toHaveBeenCalledWith('Published 1 translated record.');
    });
    // Once every record is published, the toast says it: the button goes.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
    });
    fireEvent.click(closeButton());
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

    const cancel = await screen.findByRole('button', {
      name: 'Cancel translation',
    });
    // Before the first records, the spinning status line is the only
    // loading state.
    expect(screen.getByText('Translating…')).toBeTruthy();
    expect(screen.queryByText('Loading the records')).toBeNull();
    fireEvent.click(cancel);

    expect(loadingOptions?.abortSignal?.aborted).toBe(true);
    expect(loadingOptions?.checkCancellation?.()).toBe(true);
    expect(ctx.resolve).not.toHaveBeenCalled();
    const cancelling = screen.getByRole('button', {
      name: 'Cancel translation',
    });
    expect(cancelling).toHaveProperty('disabled', true);
    expect(cancelling).toHaveAttribute('aria-busy', 'true');
    await act(async () => loading.resolve());
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: false,
        canceled: true,
        summary: expect.objectContaining({ processedCount: 0 }),
      }),
    );
    expect(mocks.translateAndUpdateRecords).not.toHaveBeenCalled();
    expect(screen.queryByText(/Translation stopped/)).toBeNull();
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

    fireEvent.click(screen.getByRole('button', { name: 'Cancel translation' }));
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
    expect(screen.getByText('1 of 1 record')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await act(async () => translation.resolve());
    expect(snapshot).toHaveBeenCalledTimes(3);
    expect(closeButton()).not.toHaveAttribute('aria-disabled');
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
    const publish = await screen.findByRole('button', {
      name: 'Publish 2 records',
    });
    act(() => publish.focus());
    fireEvent.click(publish);
    dropFocus();
    await waitFor(() => expect(ctx.alert).toHaveBeenCalledTimes(1));
    // The verb agrees with a count of one.
    expect(ctx.alert).toHaveBeenCalledWith(
      expect.stringContaining(
        'Could not publish all translated records. 1 record was published before the operation stopped.',
      ),
    );
    expect(ctx.notice).not.toHaveBeenCalled();
    // The publishing ended with records left: the button takes the focus
    // back.
    const publishOther = await screen.findByRole('button', {
      name: 'Publish the other 1 record',
    });
    expect(document.activeElement).toBe(publishOther);
    fireEvent.click(publishOther);
    dropFocus();
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith(
        'Published 2 translated records.',
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull(),
    );
    // Every record is published: Close, the next action, takes the focus.
    expect(document.activeElement).toBe(closeButton());
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
      await screen.findByRole('button', { name: 'Publish 2 records' }),
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
      await screen.findByRole('button', { name: 'Publish 2 records' }),
    );

    await waitFor(() => expect(ctx.alert).toHaveBeenCalledTimes(1));

    expect(
      mocks.bulkPublish.mock.calls[0][0].data.relationships.items.data,
    ).toEqual([{ type: 'item', id: 'r1' }]);
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', {
        name: 'Publish the other 1 record',
      }),
    ).toBeTruthy();
  });

  it('shows the latest 100 records, newest first, and counts the warnings', async () => {
    const itemIds = Array.from({ length: 101 }, (_, index) => `r${index + 1}`);
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
        reportCompleted(records, options);
        options.onProgress?.({
          recordIndex: 0,
          recordId: 'r1',
          itemTypeId: 'article',
          recordLabel: 'Article r1',
          status: 'completed',
          statusText: 'Translated',
          warnings: ['Copied linked records in "related".'],
        });
      },
    );
    renderModal(itemIds);

    await waitForClose();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(100);
    expect(within(rows[0]).getByText('Article r1')).toBeTruthy();
    expect(within(rows[99]).getByText('Article r3')).toBeTruthy();
    // The record with warnings comes first, then the latest translated ones.
    expect(screen.getByText('Showing 100 of 101 records')).toBeTruthy();
    expect(rowValue('Translated')).toBe('1011 with warnings');
    expect(screen.getByText('1 with warnings')).toBeTruthy();
    // A link to a page of the CMS (`to`): the Canvas gives it the absolute
    // URL on the internal domain, and it opens in a new tab.
    const link = within(rows[0]).getByRole('link', { name: 'Open the record' });
    expect(link).toHaveAttribute(
      'href',
      'https://example/editor/item_types/article/items/r1/edit',
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('lists the records with problems first once the run ended, also one out of the latest 100', async () => {
    const itemIds = Array.from({ length: 150 }, (_, index) => `r${index + 1}`);
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
        options.onProgress?.({
          recordIndex: 0,
          recordId: 'r1',
          itemTypeId: 'article',
          recordLabel: 'Article r1',
          status: 'error',
          statusText: 'Failed',
        });
        reportCompleted(
          records.filter((item) => item.id !== 'r1'),
          options,
        );
      },
    );
    renderModal(itemIds);

    await waitForClose();
    // The list keeps its 100 rows: the failed record, then the latest 99
    // translated ones.
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(100);
    expect(within(rows[0]).getByText('Article r1')).toBeTruthy();
    expect(within(rows[1]).getByText('Article r150')).toBeTruthy();
    expect(within(rows[99]).getByText('Article r52')).toBeTruthy();
    expect(screen.getByText('Showing 100 of 150 records')).toBeTruthy();
    expect(counts()).toEqual({ translated: '149', failed: '1' });
  });

  it('publishes in the job environment even if the host replaces context and parameters', async () => {
    const { ctx, modalCtx, parameters, rerender } = renderModal(['r1']);
    await screen.findByRole('button', { name: 'Publish 1 record' });
    const nextCtx = makeCtx<RenderModalCtx>({
      ...modalCtx,
      environment: 'other',
    });
    rerender(
      <TranslationProgressModal
        ctx={nextCtx}
        parameters={{ ...parameters, accessToken: 'other-token' }}
      />,
      nextCtx,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 record' }));

    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('Published 1 translated record.'),
    );
    expect(mocks.buildDatoCMSClient).toHaveBeenLastCalledWith(
      'cma-token',
      'main',
      'https://cma.example.test',
    );
  });

  it('offers no cancel for a small publishing, which is a single request, and closes once it ends', async () => {
    const pending = deferred();
    mocks.bulkPublish.mockImplementation(async ({ data }) => {
      await pending.promise;
      return {
        data: [],
        meta: { successful: data.relationships.items.data.length, failed: 0 },
      };
    });
    const { ctx } = renderModal(['r1']);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Publish 1 record' }),
    );

    await screen.findByRole('button', { name: 'Publishing 0 of 1…' });
    expectCloseBlocked();
    expect(
      screen.queryByRole('button', { name: 'Cancel publishing' }),
    ).toBeNull();
    pending.resolve();

    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('Published 1 translated record.'),
    );
    fireEvent.click(await waitForClose());
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ canceled: false }),
    );
  });
});
