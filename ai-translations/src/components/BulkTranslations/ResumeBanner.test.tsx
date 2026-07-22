import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunResumeSummary } from '../../engine/report';
import { ResumeBanner } from './ResumeBanner';

const summary: RunResumeSummary = {
  totalUnits: 20,
  writtenUnits: 8,
  remainingUnits: 12,
  resumeFromRecordId: 'r9',
  models: [
    {
      itemTypeId: 'm-product',
      totalRecords: 6,
      completedRecords: 2,
      totalUnits: 12,
      writtenUnits: 5,
      remainingUnits: 7,
    },
    {
      itemTypeId: 'm-article',
      totalRecords: 4,
      completedRecords: 1,
      totalUnits: 8,
      writtenUnits: 3,
      remainingUnits: 5,
    },
  ],
};

describe('ResumeBanner', () => {
  it('shows the overall and per-model progress with friendly model names', () => {
    render(
      <ResumeBanner
        summary={summary}
        resolveModelName={(id) => (id === 'm-product' ? 'Product' : 'Article')}
        onResume={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/8 of 20 translations done/i)).toBeTruthy();
    expect(screen.getByText(/12 remaining/i)).toBeTruthy();
    expect(screen.getByText('Product')).toBeTruthy();
    expect(screen.getByText('Article')).toBeTruthy();
    expect(screen.getByText(/5\/12 translated/)).toBeTruthy();
  });

  it('fires onResume and onDismiss', () => {
    const onResume = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ResumeBanner summary={summary} onResume={onResume} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
