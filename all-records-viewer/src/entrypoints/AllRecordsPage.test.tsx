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
import type { RawField } from '../presentation/fields';
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

beforeEach(() => {
  cmaMocks.rawList.mockResolvedValue({ data: [], meta: { total_count: 0 } });
  cmaMocks.uploadRawList.mockResolvedValue({
    data: [],
    meta: { total_count: 0 },
  });
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
    cmaMocks.rawList.mockImplementation((query) =>
      Promise.resolve({
        data: [item(query.page.offset === 0 ? 'record-1' : 'record-2')],
        meta: { total_count: 100 },
      }),
    );
    const navigateTo = vi.fn();
    const itemTypes = { 'model-1': model() };
    const firstCtx = buildCtx({
      currentUserAccessToken: 'user-token',
      itemTypes,
      navigateTo,
    });
    const { rerender } = render(<AllRecordsPage ctx={firstCtx} />);

    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Select record record-1' }),
    );
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

    await screen.findByRole('checkbox', { name: 'Select record record-2' });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select all records on this page',
      }),
    );
    expect(screen.getByText('2 records selected')).toBeInTheDocument();
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

    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Select record record-1' }),
    );
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
          order_by: 'title_ASC',
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
          order_by: '_status_DESC',
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
