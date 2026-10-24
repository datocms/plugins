import { fireEvent, render, screen } from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORDER_BY } from '../lib/records';
import { TEXTS } from '../texts';
import type { ColumnId, OrderBy } from '../types';
import { DEFAULT_COLUMN_SETTINGS } from './columnSettings';
import { RecordsTable, type RecordsTableProps } from './RecordsTable';
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
  imageUrl: 'https://www.datocms-assets.com/1/hello.png',
  model: 'Article',
  status: 'updated',
  statusLabel: 'Unpublished changes',
  updatedAt: '2026-10-15T09:30:00Z',
  createdAt: '2026-10-01T09:30:00Z',
  publishedValid: true,
  currentValid: true,
  draftModeActive: true,
  url: '/environments/sandbox/editor/item_types/model-1/items/record-1/edit',
};

function props(
  orderBy: OrderBy,
  sortable: readonly ColumnId[] | undefined,
  overrides: Partial<RecordsTableProps> = {},
): RecordsTableProps {
  return {
    columns: [...DEFAULT_COLUMN_SETTINGS, { id: '_created_at', width: 0.15 }],
    onColumnsChange: vi.fn(),
    rows: [],
    selectedIds: new Set(),
    orderBy,
    sortableColumnIds: sortable ? new Set(sortable) : undefined,
    sortingEnabled: true,
    onOrderByChange: vi.fn(),
    selectionEnabled: true,
    onToggleRow: vi.fn(),
    onTogglePage: vi.fn(),
    ...overrides,
  };
}

function renderTable(initial: RecordsTableProps) {
  const view = (tableProps: RecordsTableProps) => (
    <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
      <RecordsTable {...tableProps} />
    </Canvas>
  );
  const { rerender } = render(view(initial));
  return (next: RecordsTableProps) => rerender(view(next));
}

// The sortable headers are links named by their label; the others are text
const header = (label: string) => screen.getByRole('link', { name: label });

describe('RecordsTable ordering', () => {
  it('cycles the default descending Last update directly to ascending', () => {
    const onOrderByChange = vi.fn();
    const rerender = renderTable(
      props(DEFAULT_ORDER_BY, undefined, { onOrderByChange }),
    );

    fireEvent.click(header('Last update'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_ASC');

    rerender(props('_updated_at_ASC', undefined, { onOrderByChange }));
    fireEvent.click(header('Last update'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_DESC');
  });

  it('keeps descending Created resetting to the default order', () => {
    const onOrderByChange = vi.fn();
    renderTable(props('_created_at_DESC', undefined, { onOrderByChange }));

    fireEvent.click(header('Created'));

    expect(onOrderByChange).toHaveBeenLastCalledWith(null);
  });

  it('cycles Preview and Model from unsorted to ascending, descending and back', () => {
    const onOrderByChange = vi.fn();
    const sortable = ['_preview', '_model', '_status'] as const;
    const rerender = renderTable(
      props(DEFAULT_ORDER_BY, sortable, { onOrderByChange }),
    );

    fireEvent.click(header('Model'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_model_ASC');
    fireEvent.click(header('Preview'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_ASC');

    rerender(props('_preview_ASC', sortable, { onOrderByChange }));
    fireEvent.click(header('Preview'));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_DESC');

    rerender(props('_preview_DESC', sortable, { onOrderByChange }));
    fireEvent.click(header('Preview'));
    expect(onOrderByChange).toHaveBeenLastCalledWith(null);

    rerender(props('_model_DESC', sortable, { onOrderByChange }));
    fireEvent.click(header('Model'));
    expect(onOrderByChange).toHaveBeenLastCalledWith(null);
  });

  it('does not sort by a column that cannot be sorted now', () => {
    renderTable(props(DEFAULT_ORDER_BY, ['_preview', '_model']));

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Status' }),
    ).not.toBeInTheDocument();
    expect(header('Model')).toBeInTheDocument();
  });

  it('has no sorting headers while the records load or an action runs', () => {
    renderTable(props(DEFAULT_ORDER_BY, undefined, { sortingEnabled: false }));

    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

describe('RecordsTable rows', () => {
  it('links each row to its record and selects it by its title', () => {
    const onToggleRow = vi.fn();
    const onTogglePage = vi.fn();
    const { container } = render(
      <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
        <RecordsTable
          {...props(DEFAULT_ORDER_BY, undefined, {
            rows: [RECORD],
            onToggleRow,
            onTogglePage,
          })}
        />
      </Canvas>,
    );

    expect(screen.getByRole('link', { name: /Hello world/ })).toHaveAttribute(
      'href',
      'https://acme.admin.datocms.com/environments/sandbox/editor/item_types/model-1/items/record-1/edit',
    );
    expect(screen.getByText('Article')).toBeInTheDocument();
    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      RECORD.imageUrl,
    );
    expect(container.querySelector('time')).toHaveAttribute(
      'datetime',
      expect.stringContaining('2026-10-15'),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Hello world' }));
    expect(onToggleRow).toHaveBeenCalledWith('record-1');

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select all records on this page' }),
    );
    expect(onTogglePage).toHaveBeenCalledWith(true);
  });

  it('shows no image for a record without one', () => {
    const { container } = render(
      <Canvas ctx={ctx} noAutoResizer texts={TEXTS}>
        <RecordsTable
          {...props(DEFAULT_ORDER_BY, undefined, {
            rows: [{ ...RECORD, imageUrl: null }],
          })}
        />
      </Canvas>,
    );

    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('locks the selection while the records load', () => {
    renderTable(
      props(DEFAULT_ORDER_BY, undefined, {
        rows: [RECORD],
        selectionEnabled: false,
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
