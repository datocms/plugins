import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORDER_BY } from '../data/query';
import type { OrderBy } from '../types';
import { AllRecordsTable, type AllRecordsTableProps } from './AllRecordsTable';
import { DEFAULT_COLUMN_SETTINGS } from './columnSettings';

function props(
  orderBy: OrderBy | null,
  onOrderByChange: AllRecordsTableProps['onOrderByChange'],
): AllRecordsTableProps {
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

describe('AllRecordsTable ordering', () => {
  it('cycles the default descending Last update directly to ascending', () => {
    const onOrderByChange = vi.fn();
    const tableProps = {
      ...props(DEFAULT_ORDER_BY, onOrderByChange),
      sortableColumnIds: new Set(['_updated_at'] as const),
    };
    const { rerender } = render(<AllRecordsTable {...tableProps} />);

    fireEvent.click(screen.getByRole('button', { name: /^Last update\s*▼$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_ASC');

    rerender(<AllRecordsTable {...tableProps} orderBy="_updated_at_ASC" />);
    fireEvent.click(screen.getByRole('button', { name: /^Last update\s*▲$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_updated_at_DESC');
  });

  it('keeps descending Created resetting to the default order', () => {
    const onOrderByChange = vi.fn();
    render(
      <AllRecordsTable
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
      <AllRecordsTable {...props(null, onOrderByChange)} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_model_ASC');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_ASC');

    rerender(<AllRecordsTable {...props('_preview_ASC', onOrderByChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /^Preview\s*▲$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith('_preview_DESC');

    rerender(<AllRecordsTable {...props('_preview_DESC', onOrderByChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /^Preview\s*▼$/ }));
    expect(onOrderByChange).toHaveBeenLastCalledWith(null);
  });
});
