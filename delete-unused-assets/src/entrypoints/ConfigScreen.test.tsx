// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionProgress,
  DeletionResult,
  deleteUnusedAssets,
  discoverUnusedAssets,
  UnusedAsset,
} from '../utils/unusedAssets';
import ConfigScreen from './ConfigScreen';

const mocks = vi.hoisted(() => ({
  discover: vi.fn<typeof discoverUnusedAssets>(),
  delete: vi.fn<typeof deleteUnusedAssets>(),
  openConfirm: vi.fn<(options: unknown) => Promise<unknown>>(),
  notice: vi.fn<(message: string) => Promise<void>>(),
}));

vi.mock('../utils/unusedAssets', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discoverUnusedAssets: mocks.discover,
  deleteUnusedAssets: mocks.delete,
}));

// jsdom has no layout: the components only need these to exist.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
vi.stubGlobal('matchMedia', (media: string) => ({
  matches: false,
  media,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
}));

function makeAssets(count: number): UnusedAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${index}`,
    filename: `image-${index}.jpg`,
    url: `https://assets.example.test/image-${index}.jpg`,
    size: 2_048,
  }));
}

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

function context(
  overrides: Record<string, unknown> = {},
): RenderConfigScreenCtx {
  return {
    mode: 'renderConfigScreen',
    currentUserAccessToken: 'synthetic-token',
    environment: 'main',
    cmaBaseUrl: undefined,
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    ui: { locale: 'en' },
    site: { attributes: { internal_domain: null } },
    notice: mocks.notice,
    alert: vi.fn(),
    customToast: vi.fn(),
    navigateTo: vi.fn(),
    openConfirm: mocks.openConfirm,
    updateHeight: vi.fn(),
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    ...overrides,
  } as unknown as RenderConfigScreenCtx;
}

// Opens the screen and clicks the scan button.
function renderScanned(ctx = context()) {
  const rendered = render(<ConfigScreen ctx={ctx} />);
  fireEvent.click(button('Scan for unused assets'));
  return rendered;
}

async function renderReady(assets: UnusedAsset[]) {
  mocks.discover.mockResolvedValue(assets);
  const rendered = renderScanned();
  await screen.findByText('Deletion is permanent');
  return rendered;
}

// Role queries are slow on long lists, so these tests query by text and label.
const links = () =>
  document.querySelectorAll('a[href^="https://assets.example.test/"]');

const button = (label: string) => {
  const element = screen.getByText(label).closest('button');
  if (!element) throw new Error(`No button "${label}"`);
  return element;
};

const queryButton = (label: string) =>
  screen.queryByText(label)?.closest('button') ?? null;

