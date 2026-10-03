import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScanReport } from '../types';
import { PanelNotes } from './PanelNotes';

describe('PanelNotes large warning lists', () => {
  it.each([
    0, 1,
  ])('bounds warning rendering after %i records were read', (recordsScanned) => {
    const report: ScanReport = {
      state: 'partial',
      startedAt: '2026-10-02T00:00:00Z',
      recordsScanned,
      discovering: false,
      scope: 'Current form',
      groups: [],
      warnings: Array.from({ length: 501 }, (_, i) => `Issue ${i}`),
    };
    render(<PanelNotes report={report} running={false} uiLocale="en" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Browse 501 issues' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    const pages = screen.getByRole('navigation', { name: 'Content issues' });
    for (let page = 1; page < 11; page += 1)
      fireEvent.click(within(pages).getByRole('button', { name: 'Next »' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Issue 500')).toBeInTheDocument();
    expect(
      within(pages).getByRole('button', { name: 'Next »' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer issues' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
