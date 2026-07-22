import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import type { ProgressUpdate } from '../utils/translation/ItemsDropdownUtils';
import TranslationProgressModal from './TranslationProgressModal';

// The run itself is exercised by ItemsDropdownUtils' own tests; here we mock the
// heavy mount deps so the modal's UI wiring (cancel/close/unload) is what's under
// test. translateAndUpdateRecords captures its options and never resolves, holding
// the run "in flight" so we can drive per-record progress and the terminal actions.
const { translateMock } = vi.hoisted(() => ({ translateMock: vi.fn() }));

vi.mock('../utils/clients', () => ({ buildDatoCMSClient: () => ({}) }));
vi.mock('../utils/csvExport', () => ({
  buildTranslationReportRows: () => ({ headers: [], rows: [] }),
  toCsv: () => '',
  downloadCsv: vi.fn(),
}));
vi.mock('../utils/schemaRepository', () => ({
  createSchemaRepository: () => ({ getItemTypeById: vi.fn() }),
}));
vi.mock('../utils/translation/ProviderFactory', () => ({
  getProvider: () => ({ vendor: 'openai' }),
}));
vi.mock('../utils/translation/BulkPublishUtils', () => ({
  getDraftModeItemTypeIds: vi.fn(async () => []),
  getPublishableTranslatedRecordIds: vi.fn(() => []),
  bulkPublishTranslatedRecords: vi.fn(),
}));
vi.mock('../engine/report', () => ({
  createIndexedDBRunStore: () => ({
    load: vi.fn(async () => null),
    save: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  }),
  unitsToResume: vi.fn(() => []),
}));
vi.mock('../utils/translation/ItemsDropdownUtils', () => ({
  translateAndUpdateRecords: translateMock,
  fetchRecordsWithPagination: vi.fn(async () => [
    { id: 'a', item_type: { id: 'm1' } },
    { id: 'b', item_type: { id: 'm1' } },
  ]),
  buildFieldTypeDictionaryWithRepo: vi.fn(async () => ({})),
}));

const ctx = {
  resolve: vi.fn(),
  environment: 'main',
  cmaBaseUrl: undefined,
  isEnvironmentPrimary: true,
  site: { attributes: { internal_domain: 'admin.datocms.com' } },
  alert: vi.fn(),
  notice: vi.fn(),
} as unknown as RenderModalCtx;

const parameters = {
  totalRecords: 2,
  fromLocale: 'en',
  toLocales: ['it'],
  accessToken: 'tok',
  pluginParams: { vendor: 'openai' } as ctxParamsType,
  itemIds: ['a', 'b'],
};

/** Resolve the options bag translateAndUpdateRecords was called with. */
const runOptions = () =>
  translateMock.mock.calls[0]?.[9] as {
    onProgress: (u: ProgressUpdate) => void;
  };

beforeEach(() => {
  vi.clearAllMocks();
  translateMock.mockImplementation(() => new Promise(() => {}));
});

describe('TranslationProgressModal', () => {
  it('keeps the modal open with partial results on Cancel, then resolves on Close', async () => {
    render(<TranslationProgressModal ctx={ctx} parameters={parameters} />);
    await waitFor(() => expect(runOptions()).toBeTruthy());

    // One record finishes (1 of 2) — run stays in progress.
    act(() =>
      runOptions().onProgress({
        recordIndex: 0,
        recordId: 'a',
        status: 'completed',
        recordLabel: 'Alpha',
        statusText: 'Translated',
        itemTypeId: 'm1',
      }),
    );
    expect(screen.getByText('Alpha')).toBeTruthy();

    // Cancel must NOT close the modal — the partial results stay on screen.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(screen.getByText('Alpha')).toBeTruthy();

    // Close is a deliberate second action; it resolves with canceled:true.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(ctx.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ canceled: true, completed: false }),
    );
  });

  it('hides Export CSV and the Close button while the run is in progress', async () => {
    render(<TranslationProgressModal ctx={ctx} parameters={parameters} />);
    await waitFor(() => expect(runOptions()).toBeTruthy());

    expect(screen.queryByRole('button', { name: /export csv/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByText(/please wait/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('lets the user manually pause the run, showing the pause panel', async () => {
    render(<TranslationProgressModal ctx={ctx} parameters={parameters} />);
    await waitFor(() => expect(runOptions()).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    // The pause panel takes over with Resume; the footer Pause/Cancel hide.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('guards against navigating away while a run is in progress', async () => {
    render(<TranslationProgressModal ctx={ctx} parameters={parameters} />);
    await waitFor(() => expect(runOptions()).toBeTruthy());

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
