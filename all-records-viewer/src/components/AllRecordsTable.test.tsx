import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORDER_BY } from '../data/query';
import { TEXTS } from '../texts';
import type { ColumnId, OrderBy } from '../types';
import { AllRecordsTable, type AllRecordsTableProps } from './AllRecordsTable';
import { DEFAULT_COLUMN_SETTINGS } from './columnSettings';
import type { TableRecord } from './types';

const ctx = {
  mode: 'renderPage',
  cssDesignTokens: {},
  colorScheme: 'light',
  bodyPadding: [0, 0, 0, 0],
  ui: { locale: 'en' },
  site: { attributes: { internal_domain: 'acme.admin.datocms.com' } },
  location: { pathname: '/', search: '', hash: '' },
  navigateTo: vi.fn(),
  notice: vi.fn(),
  alert: vi.fn(),
  customToast: vi.fn(),
  openConfirm: vi.fn(),
} as unknown as RenderPageCtx;

const RECORD: TableRecord = {
  id: 'record-1',
  title: 'Hello world',
  model: 'Article',
  status: 'published',
  updatedAt: '2026-10-15T09:30:00Z',
  createdAt: '2026-10-01T09:30:00Z',
  publishedValid: true,
  currentValid: true,
  draftModeActive: false,
  url: '/editor/item_types/model-1/items/record-1',
};

function props(
  orderBy: OrderBy | null,
  sortable: readonly ColumnId[],
  overrides: Partial<AllRecordsTableProps> = {},
): AllRecordsTableProps {
  return {
    columns: [...DEFAULT_COLUMN_SETTINGS, { id: '_created_at', width: 0.15 }],
    onColumnsChange: vi.fn(),
    rows: [],
    selectedIds: new Set(),
    orderBy,
    sortableColumnIds: new Set(sortable),
    sortingEnabled: true,
    onOrderByChange: vi.fn(),
    selectionEnabled: true,
    selectAllHidden: false,
    onToggleRow: vi.fn(),
    onTogglePage: vi.fn(),
    ...overrides,
  };
}

function renderTable(initial: AllRecordsTableProps) {
  const view = (tableProps: AllRecordsTableProps) => (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <AllRecordsTable {...tableProps} />
    </Canvas>
  );
  const { rerender } = render(view(initial));
  return (next: AllRecordsTableProps) => rerender(view(next));
}

afterEach(() => {
  cleanup();
});

// The sortable headers are buttons; the others are plain text
const header = (label: string) => screen.getByRole('button', { name: label });

describe('AllRecordsTable ordering', () => {
  it('cycles the default descending Last update directly to ascending', () => {
    const onOrderByChange = vi.fn();
    const rerender = renderTable(
      props(DEFAULT_ORDER_BY, ['_updated_at'], { onOrderByChange }),
    );

    fireEvent.click(header('Last update'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_ASC');

    rerender(props('_updated_at_ASC', ['_updated_at'], { onOrderByChange }));
    fireEvent.click(header('Last update'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_DESC');
  });

  it('keeps descending Created resetting to the default order', () => {
    const onOrderByChange = vi.fn();
    renderTable(
      props('_created_at_DESC', ['_created_at'], { onOrderByChange }),
    );

    fireEvent.click(header('Created'));

    expect(onOrderByChange).toHaveBeenLastCalledWith(null);
  });

  it('cycles every server-backed sortable header', () => {
    const onOrderByChange = vi.fn();
    const sortable = ['_preview', '_model', '_status'] as const;
    const rerender = renderTable(props(null, sortable, { onOrderByChange }));

    fireEvent.click(header('Model'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_model_ASC');
    fireEvent.click(header('Title'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_ASC');

    rerender(props('_preview_ASC', sortable, { onOrderByChange }));
    fireEvent.click(header('Title'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_DESC');

    rerender(props('_preview_DESC', sortable, { onOrderByChange }));
    fireEvent.click(header('Title'));
    expect(onOrderByChange).toHaveBeenLastCalledWith(null);
  });

  it('does not sort by a column that the order does not support', () => {
    renderTable(props(null, ['_model']));

    expect(screen.getByText('Last update')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Last update' }),
    ).not.toBeInTheDocument();
    expect(header('Model')).toBeInTheDocument();
  });

  it('has no sorting headers while searching', () => {
    renderTable(
      props(null, ['_preview', '_model', '_updated_at'], {
        sortingEnabled: false,
      }),
    );

    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
  });
});

describe('AllRecordsTable rows', () => {
  it('links each row to its record and selects it by its title', () => {
    const onToggleRow = vi.fn();
    const onTogglePage = vi.fn();
    renderTable(
      props(DEFAULT_ORDER_BY, [], {
        rows: [RECORD],
        onToggleRow,
        onTogglePage,
      }),
    );

    expect(screen.getByRole('link', { name: /Hello world/ })).toHaveAttribute(
      'href',
      'https://acme.admin.datocms.com/editor/item_types/model-1/items/record-1',
    );
    expect(screen.getByText('Published')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Hello world' }));
    expect(onToggleRow).toHaveBeenCalledWith('record-1');

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select all records on this page' }),
    );
    expect(onTogglePage).toHaveBeenCalledWith(true);
  });

  it('locks the selection while the records load', () => {
    const onTogglePage = vi.fn();
    renderTable(
      props(DEFAULT_ORDER_BY, [], {
        rows: [RECORD],
        selectionEnabled: false,
        onTogglePage,
      }),
    );

    expect(
      screen.getByRole('checkbox', { name: 'Hello world' }),
    ).toBeDisabled();
    // The header keeps its checkbox, thus its labels stay above their
    // columns, but the checkbox does nothing meanwhile
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select all records on this page' }),
    );
    expect(onTogglePage).not.toHaveBeenCalled();
  });

  it('hides the header checkbox while a bulk action runs', () => {
    renderTable(
      props(DEFAULT_ORDER_BY, [], {
        rows: [RECORD],
        selectionEnabled: false,
        selectAllHidden: true,
      }),
    );

    expect(
      screen.getByRole('checkbox', { name: 'Hello world' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('checkbox', {
        name: 'Select all records on this page',
      }),
    ).not.toBeInTheDocument();
  });
});
