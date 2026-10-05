// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import type { MouseEventHandler, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionProgress,
  DeletionResult,
  deleteUnusedAssets,
  discoverUnusedAssets,
  UnusedAsset,
} from '../utils/unusedAssets';
import CustomModal from './CustomModal';

const mocks = vi.hoisted(() => ({
  discover: vi.fn<typeof discoverUnusedAssets>(),
  delete: vi.fn<typeof deleteUnusedAssets>(),
  resolve: vi.fn<(value: unknown) => Promise<void>>(),
}));

vi.mock('../utils/unusedAssets', () => ({
  discoverUnusedAssets: mocks.discover,
  deleteUnusedAssets: mocks.delete,
}));
vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Spinner: () => <span aria-label="Loading" />,
}));

function makeAssets(count: number): UnusedAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${index}`,
    filename: `image-${index}.jpg`,
    url: `https://assets.example.test/image-${index}.jpg`,
    size: 2_048,
  }));
}

const DELETE = /^Delete \d/;

function result(
  total: number,
  overrides: Partial<DeletionResult> = {},
): DeletionResult {
  return {
    total,
    processed: total,
    deleted: total,
    skipped: 0,
    failed: 0,
    freedBytes: (overrides.deleted ?? total) * 2_048,
    freedBytesEstimated: false,
    cancelled: false,
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}): RenderModalCtx {
  return {
    currentUserAccessToken: 'synthetic-token',
    environment: 'main',
    cmaBaseUrl: undefined,
    resolve: mocks.resolve,
    ...overrides,
  } as unknown as RenderModalCtx;
}

async function renderReady(assets: UnusedAsset[]) {
  mocks.discover.mockResolvedValue(assets);
  const rendered = render(<CustomModal ctx={context()} />);
  await screen.findByText(DELETE);
  return rendered;
}

// Role queries are slow on long lists, so these tests query by label.
const links = () => document.querySelectorAll('a');

// Resolves the deletion when `finish` is called, after reporting progress.
function pendingDeletion() {
  let finish: (value: DeletionResult) => void = () => {};
  let report: (progress: DeletionProgress) => void = () => {};
  mocks.delete.mockImplementation((_client, assets, options) => {
    report = (progress) => options?.onProgress?.(progress);
    report(result(assets.length, { processed: 0, deleted: 0 }));
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  return {
    finish: (value: DeletionResult) => act(async () => finish(value)),
    report: (progress: DeletionProgress) => act(() => report(progress)),
    signal: () => mocks.delete.mock.calls[0]?.[2]?.signal,
  };
}

function countFor(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.discover.mockResolvedValue([]);
  mocks.resolve.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('CustomModal', () => {
  it('shows the empty state without offering deletion', async () => {
    render(<CustomModal ctx={context()} />);
    expect(
      await screen.findByText('There are no unused assets in your library'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('asks for the API token permission without scanning', async () => {
    render(<CustomModal ctx={context({ currentUserAccessToken: null })} />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'needs access to your API token',
    );
    expect(mocks.discover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.resolve).toHaveBeenCalledWith('');
  });

  it('does not offer deletion after failed discovery', async () => {
    mocks.discover.mockRejectedValue(new Error('network'));
    render(<CustomModal ctx={context()} />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't find unused assets",
    );
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('pages the list 100 at a time', async () => {
    await renderReady(makeAssets(201));
    expect(links()).toHaveLength(100);
    fireEvent.click(screen.getByLabelText('Page 3'));
    expect(links()).toHaveLength(1);
    expect(screen.getByText(/Showing 201–201 of 201 assets/)).toBeTruthy();
    expect(screen.getByText(/^Next/).hasAttribute('disabled')).toBe(true);
  });

  it('filters by filename and selects only the matches', async () => {
    mocks.delete.mockResolvedValue(result(88));
    await renderReady(makeAssets(150));
    const search = screen.getByLabelText('Search assets');
    fireEvent.change(search, { target: { value: ' IMAGE-1 ' } });

    // image-1, image-10..19 and image-100..149 match.
    expect(links()).toHaveLength(61);
    fireEvent.click(screen.getByLabelText('Select all matches'));
    expect(screen.getByText(/^89 of 150 selected/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Clear search'));
    fireEvent.click(screen.getByLabelText('Select image-0.jpg'));
    fireEvent.click(screen.getByText('Delete 88 assets'));
    const deleted = mocks.delete.mock.calls[0]?.[1] ?? [];
    expect(deleted).toHaveLength(88);
    expect(deleted.some((asset) => asset.id === 'asset-0')).toBe(false);
    await act(async () => {});
  });

  it('selects and clears every asset across pages', async () => {
    await renderReady(makeAssets(150));
    const selectAll = screen.getByLabelText('Select all');
    fireEvent.click(selectAll);
    expect(screen.getByText(/^0 of 150 selected/)).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Select assets to delete' })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByLabelText('Select image-1.jpg'));
    expect(selectAll).toHaveProperty('indeterminate', true);
    fireEvent.click(selectAll);
    expect(screen.getByText(/^150 of 150 selected/)).toBeTruthy();
  });

  it('shows progress, then a success summary', async () => {
    const deletion = pendingDeletion();
    await renderReady(makeAssets(400));
    const deleteButton = screen.getByRole('button', { name: DELETE });
    act(() => {
      fireEvent.click(deleteButton);
      fireEvent.click(deleteButton);
    });
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Deleting 400 assets…')).toBeTruthy();

    deletion.report(result(400, { processed: 100, deleted: 98, skipped: 2 }));
    expect(screen.getByText('25%')).toBeTruthy();
    expect(countFor('Deleted')).toBe('98');
    expect(countFor('Skipped (in use or already removed)')).toBe('2');

    await deletion.finish(result(400));
    expect(screen.getByText('Assets successfully deleted!')).toBeTruthy();
    expect(countFor('Storage freed')).toBe('800KB');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('stops after the current batch without claiming success', async () => {
    const deletion = pendingDeletion();
    await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(deletion.signal()?.aborted).toBe(true);
    expect(
      screen.getByText('Stopping after the current batch finishes…'),
    ).toBeTruthy();
    await deletion.finish(
      result(101, { cancelled: true, processed: 100, deleted: 100 }),
    );
    expect(screen.getByText('Deletion stopped')).toBeTruthy();
    expect(countFor('Not processed')).toBe('1');
  });

  it('summarizes an incomplete deletion', async () => {
    mocks.delete.mockResolvedValue(
      result(101, {
        processed: 100,
        deleted: 97,
        skipped: 2,
        failed: 1,
        freedBytesEstimated: true,
        error: 'Deletion stopped because of an API error.',
      }),
    );
    await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    expect(await screen.findByText("Deletion didn't complete")).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('API error');
    expect(countFor('Storage freed (estimated)')).toBe('194KB');
    expect(countFor('Failed')).toBe('1');
    expect(countFor('Not processed')).toBe('1');
  });

  it('ignores a deletion that finishes after unmount', async () => {
    const deletion = pendingDeletion();
    const rendered = await renderReady(makeAssets(1));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    rendered.unmount();
    expect(deletion.signal()?.aborted).toBe(true);
    await deletion.finish(result(1));
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
