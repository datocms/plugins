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
  }));
}

const largeAssets = makeAssets(10_000);

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
  await screen.findByRole('button', { name: 'Delete' });
  return rendered;
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
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
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
      'Checking 500 of 10000 assets… 23 unused assets found.',
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
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await act(async () => discovery.resolve(makeAssets(23)));
  });

  it('preserves small confirmation and loading states without pagination or Stop', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(100));
    expect(screen.getAllByRole('link')).toHaveLength(100);
    expect(
      screen.getByText('This will delete all of the following assets:'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByText(/assets processed/)).toBeNull();
    expect(screen.queryByText(/Deleted:/)).toBeNull();
    await act(async () => deletion.resolve(result(100)));
    expect(mocks.notice).toHaveBeenCalledWith(
      'Unused assets successfully deleted!',
    );
    expect(mocks.resolve).toHaveBeenCalledWith('');
  });

  it('renders only 100 of 10000 assets per page while deleting the complete selection', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(largeAssets);
    expect(screen.getAllByRole('link')).toHaveLength(100);
    expect(screen.getByText(/Showing 1–100 of 10000 assets/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('link', { name: 'image-100.jpg' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'image-0.jpg' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(100);
    expect(screen.getByText(/Showing 101–200 of 10000 assets/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
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

  it('blocks duplicate deletion clicks before React commits the loading state', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(1));
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
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
    expect(screen.getByText('Not processed: 1 asset.')).toBeTruthy();
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.resolve).toHaveBeenCalledWith('');
  });

  it('aborts on unmount and ignores late progress and a completed deletion response', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    const rendered = await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Close' });
    expect(
      screen.getByText(
        /Deleted: 95. Kept because they are in use: 2. Already removed: 1. Failed: 1./,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Could not confirm deletion of 1 asset/),
    ).toBeTruthy();
    expect(screen.getByText('Not processed: 1 asset.')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Close' });
    expect(screen.getByText('Not processed: 1 asset.')).toBeTruthy();
    expect(screen.queryByText('Not processed: 100 assets.')).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('contains unexpected deletion errors and retains confirmed counts', async () => {
    const deletion = deferred<DeletionResult>();
    mocks.delete.mockReturnValue(deletion.promise);
    await renderReady(makeAssets(101));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const options = mocks.delete.mock.calls[0]?.[2];
    await act(async () => {
      options?.onProgress?.(result(101, { processed: 100, deleted: 100 }));
      deletion.reject(new Error('private SDK request payload'));
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Counts show the last confirmed progress',
    );
    expect(screen.queryByText(/private SDK request payload/)).toBeNull();
    expect(screen.getByText(/Deleted: 100/)).toBeTruthy();
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('reports assets preserved after revalidation honestly on successful completion', async () => {
    mocks.delete.mockResolvedValue(
      result(3, { deleted: 1, skipped: 1, missing: 1 }),
    );
    await renderReady(makeAssets(3));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => {});
    expect(mocks.notice).toHaveBeenCalledWith(
      'Unused assets deleted: 1. Assets kept because they are in use: 1. Assets already removed: 1.',
    );
    expect(mocks.resolve).toHaveBeenCalledWith('');
  });
});
