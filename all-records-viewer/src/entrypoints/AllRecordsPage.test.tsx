import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
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

// The page renders its own Canvas: the ctx has what Canvas reads
function buildCtx(overrides: Record<string, unknown> = {}): RenderPageCtx {
  return {
    mode: 'renderPage',
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
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
        internal_domain: 'acme.admin.datocms.com',
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
    customToast: vi.fn(),
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
      // Published, with changes: Publish and Unpublish both apply
      status: 'updated',
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

function records(count: number): RawItem[] {
  return Array.from({ length: count }, (_, index) =>
    item(`record-${index + 1}`),
  );
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

// The row checkbox is named by the first cell of the row: the title, or
// "Record <id>" for a record without one. Label queries are faster than
// role queries on pages of 200 rows.
function recordCheckbox(id: string): HTMLElement {
  return screen.getByLabelText(`Record ${id}`, { selector: 'input' });
}

function queryRecordCheckbox(id: string): HTMLElement | null {
  return screen.queryByLabelText(`Record ${id}`, { selector: 'input' });
}

function rowCheckboxes(): HTMLElement[] {
  return screen.getAllByLabelText(/^Record /, { selector: 'input' });
}

// The table is ready when its rows can be selected: no load, presentation
// or action is running
function requireReadyRecordCheckbox(id: string): HTMLElement {
  const checkbox = recordCheckbox(id);
  expect(checkbox).toBeEnabled();
  return checkbox;
}

async function readyRecordCheckbox(id: string): Promise<HTMLElement> {
  return waitFor(() => requireReadyRecordCheckbox(id), UI_WAIT_OPTIONS);
}

// A button disabled with a reason keeps its focus: it has aria-disabled
// instead of the disabled attribute
function expectActionable(button: HTMLElement): void {
  expect(button).toBeEnabled();
  expect(button).not.toHaveAttribute('aria-disabled', 'true');
}

async function readyButton(name: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const button = screen.getByRole('button', { name });
    expectActionable(button);
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
    expectActionable(button);
    fireEvent.click(button);
  }, UI_WAIT_OPTIONS);
}

// The triggers of the menus open on mouse down
async function openReadyMenu(name: string): Promise<void> {
  await waitFor(() => {
    const trigger = screen.getByRole('button', { name });
    expectActionable(trigger);
    fireEvent.mouseDown(trigger);
  }, UI_WAIT_OPTIONS);
}

async function pickMenuOption(name: string): Promise<void> {
  fireEvent.mouseDown(
    await screen.findByRole('menuitem', { name }, UI_WAIT_OPTIONS),
  );
}

async function selectAllMatching(count: number): Promise<void> {
  await clickReadyRecordCheckbox('record-1');
  await screen.findByText('1 record selected', undefined, UI_WAIT_OPTIONS);
  // No filter is on: the button offers all the records
  await clickReadyButton(`Select all ${count} records`);
  await screen.findByText(
    `${count} records selected`,
    undefined,
    UI_WAIT_OPTIONS,
  );
}

// The bar slides out: it leaves the page once its transition ends
async function expectNoSelectionBar(): Promise<void> {
  await waitFor(() =>
    expect(screen.queryByText(/records? selected$/)).not.toBeInTheDocument(),
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
      screen.getByRole('heading', {
        level: 1,
        name: 'This page needs a permission',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Current user access token/)).toBeInTheDocument();
    expect(cmaMocks.rawList).not.toHaveBeenCalled();
  });

  it('shows a dedicated state when the environment has no record models', () => {
    render(
      <AllRecordsPage
        ctx={buildCtx({ currentUserAccessToken: 'user-token' })}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'All records' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/There are no models yet/)).toBeInTheDocument();
  });

  it('shows the overview when there are no records, and no results for a filter', async () => {
    const ctx = buildOperationCtx();
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);

    expect(
      await screen.findByText(/show here once they are created/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'All records' }),
    ).toBeInTheDocument();

    rerender(
      <AllRecordsPage
        ctx={buildCtx({
          ...ctx,
          location: { pathname: '', search: '?model=model-1', hash: '' },
        })}
      />,
    );

    expect(
      await screen.findByText('Nothing matches the filter.'),
    ).toBeInTheDocument();
    // The title bar stays, so the filters can change
    expect(
      screen.getByRole('heading', { level: 1, name: 'All records' }),
    ).toBeInTheDocument();
  });

  it('keeps the title bar while the list loads for other filters', async () => {
    const ctx = buildOperationCtx();
    const ctxAt = (search: string) =>
      buildCtx({ ...ctx, location: { pathname: '', search, hash: '' } });
    const noResults = 'Nothing matches the filter.';
    const { rerender } = render(<AllRecordsPage ctx={ctxAt('?query=zzz')} />);
    await screen.findByText(noResults, undefined, UI_WAIT_OPTIONS);
    // No matches to order: the count is plain
    expect(screen.getByText('0 records')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Filter Records' });

    // From no results to another filter: the old result is not of the new
    // filter, thus the list loads instead of saying "no results"
    const otherFilter = deferred<unknown>();
    cmaMocks.rawList.mockImplementation(() => otherFilter.promise);
    rerender(<AllRecordsPage ctx={ctxAt('?status=draft')} />);

    expect(toggle).toBeInTheDocument();
    expect(screen.queryByText(noResults)).not.toBeInTheDocument();
    expect(screen.getByText('Loading the records')).toBeInTheDocument();
    await act(async () => {
      otherFilter.resolve({ data: [], meta: { total_count: 0 } });
    });
    expect(await screen.findByText(noResults)).toBeInTheDocument();

    // From no results to no filter: the overview never replaces the page
    // while the records load
    const noFilter = deferred<unknown>();
    cmaMocks.rawList.mockImplementation(() => noFilter.promise);
    rerender(<AllRecordsPage ctx={ctxAt('')} />);

    expect(toggle).toBeInTheDocument();
    expect(
      screen.queryByText(/show here once they are created/),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Loading the records')).toBeInTheDocument();
    await act(async () => {
      noFilter.resolve({ data: [item('record-1')], meta: { total_count: 1 } });
    });
    expect(await readyRecordCheckbox('record-1')).toBeInTheDocument();
    expect(toggle).toBeInTheDocument();
  });

  it('keeps a search row of the URL open when the user empties it', async () => {
    mockRecords([item('record-1')]);
    const navigateTo = vi.fn();
    const ctxAt = (search: string) =>
      buildCtx({
        currentUserAccessToken: 'user-token',
        itemTypes: { 'model-1': model() },
        navigateTo,
        location: { pathname: '', search, hash: '' },
      });
    const { rerender } = render(<AllRecordsPage ctx={ctxAt('?query=old')} />);
    const search = within(
      await screen.findByRole('search', { name: 'Records' }, UI_WAIT_OPTIONS),
    ).getByRole('textbox');

    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() =>
      expect(navigateTo).toHaveBeenCalledWith(
        '/editor/p/plugin-1/pages/all-records',
      ),
    );
    rerender(<AllRecordsPage ctx={ctxAt('')} />);

    // The user is still typing in it
    expect(search).toBeInTheDocument();
    expect(search).toHaveValue('');
  });

  it('closes the search row and clears the search on Escape', async () => {
    mockRecords([item('record-1')]);
    const navigateTo = vi.fn();
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
          navigateTo,
          location: { pathname: '', search: '?query=old', hash: '' },
        })}
      />,
    );
    const search = within(
      await screen.findByRole('search', { name: 'Records' }, UI_WAIT_OPTIONS),
    ).getByRole('textbox');

    fireEvent.keyDown(search, { key: 'Escape' });

    expect(navigateTo).toHaveBeenCalledWith(
      '/editor/p/plugin-1/pages/all-records',
    );
    expect(
      screen.queryByRole('search', { name: 'Records' }),
    ).not.toBeInTheDocument();
  });

  it('writes the trimmed search to the URL 300 ms after the last change', async () => {
    mockRecords([item('record-1')]);
    const ctx = buildOperationCtx();
    render(<AllRecordsPage ctx={ctx} />);

    await clickReadyButton('Filter Records');
    const search = within(
      await screen.findByRole('search', { name: 'Records' }),
    ).getByRole('textbox');
    fireEvent.change(search, { target: { value: '  term ' } });

    expect(search).toHaveValue('  term ');
    expect(ctx.navigateTo).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(ctx.navigateTo).toHaveBeenCalledWith(
        '/editor/p/plugin-1/pages/all-records?query=term',
      ),
    );
  });

  it('does not let a stale debounced value overwrite URL-driven search', async () => {
    mockRecords([item('record-1')]);
    const navigateTo = vi.fn();
    const itemTypes = { 'model-1': model() };
    const initialCtx = buildCtx({
      currentUserAccessToken: 'user-token',
      itemTypes,
      navigateTo,
      location: { pathname: '', search: '?query=old', hash: '' },
    });
    const { rerender } = render(<AllRecordsPage ctx={initialCtx} />);
    // A search in the URL keeps the filter row open
    await screen.findByRole('search', { name: 'Records' }, UI_WAIT_OPTIONS);

    vi.useFakeTimers();
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

    expect(
      within(screen.getByRole('search', { name: 'Records' })).getByRole(
        'textbox',
      ),
    ).toHaveValue('new');
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('retains off-page records when selecting the current page', async () => {
    mockRecords(records(100));
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
    expect(
      screen.getByRole('button', { name: 'Go to page 2' }),
    ).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByLabelText('Select all records on this page'));
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

    await expectNoSelectionBar();
  });

  it('disables metadata sorting while relevance search is active', async () => {
    mockRecords([item('record-1')]);
    render(
      <AllRecordsPage
        ctx={buildCtx({
          currentUserAccessToken: 'user-token',
          itemTypes: { 'model-1': model() },
          location: { pathname: '', search: '?query=term', hash: '' },
        })}
      />,
    );

    await readyRecordCheckbox('record-1');
    expect(screen.getByText('Last update')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Last update' }),
    ).not.toBeInTheDocument();
    // The order of a search shows in the count, not in a notice
    expect(
      await screen.findByText('1 record, best matches first'),
    ).toBeInTheDocument();
  });

  it('navigates from default Last update DESC to ASC and continues toggling', async () => {
    mockRecords([item('record-1')]);
    const ctx = buildOperationCtx({
      location: { pathname: '', search: '?model=model-1', hash: '' },
    });
    const { rerender } = render(<AllRecordsPage ctx={ctx} />);
    await readyRecordCheckbox('record-1');
    fireEvent.click(screen.getByRole('button', { name: 'Last update' }));
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
    await readyRecordCheckbox('record-1');
    fireEvent.click(screen.getByRole('button', { name: 'Last update' }));
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
    await readyRecordCheckbox('record-1');
    fireEvent.click(screen.getByRole('button', { name: 'Last update' }));
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
    mockRecords([item('record-1')]);
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

    await readyRecordCheckbox('record-1');
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    expect(navigateTo).toHaveBeenLastCalledWith(
      '/editor/p/plugin-1/pages/all-records?orderBy=_model_ASC',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(navigateTo).toHaveBeenLastCalledWith(
      '/editor/p/plugin-1/pages/all-records?orderBy=_status_ASC',
    );
  });

  it('does not offer a constant Status sort while status-filtered', async () => {
    mockRecords([item('record-1')]);
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

    await readyRecordCheckbox('record-1');
    // The column header, and the field of the "Status is Published" tile
    expect(screen.getAllByText('Status')).toHaveLength(2);
    expect(screen.getByRole('search')).toHaveTextContent('StatusisPublished');
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument();
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
      await screen.findByText("Couldn't load the records"),
    ).toBeInTheDocument();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
    expect(screen.getByText('Try again in a moment.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(cmaMocks.rawList).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't load the records"),
      ).not.toBeInTheDocument(),
    );
  });

  it('explains a selection page whose records were deleted, and keeps the selection', async () => {
    const current = new Map([['record-1', item('record-1')]]);
    cmaMocks.rawList.mockImplementation((query: MockListQuery) => {
      const matching = query.filter?.ids
        ? query.filter.ids.split(',').flatMap((id) => {
            const record = current.get(id);
            return record ? [record] : [];
          })
        : [...current.values()];
      return Promise.resolve({
        data: matching,
        meta: { total_count: matching.length },
      });
    });
    render(<AllRecordsPage ctx={buildOperationCtx()} />);
    await clickReadyRecordCheckbox('record-1');
    await screen.findByText('1 record selected', undefined, UI_WAIT_OPTIONS);

    // Someone else deletes the record
    current.delete('record-1');
    await clickReadyButton('Show selection');

    expect(
      await screen.findByText(
        "The selected records can't be shown",
        undefined,
        UI_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('1 record selected')).toBeInTheDocument();
    expect(queryRecordCheckbox('record-1')).not.toBeInTheDocument();
    // The bar offers nothing that would fail on records that are gone
    for (const name of ['Invert selection', 'Publish', 'Unpublish', 'Delete']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    // The list shows none of them: nothing in the title bar
    expect(
      screen.queryByText('Only the selected records'),
    ).not.toBeInTheDocument();
    // The area names the way out, as the cross of the bar does
    expect(
      screen.getAllByRole('button', { name: 'Clear selection' }),
    ).toHaveLength(2);

    await clickReadyButton('Hide selection');
    await screen.findByRole('button', { name: 'Show selection' });
  });

  it('offers Publish and Unpublish only for the records they apply to', async () => {
    const draft = item('record-1');
    draft.meta.status = 'draft';
    const published = item('record-2');
    published.meta.status = 'published';
    mockRecords([draft, published]);
    render(<AllRecordsPage ctx={buildOperationCtx()} />);

    // A published record has no changes to publish
    await clickReadyRecordCheckbox('record-2');
    await readyButton('Unpublish');
    expect(
      screen.queryByRole('button', { name: 'Publish' }),
    ).not.toBeInTheDocument();

    await clickReadyRecordCheckbox('record-1');
    await screen.findByText('2 records selected', undefined, UI_WAIT_OPTIONS);
    await readyButton('Publish');
    await readyButton('Unpublish');

    // A draft is not live: nothing to unpublish
    await clickReadyRecordCheckbox('record-2');
    await screen.findByText('1 record selected', undefined, UI_WAIT_OPTIONS);
    await readyButton('Publish');
    expect(
      screen.queryByRole('button', { name: 'Unpublish' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the rows of Show selection while it loads them again', async () => {
    mockRecords(records(3));
    render(<AllRecordsPage ctx={buildOperationCtx()} />);
    await clickReadyRecordCheckbox('record-1');
    await clickReadyRecordCheckbox('record-2');
    await screen.findByText('2 records selected', undefined, UI_WAIT_OPTIONS);
    await clickReadyButton('Show selection');
    await readyRecordCheckbox('record-2');
    expect(queryRecordCheckbox('record-3')).not.toBeInTheDocument();
    // Every row is selected here: inverting would only clear them
    expect(
      screen.queryByRole('button', { name: 'Invert selection' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();

    const reload = deferred<{
      data: RawItem[];
      meta: { total_count: number };
    }>();
    cmaMocks.rawList.mockImplementationOnce(() => reload.promise);
    await clickReadyRecordCheckbox('record-1');

    // The record that left the selection goes; the other row stays, locked,
    // while the selection loads again
    await waitFor(() =>
      expect(queryRecordCheckbox('record-1')).not.toBeInTheDocument(),
    );
    expect(recordCheckbox('record-2')).toBeDisabled();
    expect(screen.queryByText('Loading the records')).not.toBeInTheDocument();

    reload.resolve({ data: [item('record-2')], meta: { total_count: 1 } });
    await readyRecordCheckbox('record-2');
    expect(screen.getByText('1 record selected')).toBeInTheDocument();
  });
});

describe('AllRecordsPage large selections', () => {
  it('keeps all matches hidden after reducing page size for a complete same-filter selection', async () => {
    mockRecords(records(200));
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
      fireEvent.click(screen.getByLabelText('Select all records on this page'));
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
      screen.queryByRole('button', { name: /^Select (all )?\d/ }),
    ).not.toBeInTheDocument();
    expect(
      cmaMocks.rawList.mock.calls.filter(([query]) => query.filter?.ids),
    ).toHaveLength(0);
  });

  it('removes missing IDs after a partial delete while retaining current survivors', async () => {
    const current = new Map([
      ['record-1', item('record-1')],
      ['record-2', item('record-2')],
    ]);
    cmaMocks.rawList.mockImplementation((query: MockListQuery) => {
      const matching = query.filter?.ids
        ? query.filter.ids.split(',').flatMap((id) => {
            const record = current.get(id);
            return record ? [record] : [];
          })
        : [...current.values()];
      return Promise.resolve({
        data: matching.slice(
          query.page.offset,
          query.page.offset + query.page.limit,
        ),
        meta: { total_count: matching.length },
      });
    });
    cmaMocks.rawBulkDestroy.mockImplementationOnce(() => {
      current.delete('record-1');
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
    expect(queryRecordCheckbox('record-1')).not.toBeInTheDocument();
    expect(ctx.alert).toHaveBeenCalledTimes(1);
    expect(ctx.alert).toHaveBeenCalledWith(
      "1 record deleted. 1 couldn't be deleted: open the selected records to see why.",
    );
    expect(ctx.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete 2 records?',
        content: "This can't be undone.",
        choices: [expect.objectContaining({ label: 'Delete' })],
      }),
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
    const all = records(201);
    for (const record of all) {
      record.meta.stage = 'draft';
    }
    const byId = new Map(all.map((record) => [record.id, record]));
    mockRecords(all);
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
    });
    render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(201);

    // Every record is in Draft: the menu offers only the other stage
    await openReadyMenu('Move to stage');
    await screen.findByRole('menuitem', { name: 'Review' }, UI_WAIT_OPTIONS);
    expect(
      screen.getAllByRole('menuitem').map((option) => option.textContent),
    ).toEqual(['Review']);
    await pickMenuOption('Review');
    // The pick closes the menu; the next opening loads the stages again
    await waitFor(() =>
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument(),
    );
    await screen.findByText('200 records selected', undefined, UI_WAIT_OPTIONS);

    // 199 records are in Review now, and one is still in Draft
    await openReadyMenu('Move to stage');
    await screen.findByRole('menuitem', { name: 'Draft' }, UI_WAIT_OPTIONS);
    expect(
      screen.getAllByRole('menuitem').map((option) => option.textContent),
    ).toEqual(['Draft', 'Review']);
    await pickMenuOption('Draft');

    // The record already in Draft needs nothing more: the selection is done
    await expectNoSelectionBar();
    expect(cmaMocks.workflowFind).toHaveBeenCalledTimes(2);
    expect(cmaMocks.workflowFind).toHaveBeenCalledWith('workflow-1');
    expect(ctx.openModal).not.toHaveBeenCalled();
    // The second pick leaves out only the record already in Draft: nothing
    // is refused, thus neither pick asks first
    expect(ctx.openConfirm).not.toHaveBeenCalled();
    expect(ctx.notice).toHaveBeenCalledWith(
      '199 records moved to “Draft”. The other 1 was already there.',
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

  it('keeps selected only the records that the role could not move', async () => {
    const workflowModel = model();
    workflowModel.relationships.workflow.data = {
      id: 'workflow-1',
      type: 'workflow',
    };
    const there = item('record-1');
    there.meta.stage = 'review';
    const own = item('record-2');
    own.meta.stage = 'draft';
    own.relationships.creator = { data: { id: 'user-1', type: 'user' } };
    const others = item('record-3');
    others.meta.stage = 'draft';
    others.relationships.creator = {
      data: { id: 'other-user', type: 'user' },
    };
    mockRecords([there, own, others]);
    cmaMocks.workflowFind.mockResolvedValue({
      stages: [
        { id: 'draft', name: 'Draft' },
        { id: 'review', name: 'Review' },
      ],
    });
    const ctx = buildOperationCtx({
      itemTypes: { 'model-1': workflowModel },
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
    await clickReadyRecordCheckbox('record-2');
    await clickReadyRecordCheckbox('record-3');
    await screen.findByText('3 records selected', undefined, UI_WAIT_OPTIONS);

    await openReadyMenu('Move to stage');
    await pickMenuOption('Review');

    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith(
        '1 record moved to “Review”. 1 was already there. The other 1 is still selected.',
      ),
    );
    expect(ctx.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "1 is already in this stage. Your role can't move the other 1.",
      }),
    );
    // The record already in Review leaves the selection with the moved one
    await screen.findByText('1 record selected', undefined, UI_WAIT_OPTIONS);
    expect(recordCheckbox('record-3')).toBeChecked();
    expect(recordCheckbox('record-1')).not.toBeChecked();
  });

  it('spins the title bar while a move reads the selected records again', async () => {
    const workflowModel = model();
    workflowModel.relationships.workflow.data = {
      id: 'workflow-1',
      type: 'workflow',
    };
    const record = item('record-1');
    record.meta.stage = 'draft';
    mockRecords([record]);
    cmaMocks.workflowFind.mockResolvedValue({
      stages: [
        { id: 'draft', name: 'Draft' },
        { id: 'review', name: 'Review' },
      ],
    });
    const ctx = buildOperationCtx({
      itemTypes: { 'model-1': workflowModel },
    });
    const { container } = render(<AllRecordsPage ctx={ctx} />);
    await clickReadyRecordCheckbox('record-1');
    await openReadyMenu('Move to stage');
    await screen.findByRole('menuitem', { name: 'Review' }, UI_WAIT_OPTIONS);
    expect(container.querySelector('.Toolbar__spinner')).toBeNull();

    const reload = deferred<{
      data: RawItem[];
      meta: { total_count: number };
    }>();
    cmaMocks.rawList.mockImplementationOnce(() => reload.promise);
    await pickMenuOption('Review');

    // The menu has no spinner of its own: the title bar shows the wait
    await waitFor(() =>
      expect(container.querySelector('.Toolbar__spinner')).not.toBeNull(),
    );
    reload.resolve({ data: [record], meta: { total_count: 1 } });
    await waitFor(() =>
      expect(ctx.notice).toHaveBeenCalledWith('1 record moved to “Review”.'),
    );
  });

  it('shows Move to stage only for records of one model with a workflow', async () => {
    const workflowModel = model();
    workflowModel.relationships.workflow.data = {
      id: 'workflow-1',
      type: 'workflow',
    };
    const otherModel = model();
    otherModel.id = 'model-2';
    const other = item('record-2');
    other.relationships.item_type.data.id = otherModel.id;
    mockRecords([item('record-1'), other]);
    render(
      <AllRecordsPage
        ctx={buildOperationCtx({
          itemTypes: { 'model-1': workflowModel, 'model-2': otherModel },
        })}
      />,
    );

    await clickReadyRecordCheckbox('record-2');
    await readyButton('Publish');
    expect(
      screen.queryByRole('button', { name: 'Move to stage' }),
    ).not.toBeInTheDocument();

    await clickReadyRecordCheckbox('record-1');
    await screen.findByText('2 records selected');
    expect(
      screen.getByRole('button', { name: 'Move to stage' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a failed load of the stages in the Move to stage menu', async () => {
    const workflowModel = model();
    workflowModel.relationships.workflow.data = {
      id: 'workflow-1',
      type: 'workflow',
    };
    mockRecords([item('record-1')]);
    cmaMocks.workflowFind.mockRejectedValueOnce(
      new Error('Network unavailable'),
    );
    const ctx = buildOperationCtx({
      itemTypes: { 'model-1': workflowModel },
    });
    render(<AllRecordsPage ctx={ctx} />);
    await clickReadyRecordCheckbox('record-1');

    await openReadyMenu('Move to stage');

    expect(
      await screen.findByText(
        "Couldn't load the stages",
        undefined,
        UI_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
    expect(
      screen.getAllByRole('menuitem').map((option) => option.textContent),
    ).toEqual(['Try again']);
    expect(ctx.openConfirm).not.toHaveBeenCalled();

    // "Try again" is an option of the menu: the arrow keys and Enter reach
    // it, and it loads the stages again in the same menu
    cmaMocks.workflowFind.mockResolvedValueOnce({
      stages: [{ id: 'review', name: 'Review' }],
    });
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(menu, { key: 'Enter', keyCode: 13, which: 13 });
    expect(
      await screen.findByRole('menuitem', { name: 'Review' }, UI_WAIT_OPTIONS),
    ).toBeInTheDocument();
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

  it('says what publishing does, or that the role leaves some records out', async () => {
    const own = item('record-1');
    own.relationships.creator = { data: { id: 'user-1', type: 'user' } };
    const others = item('record-2');
    others.relationships.creator = {
      data: { id: 'other-user', type: 'user' },
    };
    mockRecords([own, others]);
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
      openConfirm: vi.fn().mockResolvedValue(false),
    });
    render(<AllRecordsPage ctx={ctx} />);
    await clickReadyRecordCheckbox('record-1');
    await clickReadyButton('Publish');
    await waitFor(() =>
      expect(ctx.openConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: 'Publish 1 record?',
          content: 'Its latest changes go live.',
        }),
      ),
    );

    await clickReadyRecordCheckbox('record-2');
    await clickReadyButton('Publish');
    await waitFor(() =>
      expect(ctx.openConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: 'Publish 1 of 2 records?',
          content: "Your role can't publish the other 1.",
        }),
      ),
    );
    expect(cmaMocks.rawBulkPublish).not.toHaveBeenCalled();
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
        "Couldn't publish the selected records. Some selected records were deleted, or you can no longer read them. Clear the selection, then select the records again.",
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
    const { container } = render(<AllRecordsPage ctx={ctx} />);
    await screen.findByText('Original linked title');
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/original.jpg'),
    );

    await waitFor(() => {
      const checkbox = screen.getByLabelText('Original linked title', {
        selector: 'input',
      });
      expect(checkbox).toBeEnabled();
      fireEvent.click(checkbox);
    }, UI_WAIT_OPTIONS);
    await clickReadyButton('Publish');

    await screen.findByText('Updated linked title');
    expect(container.querySelector('img')).toHaveAttribute(
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
    mockRecords(records(401));
    const fields = deferred<RawField[]>();
    const ctx = buildOperationCtx({
      location: { pathname: '', search: '?perPage=200', hash: '' },
      loadItemTypeFields: vi.fn().mockImplementation(() => fields.promise),
    });
    render(<AllRecordsPage ctx={ctx} />);
    await waitFor(() => {
      expect(ctx.loadItemTypeFields).toHaveBeenCalled();
      expect(recordCheckbox('record-1')).toBeDisabled();
    }, UI_WAIT_OPTIONS);

    const selection = selectAllMatching(401);
    expect(screen.queryByText(/records? selected$/)).not.toBeInTheDocument();
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
    mockRecords(records(50));
    render(<AllRecordsPage ctx={buildOperationCtx()} />);

    expect(
      screen.queryByRole('button', { name: /^Select (all )?\d/ }),
    ).not.toBeInTheDocument();
    await clickReadyRecordCheckbox('record-1');
    expect(screen.getByText('1 record selected')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Select (all )?\d/ }),
    ).not.toBeInTheDocument();
  });

  it('hydrates and renders at most 50 selected records and paginates without URL navigation', async () => {
    const perPage = 50;
    mockRecords(records(401));
    const ctx = buildOperationCtx({
      location: { pathname: '', search: `?perPage=${perPage}`, hash: '' },
    });
    render(<AllRecordsPage ctx={ctx} />);
    expect(
      screen.queryByRole('button', { name: /^Select (all )?\d/ }),
    ).not.toBeInTheDocument();

    await selectAllMatching(401);

    expect(
      screen.queryByRole('button', { name: /^Select (all )?\d/ }),
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
    expect(rowCheckboxes()).toHaveLength(perPage);
    expect(screen.getByText('Only the selected records')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to page 1' }),
    ).toHaveAttribute('aria-current', 'page');
    await clickReadyButton('Next page');

    await readyRecordCheckbox(`record-${perPage + 1}`);
    expect(rowCheckboxes()).toHaveLength(perPage);
    expect(queryRecordCheckbox('record-1')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to page 2' }),
    ).toHaveAttribute('aria-current', 'page');
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
    mockRecords(records(401));
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
    // The bar says what runs in place of the count, and its actions leave
    // until it ends
    expect(screen.getByText('Publishing 401 records…')).toHaveAttribute(
      'role',
      'status',
    );
    expect(
      screen.queryByRole('button', { name: 'Show selection' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Publish' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    await act(async () =>
      firstJob.resolve({ data: [], meta: { successful: 200, failed: 0 } }),
    );
    await waitFor(() =>
      expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByText('Publishing 200 of 401 records…'),
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
    await expectNoSelectionBar();
  });

  it('cancels future batches while allowing the accepted job to finish and retains unsubmitted records', async () => {
    mockRecords(records(401));
    const acceptedJob = deferred<BulkJobResult>();
    cmaMocks.rawBulkPublish.mockImplementationOnce(() => acceptedJob.promise);
    const ctx = buildOperationCtx();
    render(<AllRecordsPage ctx={ctx} />);
    await selectAllMatching(401);
    await clickReadyButton('Publish');
    await waitFor(() =>
      expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Stopping…')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Stop' }),
    ).not.toBeInTheDocument();
    await act(async () =>
      acceptedJob.resolve({ data: [], meta: { successful: 200, failed: 0 } }),
    );

    await screen.findByText('201 records selected', undefined, UI_WAIT_OPTIONS);
    expect(cmaMocks.rawBulkPublish).toHaveBeenCalledTimes(1);
    // A stop that the user asked for is not a failure
    expect(ctx.notice).toHaveBeenCalledWith(
      'Stopped. 200 records published. The other 201 are still selected.',
    );
    expect(ctx.alert).not.toHaveBeenCalled();
    await clickReadyButton('Show selection');
    expect(await readyRecordCheckbox('record-201')).toBeChecked();
    expect(queryRecordCheckbox('record-1')).not.toBeInTheDocument();
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
    mockRecords([...records(400), excludedRecord]);
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
        title: 'Publish 400 of 401 records?',
        content: "The other 1 can't be published.",
      }),
    );
    expect(ctx.alert).toHaveBeenCalledWith(
      "399 records published. 1 couldn't be published: open the selected records to see why.",
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
    await clickReadyButton('Go to page 5');
    expect(await readyRecordCheckbox('record-401')).toBeChecked();
    expect(rowCheckboxes()).toHaveLength(1);
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
    await expectNoSelectionBar();
  });

  it('stops future jobs and discards stale UI updates when the environment changes during an accepted job', async () => {
    mockRecords(records(401));
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
    await expectNoSelectionBar();
  });
});
