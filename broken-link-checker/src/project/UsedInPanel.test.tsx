import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import type { LinkGroup, LinkOccurrence } from '../types';
import { UsedInPanel } from './UsedInPanel';

const LINK_URL = 'https://shared.example/';

function sharedUrl(
  recordCount: number,
  places = 1,
  change: (occurrence: LinkOccurrence) => LinkOccurrence = (o) => o,
): LinkGroup {
  return {
    key: LINK_URL,
    prepared: {
      key: LINK_URL,
      url: LINK_URL,
      status: 'queued',
      message: 'Queued',
    },
    result: {
      key: LINK_URL,
      url: LINK_URL,
      status: 'broken',
      message: 'HTTP 404',
    },
    stale: false,
    occurrences: Array.from({ length: recordCount * places }, (_, index) => {
      const record = Math.floor(index / places);
      return change({
        id: `place-${index}`,
        url: LINK_URL,
        recordId: `record-${record}`,
        modelId: `model-${record % 30}`,
        modelName: `Model ${record % 30}`,
        fieldPath: 'body.en',
        fieldLabel: 'Body',
        locale: 'en',
        blockPath: ['Content', 'Block'],
      });
    }),
  };
}

function show(
  group: LinkGroup,
  {
    changed = [],
    showLocale = true,
    open = true,
  }: { changed?: string[]; showLocale?: boolean; open?: boolean } = {},
) {
  const onOpenRecord = vi.fn();
  const onToggle = vi.fn();
  renderInCanvas(
    <UsedInPanel
      group={group}
      changedRecordIds={new Set(changed)}
      showLocale={showLocale}
      uiLocale="en"
      collapse={{ open, onToggle }}
      onOpenRecord={onOpenRecord}
    />,
  );
  return { onOpenRecord, onToggle };
}

/**
 * The rows that open a record, named by their model and title as the host
 * presents them (see the fixtures), their places, then what they do.
 */
function recordRows() {
  return screen.queryAllByRole('button', {
    name: /^Page\s*Title of record-\d+.*,\s*open record$/,
  });
}

/** The rows ask the host for their records once they render. */
async function loaded(count: number) {
  await waitFor(() => expect(recordRows()).toHaveLength(count));
}

describe('UsedInPanel', () => {
  it('keeps the existing expansion for small lists', async () => {
    const user = userEvent.setup();
    show(sharedUrl(51));
    await loaded(50);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Show 1 more record' }),
    );
    await loaded(51);
    expect(
      screen.queryByRole('button', { name: /^Show/ }),
    ).not.toBeInTheDocument();
  });

  it('pages the records 50 at a time above 200 records', async () => {
    show(sharedUrl(201));
    await loaded(50);
    expect(
      screen.queryByRole('button', { name: /^Show/ }),
    ).not.toBeInTheDocument();
    const pages = screen.getByRole('navigation', {
      name: 'Records using this link pagination',
    });
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(
      await screen.findByRole('button', {
        name: /^Page\s*Title of record-50\s*Body, English, in Content > Block\s*,\s*open record$/,
      }),
    ).toBeInTheDocument();
    expect(recordRows()).toHaveLength(50);
    expect(
      screen.queryByRole('button', { name: /Title of record-0\b/ }),
    ).not.toBeInTheDocument();
  });

  it('opens a record from its row and lists its first place under its title, then how many more', async () => {
    const user = userEvent.setup();
    const { onOpenRecord } = show(sharedUrl(1, 7), { changed: ['record-0'] });
    expect(
      screen.getByRole('heading', { name: /^Records\s*1$/ }),
    ).toBeInTheDocument();
    const row = await screen.findByRole('button', {
      name: /^Page\s*Title of record-0\s*Content changed\s*Body, English, in Content > Block\s*and 6 more places\s*,\s*open record$/,
    });
    await user.click(row);
    expect(onOpenRecord).toHaveBeenCalledWith('record-0');
  });

  it('lists every place when the record has two', async () => {
    show(sharedUrl(1, 2));
    await loaded(1);
    expect(
      screen.getAllByText('Body, English, in Content > Block'),
    ).toHaveLength(2);
    expect(screen.queryByText(/more place/)).not.toBeInTheDocument();
  });

  it('names the spelling a place links to, and no locale on a single-locale site', async () => {
    show(
      sharedUrl(1, 1, (occurrence) => ({
        ...occurrence,
        url: `${LINK_URL}#pricing`,
      })),
      { showLocale: false },
    );
    await loaded(1);
    expect(
      screen.getByText(
        `Body, in Content > Block · links to ${LINK_URL}#pricing`,
      ),
    ).toBeInTheDocument();
  });

  it('shows a record without an ID as a row that opens nothing', () => {
    show(
      sharedUrl(1, 1, ({ recordId: _recordId, ...occurrence }) => occurrence),
    );
    expect(screen.getByText('New record')).toBeInTheDocument();
    expect(screen.getByText('Model 0')).toBeInTheDocument();
    expect(recordRows()).toHaveLength(0);
  });

  it('tells apart records without an ID in two models', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    show(
      sharedUrl(2, 1, ({ recordId: _recordId, ...occurrence }) => occurrence),
    );
    expect(screen.getAllByText('New record')).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('keeps its open state in the caller', async () => {
    const user = userEvent.setup();
    const { onToggle } = show(sharedUrl(1), { open: false });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Records/ }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
