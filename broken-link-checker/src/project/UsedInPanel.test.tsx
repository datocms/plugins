import { render, screen, within } from '@testing-library/react';
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

  it('keeps 50 rows and five places per record while browsing a large shared destination', async () => {
    const user = userEvent.setup();
    const open = show(sharedUrl(501, 13));
    const pages = within(
      screen.getByRole('navigation', { name: 'Records using this URL' }),
    );
    expect(
      screen.getAllByRole('button', { name: /^Open record/ }),
    ).toHaveLength(50);
    expect(document.querySelectorAll('.blc-record-row__place')).toHaveLength(
      250,
    );
    expect(pages.getByText('Page 1 of 11')).toBeInTheDocument();
    expect(pages.getByRole('button', { name: '« Previous' })).toBeDisabled();
    await user.click(pages.getByRole('button', { name: 'Next »' }));
    expect(
      screen.queryByRole('button', { name: 'Open record Record 0' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /^Open record/ }),
    ).toHaveLength(50);
    expect(document.querySelectorAll('.blc-record-row__place')).toHaveLength(
      250,
    );
    expect(pages.getByText('Page 2 of 11')).toBeInTheDocument();
    const changed = screen.getByRole('button', {
      name: 'Open record Record 50',
    });
    expect(changed).toHaveAccessibleDescription(/Content changed/);
    expect(changed).toHaveAccessibleDescription(/and 8 more places/);
    await user.click(changed);
    expect(open).toHaveBeenCalledWith('record-50');
    await user.click(pages.getByRole('button', { name: '« Previous' }));
    expect(
      screen.getByRole('button', { name: 'Open record Record 0' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /^Open record/ }),
    ).toHaveLength(50);
  });

  it('counts all places without rendering them when one record has many occurrences', () => {
    show(sharedUrl(1, 10_000));
    expect(document.querySelectorAll('.blc-record-row__place')).toHaveLength(5);
    expect(screen.getByText('and 9,995 more places')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open record Record 0' }),
    ).toHaveAccessibleDescription(/and 9,995 more places/);
  });
});
