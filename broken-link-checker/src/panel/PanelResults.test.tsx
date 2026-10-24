import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import { panelContext } from '../test/fixtures';
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

function renderResults(count: number) {
  const onGoToField = vi.fn();
  renderInCanvas(
    <PanelResults
      report={report(count)}
      showLocale={false}
      uiLocale="en"
      onGoToField={onGoToField}
    />,
    { ctx: panelContext() },
  );
  return onGoToField;
}

const PLACE = /^Link \d+\s*,\s*go to field$/;

describe('PanelResults places', () => {
  it('preserves the existing expansion for small location lists', async () => {
    const user = userEvent.setup();
    const onGoToField = renderResults(8);
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(5);
    await user.click(
      screen.getByRole('button', { name: 'Show 3 more places' }),
    );
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(8);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /^Link 7\s*,\s*go to field$/ }),
    );
    expect(onGoToField).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'place-7' }),
    );
  });

  it('pages a large location list 50 places at a time', async () => {
    const user = userEvent.setup();
    renderResults(201);
    await user.click(screen.getByRole('button', { name: 'Browse 201 places' }));
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(50);
    // Named after its URL: each URL's pages are a landmark of their own.
    const pages = screen.getByRole('navigation', {
      name: 'Places of https://example.test/shared pagination',
    });
    // Compact pages show 3 numbers at a time: "Next" reaches the last one.
    for (let page = 1; page < 5; page += 1)
      fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(
      within(pages).getByRole('button', { name: 'Go to page 5' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /^Link 200\s*,\s*go to field$/ }),
    ).toBeInTheDocument();
  });
});
