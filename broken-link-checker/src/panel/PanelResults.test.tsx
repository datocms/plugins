import { render, screen } from '@testing-library/react';
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
