import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LinkGroup } from '../types';
import { UsedInPanel } from './UsedInPanel';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);

function sharedUrl(recordCount: number, places = 1): LinkGroup {
  const url = 'https://shared.example/';
  return {
    key: url,
    prepared: { key: url, url, status: 'queued', message: 'Queued' },
    result: { key: url, url, status: 'broken', message: 'HTTP 404' },
    stale: false,
    occurrences: Array.from({ length: recordCount * places }, (_, index) => {
      const record = Math.floor(index / places);
      return {
        id: `place-${index}`,
        url,
        recordId: `record-${record}`,
        recordTitle: `Record ${record}`,
        modelId: `model-${record % 30}`,
        modelName: `Model ${record % 30}`,
        fieldPath: 'body.en',
        fieldLabel: 'Body',
        locale: 'en',
        blockPath: ['Content', 'Block'],
      };
    }),
  };
}

function show(group: LinkGroup) {
  const onOpenRecord = vi.fn();
  render(
    <UsedInPanel
      group={group}
      changedRecordIds={new Set(['record-50'])}
      showLocale
      uiLocale="en"
      onOpenRecord={onOpenRecord}
    />,
  );
  return onOpenRecord;
}

describe('UsedInPanel at scale', () => {
  it('keeps the existing expansion for small lists', async () => {
    const user = userEvent.setup();
    show(sharedUrl(51));
    expect(
      screen.getAllByRole('button', { name: /^Open record/ }),
    ).toHaveLength(50);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Show 1 more record' }),
    );
    expect(
      screen.getAllByRole('button', { name: /^Open record/ }),
    ).toHaveLength(51);
    expect(
      screen.queryByRole('button', { name: /^Show/ }),
    ).not.toBeInTheDocument();
  });
});
