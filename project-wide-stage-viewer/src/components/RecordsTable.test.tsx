import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORDER_BY } from '../lib/records';
import type { OrderBy } from '../types';
import { RecordsTable, type RecordsTableProps } from './RecordsTable';
import { DEFAULT_COLUMN_SETTINGS } from './columnSettings';

function props(
  orderBy: OrderBy | null,
  onOrderByChange: RecordsTableProps['onOrderByChange'],
): RecordsTableProps {
  return {
    columns: DEFAULT_COLUMN_SETTINGS,
    rows: [],
    selectedIds: new Set(),
    orderBy,
    sortableColumnIds: new Set(['_preview', '_model', '_status']),
    onColumnsChange: vi.fn(),
    onOrderByChange,
    onToggleRow: vi.fn(),
    onTogglePage: vi.fn(),
    onOpenRow: vi.fn(),
  };
}

describe('RecordsTable ordering', () => {
  it('cycles the default descending Last update directly to ascending', () => {
    const onOrderByChange = vi.fn();
    const tableProps = {
      ...props(DEFAULT_ORDER_BY, onOrderByChange),
      sortableColumnIds: new Set(['_updated_at'] as const),
    };
    const { rerender } = render(<RecordsTable {...tableProps} />);

    fireEvent.click(screen.getByRole('button', { name: /^Last update\s*▼$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_ASC');

    rerender(<RecordsTable {...tableProps} orderBy="_updated_at_ASC" />);
    fireEvent.click(screen.getByRole('button', { name: /^Last update\s*▲$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_DESC');
  });

  it('keeps descending Created resetting to the default order', () => {
    const onOrderByChange = vi.fn();
    render(
      <RecordsTable
        {...props('_created_at_DESC', onOrderByChange)}
        columns={[
          ...DEFAULT_COLUMN_SETTINGS,
          { id: '_created_at', width: 0.15 },
        ]}
        sortableColumnIds={new Set(['_created_at'])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Created\s*▼$/ }));

    expect(onOrderByChange).toHaveBeenLastCalledWith(null);
  });

  it('cycles every server-backed sortable header', () => {
    const onOrderByChange = vi.fn();
    const { rerender } = render(
      <RecordsTable {...props(null, onOrderByChange)} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_model_ASC');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_ASC');

    rerender(<RecordsTable {...props('_preview_ASC', onOrderByChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /^Preview\s*▲$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_DESC');

    rerender(<RecordsTable {...props('_preview_DESC', onOrderByChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /^Preview\s*▼$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith(null);
  });
});
