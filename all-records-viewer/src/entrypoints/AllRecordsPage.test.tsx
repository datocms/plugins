import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkJobResult } from '../operations/types';
import type { RawField } from '../presentation/fields';
import type { RawUpload } from '../presentation/previews';
import type { RawItem, RawItemType } from '../types';
import AllRecordsPage from './AllRecordsPage';

const cmaMocks = vi.hoisted(() => ({
  rawList: vi.fn(),
  uploadRawList: vi.fn(),
  workflowFind: vi.fn(),
  rawBulkPublish: vi.fn(),
  rawBulkUnpublish: vi.fn(),
  rawBulkDestroy: vi.fn(),
  rawBulkMoveToStage: vi.fn(),
}));

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: () => ({
    items: {
      rawList: cmaMocks.rawList,
      rawBulkPublish: cmaMocks.rawBulkPublish,
      rawBulkUnpublish: cmaMocks.rawBulkUnpublish,
      rawBulkDestroy: cmaMocks.rawBulkDestroy,
      rawBulkMoveToStage: cmaMocks.rawBulkMoveToStage,
    },
    uploads: { rawList: cmaMocks.uploadRawList },
    workflows: { find: cmaMocks.workflowFind },
  }),
}));

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => children,
  CaretDownIcon: () => null,
  CaretUpIcon: () => null,
  Dropdown: ({
    children,
    renderTrigger,
  }: {
    children: ReactNode;
    renderTrigger: (args: { open: boolean; onClick: () => void }) => ReactNode;
  }) => (
    <>
      {renderTrigger({ open: false, onClick: () => undefined })}
      {children}
    </>
  ),
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  DropdownOption: ({
    active,
    children,
    onClick,
  }: {
    active?: boolean;
    children: ReactNode;
    onClick: () => void;
  }) => (
    <button type="button" aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  ),
}));

function buildCtx(overrides: Record<string, unknown> = {}): RenderPageCtx {
  return {
    location: { pathname: '', search: '', hash: '' },
    environment: 'main',
    isEnvironmentPrimary: true,
    currentUserAccessToken: undefined,
    cmaBaseUrl: 'https://site-api.datocms.com',
    itemTypes: {},
    site: {
      id: 'site-1',
      type: 'site',
      attributes: {
        locales: ['en'],
        timezone: 'UTC',
        imgix_host: null,
        google_maps_api_token: null,
      },
    },
    ui: { locale: 'en' },
    currentUser: { id: 'user-1', type: 'user' },
    currentRole: {
      id: 'role-1',
      meta: {
        final_permissions: {
          positive_item_type_permissions: [],
          negative_item_type_permissions: [],
        },
      },
    },
    plugin: { id: 'plugin-1' },
    navigateTo: vi.fn(),
    loadItemTypeFields: vi.fn().mockResolvedValue([]),
    alert: vi.fn(),
    notice: vi.fn(),
    openConfirm: vi.fn(),
    openModal: vi.fn(),
    ...overrides,
  } as unknown as RenderPageCtx;
}

function model(): RawItemType {
  return {
    id: 'model-1',
    type: 'item_type',
    attributes: {
      name: 'Article',
      api_key: 'article',
      modular_block: false,
      draft_mode_active: true,
    },
    relationships: {
      fields: { data: [] },
      presentation_title_field: { data: null },
      presentation_image_field: { data: null },
      workflow: { data: null },
    },
  } as unknown as RawItemType;
}

function item(id: string): RawItem {
  return {
    id,
    type: 'item',
    attributes: {},
    relationships: {
      item_type: { data: { id: 'model-1', type: 'item_type' } },
    },
    meta: {
      status: 'published',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      is_current_version_valid: true,
      is_published_version_valid: true,
    },
  } as unknown as RawItem;
}

function titleField(): RawField {
  return {
    id: 'title-field',
    type: 'field',
    attributes: {
      api_key: 'title',
      field_type: 'string',
      localized: false,
      position: 0,
      appearance: { editor: 'single_line', parameters: {} },
    },
    relationships: {
      item_type: { data: { id: 'model-1', type: 'item_type' } },
    },
  } as unknown as RawField;
}

type MockListQuery = {
  page: { offset: number; limit: number };
  filter?: { ids?: string; query?: string };
};

type MockBulkPayload = {
  data: { relationships: { items: { data: { id: string }[] } } };
};

function mockRecords(records: readonly RawItem[]): void {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  cmaMocks.rawList.mockImplementation((query: MockListQuery) => {
    const matching = query.filter?.ids
      ? query.filter.ids.split(',').flatMap((id) => {
          const record = recordsById.get(id);
          return record ? [record] : [];
        })
      : records;
    return Promise.resolve({
      data: matching.slice(
        query.page.offset,
        query.page.offset + query.page.limit,
      ),
      meta: { total_count: matching.length },
    });
  });
}

