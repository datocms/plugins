import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import { panelContext } from '../test/fixtures';
import type { ScanReport } from '../types';
import { PanelNotes } from './PanelNotes';

function partialReport(recordsScanned: number, warnings: string[]): ScanReport {
  return {
    state: 'partial',
    startedAt: '2026-10-02T00:00:00Z',
    recordsScanned,
    discovering: false,
    scope: 'Current form',
    groups: [],
    warnings,
  };
}

describe('PanelNotes', () => {
  it.each([
    0, 1,
  ])('bounds warning rendering after %i records were read', async (recordsScanned) => {
    const user = userEvent.setup();
    const warnings = Array.from({ length: 501 }, (_, i) => `Issue ${i}`);
    renderInCanvas(
      <PanelNotes
        report={partialReport(recordsScanned, warnings)}
        running={false}
        uiLocale="en"
      />,
      { ctx: panelContext() },
    );
    const callout = screen.getByRole('alert');
    expect(
      within(callout).getByText("Some content couldn't be read"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // The list and its controls sit under the callout, never in it.
    expect(callout).not.toContainElement(screen.getByRole('list'));
    const browse = screen.getByRole('button', {
      name: 'Browse 498 more fields',
    });
    expect(callout).not.toContainElement(browse);
    await user.click(browse);
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    const pages = screen.getByRole('navigation', {
      name: 'Content issues pagination',
    });
    for (let page = 1; page < 11; page += 1)
      fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Issue 500')).toBeInTheDocument();
    expect(
      within(pages).getByRole('button', { name: 'Next page' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Show fewer fields' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows every issue of a short list without pages', async () => {
    const user = userEvent.setup();
    renderInCanvas(
      <PanelNotes
        report={partialReport(1, ['A', 'B', 'C', 'D', 'E'])}
        running={false}
        uiLocale="en"
      />,
      { ctx: panelContext() },
    );
    await user.click(
      screen.getByRole('button', { name: 'Show 2 more fields' }),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('needs no callout for a cancel, and says nothing while running', () => {
    const report: ScanReport = {
      ...partialReport(1, []),
      state: 'cancelled',
      stale: true,
    };
    const { rerender } = renderInCanvas(
      <PanelNotes report={report} running={false} uiLocale="en" />,
      { ctx: panelContext() },
    );
    // The headline counts the links that weren't checked.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Results out of dateThe record changed after this check. Check again to refresh the results.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<PanelNotes report={report} running uiLocale="en" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('titles a canceled check that also left content unread', () => {
    const report: ScanReport = {
      ...partialReport(1, ['Body']),
      state: 'cancelled',
    };
    renderInCanvas(
      <PanelNotes report={report} running={false} uiLocale="en" />,
      { ctx: panelContext() },
    );
    const callout = screen.getByRole('alert');
    expect(within(callout).getByText('Check canceled')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Body');
  });
});
