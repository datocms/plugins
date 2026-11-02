import {
  ApiError,
  buildClient,
  TimeoutError,
} from '@datocms/cma-client-browser';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_SCOPE, type Scope } from '../report/scope';
import { deferred, pageContext, rawRecord } from '../test/fixtures';
import { focusFromKeyboard } from '../test/focus';
import { downloadReport } from '../utils/csv';
import ProjectPage from './ProjectPage';

vi.mock('@datocms/cma-client-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datocms/cma-client-browser')>()),
  buildClient: vi.fn(),
}));
vi.mock('../utils/csv', () => ({ downloadReport: vi.fn() }));

const ENGLISH_URL = 'https://broken.example/page';
const ITALIAN_URL = 'https://italian.example/page';

const rawList = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const baseMatchMedia = window.matchMedia;

beforeEach(() => {
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
  // Menus close without their animation, so a closed menu is gone at once.
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...baseMatchMedia(query),
    matches: query === '(prefers-reduced-motion: reduce)',
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The record reads, without the one request that counts records for the progress bar. */
function recordReads() {
  return rawList.mock.calls.filter(([query]) => query?.nested === true);
}

/** Overrides that `pageContext`'s typed parameter can't take (roles, item types). */
function contextWith(overrides: Record<string, unknown>): RenderPageCtx {
  return { ...pageContext(), ...overrides } as RenderPageCtx;
}

/** The table of the URLs (the kit's table has no role of its own). */
function table() {
  const element = document.querySelector<HTMLElement>('.Table');
  if (!element) throw new Error('No table');
  return within(element);
}

function rowOf(url: string): HTMLElement {
  const row = table().getByText(url).closest<HTMLElement>('.Table__row');
  if (!row) throw new Error(`No row for ${url}`);
  return row;
}

function detail() {
  return within(screen.getByRole('complementary', { name: 'Link' }));
}

/** A canceled scan's summary has no title: its sentence says it. */
const CANCELED_LEAD =
  'This report covers only what was checked before you stopped the scan.';

/** The callout of an incomplete or canceled scan, outside the live region. */
function summary(headline: string) {
  return screen.findByText(headline, {
    ignore: '[role="status"], script, style',
  });
}

/** A complete scan: the page's live region announces it. */
async function scanComplete() {
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('status')
        .some((region) => region.textContent === 'Scan complete'),
    ).toBe(true),
  );
}

/** The overview's "Scan links" before the first scan, then the title bar's. */
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

/** Picks a scope from the caret of "Scan links"; the modal resolves `result`. */
async function chooseScope(
  user: UserEvent,
  ctx: RenderPageCtx,
  result: Scope | undefined,
) {
  vi.mocked(ctx.openModal).mockResolvedValueOnce(result);
  await user.click(screen.getByRole('button', { name: 'More scan options' }));
  await user.click(
    await screen.findByRole('menuitem', { name: 'Choose what to scan…' }),
  );
}

/** Page model and English only: one URL, checked with HEAD then GET. */
async function scanEnglishPages(user: UserEvent, ctx: RenderPageCtx) {
  await chooseScope(user, ctx, { modelIds: ['page'], localeIds: ['en'] });
  await scanComplete();
}

async function openExport(user: UserEvent) {
  const bar = screen
    .getByRole('heading', { level: 1 })
    .closest<HTMLElement>('.Toolbar');
  if (!bar) throw new Error('No title bar');
  await user.click(within(bar).getByRole('button', { name: 'Actions' }));
  return screen.findByRole('menuitem', { name: 'Export as CSV' });
}

