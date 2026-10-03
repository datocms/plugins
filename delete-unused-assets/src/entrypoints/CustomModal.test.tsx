// @vitest-environment node

import type { RenderModalCtx } from 'datocms-plugin-sdk';
import type { JSDOM } from 'jsdom';
import { type MouseEventHandler, type ReactNode, StrictMode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { createAssetClient } from '../utils/assetClient';
import type {
  DeletionResult,
  deleteUnusedAssets,
  discoverUnusedAssets,
  UnusedAsset,
} from '../utils/unusedAssets';
import CustomModal from './CustomModal';

type TestingLibrary = typeof import('@testing-library/react/pure');

let act: TestingLibrary['act'];
let cleanup: TestingLibrary['cleanup'] | undefined;
let fireEvent: TestingLibrary['fireEvent'];
let render: TestingLibrary['render'];
let screen: TestingLibrary['screen'];
let dom: JSDOM | undefined;

// Load JSDOM after the worker handshake: importing it can exceed the pool's
// fixed startup deadline on a machine running many concurrent plugin checks.
beforeAll(async () => {
  const { JSDOM } = await import('jsdom');
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://plugin.example.test/',
  });
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Event',
    'MouseEvent',
    'Node',
    'Text',
    'Document',
    'DocumentFragment',
    'MutationObserver',
    'getComputedStyle',
  ] as const) {
    vi.stubGlobal(key, dom.window[key]);
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The pure entrypoint does not register hooks from within this beforeAll.
  ({ act, cleanup, fireEvent, render, screen } = await import(
    '@testing-library/react/pure'
  ));
}, 180_000);

afterAll(() => {
  cleanup?.();
  dom?.window.close();
  vi.unstubAllGlobals();
});

const mocks = vi.hoisted(() => ({
  createClient: vi.fn<typeof createAssetClient>(),
  discover: vi.fn<typeof discoverUnusedAssets>(),
  delete: vi.fn<typeof deleteUnusedAssets>(),
  notice: vi.fn<(message: string) => Promise<void>>(),
  resolve: vi.fn<(value: unknown) => Promise<void>>(),
}));

vi.mock('../utils/assetClient', () => ({
  createAssetClient: mocks.createClient,
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

function deferred<T>() {
  let resolve = (_value: T): void => {
    throw new Error('Deferred promise is not initialized');
  };
  let reject = (_reason: unknown): void => {
    throw new Error('Deferred promise is not initialized');
  };
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeAssets(count: number): UnusedAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${index}`,
    filename: `image-${index}.jpg`,
    url: `https://assets.example.test/image-${index}.jpg`,
    size: 2_048,
  }));
}

const largeAssets = makeAssets(10_000);
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
    missing: 0,
    failed: 0,
    uncertain: 0,
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
    notice: mocks.notice,
    resolve: mocks.resolve,
    ...overrides,
  } as unknown as RenderModalCtx;
}

async function renderReady(assets: UnusedAsset[]) {
  mocks.discover.mockResolvedValue(assets);
  const rendered = render(<CustomModal ctx={context()} />);
  await screen.findByRole('button', { name: DELETE });
  return rendered;
}

function countFor(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockImplementation(() => ({
    list: vi.fn(),
    destroy: vi.fn(),
  }));
  mocks.discover.mockResolvedValue([]);
  mocks.notice.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue(undefined);
});

afterEach(() => cleanup?.());

