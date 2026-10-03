import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LinkOccurrence, ScanReport } from '../types';
import { PanelResults } from './PanelResults';

function report(count: number): ScanReport {
  const occurrences: LinkOccurrence[] = Array.from(
    { length: count },
    (_, i) => ({
      id: `place-${i}`,
      recordId: 'record-1',
      recordTitle: 'Complex record',
      modelId: 'article',
      modelName: 'Article',
      fieldPath: 'body.en',
      fieldLabel: `Link ${i}`,
      locale: 'en',
      blockPath: [],
      url: 'https://example.test/shared',
    }),
  );
  return {
    state: 'complete',
    startedAt: '2026-10-02T00:00:00Z',
    recordsScanned: 1,
    discovering: false,
    scope: 'Current form',
    warnings: [],
    groups: [
      {
        key: 'shared',
        prepared: {
          key: 'shared',
          url: 'https://example.test/shared',
          status: 'queued',
          message: '',
        },
        result: { key: 'shared', url: '', status: 'broken', message: '' },
        stale: false,
        occurrences,
      },
    ],
  };
}

describe('PanelResults large location lists', () => {
  it('keeps each page bounded while every location remains accessible', async () => {
    const user = userEvent.setup();
    const goToField = vi.fn();
    render(
      <PanelResults
        report={report(2_000)}
        showLocale
        uiLocale="en"
        onGoToField={goToField}
      />,
    );
    expect(
      screen.getAllByRole('button', { name: /^Go to field:/ }),
    ).toHaveLength(5);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Browse 2,000 places' }),
    );
    expect(
      screen.getAllByRole('button', { name: /^Go to field:/ }),
    ).toHaveLength(50);
    const pages = screen.getByRole('navigation', { name: 'Link places' });
    expect(within(pages).getByText('1 of 40')).toBeInTheDocument();
    await user.click(within(pages).getByRole('button', { name: 'Next »' }));
    expect(
      screen.queryByRole('button', { name: 'Go to field: Link 0, English' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Go to field: Link 50, English' }),
    );
    expect(goToField).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'place-50' }),
    );
    for (let page = 2; page < 40; page += 1) {
      fireEvent.click(within(pages).getByRole('button', { name: 'Next »' }));
    }
    expect(
      screen.getAllByRole('button', { name: /^Go to field:/ }),
    ).toHaveLength(50);
    expect(
      within(pages).getByRole('button', { name: 'Next »' }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Go to field: Link 1999, English' }),
    );
    expect(goToField).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'place-1999' }),
    );
  });

  it('preserves the existing expansion for small location lists', async () => {
    const user = userEvent.setup();
    render(
      <PanelResults
        report={report(8)}
        showLocale={false}
        uiLocale="en"
        onGoToField={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Show 3 more places' }),
    );
    expect(
      screen.getAllByRole('button', { name: /^Go to field:/ }),
    ).toHaveLength(8);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