function buildOperationCtx(
  overrides: Record<string, unknown> = {},
): RenderPageCtx {
  return buildCtx({
    currentUserAccessToken: 'user-token',
    itemTypes: { 'model-1': model() },
    currentRole: {
      id: 'role-1',
      meta: {
        final_permissions: {
          positive_item_type_permissions: [
            { action: 'all', environment: 'main' },
          ],
          negative_item_type_permissions: [],
        },
      },
    },
    openConfirm: vi.fn().mockResolvedValue(true),
    ...overrides,
  });
}

function deferred<T>() {
  let complete: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (value: T) => complete(value) };
}

const UI_WAIT_OPTIONS = { timeout: 10_000 };

function requireReadyRecordCheckbox(id: string): HTMLElement {
  const checkbox = screen.getByRole('checkbox', {
    name: `Select record ${id}`,
  });
  expect(checkbox).toBeEnabled();
  expect(screen.getByRole('table', { name: 'All records' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  return checkbox;
}

async function readyRecordCheckbox(id: string): Promise<HTMLElement> {
  return waitFor(() => requireReadyRecordCheckbox(id), UI_WAIT_OPTIONS);
}

async function readyButton(name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const button = screen.getByRole('button', { name });
    expect(button).toBeEnabled();
    return button;
  }, UI_WAIT_OPTIONS);
}

// The async wait wrapper yields before returning. Presentation effects can
// disable a previously ready element during that yield, so assert and click
// together, with no post-click assertion that could retry a selection toggle.
async function clickReadyRecordCheckbox(id: string): Promise<void> {
  await waitFor(() => {
    fireEvent.click(requireReadyRecordCheckbox(id));
  }, UI_WAIT_OPTIONS);
}

async function clickReadyButton(name: string | RegExp): Promise<void> {
  await waitFor(() => {
    const button = screen.getByRole('button', { name });
    expect(button).toBeEnabled();
    fireEvent.click(button);
  }, UI_WAIT_OPTIONS);
}

async function selectAllMatching(count: number): Promise<void> {
  await clickReadyRecordCheckbox('record-1');
  await screen.findByText('1 record selected', undefined, UI_WAIT_OPTIONS);
  await clickReadyButton('Select all matching records');
  await screen.findByText(
    `${count} records selected`,
    undefined,
    UI_WAIT_OPTIONS,
  );
}

beforeEach(() => {
  cmaMocks.rawList.mockResolvedValue({ data: [], meta: { total_count: 0 } });
  cmaMocks.uploadRawList.mockResolvedValue({
    data: [],
    meta: { total_count: 0 },
  });
  for (const bulkMethod of [
    cmaMocks.rawBulkPublish,
    cmaMocks.rawBulkUnpublish,
    cmaMocks.rawBulkDestroy,
    cmaMocks.rawBulkMoveToStage,
  ]) {
    bulkMethod.mockReset().mockImplementation((payload: MockBulkPayload) =>
      Promise.resolve({
        data: [],
        meta: {
          successful: payload.data.relationships.items.data.length,
          failed: 0,
        },
      }),
    );
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('AllRecordsPage states', () => {
  it('explains the required CMA permission', () => {
    render(<AllRecordsPage ctx={buildCtx()} />);

    expect(
      screen.getByRole('heading', { name: 'API access required' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Current user access token/)).toBeInTheDocument();
  });

  it('shows a dedicated state when the environment has no record models', () => {
    render(
      <AllRecordsPage
        ctx={buildCtx({ currentUserAccessToken: 'user-token' })}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'No record models' }),
    ).toBeInTheDocument();
  });

  it('does not let a stale debounced value overwrite URL-driven search', async () => {
    vi.useFakeTimers();
    const navigateTo = vi.fn();
    const itemTypes = { 'model-1': model() };
    const initialCtx = buildCtx({
      currentUserAccessToken: 'user-token',
      itemTypes,
      navigateTo,
      location: { pathname: '', search: '?query=old', hash: '' },
    });
    const { rerender } = render(<AllRecordsPage ctx={initialCtx} />);

    navigateTo.mockClear();
    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes,
          navigateTo,
          location: { pathname: '', search: '?query=new', hash: '' },
        })}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });

    expect(screen.getByRole('textbox', { name: 'Search records' })).toHaveValue(
      'new',
    );
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('retains off-page records when selecting the current page', async () => {
    mockRecords(
      Array.from({ length: 100 }, (_, index) => item(`record-${index + 1}`)),
    );
    const navigateTo = vi.fn();
    const itemTypes = { 'model-1': model() };
    const firstCtx = buildCtx({
      currentUserAccessToken: 'user-token',
      itemTypes,
      navigateTo,
    });
    const { rerender } = render(<AllRecordsPage ctx={firstCtx} />);

    await clickReadyRecordCheckbox('record-1');
    expect(screen.getByText('1 record selected')).toBeInTheDocument();

    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes,
          navigateTo,
          location: { pathname: '', search: '?page=1', hash: '' },
        })}
      />,
    );

    await readyRecordCheckbox('record-51');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select all records on this page',
      }),
    );
    expect(screen.getByText('51 records selected')).toBeInTheDocument();
  });

  it('clears selection when the environment changes', async () => {
    cmaMocks.rawList.mockResolvedValue({
      data: [item('record-1')],
      meta: { total_count: 1 },
    });
    const itemTypes = { 'model-1': model() };
    const { rerender } = render(
      <AllRecordsPage
        ctx={buildCtx({ currentUserAccessToken: 'user-token', itemTypes })}
      />,
    );

    await clickReadyRecordCheckbox('record-1');
    expect(screen.getByText('1 record selected')).toBeInTheDocument();

    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes,
          environment: 'sandbox',
          isEnvironmentPrimary: false,
        })}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByText('1 record selected')).not.toBeInTheDocument(),
    );
  });

  it('disables metadata sorting while relevance search is active', async () => {
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
          location: { pathname: '', search: '?query=term', hash: '' },
        })}
      />,
    );

    expect(
      await screen.findByRole('button', { name: 'Last update' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last update' })).toHaveAttribute(
      'title',
      'Sorting is unavailable while searching',
    );
  });

  it('navigates from default Last update DESC to ASC and continues toggling', async () => {
    const ctx = buildOperationCtx({
      location: { pathname: '', search: '?model=model-1', hash: '' },
    });
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);
    await clickReadyButton(/^Last update\s*▼$/);
    expect(ctx.navigateTo).toHaveBeenLastCalledWith(
      '/editor/p/plugin-1/pages/all-records?model=model-1&orderBy=_updated_at_ASC',
    );

    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          ...ctx,
          location: {
            pathname: '',
            search: '?model=model-1&orderBy=_updated_at_ASC',
            hash: '',
          },
        })}
      />,
    );
    await clickReadyButton(/^Last update\s*▲$/);
    expect(ctx.navigateTo).toHaveBeenLastCalledWith(
      '/editor/p/plugin-1/pages/all-records?model=model-1&orderBy=_updated_at_DESC',
    );

    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          ...ctx,
          location: {
            pathname: '',
            search: '?model=model-1&orderBy=_updated_at_DESC',
            hash: '',
          },
        })}
      />,
    );
    await clickReadyButton(/^Last update\s*▼$/);
    expect(ctx.navigateTo).toHaveBeenLastCalledWith(
      '/editor/p/plugin-1/pages/all-records?model=model-1&orderBy=_updated_at_ASC',
    );
  });

  it('resolves Preview ordering to a model field before fetching the page', async () => {
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
          location: {
            pathname: '',
            search: '?model=model-1&orderBy=_preview_ASC',
            hash: '',
          },
          loadItemTypeFields: vi.fn().mockResolvedValue([titleField()]),
        })}
      />,
    );

    await waitFor(() =>
      expect(cmaMocks.rawList).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ type: 'model-1' }),
          order_by: 'title_ASC,id_ASC',
          page: { limit: 50, offset: 0 },
        }),
      ),
    );
  });

  it('sends Status ordering to the API for one selected model', async () => {
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
          location: {
            pathname: '',
            search: '?model=model-1&orderBy=_status_DESC',
            hash: '',
          },
        })}
      />,
    );

    await waitFor(() =>
      expect(cmaMocks.rawList).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ type: 'model-1' }),
          order_by: '_status_DESC,id_ASC',
          page: { limit: 50, offset: 0 },
        }),
      ),
    );
  });

  it('stores global Model and Status header sorting in the page URL', async () => {
    const navigateTo = vi.fn();
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
          navigateTo,
        })}
      />,
    );

    const modelHeader = await screen.findByRole('button', { name: 'Model' });
    await waitFor(() => expect(modelHeader).toBeEnabled());
    fireEvent.click(modelHeader);
    expect(navigateTo).toHaveBeenLastCalledWith(
      '/editor/p/plugin-1/pages/all-records?orderBy=_model_ASC',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(navigateTo).toHaveBeenLastCalledWith(
      '/editor/p/plugin-1/pages/all-records?orderBy=_status_ASC',
    );
  });

  it('does not offer a constant Status sort while status-filtered', async () => {
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
          location: {
            pathname: '',
            search: '?status=published',
            hash: '',
          },
        })}
      />,
    );

    await screen.findByRole('table', { name: 'All records' });
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
  });

  it('shows a load failure and retries without reloading the plugin', async () => {
    cmaMocks.rawList
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ data: [], meta: { total_count: 0 } });
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Could not load records' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(cmaMocks.rawList).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Could not load records' }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe('AllRecordsPage large selections', () => {
  it('offers all matches after filtering 1200 Products down to 694 with unselected records', async () => {
    const products = Array.from({ length: 1200 }, (_, index) =>
      item(`record-${index + 1}`),
    );
    const matches = [
      ...products.slice(0, 20),
      ...Array.from({ length: 674 }, (_, index) => item(`novara-${index + 1}`)),
    ];
    const byId = new Map(
      [...products, ...matches].map((record) => [record.id, record]),
    );
    cmaMocks.rawList.mockImplementation((query: MockListQuery) => {
      const filtered = Boolean(query.filter?.query);
      const matching = query.filter?.ids
        ? query.filter.ids.split(',').flatMap((id) => {
            const record = byId.get(id);
            return record ? [record] : [];
          })
        : filtered
          ? matches
          : products;
      return Promise.resolve({
        data: matching.slice(
          query.page.offset,
          query.page.offset + query.page.limit,
        ),
        meta: {
          total_count: query.filter?.ids || filtered ? matching.length : 100002,
        },
      });
    });
    const ctx = buildOperationCtx({
      location: {
        pathname: '',
        search: '?model=model-1&perPage=200',
        hash: '',
      },
    });
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);
    for (let page = 0; page < 6; page += 1) {
      if (page > 0) {
        rerender(
          <AllRecordsPage
            ctx={buildCtx({
              ...ctx,
              location: {
                pathname: '',
                search: `?model=model-1&perPage=200&page=${page}`,
                hash: '',
              },
            })}
          />,
        );
      }
      // biome-ignore lint/performance/noAwaitInLoops: Select each real-pattern page after its presentation finishes.
      await waitFor(() => {
        requireReadyRecordCheckbox(`record-${page * 200 + 1}`);
        fireEvent.click(
          screen.getByRole('checkbox', {
            name: 'Select all records on this page',
          }),
        );
      }, UI_WAIT_OPTIONS);
      await screen.findByText(
        `${(page + 1) * 200} records selected`,
        undefined,
        UI_WAIT_OPTIONS,
      );
    }
    const filter = '?model=model-1&query=Product%3A+Novara+Basis';
    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          ...ctx,
          location: { pathname: '', search: `${filter}&perPage=200`, hash: '' },
        })}
      />,
    );
    await readyRecordCheckbox('novara-1');
    expect(screen.getByText('1200 records selected')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select all records on this page' }),
    ).toBePartiallyChecked();
    expect(await readyButton('Select all matching records')).toBeEnabled();

    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          ...ctx,
          location: { pathname: '', search: `${filter}&perPage=50`, hash: '' },
        })}
      />,
    );
    await readyRecordCheckbox('novara-1');
    await clickReadyButton('Select all matching records');

    await screen.findByText('694 records selected', undefined, UI_WAIT_OPTIONS);
    expect(
      screen.queryByRole('button', { name: 'Select all matching records' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('checkbox', { name: /^Select record / }),
    ).toHaveLength(50);
    expect(ctx.openConfirm).not.toHaveBeenCalled();
    expect(cmaMocks.rawBulkPublish).not.toHaveBeenCalled();
  });

  it('keeps all matches hidden after reducing page size for a complete same-filter selection', async () => {
    mockRecords(
      Array.from({ length: 200 }, (_, index) => item(`record-${index + 1}`)),
    );
    const ctx = buildOperationCtx({
      location: {
        pathname: '',
        search: '?model=model-1&perPage=200',
        hash: '',
      },
    });
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);
    await waitFor(() => {
      requireReadyRecordCheckbox('record-1');
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: 'Select all records on this page',
        }),
      );
    }, UI_WAIT_OPTIONS);
    await screen.findByText('200 records selected');

    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          ...ctx,
          location: {
            pathname: '',
            search: '?model=model-1&perPage=50',
            hash: '',
          },
        })}
      />,
    );
    await readyRecordCheckbox('record-1');

    expect(screen.getByText('200 records selected')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Select all matching records' }),
    ).not.toBeInTheDocument();
    expect(
      cmaMocks.rawList.mock.calls.filter(([query]) => query.filter?.ids),
    ).toHaveLength(0);
  });

  it('stops a 1000-record preflight after the two active batches when the environment changes', async () => {
    const records = Array.from({ length: 1000 }, (_, index) =>
      item(`record-${index + 1}`),
    );
    const byId = new Map(records.map((record) => [record.id, record]));
    const pending: {
      ids: string[];
      result: ReturnType<
        typeof deferred<{ data: RawItem[]; meta: { total_count: number } }>
      >;
    }[] = [];
    cmaMocks.rawList.mockImplementation((query: MockListQuery) => {
      if (query.filter?.ids) {
        const result = deferred<{
          data: RawItem[];
          meta: { total_count: number };
        }>();
        pending.push({ ids: query.filter.ids.split(','), result });
        return result.promise;
      }
      return Promise.resolve({
        data: records.slice(
          query.page.offset,
          query.page.offset + query.page.limit,
        ),
        meta: { total_count: records.length },
      });
    });
    const ctx = buildOperationCtx();
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(1000);
    await clickReadyButton('Publish');
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending.map((batch) => batch.ids.length)).toEqual([100, 100]);

    const nextCtx = buildOperationCtx({
      environment: 'sandbox',
      isEnvironmentPrimary: false,
    });
    rerender(<AllRecordsPage ctx={nextCtx} />);
    await act(async () => {
      for (const batch of pending) {
        batch.result.resolve({
          data: batch.ids.flatMap((id) => {
            const record = byId.get(id);
            return record ? [record] : [];
          }),
          meta: { total_count: batch.ids.length },
        });
      }
    });
    await readyRecordCheckbox('record-1');

    expect(pending).toHaveLength(2);
    expect(ctx.openConfirm).not.toHaveBeenCalled();
    expect(nextCtx.openConfirm).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(nextCtx.alert).not.toHaveBeenCalled();
    expect(cmaMocks.rawBulkPublish).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Selection actions' }),
    ).not.toBeInTheDocument();
  });

  it('removes missing IDs after a partial delete while retaining current survivors', async () => {
    const records = new Map([
      ['record-1', item('record-1')],
      ['record-2', item('record-2')],
    ]);
    cmaMocks.rawList.mockImplementation((query: MockListQuery) => {
      const matching = query.filter?.ids
        ? query.filter.ids.split(',').flatMap((id) => {
            const record = records.get(id);
            return record ? [record] : [];
          })
        : [...records.values()];
      return Promise.resolve({
        data: matching.slice(
          query.page.offset,
          query.page.offset + query.page.limit,
        ),
        meta: { total_count: matching.length },
      });
    });
    cmaMocks.rawBulkDestroy.mockImplementationOnce(() => {
      records.delete('record-1');
      return Promise.resolve({ data: [], meta: { successful: 1, failed: 1 } });
    });
    const ctx = buildOperationCtx();
    render(<AllRecordsPage ctx={ctx} />);
    await clickReadyRecordCheckbox('record-1');
    await clickReadyRecordCheckbox('record-2');

    await clickReadyButton('Delete');

    await screen.findByText('1 record selected', undefined, UI_WAIT_OPTIONS);
    await clickReadyButton('Show selection');
    expect(await readyRecordCheckbox('record-2')).toBeChecked();
    expect(
      screen.queryByRole('checkbox', { name: 'Select record record-1' }),
    ).not.toBeInTheDocument();
    expect(ctx.alert).toHaveBeenCalledTimes(1);
    expect(ctx.alert).toHaveBeenCalledWith(
      '1 record deleted; 1 record failed.',
    );
    expect(cmaMocks.rawBulkDestroy).toHaveBeenCalledTimes(1);
    expect(await readyButton('Publish')).toBeEnabled();
  });

  it('uses current stages for retained off-page records after a partial move', async () => {
    const workflowModel = model();
    workflowModel.relationships.workflow.data = {
      id: 'workflow-1',
      type: 'workflow',
    };
    const records = Array.from({ length: 201 }, (_, index) => {
      const record = item(`record-${index + 1}`);
      record.meta.stage = 'draft';
      return record;
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    mockRecords(records);
    cmaMocks.workflowFind.mockResolvedValue({
      stages: [
        { id: 'draft', name: 'Draft' },
        { id: 'review', name: 'Review' },
      ],
    });
    let submittedJobs = 0;
    cmaMocks.rawBulkMoveToStage.mockImplementation(
      (
        payload: MockBulkPayload & {
          data: { attributes: { stage: string } };
        },
      ) => {
        const ids = payload.data.relationships.items.data.map(
          (record) => record.id,
        );
        const failed = submittedJobs++ === 0 ? 1 : 0;
        for (const id of ids.slice(0, ids.length - failed)) {
          const record = byId.get(id);
          if (record) {
            record.meta = {
              ...record.meta,
              stage: payload.data.attributes.stage,
            };
          }
        }
        return Promise.resolve({
          data: [],
          meta: { successful: ids.length - failed, failed },
        });
      },
    );
    const ctx = buildOperationCtx({
      itemTypes: { 'model-1': workflowModel },
      openModal: vi
        .fn()
        .mockResolvedValueOnce('review')
        .mockResolvedValueOnce('draft'),
    });
    render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(201);

    await clickReadyButton('Move to stage');
    await screen.findByText('200 records selected', undefined, UI_WAIT_OPTIONS);
    await clickReadyButton('Move to stage');

    await screen.findByText('1 record selected', undefined, UI_WAIT_OPTIONS);
    expect(ctx.openModal).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parameters: {
          count: 200,
          stages: [
            { id: 'draft', name: 'Draft' },
            { id: 'review', name: 'Review' },
          ],
        },
      }),
    );
    expect(ctx.openConfirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content:
          '199 records of 200 selected records are eligible. Destination: Draft.',
      }),
    );
    expect(
      cmaMocks.rawBulkMoveToStage.mock.calls.map(
        ([payload]) => payload.data.relationships.items.data.length,
      ),
    ).toEqual([200, 1, 199]);
    expect(
      cmaMocks.rawBulkMoveToStage.mock.calls[2][0].data.relationships.items
        .data,
    ).toEqual(
      Array.from({ length: 199 }, (_, index) => ({
        id: `record-${index + 1}`,
        type: 'item',
      })),
    );
    for (const [query] of cmaMocks.rawList.mock.calls) {
      if (query.filter?.ids) {
        expect(query.filter.ids.split(',').length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('checks current creator permissions before confirming a selected action', async () => {
    const record = item('record-1');
    record.relationships.creator = {
      data: { id: 'user-1', type: 'user' },
    };
    mockRecords([record]);
    const ctx = buildOperationCtx({
      currentRole: {
        id: 'role-1',
        meta: {
          final_permissions: {
            positive_item_type_permissions: [
              { action: 'all', environment: 'main', on_creator: 'self' },
            ],
            negative_item_type_permissions: [],
          },
        },
      },
    });
    render(<AllRecordsPage ctx={ctx} />);
    await clickReadyRecordCheckbox('record-1');
    await readyButton('Publish');
    record.relationships.creator = {
      data: { id: 'other-user', type: 'user' },
    };

    await clickReadyButton('Publish');

    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith(
        'None of the selected records can be published.',
      ),
    );
    expect(ctx.openConfirm).not.toHaveBeenCalled();
    expect(cmaMocks.rawBulkPublish).not.toHaveBeenCalled();
    expect(screen.getByText('1 record selected')).toBeInTheDocument();
  });

  it('reports an incomplete preflight without submitting or dropping the selection', async () => {
    mockRecords([item('record-1')]);
    const ctx = buildOperationCtx();
    render(<AllRecordsPage ctx={ctx} />);
    await clickReadyRecordCheckbox('record-1');
    await readyButton('Publish');
    cmaMocks.rawList.mockResolvedValueOnce({
      data: [],
      meta: { total_count: 0 },
    });

    await clickReadyButton('Publish');

    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith(
        'Could not publish the selected records: Some selected records no longer exist or cannot be read. Refresh the view and select the records again.',
      ),
    );
    expect(ctx.openConfirm).not.toHaveBeenCalled();
    expect(cmaMocks.rawBulkPublish).not.toHaveBeenCalled();
    expect(screen.getByText('1 record selected')).toBeInTheDocument();
  });

  it('reloads linked titles and uploads when a completed action refreshes records', async () => {
    const rootModel = model();
    rootModel.relationships.presentation_title_field.data = {
      id: 'title-field',
      type: 'field',
    };
    const linkedModel = model();
    linkedModel.id = 'linked-model';
    const referenceField = titleField();
    referenceField.attributes.field_type = 'link';
    const linkedTitleField = titleField();
    linkedTitleField.id = 'linked-title-field';
    linkedTitleField.relationships.item_type.data.id = linkedModel.id;
    const imageField = titleField();
    imageField.id = 'image-field';
    imageField.attributes.api_key = 'image';
    imageField.attributes.field_type = 'file';
    imageField.attributes.position = 1;
    const root = item('record-1');
    root.attributes = {
      title: 'linked-record',
      image: { upload_id: 'upload-1' },
    };
    let linked = item('linked-record');
    linked.relationships.item_type.data.id = linkedModel.id;
    linked.attributes = { title: 'Original linked title' };
    let currentUpload = {
      id: 'upload-1',
      type: 'upload',
      attributes: {
        url: 'https://example.com/original.jpg',
        path: 'original.jpg',
        md5: 'original-hash',
        mux_playback_id: null,
        default_field_metadata: { focal_point: null, poster_time: null },
      },
    } as unknown as RawUpload;
    cmaMocks.rawList.mockImplementation((query: MockListQuery) =>
      Promise.resolve({
        data: query.filter?.ids === linked.id ? [linked] : [root],
        meta: { total_count: 1 },
      }),
    );
    cmaMocks.uploadRawList.mockImplementation(() =>
      Promise.resolve({ data: [currentUpload], meta: { total_count: 1 } }),
    );
    cmaMocks.rawBulkPublish.mockImplementationOnce(() => {
      linked = { ...linked, attributes: { title: 'Updated linked title' } };
      currentUpload = {
        ...currentUpload,
        attributes: {
          ...currentUpload.attributes,
          url: 'https://example.com/updated.jpg',
          md5: 'updated-hash',
        },
      };
      return Promise.resolve({ data: [], meta: { successful: 1, failed: 0 } });
    });
    const ctx = buildOperationCtx({
      location: { pathname: '', search: '?model=model-1', hash: '' },
      itemTypes: { 'model-1': rootModel, 'linked-model': linkedModel },
      loadItemTypeFields: vi.fn(async (modelId: string) =>
        modelId === linkedModel.id
          ? [linkedTitleField]
          : [referenceField, imageField],
      ),
    });
    render(<AllRecordsPage ctx={ctx} />);
    await screen.findByText('Original linked title');
    expect(screen.getByRole('table').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/original.jpg'),
    );

    await clickReadyRecordCheckbox('record-1');
    await clickReadyButton('Publish');

    await screen.findByText('Updated linked title');
    expect(screen.getByRole('table').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/updated.jpg'),
    );
    expect(cmaMocks.uploadRawList).toHaveBeenCalledTimes(2);
    expect(
      cmaMocks.rawList.mock.calls.filter(
        ([query]) => query.filter?.ids === linked.id,
      ),
    ).toHaveLength(2);
  });

  it('waits for deferred presentations before selecting a 200-record page', async () => {
    mockRecords(
      Array.from({ length: 401 }, (_, index) => item(`record-${index + 1}`)),
    );
    const fields = deferred<RawField[]>();
    const ctx = buildOperationCtx({
      location: { pathname: '', search: '?perPage=200', hash: '' },
      loadItemTypeFields: vi.fn().mockImplementation(() => fields.promise),
    });
    render(<AllRecordsPage ctx={ctx} />);
    await waitFor(() => {
      expect(ctx.loadItemTypeFields).toHaveBeenCalled();
      expect(
        screen.getByRole('checkbox', { name: 'Select record record-1' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('table', { name: 'All records' }),
      ).toHaveAttribute('aria-busy', 'true');
    }, UI_WAIT_OPTIONS);

    const selection = selectAllMatching(401);
    expect(
      screen.queryByRole('region', { name: 'Selection actions' }),
    ).not.toBeInTheDocument();
    expect(
      cmaMocks.rawList.mock.calls.some(
        ([query]) => query.order_by === 'id_ASC',
      ),
    ).toBe(false);

    await act(async () => fields.resolve([]));
    await selection;

    expect(screen.getByText('401 records selected')).toBeInTheDocument();
    expect(
      cmaMocks.rawList.mock.calls
        .map(([query]) => query)
        .filter((query) => query.order_by === 'id_ASC')
        .map((query) => query.page.offset),
    ).toEqual([0, 200, 400]);
  });

  it('does not offer selecting all matches when all records fit on one page', async () => {
    mockRecords(
      Array.from({ length: 50 }, (_, index) => item(`record-${index + 1}`)),
    );
    render(<AllRecordsPage ctx={buildOperationCtx()} />);

    expect(
      screen.queryByRole('button', { name: 'Select all matching records' }),
    ).not.toBeInTheDocument();
    await clickReadyRecordCheckbox('record-1');
    expect(screen.getByText('1 record selected')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Select all matching records' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    50, 200,
  ])('hydrates and renders at most %i selected records and paginates without URL navigation', async (perPage) => {
    mockRecords(
      Array.from({ length: 401 }, (_, index) => item(`record-${index + 1}`)),
    );
    const ctx = buildOperationCtx({
      location: { pathname: '', search: `?perPage=${perPage}`, hash: '' },
    });
    render(<AllRecordsPage ctx={ctx} />);
    expect(
      screen.queryByRole('button', { name: 'Select all matching records' }),
    ).not.toBeInTheDocument();

    await selectAllMatching(401);

    expect(
      screen.queryByRole('button', { name: 'Select all matching records' }),
    ).not.toBeInTheDocument();
    const collectionQueries = cmaMocks.rawList.mock.calls
      .map(([query]) => query)
      .filter((query) => query.order_by === 'id_ASC');
    expect(collectionQueries.map((query) => query.page)).toEqual([
      { offset: 0, limit: 200 },
      { offset: 200, limit: 200 },
      { offset: 400, limit: 200 },
    ]);
    cmaMocks.rawList.mockClear();

    await clickReadyButton('Show selection');
    await readyRecordCheckbox('record-1');
    expect(
      screen.getAllByRole('checkbox', { name: /^Select record / }),
    ).toHaveLength(perPage);
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await clickReadyButton('Next »');

    await readyRecordCheckbox(`record-${perPage + 1}`);
    expect(
      screen.getAllByRole('checkbox', { name: /^Select record / }),
    ).toHaveLength(perPage);
    expect(
      screen.queryByRole('checkbox', { name: 'Select record record-1' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    expect(
      cmaMocks.rawList.mock.calls.map(([query]) => query.filter.ids),
    ).toEqual(
      Array.from({ length: 2 * Math.ceil(perPage / 100) }, (_, batch) => {
        const size = Math.min(100, perPage);
        const offset = batch * size;
        return Array.from(
          { length: size },
          (_, index) => `record-${offset + index + 1}`,
        ).join(',');
      }),
    );
    for (const [query] of cmaMocks.rawList.mock.calls) {
      expect(query.page.limit).toBeLessThanOrEqual(100);
      expect(query.nested).toBe(false);
    }
  });

  it('publishes 401 selected records continuously in 200/200/1 batches with one confirmation', async () => {
    mockRecords(
      Array.from({ length: 401 }, (_, index) => item(`record-${index + 1}`)),
    );
    const firstJob = deferred<BulkJobResult>();
    const secondJob = deferred<BulkJobResult>();
    cmaMocks.rawBulkPublish
      .mockImplementationOnce(() => firstJob.promise)
      .mockImplementationOnce(() => secondJob.promise);
    const ctx = buildOperationCtx();
    render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(401);

    await clickReadyButton('Publish');
    await waitFor(() =>
      expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.getByText('0 of 401 processed; 0 succeeded; 0 failed'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show selection' }),
    ).toBeDisabled();

    await act(async () =>
      firstJob.resolve({ data: [], meta: { successful: 200, failed: 0 } }),
    );
    await waitFor(() =>
      expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByText('200 of 401 processed; 200 succeeded; 0 failed'),
    ).toBeInTheDocument();
    await act(async () =>
      secondJob.resolve({ data: [], meta: { successful: 200, failed: 0 } }),
    );

    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('401 records published.'),
    );
    expect(ctx.openConfirm).toHaveBeenCalledTimes(1);
    expect(
      cmaMocks.rawBulkPublish.mock.calls.map(
        ([payload]) => payload.data.relationships.items.data.length,
      ),
    ).toEqual([200, 200, 1]);
    expect(ctx.alert).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Selection actions' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('cancels future batches while allowing the accepted job to finish and retains unsubmitted records', async () => {
    mockRecords(
      Array.from({ length: 401 }, (_, index) => item(`record-${index + 1}`)),
    );
    const acceptedJob = deferred<BulkJobResult>();
    cmaMocks.rawBulkPublish.mockImplementationOnce(() => acceptedJob.promise);
    const ctx = buildOperationCtx();
    render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(401);
    await clickReadyButton('Publish');
    await waitFor(() =>
      expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel remaining' }));
    expect(screen.getByText('401 records selected')).toBeInTheDocument();
    await act(async () =>
      acceptedJob.resolve({ data: [], meta: { successful: 200, failed: 0 } }),
    );

    await screen.findByText('201 records selected', undefined, UI_WAIT_OPTIONS);
    expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(1);
    expect(ctx.alert).toHaveBeenCalledWith(
      'Cancelled. 200 records published; 201 records were not submitted.',
    );
    expect(ctx.notice).not.toHaveBeenCalled();
    await clickReadyButton('Show selection');
    expect(await readyRecordCheckbox('record-201')).toBeChecked();
    expect(
      screen.queryByRole('checkbox', { name: 'Select record record-1' }),
    ).not.toBeInTheDocument();
  });

  it('retains a partially failed batch and excluded records while removing fully successful batches', async () => {
    const secondModel = model();
    secondModel.id = 'model-2';
    secondModel.attributes = {
      ...secondModel.attributes,
      name: 'Single version',
      draft_mode_active: false,
    };
    const excludedRecord = item('record-401');
    excludedRecord.relationships.item_type.data.id = secondModel.id;
    mockRecords([
      ...Array.from({ length: 400 }, (_, index) => item(`record-${index + 1}`)),
      excludedRecord,
    ]);
    cmaMocks.rawBulkPublish
      .mockResolvedValueOnce({ data: [], meta: { successful: 200, failed: 0 } })
      .mockResolvedValueOnce({
        data: [],
        meta: { successful: 199, failed: 1 },
      });
    const ctx = buildOperationCtx({
      itemTypes: { 'model-1': model(), 'model-2': secondModel },
    });
    render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(401);

    await clickReadyButton('Publish');

    await screen.findByText('201 records selected', undefined, UI_WAIT_OPTIONS);
    expect(ctx.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '400 records of 401 selected records are eligible.',
      }),
    );
    expect(ctx.alert).toHaveBeenCalledWith(
      '399 records published; 1 record failed.',
    );
    expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(2);
    expect(
      cmaMocks.rawBulkPublish.mock.calls.flatMap(([payload]) =>
        payload.data.relationships.items.data.map(
          (record: { id: string }) => record.id,
        ),
      ),
    ).toEqual(Array.from({ length: 400 }, (_, index) => `record-${index + 1}`));

    await clickReadyButton('Show selection');
    expect(await readyRecordCheckbox('record-201')).toBeChecked();
    await clickReadyButton('5');
    expect(await readyRecordCheckbox('record-401')).toBeChecked();
    expect(
      screen.getAllByRole('checkbox', { name: /^Select record / }),
    ).toHaveLength(1);
  });

  it('locks duplicate confirmation requests and prevents mutation after the environment changes', async () => {
    mockRecords([item('record-1')]);
    const confirmation = deferred<boolean>();
    const ctx = buildOperationCtx({
      openConfirm: vi.fn().mockImplementation(() => confirmation.promise),
    });
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);
    await clickReadyRecordCheckbox('record-1');
    const publish = await readyButton('Publish');
    act(() => {
      fireEvent.click(publish);
      fireEvent.click(publish);
    });
    await waitFor(() => expect(ctx.openConfirm).toHaveBeenCalledTimes(1));

    rerender(
      <AllRecordsPage
        ctx={buildOperationCtx({
          environment: 'sandbox',
          isEnvironmentPrimary: false,
        })}
      />,
    );
    await act(async () => confirmation.resolve(true));

    expect(cmaMocks.rawBulkPublish).not.toHaveBeenCalled();
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Selection actions' }),
    ).not.toBeInTheDocument();
  });

  it('stops future jobs and discards stale UI updates when the environment changes during an accepted job', async () => {
    mockRecords(
      Array.from({ length: 401 }, (_, index) => item(`record-${index + 1}`)),
    );
    const acceptedJob = deferred<BulkJobResult>();
    cmaMocks.rawBulkPublish.mockImplementationOnce(() => acceptedJob.promise);
    const ctx = buildOperationCtx();
    const nextCtx = buildOperationCtx({
      environment: 'sandbox',
      isEnvironmentPrimary: false,
    });
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(401);
    await clickReadyButton('Publish');
    await waitFor(() =>
      expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(1),
    );

    rerender(<AllRecordsPage ctx={nextCtx} />);
    await act(async () =>
      acceptedJob.resolve({ data: [], meta: { successful: 200, failed: 0 } }),
    );

    expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(1);
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(ctx.alert).not.toHaveBeenCalled();
    expect(nextCtx.notice).not.toHaveBeenCalled();
    expect(nextCtx.alert).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Selection actions' }),
    ).not.toBeInTheDocument();
  });
});