describe('CustomModal', () => {
  it('preserves the empty library state without offering deletion', async () => {
    render(<CustomModal ctx={context()} />);
    expect(
      await screen.findByText('There are no unused assets in your library'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Loading')).toBeNull();
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('guards missing tokens without making API calls', async () => {
    render(<CustomModal ctx={context({ currentUserAccessToken: null })} />);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This plugin needs access to your API token to find and delete unused assets.',
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.resolve).toHaveBeenCalledWith('');
  });

  it('ignores stale StrictMode discoveries and keeps the client stable on rerenders', async () => {
    const first = deferred<UnusedAsset[]>();
    const second = deferred<UnusedAsset[]>();
    mocks.discover
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const ctx = context();
    const rendered = render(
      <StrictMode>
        <CustomModal ctx={ctx} />
      </StrictMode>,
    );
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    const firstOptions = mocks.discover.mock.calls[0]?.[1];
    const secondOptions = mocks.discover.mock.calls[1]?.[1];
    expect(firstOptions?.signal?.aborted).toBe(true);
    expect(secondOptions?.signal?.aborted).toBe(false);

    await act(async () => second.resolve(makeAssets(2)));
    await act(async () => {
      firstOptions?.onProgress?.({
        scanned: 10_000,
        found: 10_000,
        total: 10_000,
      });
      first.resolve(largeAssets);
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByText(/Checking/)).toBeNull();

    const clientsCreated = mocks.createClient.mock.calls.length;
    rendered.rerender(
      <StrictMode>
        <CustomModal ctx={{ ...ctx }} />
      </StrictMode>,
    );
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(mocks.createClient).toHaveBeenCalledTimes(clientsCreated);
    rendered.unmount();
    expect(secondOptions?.signal?.aborted).toBe(true);
  });

  it('shows discovery counts only for a large library', async () => {
    const discovery = deferred<UnusedAsset[]>();
    mocks.discover.mockReturnValue(discovery.promise);
    render(<CustomModal ctx={context()} />);
    const options = mocks.discover.mock.calls[0]?.[1];
    act(() => options?.onProgress?.({ scanned: 100, found: 3, total: 100 }));
    expect(screen.queryByText(/Checking/)).toBeNull();
    act(() =>
      options?.onProgress?.({ scanned: 500, found: 23, total: 10_000 }),
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Checking 500 of 10,000 assets… 23 unused assets found.',
    );
    act(() =>
      options?.onProgress?.({
        scanned: 100,
        found: 5,
        total: 10_001,
        attempt: 2,
      }),
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Asset library changed; checking again (attempt 2 of 3)…',
    );
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
    await act(async () => discovery.resolve(makeAssets(23)));
  });

  it('preserves small confirmation and loading states without pagination or Stop', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(100));
    expect(screen.getAllByRole('link')).toHaveLength(100);
    expect(
      screen.getByRole('button', { name: 'Delete 100 assets' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    expect(screen.getByText('Deleting 100 assets…')).toBeTruthy();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(
      screen
        .getByRole('progressbar', { name: 'Deletion progress' })
        .getAttribute('aria-valuenow'),
    ).toBe('0');
    expect(
      screen.getByText('0 of 100 assets processed · 0B freed so far'),
    ).toBeTruthy();
    expect(countFor('Deleted')).toBe('0');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await act(async () => deletion.resolve(result(100)));
    expect(screen.getByText('Assets successfully deleted!')).toBeTruthy();
    expect(countFor('Assets deleted')).toBe('100');
    expect(countFor('Storage freed')).toBe('200KB');
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.resolve).toHaveBeenCalledWith('');
  });

  it('updates the progress bar and freed storage as batches complete', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(400));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    const options = mocks.delete.mock.calls[0]?.[2];
    act(() =>
      options?.onProgress?.({
        total: 400,
        processed: 100,
        deleted: 98,
        skipped: 2,
        missing: 0,
        failed: 0,
        freedBytes: 98 * 2_048,
      }),
    );
    const bar = screen.getByRole('progressbar', { name: 'Deletion progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByText('25%')).toBeTruthy();
    expect(
      screen.getByText('100 of 400 assets processed · 196KB freed so far'),
    ).toBeTruthy();
    expect(countFor('Deleted')).toBe('98');
    expect(countFor('Kept because they are in use')).toBe('2');
    await act(async () => deletion.resolve(result(400)));
  });

  it('renders only 100 of 10000 assets per page while deleting the complete selection', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(largeAssets);
    expect(screen.getAllByRole('link')).toHaveLength(100);
    expect(screen.getByText(/Showing 1–100 of 10,000 assets/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('link', { name: 'image-100.jpg' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'image-0.jpg' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(100);
    expect(screen.getByText(/Showing 101–200 of 10,000 assets/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    expect(mocks.delete.mock.calls[0]?.[1]).toBe(largeAssets);
    expect(mocks.delete.mock.calls[0]?.[1]).toHaveLength(10_000);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    await act(async () => deletion.resolve(result(10_000)));
  });

  it('shows the final partial page and disables Next at the end of the selection', async () => {
    await renderReady(makeAssets(201));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'image-200.jpg' })).toBeTruthy();
    expect(screen.getByText(/Showing 201–201 of 201 assets/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getAllByRole('link')).toHaveLength(100);
    expect(screen.getByText(/Showing 101–200 of 201 assets/)).toBeTruthy();
  });

  it('filters by filename and selects only the matches', async () => {
    const assets = makeAssets(150);
    mocks.delete.mockResolvedValue(result(140));
    await renderReady(assets);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const search = screen.getByRole('textbox', { name: 'Search assets' });
    fireEvent.change(search, { target: { value: ' IMAGE-1 ' } });

    // image-1, image-10..19 and image-100..149 match; the list returns to page 1.
    expect(screen.getAllByRole('link')).toHaveLength(61);
    expect(screen.getByRole('link', { name: 'image-1.jpg' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'image-2.jpg' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select all matches' }),
    );
    expect(screen.getByText(/^89 of 150 selected/)).toBeTruthy();

    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('No assets match your search')).toBeTruthy();
    expect(
      screen
        .getByRole('checkbox', { name: 'Select all matches' })
        .hasAttribute('disabled'),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveProperty('value', '');
    expect(screen.getAllByRole('link')).toHaveLength(100);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select image-0.jpg' }),
    );

    // Selected assets hidden by a search are still deleted.
    fireEvent.change(search, { target: { value: 'image-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete 88 assets' }));
    const deleted = mocks.delete.mock.calls[0]?.[1] ?? [];
    expect(deleted).toHaveLength(88);
    expect(deleted.some((asset) => asset.id === 'asset-0')).toBe(false);
    expect(deleted.some((asset) => asset.id === 'asset-30')).toBe(true);
    await act(async () => {});
  });

  it('deletes only the assets left selected', async () => {
    const assets = makeAssets(3);
    mocks.delete.mockResolvedValue(result(2));
    await renderReady(assets);
    expect(screen.getByText('3 of 3 selected · 6KB')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select image-1.jpg' }),
    );
    expect(screen.getByText('2 of 3 selected · 4KB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 assets' }));
    expect(mocks.delete.mock.calls[0]?.[1]).toEqual([assets[0], assets[2]]);
    await act(async () => {});
  });

  it('selects and clears every asset across pages', async () => {
    await renderReady(makeAssets(150));
    const selectAll = screen.getByRole('checkbox', { name: 'Select all' });
    fireEvent.click(selectAll);
    expect(screen.getByText(/^0 of 150 selected/)).toBeTruthy();
    const deleteButton = screen.getByRole('button', {
      name: 'Select assets to delete',
    });
    expect(deleteButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(deleteButton);
    expect(mocks.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select image-120.jpg' }),
    );
    expect(screen.getByText(/^1 of 150 selected/)).toBeTruthy();
    expect(selectAll).toHaveProperty('indeterminate', true);

    fireEvent.click(selectAll);
    expect(screen.getByText(/^150 of 150 selected/)).toBeTruthy();
    expect(selectAll).toHaveProperty('indeterminate', false);
    expect(
      screen.getByRole('button', { name: 'Delete 150 assets' }),
    ).toBeTruthy();
  });

  it('jumps to a page number and marks it as the current page', async () => {
    await renderReady(makeAssets(1_000));
    expect(screen.getByText('1').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Page 5' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Page 6' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Page 5' }));
    expect(screen.getByRole('link', { name: 'image-400.jpg' })).toBeTruthy();
    expect(screen.getByText('5').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Page 7' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Page 1' })).toBeNull();
  });

  it('blocks duplicate deletion clicks before React commits the loading state', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(1));
    const deleteButton = screen.getByRole('button', { name: DELETE });
    act(() => {
      fireEvent.click(deleteButton);
      fireEvent.click(deleteButton);
    });
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    await act(async () => deletion.resolve(result(1)));
  });

  it('stops safely without claiming success while an in-flight batch is pending', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    const signal = mocks.delete.mock.calls[0]?.[2]?.signal;
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(signal?.aborted).toBe(true);
    expect(
      screen.getByText('Stopping after the current batch finishes…'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Stopping…' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    await act(async () =>
      deletion.resolve(
        result(101, {
          cancelled: true,
          processed: 100,
          deleted: 100,
        }),
      ),
    );
    expect(screen.getByText('Deletion stopped')).toBeTruthy();
    expect(countFor('Not processed')).toBe('1');
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.resolve).toHaveBeenCalledWith('');
  });

  it('aborts on unmount and ignores late progress and a completed deletion response', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    const rendered = await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    const options = mocks.delete.mock.calls[0]?.[2];
    rendered.unmount();
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => {
      options?.onProgress?.(result(101));
      deletion.resolve(result(101));
    });
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('aborts deletion when the environment changes and rejects its stale result', async () => {
    const deletion = deferred<DeletionResult>();
    const nextDiscovery = deferred<UnusedAsset[]>();
    mocks.delete.mockReturnValue(deletion.promise);
    const rendered = await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    const options = mocks.delete.mock.calls[0]?.[2];
    mocks.discover.mockReturnValueOnce(nextDiscovery.promise);
    rendered.rerender(
      <CustomModal ctx={context({ environment: 'sandbox' })} />,
    );
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => {
      options?.onProgress?.(result(101));
      deletion.resolve(result(101));
    });
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    await act(async () => nextDiscovery.resolve(makeAssets(2)));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(mocks.createClient).toHaveBeenLastCalledWith({
      apiToken: 'synthetic-token',
      environment: 'sandbox',
      baseUrl: undefined,
    });
  });

  it.each([
    ['cancelled', { cancelled: true }],
    ['failed', { failed: 1, deleted: 0 }],
    ['uncertain', { uncertain: 1, deleted: 0 }],
    ['error', { error: 'The deletion outcome could not be confirmed.' }],
    ['incomplete', { processed: 0, deleted: 0 }],
  ] as const)('never reports success for a %s result', async (_name, overrides) => {
    mocks.delete.mockResolvedValue(result(1, overrides));
    await renderReady(makeAssets(1));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    await screen.findByRole('button', { name: 'Close' });
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('summarizes partial counts and uncertainty without auto-closing', async () => {
    mocks.delete.mockResolvedValue(
      result(101, {
        processed: 99,
        deleted: 95,
        skipped: 2,
        missing: 1,
        failed: 1,
        uncertain: 1,
        error: 'The deletion outcome could not be confirmed.',
      }),
    );
    await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    await screen.findByRole('button', { name: 'Close' });
    expect(screen.getByText("Deletion didn't complete")).toBeTruthy();
    expect(countFor('Assets deleted')).toBe('95');
    expect(countFor('Storage freed')).toBe('190KB');
    expect(countFor('Kept because they are in use')).toBe('2');
    expect(countFor('Already removed')).toBe('1');
    expect(countFor('Failed')).toBe('1');
    expect(
      screen.getByText(/Could not confirm deletion of 1 asset/),
    ).toBeTruthy();
    expect(countFor('Not processed')).toBe('1');
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('does not label submitted assets with uncertain outcomes as not processed', async () => {
    mocks.delete.mockResolvedValue(
      result(101, {
        processed: 1,
        deleted: 1,
        uncertain: 99,
        error: 'The deletion outcome could not be confirmed.',
      }),
    );
    await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    await screen.findByRole('button', { name: 'Close' });
    expect(countFor('Not processed')).toBe('1');
    expect(
      screen.getByText(/Could not confirm deletion of 99 assets/),
    ).toBeTruthy();
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('does not offer deletion after failed discovery', async () => {
    mocks.discover.mockRejectedValue(
      new Error(
        'The asset library changed during discovery. No assets were deleted.',
      ),
    );
    render(<CustomModal ctx={context()} />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The asset library changed during discovery',
    );
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('contains unexpected deletion errors and retains confirmed counts', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    const options = mocks.delete.mock.calls[0]?.[2];
    await act(async () => {
      options?.onProgress?.(result(101, { processed: 100, deleted: 100 }));
      deletion.reject(new Error('private SDK request payload'));
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Counts show the last confirmed progress',
    );
    expect(screen.queryByText(/private SDK request payload/)).toBeNull();
    expect(countFor('Deleted')).toBe('100');
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('reports assets preserved after revalidation honestly on successful completion', async () => {
    mocks.delete.mockResolvedValue(
      result(3, { deleted: 1, skipped: 1, missing: 1 }),
    );
    await renderReady(makeAssets(3));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    await screen.findByText('Assets successfully deleted!');
    expect(countFor('Asset deleted')).toBe('1');
    expect(countFor('Storage freed')).toBe('2KB');
    expect(countFor('Kept because they are in use')).toBe('1');
    expect(countFor('Already removed')).toBe('1');
    expect(screen.queryByText('Failed')).toBeNull();
    expect(mocks.notice).not.toHaveBeenCalled();
  });

  it('labels storage freed as estimated when the API outcome is ambiguous', async () => {
    mocks.delete.mockResolvedValue(
      result(2, { deleted: 1, missing: 1, freedBytesEstimated: true }),
    );
    await renderReady(makeAssets(2));
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    await screen.findByText('Assets successfully deleted!');
    expect(countFor('Storage freed (estimated)')).toBe('2KB');
  });
});
