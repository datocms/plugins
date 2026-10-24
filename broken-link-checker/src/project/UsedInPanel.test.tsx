import { fireEvent, screen, within } from '@testing-library/react';
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
        recordTitle: `Record ${record}`,
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

/** The rows that open a record, named by their model and title, then what they do. */
function recordRows() {
  return screen.queryAllByRole('button', {
    name: /^Model \d+\s*Record \d+.*,\s*open record$/,
  });
}

describe('UsedInPanel', () => {
  it('keeps the existing expansion for small lists', async () => {
    const user = userEvent.setup();
    show(sharedUrl(51));
    expect(recordRows()).toHaveLength(50);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Show 1 more record' }),
    );
    expect(recordRows()).toHaveLength(51);
    expect(
      screen.queryByRole('button', { name: /^Show/ }),
    ).not.toBeInTheDocument();
  });

  it('pages the records 50 at a time above 200 records', () => {
    show(sharedUrl(201));
    expect(recordRows()).toHaveLength(50);
    expect(
      screen.queryByRole('button', { name: /^Show/ }),
    ).not.toBeInTheDocument();
    const pages = screen.getByRole('navigation', {
      name: 'Records using this URL pagination',
    });
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(recordRows()).toHaveLength(50);
    expect(
      screen.getByRole('button', {
        name: /^Model 20\s*Record 50\s*,\s*open record$/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Record 0$/ }),
    ).not.toBeInTheDocument();
  });

  it('opens a record from its row and lists its places under it', async () => {
    const user = userEvent.setup();
    const { onOpenRecord } = show(sharedUrl(1, 7), { changed: ['record-0'] });
    expect(
      screen.getByRole('heading', { name: /^Records\s*1$/ }),
    ).toBeInTheDocument();
    const row = screen.getByRole('button', {
      name: /^Model 0\s*Record 0\s*Content changed\s*,\s*open record$/,
    });
    // Five places, then how many more there are.
    expect(
      screen.getAllByText('Body, English, in Content > Block'),
    ).toHaveLength(5);
    expect(screen.getByText('and 2 more places')).toBeInTheDocument();
    await user.click(row);
    expect(onOpenRecord).toHaveBeenCalledWith('record-0');
  });

  it('links a place to the spelling it uses, and names no locale on a single-locale site', () => {
    show(
      sharedUrl(1, 1, (occurrence) => ({
        ...occurrence,
        url: `${LINK_URL}#pricing`,
      })),
      { showLocale: false },
    );
    expect(screen.getByText('Body, in Content > Block')).toBeInTheDocument();
    const variant = screen.getByRole('link', {
      name: `${LINK_URL}#pricing (opens in a new tab)`,
    });
    expect(variant).toHaveAttribute('href', `${LINK_URL}#pricing`);
    expect(variant.parentElement).toHaveTextContent(
      `Links to ${LINK_URL}#pricing`,
    );
  });

  it('shows a record without an ID as a row that opens nothing', () => {
    show(
      sharedUrl(1, 1, ({ recordId: _recordId, ...occurrence }) => occurrence),
    );
    expect(screen.getByText('Record 0')).toBeInTheDocument();
    expect(recordRows()).toHaveLength(0);
  });

  it('tells apart records without an ID that share a title in two models', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    show(
      sharedUrl(2, 1, ({ recordId: _recordId, ...occurrence }) => ({
        ...occurrence,
        recordTitle: 'Untitled',
        modelName: 'Page',
      })),
    );
    expect(screen.getAllByText('Untitled')).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('keeps its open state in the caller', async () => {
    const user = userEvent.setup();
    const { onToggle } = show(sharedUrl(1), { open: false });
    expect(screen.queryByText('Record 0')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Records/ }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