describe('project page', () => {
  it('explains a missing token and offers no unauthorized scan', () => {
    render(
      <ProjectPage ctx={pageContext({ currentUserAccessToken: undefined })} />,
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: "Link checker can't read your records",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/“Broken links” panel/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
            can_edit_schema: true,
            positive_item_type_permissions: [],
            negative_item_type_permissions: [],
          },
        },
      },
    });
    const view = render(<ProjectPage ctx={noReadAccess} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'No models to scan' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your role can't read the records of any model/),
    ).toBeInTheDocument();
    // Models exist: Schema can't help.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.unmount();

    render(<ProjectPage ctx={contextWith({ itemTypes: {} })} />);
    expect(
      screen.getByText("This environment doesn't have any models yet."),
    ).toBeInTheDocument();
    // Only roles that can edit the schema are led there.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('points roles that can edit the schema to Schema in an empty environment', async () => {
    const user = userEvent.setup();
    const ctx = contextWith({
      itemTypes: {},
      environment: 'sandbox',
      isEnvironmentPrimary: false,
      currentRole: {
        ...pageContext().currentRole,
        meta: { final_permissions: { can_edit_schema: true } },
      },
    });
    render(<ProjectPage ctx={ctx} />);
    await user.click(screen.getByRole('link', { name: 'Open Schema' }));
    expect(ctx.navigateTo).toHaveBeenCalledWith('/environments/sandbox/schema');
  });

  it('scans every model and locale with saved content and the current user token', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    render(<ProjectPage ctx={ctx} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Link checker' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Scan your saved records to find broken website links.'),
    ).toBeInTheDocument();
    // Before the first scan there is no title bar: the overview holds the scan.
    expect(screen.getAllByRole('button', { name: 'Scan links' })).toHaveLength(
      1,
    );

    await scanAll(user);
    await scanComplete();
    // The whole project is the default: the summary doesn't name it.
    expect(screen.getByText(/^2 records read • /)).toBeInTheDocument();
    expect(screen.queryByText(/All models/)).not.toBeInTheDocument();
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'test-user-token',
      environment: 'main',
      baseUrl: 'https://cma.example',
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
      screen.queryByText(
        'Scan your saved records to find broken website links.',
      ),
    ).not.toBeInTheDocument();
    expect(ctx.editItem).not.toHaveBeenCalled();
  });

  it('scans only the models and locales chosen in the scope modal', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    render(<ProjectPage ctx={ctx} />);

    await chooseScope(user, ctx, undefined);
    expect(ctx.openModal).toHaveBeenCalledWith({
      id: 'scan-scope',
      title: 'Choose what to scan',
      width: 's',
      initialHeight: 349,
      closeDisabled: true,
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
    });
    await act(async () => undefined);
    expect(rawList).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Link checker' }),
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

  it('sizes the scope modal for a single-locale site', async () => {
    const user = userEvent.setup();
    const ctx = contextWith({
      site: {
        id: 'site-1',
        attributes: { locales: ['en'], internal_domain: null },
      },
    });
    render(<ProjectPage ctx={ctx} />);
    await chooseScope(user, ctx, undefined);
    expect(ctx.openModal).toHaveBeenCalledWith(
      expect.objectContaining({ initialHeight: 215 }),
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
      detail().getByRole('button', {
        name: /^Page\s*Example page\s*,\s*open record$/,
      }),
    );
    expect(ctx.editItem).toHaveBeenCalledWith('record-1');
    expect(table().getByText(ENGLISH_URL)).toBeInTheDocument();
    expect(ctx.navigateTo).not.toHaveBeenCalled();

    await act(async () =>
      modal.resolve(
        rawRecord() as unknown as NonNullable<
          Awaited<ReturnType<RenderPageCtx['editItem']>>
        >,
      ),
    );
    expect(table().getByText('Content changed')).toBeInTheDocument();
    expect(detail().getByText('Content changed')).toBeInTheDocument();
    expect(
      screen.getByText(/Some records changed after this scan/),
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
      detail().getByRole('button', {
        name: /^Page\s*Example page\s*,\s*open record$/,
      }),
    );
    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't open the record."),
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
    expect(await summary('Scan incomplete')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: "Show what couldn't be read" }),
    );
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
    expect(await summary(CANCELED_LEAD)).toBeInTheDocument();
    // The links that weren't checked have a view of their own.
    await user.click(screen.getByRole('button', { name: /^Link checker/ }));
    await user.click(
      await screen.findByRole('menuitem', { name: /^Not checked/ }),
    );
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
    await user.click(detail().getByRole('button', { name: 'Recheck link' }));
    // The rechecked URL's action keeps its label while pending.
    const pending = detail().getByRole('button', { name: 'Recheck link' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(within(rowOf(ENGLISH_URL)).getByText('Checking')).toBeVisible();
    const scan = screen.getByRole('button', { name: 'Scan links' });
    expect(scan).toHaveAttribute('aria-disabled', 'true');
    await user.click(scan);
    expect(recordReads()).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'More scan options' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.queryByRole('button', { name: 'Cancel scan' }),
    ).not.toBeInTheDocument();
    await scanComplete();

    await act(async () =>
      response.resolve(new Response(null, { status: 200 })),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Scan links' }),
      ).not.toHaveAttribute('aria-disabled'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('exports the whole report whatever the filters, and alerts when that fails', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ProjectPage ctx={ctx} />);
    await scanAll(user);
    await scanComplete();

    await user.click(screen.getByRole('button', { name: /^Link checker/ }));
    await user.click(
      await screen.findByRole('menuitem', { name: /^All links/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Filter Links' }));
    await user.type(
      within(screen.getByRole('search', { name: 'Links' })).getByRole(
        'textbox',
      ),
      'italian',
    );
    expect(await screen.findByText('1 link')).toBeInTheDocument();
    expect(screen.queryByText(ENGLISH_URL)).not.toBeInTheDocument();
    await user.click(await openExport(user));
    expect(downloadReport).toHaveBeenCalledTimes(1);
    const [exported] = vi.mocked(downloadReport).mock.calls[0];
    expect(exported.groups.map((group) => group.prepared.url)).toEqual([
      ENGLISH_URL,
      ITALIAN_URL,
    ]);

    vi.mocked(downloadReport).mockImplementationOnce(() => {
      throw new Error('Download blocked');
    });
    await user.click(await openExport(user));
    expect(ctx.alert).toHaveBeenCalledWith("Couldn't export the report.");
  });

  it('keeps a rechecked URL in its row, and exports the settled report meanwhile', async () => {
    const user = userEvent.setup();
    mixedResults();
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await scanComplete();
    expect(table().queryByText(ITALIAN_URL)).not.toBeInTheDocument();
    expect(screen.getByText('1 link')).toBeInTheDocument();

    const response = deferred<Response>();
    fetchMock.mockImplementationOnce(() => response.promise);
    await user.click(table().getByText(ENGLISH_URL));
    await user.click(detail().getByRole('button', { name: 'Recheck link' }));
    expect(within(rowOf(ENGLISH_URL)).getByText('Checking')).toBeVisible();
    expect(screen.getByText('1 link')).toBeInTheDocument();
    expect(
      screen.queryByText('Nothing needs attention'),
    ).not.toBeInTheDocument();

    await user.click(await openExport(user));
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
      await screen.findByText('Nothing needs attention'),
    ).toBeInTheDocument();
  });

  it('closes the open row and keeps the detail sections as they were on a new scan', async () => {
    const user = userEvent.setup();
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await scanComplete();
    await user.click(table().getByText(ENGLISH_URL));
    await user.click(detail().getByRole('button', { name: /^Records/ }));
    expect(detail().getByRole('button', { name: /^Records/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await scanAll(user);
    await scanComplete();
    expect(
      screen.queryByRole('complementary', { name: 'Link' }),
    ).not.toBeInTheDocument();
    await user.click(table().getByText(ENGLISH_URL));
    expect(detail().getByRole('button', { name: /^Records/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it.each([
    [apiError(403, 'Forbidden'), "News: Your role can't see these records."],
    [
      apiError(401, 'Unauthorized'),
      'News: Access was refused. Reload the page and scan again.',
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
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    rawList.mockImplementation(async (query: { filter: { type: string } }) => {
      if (query.filter.type === 'news') throw error;
      return { data: [rawRecord()], meta: { total_count: 1 } };
    });
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await summary('Scan incomplete');
    await user.click(
      screen.getByRole('button', { name: "Show what couldn't be read" }),
    );
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it('alerts when the scan dialog cannot be opened', async () => {
    const user = userEvent.setup();
    const ctx = pageContext();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.mocked(ctx.openModal).mockRejectedValueOnce(new Error('Host error'));
    render(<ProjectPage ctx={ctx} />);
    await user.click(screen.getByRole('button', { name: 'More scan options' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Choose what to scan…' }),
    );
    await waitFor(() =>
      expect(ctx.alert).toHaveBeenCalledWith("Couldn't open the scan dialog."),
    );
    expect(consoleError).toHaveBeenCalled();
    expect(rawList).not.toHaveBeenCalled();
  });

  it('moves keyboard focus to the new action when a scan starts and when it is canceled', async () => {
    const user = userEvent.setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    focusFromKeyboard();
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    render(<ProjectPage ctx={pageContext()} />);
    screen.getByRole('button', { name: 'Scan links' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await summary(CANCELED_LEAD);
    expect(screen.getByRole('button', { name: 'Scan links' })).toHaveFocus();
  });

  it("doesn't move a pointer's focus, so the action keeps its normal look", async () => {
    const user = userEvent.setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    render(<ProjectPage ctx={pageContext()} />);
    await scanAll(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      screen.getByRole('button', { name: 'Cancel scan' }),
    ).not.toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Cancel scan' }));
    await summary(CANCELED_LEAD);
    expect(
      screen.getByRole('button', { name: 'Scan links' }),
    ).not.toHaveFocus();
  });
});
