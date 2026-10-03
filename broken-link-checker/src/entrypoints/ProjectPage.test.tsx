import {
  ApiError,
  buildClient,
  TimeoutError,
} from '@datocms/cma-client-browser';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_SCOPE, type Scope } from '../report/scope';
import {
  deferred,
  mediaState,
  pageContext,
  rawRecord,
  resetMediaState,
} from '../test/fixtures';
import { downloadReport } from '../utils/csv';
import ProjectPage from './ProjectPage';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);
vi.mock('@datocms/cma-client-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datocms/cma-client-browser')>()),
  buildClient: vi.fn(),
}));
vi.mock('../utils/csv', () => ({ downloadReport: vi.fn() }));

const ENGLISH_URL = 'https://broken.example/page';
const ITALIAN_URL = 'https://italian.example/page';

const rawList = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetMediaState();
  rawList
    .mockReset()
    .mockResolvedValue({ data: [rawRecord()], meta: { total_count: 1 } });
  vi.mocked(buildClient)
    .mockReset()
    .mockReturnValue({ items: { rawList } } as unknown as ReturnType<
      typeof buildClient
    >);
  vi.mocked(downloadReport).mockReset();
  fetchMock
    .mockReset()
    .mockImplementation(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The record reads, without the one request that counts records for the progress bar. */
function recordReads() {
  return rawList.mock.calls.filter(([query]) => query?.nested === true);
}

/** Overrides that `pageContext`'s typed parameter can't take (roles, item types). */
function contextWith(overrides: Record<string, unknown>): RenderPageCtx {
  return { ...pageContext(), ...overrides } as RenderPageCtx;
}

function table() {
  return within(screen.getByRole('table', { name: 'Link check results' }));
}

function sidebar() {
  return within(screen.getByRole('complementary', { name: 'Link details' }));
}

function rowOf(url: string): HTMLTableRowElement {
  const row = table().getByText(url).closest('tr');
  if (!row) throw new Error(`No row for ${url}`);
  return row;
}

/** The pane's one "Scan links": the blank slate's before the first scan, then the toolbar's. */
async function scanAll(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Scan links' }));
}

/** The English URL is broken and the Italian one reachable. */
function mixedResults() {
  fetchMock.mockImplementation(
    async (input) =>
      new Response(null, {
        status: String(input).includes('italian') ? 200 : 404,
      }),
  );
}

function apiError(status: number, statusText: string) {
  return new ApiError({
    request: { method: 'GET', url: 'https://cma.example/items', headers: {} },
    response: { status, statusText, headers: {} },
  });
}

function scopeButton() {
  return screen.getByRole('button', { name: 'Choose what to scan…' });
}

/** Picks a scope through the toolbar's scope button; the modal resolves `result`. */
async function chooseScope(
  user: UserEvent,
  ctx: RenderPageCtx,
  result: Scope | undefined,
) {
  vi.mocked(ctx.openModal).mockResolvedValueOnce(result);
  await user.click(scopeButton());
}

/** Page model and English only: one URL, checked with HEAD then GET. */
async function scanEnglishPages(user: UserEvent, ctx: RenderPageCtx) {
  await chooseScope(user, ctx, { modelIds: ['page'], localeIds: ['en'] });
  await screen.findByRole('heading', { name: 'Scan complete' });
}

describe('project page', () => {
  it('explains a missing token and offers no unauthorized scan', () => {
    render(
      <ProjectPage ctx={pageContext({ currentUserAccessToken: undefined })} />,
    );
    expect(
      screen.getByRole('heading', { name: 'API access needed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/"Broken links" sidebar panel/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Scan links' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Choose what to scan/ }),
    ).not.toBeInTheDocument();
    expect(buildClient).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains why there is nothing to scan', () => {
    const noReadAccess = contextWith({
      currentRole: {
        id: 'blind',
        attributes: {
          positive_item_type_permissions: [],
          negative_item_type_permissions: [],
        },
        meta: {
          final_permissions: {
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
        },
      },
    });
    const view = render(<ProjectPage ctx={noReadAccess} />);
    expect(
      screen.getByRole('heading', { name: 'No models to scan' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your role cannot read the records of any model/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Scan links' }),
    ).not.toBeInTheDocument();
    view.unmount();

    const empty = render(<ProjectPage ctx={contextWith({ itemTypes: {} })} />);
    expect(
      screen.getByText("This environment doesn't have any models yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Models are created in Schema.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Scan links' }),
    ).not.toBeInTheDocument();
    empty.unmount();
  });

  it('points roles that can edit the schema to Schema in an empty environment', async () => {
    const user = userEvent.setup();
    const ctx = contextWith({
      itemTypes: {},
      environment: 'sandbox',
      isEnvironmentPrimary: false,
      navigateTo: vi.fn().mockResolvedValue(undefined),
      currentRole: {
        ...pageContext().currentRole,
        meta: { final_permissions: { can_edit_schema: true } },
      },
    });
    render(<ProjectPage ctx={ctx} />);
    expect(
      screen.queryByText('Models are created in Schema.'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Create a model in Schema' }),
    );
    expect(ctx.navigateTo).toHaveBeenCalledWith('/environments/sandbox/schema');
  });

  it('scans every model and locale with saved content and the current user token', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    render(<ProjectPage ctx={ctx} />);
    expect(
      screen.getByRole('heading', { name: 'No links checked yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Scan your saved records to find broken links.'),
    ).toBeInTheDocument();
    // One primary in the pane: the blank slate's. The toolbar offers the scope.
    expect(screen.getAllByRole('button', { name: 'Scan links' })).toHaveLength(
      1,
    );
    expect(scopeButton()).toBeEnabled();

    await scanAll(user);
    expect(
      await screen.findByRole('heading', { name: 'Scan complete' }),
    ).toBeInTheDocument();
    // The summary names what the scan covered.
    expect(
      screen.getByText(/^All models • All locales • 2 records read • /),
    ).toBeInTheDocument();
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'test-user-token',
      environment: 'main',
      baseUrl: 'https://cma.example',
      autoRetry: false,
      requestTimeout: 31_000,
      fetchFn: expect.any(Function),
    });
    expect(recordReads()).toHaveLength(2);
    for (const type of ['page', 'news'])
      expect(rawList).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 'current',
          nested: true,
          filter: { type },
        }),
      );
    // One more request counts the records, for the progress bar.
    expect(rawList).toHaveBeenCalledWith({
      filter: { type: 'news,page' },
      page: { limit: 0 },
      version: 'current',
    });
    expect(table().getByText(ENGLISH_URL)).toBeInTheDocument();
    expect(table().getByText(ITALIAN_URL)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'No links checked yet' }),
    ).not.toBeInTheDocument();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it('scans only the models and locales chosen in the scope modal', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    render(<ProjectPage ctx={ctx} />);

    await chooseScope(user, ctx, undefined);
    expect(ctx.openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'scan-scope',
        title: 'Choose what to scan',
        width: 's',
        initialHeight: 328,
        parameters: {
          environment: 'main',
          models: [
            { id: 'news', name: 'News' },
            { id: 'page', name: 'Page' },
          ],
          locales: [
            { code: 'en', label: 'English' },
            { code: 'it', label: 'Italian' },
          ],
          scope: ALL_SCOPE,
        },
      }),
    );
    await act(async () => undefined);
    expect(rawList).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'No links checked yet' }),
    ).toBeInTheDocument();

    await scanEnglishPages(user, ctx);
    expect(recordReads()).toHaveLength(1);
    expect(rawList).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 'current',
        nested: true,
        filter: { type: 'page' },
      }),
    );
    expect(table().getByText(ENGLISH_URL)).toBeInTheDocument();
    expect(screen.queryByText(ITALIAN_URL)).not.toBeInTheDocument();
    expect(
      screen.getByText(/^Page • English • 1 record read • /),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The modal reopens on the current scope.
    await chooseScope(user, ctx, undefined);
    expect(ctx.openModal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          scope: { modelIds: ['page'], localeIds: ['en'] },
        }),
      }),
    );
  });

  it('keeps the report open through the native editor and marks a saved record as changed', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    const modal = deferred<Awaited<ReturnType<RenderPageCtx['editItem']>>>();
    vi.mocked(ctx.editItem).mockReturnValue(modal.promise);
    render(<ProjectPage ctx={ctx} />);
    await scanEnglishPages(user, ctx);

    await user.click(table().getByText(ENGLISH_URL));
    await user.click(
      sidebar().getByRole('button', { name: 'Open record Example page' }),
    );
    expect(ctx.editItem).toHaveBeenCalledWith('record-1');
    expect(
      screen.getByRole('table', { name: 'Link check results' }),
    ).toBeInTheDocument();
    expect(ctx.navigateTo).not.toHaveBeenCalled();

    await act(async () =>
      modal.resolve(
        rawRecord() as unknown as NonNullable<
          Awaited<ReturnType<RenderPageCtx['editItem']>>
        >,
      ),
    );
    expect(table().getByText('Content changed')).toBeInTheDocument();
    expect(sidebar().getByText('Content changed')).toBeInTheDocument();
    expect(
      screen.getByText(/Records changed after this scan/),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ctx.alert).not.toHaveBeenCalled();
  });

  it('alerts when a record cannot be opened', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    vi.mocked(ctx.editItem).mockRejectedValue(new Error('Navigation failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    render(<ProjectPage ctx={ctx} />);
    await scanEnglishPages(user, ctx);

    await user.click(table().getByText(ENGLISH_URL));
    await user.click(
      sidebar().getByRole('button', { name: 'Open record Example page' }),
    );
    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't open the record!"),
    );
    expect(consoleError).toHaveBeenCalled();
    expect(table().getByText(ENGLISH_URL)).toBeInTheDocument();
  });

  it('keeps completed results and reports an unreadable model as incomplete', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rawList.mockImplementation(async (query: { filter: { type: string } }) => {
      if (query.filter.type === 'news') throw new Error('Record access denied');
      return { data: [rawRecord()], meta: { total_count: 1 } };
    });
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    expect(
      await screen.findByRole('heading', { name: 'Scan incomplete' }),
    ).toBeInTheDocument();
    expect(screen.getByText('News: Record access denied')).toBeInTheDocument();
    expect(table().getByText(ENGLISH_URL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan links' })).toBeEnabled();
  });

  it('cancels pending link checks and shows what was not checked', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      screen.queryByRole('button', { name: 'Scan links' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(
      await screen.findByRole('heading', { name: 'Scan canceled' }),
    ).toBeInTheDocument();
    expect(table().getAllByText('Not checked').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Cancel scan' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan links' })).toBeEnabled();
  });

  it('blocks new scans while one URL is rechecked', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    render(<ProjectPage ctx={ctx} />);
    await scanEnglishPages(user, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const response = deferred<Response>();
    fetchMock.mockImplementationOnce(() => response.promise);
    await user.click(table().getByText(ENGLISH_URL));
    await user.click(sidebar().getByRole('button', { name: 'Recheck URL' }));
    // An async action keeps its label while pending.
    const pending = sidebar().getByRole('button', { name: 'Recheck URL' });
    expect(pending).toBeDisabled();
    expect(within(pending).getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan links' })).toBeDisabled();
    expect(
      screen.getByText(
        'You cannot start a scan while a URL is being rechecked',
      ),
    ).toBeInTheDocument();
    expect(scopeButton()).toBeDisabled();
    expect(
      screen.getByText(
        'You cannot choose what to scan while a URL is being rechecked',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel scan' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Scan complete' }),
    ).toBeInTheDocument();

    await act(async () =>
      response.resolve(new Response(null, { status: 200 })),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scan links' })).toBeEnabled(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('exports the whole report whatever the filters, and alerts when that fails', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ProjectPage ctx={ctx} />);
    await scanAll(user);
    await screen.findByRole('heading', { name: 'Scan complete' });

    await user.type(screen.getByLabelText('Search URLs'), 'italian');
    expect(await screen.findByText('1 URL')).toBeInTheDocument();
    expect(screen.queryByText(ENGLISH_URL)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(downloadReport).toHaveBeenCalledTimes(1);
    const [exported] = vi.mocked(downloadReport).mock.calls[0];
    expect(exported.groups.map((group) => group.prepared.url)).toEqual([
      ENGLISH_URL,
      ITALIAN_URL,
    ]);

    vi.mocked(downloadReport).mockImplementationOnce(() => {
      throw new Error('Download blocked');
    });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(ctx.alert).toHaveBeenCalledWith("Couldn't export the report!");
  });

  it('opens the Info sidebar over the report in a narrow frame, without remounting the report', async () => {
    const user = userEvent.setup();
    mediaState.queries['(max-width: 999px)'] = true;
    const { container } = render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await screen.findByRole('heading', { name: 'Scan complete' });
    // The split stays on its rail: the kit's overlay mode would swap trees.
    expect(container.querySelector('[data-mode]')).toHaveAttribute(
      'data-mode',
      'split',
    );
    // Below 1800px the sidebar starts collapsed and opens on selection.
    expect(
      screen.getByRole('button', { name: 'Show sidebar' }),
    ).toBeInTheDocument();
    const results = screen.getByRole('table', { name: 'Link check results' });
    const row = rowOf(ENGLISH_URL);

    await user.click(table().getByText(ENGLISH_URL));
    const aside = screen.getByRole('complementary', { name: 'Link details' });
    expect(aside.closest('.blc-overlay')).not.toBeNull();
    expect(aside).toHaveFocus();
    expect(screen.getByRole('table', { name: 'Link check results' })).toBe(
      results,
    );

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('complementary', { name: 'Link details' }),
    ).not.toBeInTheDocument();
    expect(rowOf(ENGLISH_URL)).toBe(row);
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('keeps a rechecked URL in its row, and exports the settled report meanwhile', async () => {
    const user = userEvent.setup();
    mixedResults();
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await screen.findByRole('heading', { name: 'Scan complete' });
    expect(table().queryByText(ITALIAN_URL)).not.toBeInTheDocument();
    expect(screen.getByText('1 URL')).toBeInTheDocument();

    const response = deferred<Response>();
    fetchMock.mockImplementationOnce(() => response.promise);
    await user.click(table().getByText(ENGLISH_URL));
    await user.click(sidebar().getByRole('button', { name: 'Recheck URL' }));
    expect(within(rowOf(ENGLISH_URL)).getAllByText('Checking').length).toBe(2);
    expect(screen.getByText('1 URL')).toBeInTheDocument();
    expect(screen.getByText(/1 needs attention/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Nothing needs attention' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const [exported] = vi.mocked(downloadReport).mock.calls[0];
    expect(exported.state).toBe('complete');
    expect(
      exported.groups.find((group) => group.prepared.url === ENGLISH_URL)
        ?.result.status,
    ).toBe('broken');

    await act(async () =>
      response.resolve(new Response(null, { status: 200 })),
    );
    expect(
      await screen.findByRole('heading', { name: 'Nothing needs attention' }),
    ).toBeInTheDocument();
  });

  it.each([
    [apiError(403, 'Forbidden'), 'News: Your role cannot read its records.'],
    [
      apiError(401, 'Unauthorized'),
      'News: The API token was rejected. Reload the page and scan again.',
    ],
    [
      apiError(500, 'Internal Server Error'),
      "News: The records couldn't be loaded. Scan again to retry.",
    ],
    [
      new TimeoutError({
        request: { method: 'GET', url: 'https://cma.example', headers: {} },
      }),
      'News: The request timed out. Scan again to retry.',
    ],
    [
      new TypeError('Failed to fetch'),
      "News: The records couldn't be loaded. Scan again to retry.",
    ],
  ])('explains a failed model read in plain words (%#)', async (error, message) => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    rawList.mockImplementation(async (query: { filter: { type: string } }) => {
      if (query.filter.type === 'news') throw error;
      return { data: [rawRecord()], meta: { total_count: 1 } };
    });
    render(<ProjectPage ctx={pageContext()} />);
    // This test drives the scan's retry timers itself. A synchronous click
    // avoids waiting for user-event's interaction timers before advancing them.
    fireEvent.click(screen.getByRole('button', { name: 'Scan links' }));
    await act(async () => vi.runAllTimersAsync());
    expect(
      screen.getByRole('heading', { name: 'Scan incomplete' }),
    ).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(error);
    expect(
      recordReads().filter(([query]) => query.filter.type === 'news'),
    ).toHaveLength(
      error instanceof ApiError && error.response.status < 500 ? 1 : 4,
    );
  });

  it('alerts when the scan dialog cannot be opened', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.mocked(ctx.openModal).mockRejectedValueOnce(new Error('Host error'));
    render(<ProjectPage ctx={ctx} />);
    await user.click(scopeButton());
    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't open the scan dialog!"),
    );
    expect(consoleError).toHaveBeenCalled();
    expect(rawList).not.toHaveBeenCalled();
  });

  it('moves focus to the new action when a scan starts and when it is canceled', async () => {
    const user = userEvent.setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Cancel scan' }));
    await screen.findByRole('heading', { name: 'Scan canceled' });
    expect(screen.getByRole('button', { name: 'Scan links' })).toHaveFocus();
  });
});