// The element named by an aria-label (faster than getByLabelText, which also
// resolves the aria-labelledby of every row checkbox).
function labelled(label: string) {
  const element = document.querySelector(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No element labelled "${label}"`);
  return element;
}

// The row checkbox is named by the first cell of its row: the filename.
function rowCheckbox(filename: string) {
  const cell = screen.getByText(filename).closest('[id]');
  const checkbox = document.querySelector(
    `input[aria-labelledby="${cell?.id}"]`,
  );
  if (!checkbox) throw new Error(`No checkbox for ${filename}`);
  return checkbox;
}

const clickDelete = () =>
  act(async () => {
    fireEvent.click(button('Delete'));
  });

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
  mocks.openConfirm.mockResolvedValue('delete');
  mocks.notice.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('ConfigScreen', () => {
  it('waits for a click before scanning', () => {
    render(<ConfigScreen ctx={context()} />);
    expect(button('Scan for unused assets')).toBeTruthy();
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it('shows the empty state without offering deletion', async () => {
    renderScanned();
    expect(screen.getByRole('status').textContent).toContain(
      'Looking for unused assets',
    );
    expect(await screen.findByText('No unused assets')).toBeTruthy();
    expect(queryButton('Delete')).toBeNull();
    fireEvent.click(button('Scan again'));
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });

  it('asks for the API token permission without scanning', () => {
    render(<ConfigScreen ctx={context({ currentUserAccessToken: null })} />);
    expect(screen.getByRole('alert').textContent).toContain(
      'grant this plugin permission to make API calls',
    );
    expect(queryButton('Scan for unused assets')).toBeNull();
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it('does not offer deletion after failed discovery', async () => {
    mocks.discover.mockRejectedValueOnce(new Error('network'));
    renderScanned();
    expect(await screen.findByText("Couldn't find unused assets")).toBeTruthy();
    expect(screen.getByText('network')).toBeTruthy();
    expect(queryButton('Delete')).toBeNull();
    fireEvent.click(button('Try again'));
    expect(await screen.findByText('No unused assets')).toBeTruthy();
  });

  it('pages the list 100 at a time', async () => {
    await renderReady(makeAssets(201));
    expect(screen.getByText('201 assets')).toBeTruthy();
    expect(links()).toHaveLength(100);
    // A middle page: the last page's clamp would hide an off-by-one.
    fireEvent.click(labelled('Go to page 2'));
    expect(links()).toHaveLength(100);
    expect(links()[0]?.textContent).toBe('image-100.jpg');
    expect(labelled('Go to page 2').getAttribute('aria-current')).toBe('page');
    fireEvent.click(labelled('Go to page 3'));
    expect(links()).toHaveLength(1);
    expect(labelled('Next page')).toHaveProperty('disabled', true);
  });

  it('filters by filename and selects only the matches', async () => {
    mocks.delete.mockResolvedValue(result(88));
    await renderReady(makeAssets(150));
    fireEvent.click(labelled('Filter Unused assets'));
    fireEvent.change(labelled('Type something…'), {
      target: { value: ' IMAGE-1 ' },
    });

    // image-1, image-10..19 and image-100..149 match.
    expect(links()).toHaveLength(61);
    expect(screen.getByText('61 of 150 assets')).toBeTruthy();
    fireEvent.click(labelled('Select all rows'));
    expect(screen.getByText(/^89 of 150 assets selected/)).toBeTruthy();

    fireEvent.click(labelled('Close the filter'));
    expect(links()).toHaveLength(100);
    fireEvent.click(rowCheckbox('image-0.jpg'));
    expect(screen.getByText(/^88 of 150 assets selected/)).toBeTruthy();
    await clickDelete();
    expect(mocks.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete 88 assets?' }),
    );
    const deleted = mocks.delete.mock.calls[0]?.[1] ?? [];
    expect(deleted).toHaveLength(88);
    expect(deleted.some((asset) => asset.id === 'asset-0')).toBe(false);
  });

  it('shows only the blank slate when the filter matches nothing', async () => {
    await renderReady(makeAssets(3));
    fireEvent.click(labelled('Filter Unused assets'));
    fireEvent.change(labelled('Type something…'), {
      target: { value: 'nothing' },
    });
    expect(screen.getByText('No results')).toBeTruthy();
    expect(screen.queryByText('Deletion is permanent')).toBeNull();
    expect(links()).toHaveLength(0);
  });

  it('opens the filter with F and closes it with Escape', async () => {
    await renderReady(makeAssets(3));
    const checkbox = rowCheckbox('image-0.jpg');
    act(() => {
      (checkbox as HTMLElement).focus();
      fireEvent.keyDown(checkbox, { key: 'f', code: 'KeyF' });
    });
    const field = labelled('Type something…');
    fireEvent.change(field, { target: { value: 'image-1' } });
    expect(links()).toHaveLength(1);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.querySelector('[aria-label="Type something…"]')).toBeNull();
    expect(links()).toHaveLength(3);
  });

  it('keeps the selection when a click opens the file', async () => {
    await renderReady(makeAssets(3));
    fireEvent.click(screen.getByText('image-1.jpg'));
    expect(screen.getByText(/^3 of 3 assets selected/)).toBeTruthy();
  });

  it('clears and selects every asset across pages', async () => {
    await renderReady(makeAssets(150));
    expect(screen.getByText(/^150 of 150 assets selected/)).toBeTruthy();
    fireEvent.click(labelled('Clear selection'));
    await waitFor(() =>
      expect(screen.queryByText(/assets selected/)).toBeNull(),
    );
    fireEvent.click(labelled('Select all rows'));
    expect(screen.getByText(/^150 of 150 assets selected/)).toBeTruthy();
  });

  it('ignores Delete on the bar that slides out', async () => {
    await renderReady(makeAssets(3));
    const deleteButton = button('Delete');
    fireEvent.click(labelled('Clear selection'));
    await act(async () => {
      fireEvent.click(deleteButton);
    });
    expect(mocks.openConfirm).not.toHaveBeenCalled();
  });

  it('does nothing when the confirm is cancelled', async () => {
    mocks.openConfirm.mockResolvedValue(false);
    await renderReady(makeAssets(2));
    await clickDelete();
    expect(mocks.openConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Deletion is permanent')).toBeTruthy();
  });

  it('shows progress, then a success summary', async () => {
    const deletion = pendingDeletion();
    await renderReady(makeAssets(400));
    const deleteButton = button('Delete');
    await act(async () => {
      fireEvent.click(deleteButton);
      fireEvent.click(deleteButton);
    });
    expect(mocks.openConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Deleting 400 assets…')).toBeTruthy();
    // No batch has ended yet: the bar shows the known share, 0.
    const bar = labelled('Deleting 400 assets…');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText('0%')).toBeTruthy();

    deletion.report(result(400, { processed: 100, deleted: 98, skipped: 2 }));
    expect(screen.getByText('25%')).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(countFor('Deleted')).toBe('98');
    expect(countFor('Skipped (in use or already removed)')).toBe('2');

    await deletion.finish(result(400));
    expect(mocks.notice).toHaveBeenCalledWith(
      '400 assets were permanently deleted from your project.',
    );
    expect(countFor('Assets deleted')).toBe('400');
    expect(countFor('Storage freed')).toBe('800KB');

    // A new scan starts over from the remaining unused assets.
    mocks.discover.mockResolvedValue([]);
    fireEvent.click(button('Scan again'));
    expect(await screen.findByText('No unused assets')).toBeTruthy();
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });

  it('stops after the current batch without claiming success', async () => {
    const deletion = pendingDeletion();
    await renderReady(makeAssets(101));
    await clickDelete();
    act(() => {
      fireEvent.click(button('Stop'));
    });
    expect(deletion.signal()?.aborted).toBe(true);
    // Busy until the run ends, so Stop can't be clicked twice.
    expect(button('Stop').disabled).toBe(true);
    expect(
      screen.getByText('Stopping after the current batch finishes…'),
    ).toBeTruthy();
    await deletion.finish(
      result(101, { cancelled: true, processed: 100, deleted: 100 }),
    );
    expect(screen.getByText('Deletion stopped')).toBeTruthy();
    expect(countFor('Not processed')).toBe('1');
    expect(mocks.notice).not.toHaveBeenCalled();
  });

  it('sends no notice when every asset was skipped', async () => {
    mocks.delete.mockResolvedValue(result(2, { deleted: 0, skipped: 2 }));
    await renderReady(makeAssets(2));
    await clickDelete();
    expect(await screen.findByText('Assets deleted')).toBeTruthy();
    expect(countFor('Assets deleted')).toBe('0');
    expect(countFor('Skipped (in use or already removed)')).toBe('2');
    expect(mocks.notice).not.toHaveBeenCalled();
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
    await clickDelete();
    expect(await screen.findByText("Deletion didn't complete")).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('API error');
    expect(countFor('Storage freed (estimated)')).toBe('194KB');
    expect(countFor('Failed')).toBe('1');
    expect(countFor('Not processed')).toBe('1');
  });

  it('ignores a deletion that finishes after unmount', async () => {
    const deletion = pendingDeletion();
    const rendered = await renderReady(makeAssets(1));
    await clickDelete();
    rendered.unmount();
    expect(deletion.signal()?.aborted).toBe(true);
    await deletion.finish(result(1));
    expect(mocks.notice).not.toHaveBeenCalled();
  });
});
