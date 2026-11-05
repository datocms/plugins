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
import Canvas, { type NavigationAdapter } from 'datocms-react-ui/Canvas';
import { useInMemoryTableLayout } from 'datocms-react-ui/Table';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageContext } from '../test/fixtures';
import { focusFromKeyboard } from '../test/focus';
import type { CheckStatus, LinkGroup, ScanReport } from '../types';
import { REPORT_TEXTS } from './PageToolbar';
import {
  ReportLayout,
  type ReportLayoutProps,
  ROW_BASE_URL,
} from './ReportLayout';
import { DEFAULT_TABLE_LAYOUT } from './ReportTable';

type GroupOptions = {
  modelId?: string;
  locale?: string;
  slug?: string;
  stale?: boolean;
  fragment?: boolean;
};

function group(
  status: CheckStatus,
  {
    modelId = 'page',
    locale = 'en',
    slug = `${status}-${modelId}`,
    stale = false,
    fragment = false,
  }: GroupOptions = {},
): LinkGroup {
  const url = `https://${slug}.example/path`;
  const modelName = `${modelId.charAt(0).toUpperCase()}${modelId.slice(1)}`;
  return {
    key: url,
    prepared: {
      key: url,
      url,
      hostname: `${slug}.example`,
      status: status === 'skipped' || status === 'invalid' ? status : 'queued',
      message: 'Prepared',
    },
    result: {
      key: url,
      url,
      status,
      message: `Result: ${status}`,
      httpStatus: status === 'broken' ? 404 : undefined,
    },
    occurrences: [
      {
        id: `${slug}:occurrence`,
        recordId: `record-${modelId}`,
        recordTitle: `${modelName} record`,
        modelId,
        modelName,
        fieldPath: `body.${locale}`,
        fieldLabel: 'Body',
        locale,
        blockPath: ['Sections', 'Hero'],
        url: fragment ? `${url}#pricing` : url,
      },
    ],
    stale,
  };
}

function report(
  groups: LinkGroup[],
  overrides: Partial<ScanReport> = {},
): ScanReport {
  return {
    groups,
    state: 'complete',
    recordsScanned: groups.length,
    discovering: false,
    warnings: [],
    scope: 'Page • English',
    startedAt: '2026-09-23T12:00:00Z',
    finishedAt: '2026-09-23T12:01:00Z',
    ...overrides,
  };
}

type HarnessProps = Omit<
  ReportLayoutProps,
  'tableLayout' | 'onTableLayoutChange' | 'linkPanel' | 'recordsPanel'
> & { ctx: RenderPageCtx };

/** The page around the report: the in-memory route of the open row, the columns and the sections. */
function Harness({ ctx, ...props }: HarnessProps) {
  const [location, setLocation] = useState({
    pathname: ROW_BASE_URL,
    search: '',
  });
  const navigation = useMemo<NavigationAdapter>(
    () => ({
      location,
      navigate: (to) => {
        const [pathname, query] = to.split('?');
        setLocation({ pathname, search: query ? `?${query}` : '' });
      },
    }),
    [location],
  );
  const [layout, setLayout] = useInMemoryTableLayout(DEFAULT_TABLE_LAYOUT);
  const [linkOpen, setLinkOpen] = useState(true);
  const [recordsOpen, setRecordsOpen] = useState(true);
  return (
    <Canvas
      ctx={ctx}
      noAutoResizer
      navigation={navigation}
      texts={REPORT_TEXTS}
    >
      <ReportLayout
        {...props}
        tableLayout={layout}
        onTableLayoutChange={setLayout}
        linkPanel={{ open: linkOpen, onToggle: setLinkOpen }}
        recordsPanel={{ open: recordsOpen, onToggle: setRecordsOpen }}
      />
    </Canvas>
  );
}

function renderLayout(overrides: Partial<ReportLayoutProps> = {}) {
  const callbacks = {
    onScan: vi.fn(),
    onChooseScope: vi.fn(),
    onCancel: vi.fn(),
    onExport: vi.fn(),
    onRecheck: vi.fn(),
    onOpenRecord: vi.fn(),
  };
  const props: HarnessProps = {
    ctx: pageContext(),
    report: report([]),
    scanning: false,
    rechecking: false,
    changedRecordIds: new Set<string>(),
    multiLocale: true,
    uiLocale: 'en',
    ...callbacks,
    ...overrides,
  };
  const view = render(<Harness {...props} />);
  return {
    ...callbacks,
    unmount: view.unmount,
    rerender: (next: Partial<ReportLayoutProps>) =>
      view.rerender(<Harness {...props} {...next} />),
  };
}

const urlOf = (value: LinkGroup) => value.prepared.url;

/** The table of the URLs (the kit's table has no role of its own). */
function tableElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.Table');
  if (!element) throw new Error('No table');
  return element;
}

function table() {
  return within(tableElement());
}

function rowOf(url: string): HTMLElement {
  const row = table().getByText(url).closest<HTMLElement>('.Table__row');
  if (!row) throw new Error(`No row for ${url}`);
  return row;
}

function detail() {
  return within(screen.getByRole('complementary', { name: 'Link' }));
}

/** Text outside the live region, which repeats the summary's headline. */
const VISIBLE = { ignore: '[role="status"], script, style' };

/** The page title: "Link checker", then the active view after a "·". */
function title(qualifier?: string) {
  return screen.getByRole('heading', {
    level: 1,
    name: qualifier
      ? new RegExp(`^Link checker\\s*· ${qualifier}$`)
      : 'Link checker',
  });
}

/** The title bar of the list, whose "⋮" holds the export. */
function titleBar() {
  const bar = screen
    .getByRole('heading', { level: 1 })
    .closest<HTMLElement>('.Toolbar');
  if (!bar) throw new Error('No title bar');
  return within(bar);
}

async function openExport(user: UserEvent) {
  await user.click(titleBar().getByRole('button', { name: 'Actions' }));
  return screen.findByRole('menuitem', { name: 'Export as CSV' });
}

/** The kit's hot keys read the key code, which user-event leaves out. */
function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    which: 27,
  });
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const NARROW_FRAME = '(max-width: 1100px)';
const baseMatchMedia = window.matchMedia;

/** Menus close without their animation, so a closed menu is gone at once. */
function matchMedia(queries: readonly string[]) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...baseMatchMedia(query),
    matches: queries.includes(query),
  }));
}

/**
 * A media query whose answer a test changes, as when the frame is resized.
 * The kit reads `matches` on each render and listens to its `change` event.
 */
function changingMedia(query: string, initial: boolean) {
  type Listener = (change: { media: string }) => void;
  let matches = initial;
  const listeners = new Set<Listener>();
  const list = {
    ...baseMatchMedia(query),
    get matches() {
      return matches;
    },
    addEventListener: (_type: 'change', listener: Listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'change', listener: Listener) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;
  vi.spyOn(window, 'matchMedia').mockImplementation((asked) =>
    asked === query
      ? list
      : { ...baseMatchMedia(asked), matches: asked === REDUCED_MOTION },
  );
  return (next: boolean) => {
    matches = next;
    for (const listener of listeners) listener(list);
  };
}

/** The ResizeObservers made while the tests run, with what each one watches. */
const resizeObservers = new Set<{
  callback: ResizeObserverCallback;
  watched: Set<Element>;
}>();

// Every test of this file uses it: it does nothing until a test resizes a box.
globalThis.ResizeObserver = class {
  readonly entry = {
    callback: (() => undefined) as ResizeObserverCallback,
    watched: new Set<Element>(),
  };
  constructor(callback: ResizeObserverCallback) {
    this.entry.callback = callback;
    resizeObservers.add(this.entry);
  }
  observe(target: Element) {
    this.entry.watched.add(target);
  }
  unobserve(target: Element) {
    this.entry.watched.delete(target);
  }
  disconnect() {
    this.entry.watched.clear();
  }
  takeRecords() {
    return [];
  }
} as unknown as typeof ResizeObserver;

/** Gives a box a new width, as a resize of the frame would. */
function resize(target: Element, width: number) {
  const size = { inlineSize: width, blockSize: 600 };
  act(() => {
    for (const { callback, watched } of resizeObservers)
      if (watched.has(target))
        callback(
          [{ target, borderBoxSize: [size] } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
  });
}

/** The box of the list side of the split, which the report measures. */
function listBox(): HTMLElement {
  const box = tableElement().closest('.Pane')?.parentElement;
  if (!box) throw new Error('No list box');
  return box;
}

/** `F`, which opens the filter while the pointer or the focus is in the list. */
function pressFilterKey() {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: 'f',
    code: 'KeyF',
    keyCode: 70,
    which: 70,
  });
}

async function pickPreset(user: UserEvent, preset: RegExp) {
  await user.click(screen.getByRole('button', { name: /^Link checker/ }));
  await user.click(await screen.findByRole('menuitem', { name: preset }));
}

async function pick(user: UserEvent, trigger: string, option: string) {
  await user.click(screen.getByRole('button', { name: trigger }));
  await user.click(await screen.findByRole('menuitem', { name: option }));
}

/** The text filter of the filter row, whose search landmark is named after the list. */
function filterField() {
  return within(screen.getByRole('search', { name: 'Links' })).getByRole(
    'textbox',
  );
}

async function openFilter(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Filter Links' }));
  return filterField();
}

async function tooltipOf(user: UserEvent, element: HTMLElement) {
  await user.hover(element);
  return (await screen.findByRole('tooltip')).textContent;
}

beforeEach(() => matchMedia([REDUCED_MOTION]));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReportLayout', () => {
  it('shows the URLs that need attention by default', () => {
    const groups = [group('broken'), group('reachable'), group('skipped')];
    renderLayout({ report: report(groups) });
    expect(table().getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[1]))).not.toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[2]))).not.toBeInTheDocument();
    expect(screen.getByText('1 link')).toBeInTheDocument();
    expect(title('Needs attention')).toBeInTheDocument();
  });

  it('switches the status view from the title, with the count of each view', async () => {
    const user = userEvent.setup();
    const groups = [group('broken'), group('reachable'), group('skipped')];
    renderLayout({ report: report(groups) });

    await user.click(screen.getByRole('button', { name: /^Link checker/ }));
    const names = (await screen.findAllByRole('menuitem')).map(
      (option) => option.textContent,
    );
    // "All URLs", then "Needs attention" (the default) and each status that
    // has URLs, by severity, each with its count. The count of every URL is
    // the count after the title once "All URLs" is picked.
    expect(names).toEqual([
      'All links',
      'Needs attention1',
      'Broken1',
      'Working1',
      'Skipped1',
    ]);
    // The page's help sits at the bottom of the menu.
    expect(
      screen.getByText(/Results stay only while this page is open/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /^Working/ }));
    expect(table().getByText(urlOf(groups[1]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[0]))).not.toBeInTheDocument();
    expect(title('Working')).toBeInTheDocument();

    await pickPreset(user, /^All links/);
    expect(title()).toBeVisible();
    expect(screen.getByText('3 links')).toBeInTheDocument();
  });

  it('lists a view only while it keeps URLs or is picked', async () => {
    const user = userEvent.setup();
    const { rerender } = renderLayout({
      report: report([group('reachable'), group('skipped')]),
    });
    const options = async () => {
      await user.click(screen.getByRole('button', { name: /^Link checker/ }));
      const names = (await screen.findAllByRole('menuitem')).map(
        (option) => option.textContent,
      );
      pressEscape();
      return names;
    };
    // The default view keeps no URL, but it's the one picked.
    expect(await options()).toEqual([
      'All links',
      'Needs attention0',
      'Working1',
      'Skipped1',
    ]);
    await pickPreset(user, /^Skipped/);
    expect(title('Skipped')).toBeInTheDocument();
    // Once another view is picked, "Needs attention" keeps no URL, so it
    // goes; the picked status keeps its place once it has no URL left.
    rerender({ report: report([group('reachable')]) });
    expect(await options()).toEqual(['All links', 'Working1', 'Skipped0']);
    await pickPreset(user, /^Working/);
    expect(await options()).toEqual(['All links', 'Working1']);
    // It comes back as soon as a URL needs attention.
    rerender({ report: report([group('reachable'), group('broken')]) });
    expect(await options()).toEqual([
      'All links',
      'Needs attention1',
      'Broken1',
      'Working1',
    ]);
    await pickPreset(user, /^Needs attention/);
    expect(title('Needs attention')).toBeInTheDocument();
  });

  it('combines the model, locale and URL filters', async () => {
    const user = userEvent.setup();
    const groups = [
      group('broken'),
      group('broken', { modelId: 'news', locale: 'it' }),
      group('reachable'),
    ];
    const [page, news] = groups.map(urlOf);
    renderLayout({ report: report(groups) });

    const search = await openFilter(user);
    // The text, the model and the locale filter one list: one search landmark.
    const landmark = screen.getByRole('search', { name: 'Links' });
    expect(landmark).toContainElement(search);
    expect(landmark).toContainElement(
      screen.getByRole('button', { name: 'All models' }),
    );
    expect(landmark).toContainElement(
      screen.getByRole('button', { name: 'All locales' }),
    );
    expect(landmark).toContainElement(
      screen.getByRole('button', { name: 'Close the filter' }),
    );
    expect(screen.getAllByRole('search')).toHaveLength(1);
    await pick(user, 'All models', 'News');
    expect(screen.queryByText(page)).not.toBeInTheDocument();
    expect(table().getByText(news)).toBeInTheDocument();

    // The model, the locale and the text must match the same place.
    await pick(user, 'All locales', 'English');
    expect(screen.getByText('No results', VISIBLE)).toBeInTheDocument();
    await pick(user, 'English', 'Italian');
    await user.type(search, 'not-present');
    expect(await screen.findByText('No results', VISIBLE)).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'BROKEN-NEWS');
    expect(await screen.findByText(news)).toBeInTheDocument();
    expect(screen.getByText('1 link')).toBeInTheDocument();

    // The picker shows the current value, and the menu checks it.
    await user.click(screen.getByRole('button', { name: 'News' }));
    expect(screen.getByRole('menuitem', { name: 'News' })).toBeInTheDocument();
  });

  it('searches all links when the filter finds nothing in a narrower view', async () => {
    const user = userEvent.setup();
    const working = group('reachable');
    renderLayout({ report: report([group('broken'), working]) });
    const search = await openFilter(user);
    await user.type(search, urlOf(working));
    expect(await screen.findByText('No results', VISIBLE)).toBeInTheDocument();
    // The same search runs across every link.
    await user.click(screen.getByRole('button', { name: 'Show all links' }));
    expect(table().getByText(urlOf(working))).toBeInTheDocument();
    expect(search).toHaveValue(urlOf(working));
    // In "All links" there is no wider view to search.
    await user.type(search, '-not-present');
    expect(await screen.findByText('No results', VISIBLE)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show all links' }),
    ).not.toBeInTheDocument();
  });

  it('hides the model and locale pickers when the report has one of each', async () => {
    const user = userEvent.setup();
    renderLayout({ report: report([group('broken'), group('unverified')]) });
    await openFilter(user);
    expect(
      screen.queryByRole('button', { name: 'All models' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'All locales' }),
    ).not.toBeInTheDocument();
  });

  it('opens the filter with F, and finds a locale by its code', async () => {
    const user = userEvent.setup();
    const locales = ['en', 'it', 'de', 'fr', 'pt-BR'];
    renderLayout({
      report: report(
        locales.map((locale) =>
          group('broken', { locale, slug: `broken-${locale}` }),
        ),
      ),
    });
    await user.hover(tableElement());
    pressFilterKey();
    expect(
      await screen.findByRole('search', { name: 'Links' }),
    ).toContainElement(filterField());

    // The menu's search reads each option's innerText, which jsdom lacks.
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent ?? '';
      },
    });
    try {
      await user.click(screen.getByRole('button', { name: 'All locales' }));
      await user.type(await screen.findByPlaceholderText('Search...'), 'pt-br');
      expect(
        screen.getByRole('menuitem', { name: 'Brazilian Portuguese' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: 'German' }),
      ).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'innerText');
    }
  });

  it('moves the focus back to the open filter with F', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    renderLayout({
      report: report([broken, group('broken', { slug: 'other' })]),
    });
    const search = await openFilter(user);
    await user.type(search, 'example');
    const row = rowOf(urlOf(broken));
    row.focus();
    expect(row).toHaveFocus();

    pressFilterKey();
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue('example');
  });

  it('clears the text, model and locale filters when the filter closes, and keeps the view', async () => {
    const user = userEvent.setup();
    const groups = [
      group('broken'),
      group('reachable'),
      group('reachable', { modelId: 'news', locale: 'it' }),
    ];
    renderLayout({ report: report(groups) });
    await pickPreset(user, /^All links/);
    const search = await openFilter(user);
    await pick(user, 'All models', 'Page');
    await user.type(search, 'reachable');
    expect(await screen.findByText('1 link')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close the filter' }));
    expect(
      screen.queryByRole('search', { name: 'Links' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText('3 links')).toBeInTheDocument();
    expect(title()).toBeVisible();

    // Opening the filter again starts empty.
    expect(await openFilter(user)).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'All models' }),
    ).toBeInTheDocument();

    // Escape in the text field closes the row too, and clears it.
    await user.type(filterField(), 'reachable');
    expect(await screen.findByText('2 links')).toBeInTheDocument();
    pressEscape();
    expect(
      screen.queryByRole('search', { name: 'Links' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText('3 links')).toBeInTheDocument();
  });

  it('exports while filtered, and explains why an empty or busy report cannot export', async () => {
    const user = userEvent.setup();
    const { onExport, unmount } = renderLayout({
      report: report([group('broken'), group('reachable')]),
    });
    await user.type(await openFilter(user), 'no-match');
    await user.click(await openExport(user));
    expect(onExport).toHaveBeenCalledTimes(1);
    unmount();

    // A settled report with no URL has nothing to export or to pick: no
    // "⋮", and the title is no menu.
    const empty = renderLayout({ report: report([]) });
    expect(
      screen.queryByRole('button', { name: 'Actions' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Link checker' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Needs attention/ }),
    ).not.toBeInTheDocument();
    empty.unmount();

    // While a scan runs, URLs can still come: the option says why it can't run yet.
    const waiting = renderLayout({
      report: report([], { state: 'running' }),
      scanning: true,
    });
    const waitingOption = await openExport(user);
    expect(await tooltipOf(user, waitingOption)).toBe(
      'The report has no links to export yet.',
    );
    await user.click(waitingOption);
    expect(waiting.onExport).not.toHaveBeenCalled();
    waiting.unmount();

    renderLayout({ report: report([group('broken')]), exporting: true });
    expect(await tooltipOf(user, await openExport(user))).toBe(
      'The CSV is being prepared.',
    );
  });

  it('opens a row in the detail, and a record from it', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    const { onOpenRecord } = renderLayout({ report: report([broken]) });
    expect(
      screen.queryByRole('complementary', { name: 'Link' }),
    ).not.toBeInTheDocument();

    await user.click(table().getByText(urlOf(broken)));
    expect(rowOf(urlOf(broken))).toHaveAttribute('aria-current', 'true');
    // On top: the path, which tells the link from the others of its site, then the site.
    expect(detail().getByText('/path')).toBeInTheDocument();
    expect(detail().getByText('broken-page.example')).toBeInTheDocument();
    expect(detail().getByText('Broken')).toBeInTheDocument();
    expect(detail().getByText('404')).toBeInTheDocument();
    // A broken link says why in plain words, under its status.
    expect(detail().getByText('Result: broken')).toBeInTheDocument();
    expect(
      detail().getByRole('link', {
        name: `${urlOf(broken)} (opens in a new tab)`,
      }),
    ).toHaveAttribute('target', '_blank');

    // Each place: the field and its locale, then the fields and blocks around it.
    expect(
      detail().getByText('Body, English, in Sections > Hero'),
    ).toBeInTheDocument();
    await user.click(
      detail().getByRole('button', {
        name: /^Page\s*Page record\s*,\s*open record$/,
      }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith('record-page');
  });

  it('names no locale in the places on a single-locale site', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    renderLayout({ report: report([broken]), multiLocale: false });
    await user.click(table().getByText(urlOf(broken)));
    expect(detail().getByText('Body, in Sections > Hero')).toBeInTheDocument();
    expect(detail().queryByText(/English/)).not.toBeInTheDocument();
  });

  it('keeps the filter and the report while the detail opens and closes', async () => {
    const user = userEvent.setup();
    const groups = [group('broken', { slug: 'first' }), group('broken')];
    renderLayout({ report: report(groups) });
    const search = await openFilter(user);
    await user.type(search, 'first');
    const results = tableElement();

    await user.click(table().getByText(urlOf(groups[0])));
    expect(screen.getByRole('complementary', { name: 'Link' })).toBeVisible();
    pressEscape();
    expect(
      screen.queryByRole('complementary', { name: 'Link' }),
    ).not.toBeInTheDocument();
    expect(tableElement()).toBe(results);
    expect(search).toHaveValue('first');
    expect(screen.queryByText(urlOf(groups[1]))).not.toBeInTheDocument();
  });

  it('opens and closes the detail over the list in a narrow frame, without remounting the report', async () => {
    const user = userEvent.setup();
    matchMedia([REDUCED_MOTION, NARROW_FRAME]);
    const broken = group('broken');
    renderLayout({ report: report([broken]) });
    const results = tableElement();
    const row = rowOf(urlOf(broken));

    await user.click(table().getByText(urlOf(broken)));
    expect(screen.getByRole('complementary', { name: 'Link' })).toBeVisible();
    expect(tableElement()).toBe(results);

    // The panel over the list has a way back to it.
    await user.click(detail().getByRole('button', { name: 'Hide details' }));
    expect(
      screen.queryByRole('complementary', { name: 'Link' }),
    ).not.toBeInTheDocument();
    expect(tableElement()).toBe(results);
    expect(rowOf(urlOf(broken))).toBe(row);
  });

  it('keeps measuring the list when the frame crosses the width of the panel over the list', () => {
    const narrowFrame = changingMedia(NARROW_FRAME, true);
    const groups = Array.from({ length: 60 }, (_, index) =>
      group('broken', { slug: `broken-${index + 1}` }),
    );
    renderLayout({ report: report(groups) });
    const perPage = () => screen.queryByLabelText('Items per page');
    expect(perPage()).toBeInTheDocument();
    // A narrow list shows fewer page numbers and no "Show" select.
    resize(listBox(), 400);
    expect(perPage()).not.toBeInTheDocument();

    // The frame widens: the split puts the list in a box of another kind,
    // and the new box is the one measured.
    const before = listBox();
    act(() => narrowFrame(false));
    expect(listBox()).not.toBe(before);
    resize(listBox(), 900);
    expect(perPage()).toBeInTheDocument();
    resize(listBox(), 400);
    expect(perPage()).not.toBeInTheDocument();
  });

  it('keeps the content issues as shown when the scan settles', async () => {
    const user = userEvent.setup();
    const warnings = Array.from(
      { length: 8 },
      (_, index) => `News › Body (en) › Link ${index}: Not found`,
    );
    const groups = [group('broken')];
    const { rerender } = renderLayout({
      report: report(groups, {
        state: 'running',
        warnings,
        finishedAt: undefined,
      }),
      scanning: true,
    });
    // The scan's state comes first, then what it couldn't read.
    expect(
      screen
        .getByText(/^Scanning links…/)
        .compareDocumentPosition(screen.getByRole('alert')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await user.click(
      screen.getByRole('button', { name: "Show what couldn't be read" }),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    // The running scan's callout gives way to the summary, which keeps the list open.
    rerender({
      report: report(groups, { state: 'partial', warnings }),
      settled: { state: 'partial', finishedAt: '2026-09-23T12:01:00Z' },
      scanning: false,
    });
    const summary = within(screen.getByRole('alert'));
    expect(summary.getByText('Scan incomplete')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: "Hide what couldn't be read" }),
    ).toBeInTheDocument();
  });

  it('starts a scan or opens the scope choice from the title bar, and keeps the focus through a recheck', async () => {
    const user = userEvent.setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const broken = group('broken');
    const { onScan, onChooseScope, rerender } = renderLayout({
      report: report([broken]),
    });
    await user.click(screen.getByRole('button', { name: 'Scan links' }));
    expect(onScan).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'More scan options' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Choose what to scan…' }),
    );
    expect(onChooseScope).toHaveBeenCalledTimes(1);

    focusFromKeyboard();
    screen.getByRole('button', { name: 'Scan links' }).focus();
    // A recheck disables the action with its reason: the keyboard's focus stays on it.
    rerender({ rechecking: true });
    const blocked = screen.getByRole('button', { name: 'Scan links' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).toHaveFocus();

    rerender({ rechecking: false });
    expect(screen.getByRole('button', { name: 'Scan links' })).toHaveFocus();
  });

  it('rechecks the open URL unless a scan is running or the URL is skipped', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    const skipped = group('skipped');
    const { onRecheck, rerender } = renderLayout({
      report: report([broken, skipped]),
    });

    await user.click(table().getByText(urlOf(broken)));
    await user.click(detail().getByRole('button', { name: 'Recheck link' }));
    expect(onRecheck).toHaveBeenCalledWith(broken);

    rerender({ scanning: true });
    const recheck = detail().getByRole('button', { name: 'Recheck link' });
    expect(recheck).toHaveAttribute('aria-disabled', 'true');
    expect(await tooltipOf(user, recheck)).toBe(
      "You can't recheck a link while links are being checked.",
    );

    rerender({ scanning: false });
    await pickPreset(user, /^All links/);
    await user.click(table().getByText(urlOf(skipped)));
    expect(
      detail().queryByRole('button', { name: 'Recheck link' }),
    ).not.toBeInTheDocument();
  });

  it('explains that fragments are not verified', async () => {
    const user = userEvent.setup();
    const broken = group('broken', { fragment: true });
    renderLayout({ report: report([broken]) });
    await user.click(table().getByText(urlOf(broken)));
    expect(
      detail().getByText(/Some records link to a #fragment of this page/),
    ).toBeInTheDocument();
    // A place that links to a variant of the URL shows it.
    const variant = detail().getByRole('link', {
      name: `${urlOf(broken)}#pricing (opens in a new tab)`,
    });
    expect(variant).toHaveAttribute('href', `${urlOf(broken)}#pricing`);
  });

  it('keeps stale URLs in the view of their status and tags them', async () => {
    const user = userEvent.setup();
    const stale = group('reachable', { stale: true });
    renderLayout({
      report: report([stale], { stale: true }),
      changedRecordIds: new Set(['record-page']),
    });
    // A changed record doesn't make a working link need attention.
    expect(screen.getByText('Nothing needs attention')).toBeInTheDocument();
    await pickPreset(user, /^Working/);
    expect(table().getByText(urlOf(stale))).toBeInTheDocument();
    expect(table().getByText('Content changed')).toBeInTheDocument();
    // The summary says it in one sentence: no second callout.
    const summary = screen.getByRole('note');
    expect(
      within(summary).getByText(/^Some records changed after this scan/),
    ).toBeInTheDocument();
    // The title bar's "Scan links" scans again: the summary has no button.
    expect(within(summary).queryByRole('button')).not.toBeInTheDocument();

    // In the detail, the pill of the changed record says it.
    await user.click(table().getByText(urlOf(stale)));
    expect(
      detail().queryByText(/changed after the scan/),
    ).not.toBeInTheDocument();
    expect(detail().getByText('Content changed')).toBeInTheDocument();
  });

  it('reads incomplete and canceled scans from the settled state', () => {
    const groups = [group('broken'), group('cancelled')];
    const { unmount } = renderLayout({
      report: report(groups, {
        state: 'partial',
        warnings: ['News: Record access denied'],
      }),
      settled: { state: 'partial', finishedAt: '2026-09-23T12:01:00Z' },
    });
    const partial = within(screen.getByRole('alert'));
    expect(partial.getByText('Scan incomplete')).toBeInTheDocument();
    expect(
      partial.getByText(
        "Some content couldn't be read, so its links aren't in this report.",
      ),
    ).toBeInTheDocument();
    // The issues show on demand, under the callout.
    expect(
      screen.queryByText('News: Record access denied'),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: "Show what couldn't be read" }),
    );
    expect(screen.getByText('News: Record access denied')).toBeInTheDocument();
    // "Needs attention" keeps the links with a problem, not those that weren't checked.
    expect(table().getByText('Broken')).toBeInTheDocument();
    expect(table().queryByText('Not checked')).not.toBeInTheDocument();
    expect(screen.getByText('1 link')).toBeInTheDocument();
    // The live region says the headline of the settled state.
    expect(screen.getByRole('status')).toHaveTextContent('Scan incomplete');
    unmount();

    renderLayout({
      report: report(groups, { state: 'cancelled' }),
      settled: { state: 'cancelled', finishedAt: '2026-09-23T12:01:00Z' },
    });
    // The user's own stop: a neutral callout with no title.
    const canceled = within(screen.getByRole('note'));
    expect(canceled.queryByText('Scan canceled')).not.toBeInTheDocument();
    expect(
      canceled.getByText(
        'This report covers only what was checked before you stopped the scan.',
      ),
    ).toBeInTheDocument();
    // The facts are a line of the summary callout, with the links not checked.
    expect(
      canceled.getByText(/• 1 not checked • Stopped /),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Scan canceled');
  });

  it('shows the progress above the results and "Cancel scan" once a URL needs attention', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    const { onCancel } = renderLayout({
      report: report([broken, group('queued')], {
        state: 'running',
        recordsScanned: 60,
        finishedAt: undefined,
      }),
      scanning: true,
    });
    // Two pages of records read, one URL checked and one to go: 3 of 4.
    expect(
      screen.getByRole('progressbar', { name: 'Scanning links' }),
    ).toHaveAttribute('aria-valuenow', '75');
    expect(
      screen.getByText(
        'Scanning links… • Page • English • 60 records read • 1 of 2 links checked',
      ),
    ).toBeInTheDocument();
    expect(table().getByText(urlOf(broken))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter Links' }),
    ).toBeInTheDocument();
    // While the scan runs its live region stays empty.
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(
      screen.queryByRole('button', { name: 'Scan links' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More scan options' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the progress centered until a URL needs attention, and the bar from moving back', () => {
    const running = (groups: LinkGroup[]) =>
      report(groups, {
        state: 'running',
        discovering: true,
        recordsScanned: 60,
        finishedAt: undefined,
      });
    const { rerender } = renderLayout({
      report: running([]),
      recordTotal: 120,
      scanning: true,
    });
    expect(screen.getByText('Scanning links…')).toBeInTheDocument();
    expect(screen.getByText('60 of 120 records read')).toBeInTheDocument();
    // Nothing to filter or list yet.
    expect(
      screen.queryByRole('button', { name: 'Filter Links' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.Table')).not.toBeInTheDocument();

    // URLs that don't need attention keep it centered. They add work, which
    // would lower the share: the bar holds.
    const pending = [group('queued'), group('checking')];
    rerender({ report: running(pending) });
    expect(
      screen.getByRole('progressbar', { name: 'Scanning links' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(
      screen.getByText('60 of 120 records read • 0 of 2 links checked'),
    ).toBeInTheDocument();
    expect(document.querySelector('.Table')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Nothing needs attention yet'),
    ).not.toBeInTheDocument();

    // The first URL that needs attention moves the progress above the results.
    const broken = group('broken');
    rerender({ report: running([...pending, broken]) });
    expect(table().getByText(urlOf(broken))).toBeInTheDocument();
    expect(
      screen.getByText(/^Scanning links… • Page • English/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Filter Links' }),
    ).toBeInTheDocument();
  });

  it('keeps running when concurrent additions outgrow the earlier record count', () => {
    renderLayout({
      report: report([], {
        state: 'running',
        discovering: true,
        recordsScanned: 200_001,
        finishedAt: undefined,
      }),
      recordTotal: 200_000,
      scanning: true,
    });
    expect(
      screen.getByText('200,001 of 200,001 records read'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Scanning links' }),
    ).toHaveAttribute('aria-valuenow', '99');
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeEnabled();
    expect(screen.queryByText('Scan complete')).not.toBeInTheDocument();
  });

  it('shows the facts at the top once a scan ends with nothing needing attention', () => {
    const { rerender } = renderLayout({
      report: report([group('queued')], {
        state: 'running',
        finishedAt: undefined,
      }),
      scanning: true,
    });
    expect(screen.getByText(/^Scanning links/)).toBeInTheDocument();
    rerender({ report: report([group('reachable')]), scanning: false });
    expect(screen.queryByText(/^Scanning links/)).not.toBeInTheDocument();
    // A complete scan is a neutral callout with its facts and no title, not an alert.
    const summary = within(screen.getByRole('note'));
    expect(summary.queryByText('Scan complete')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(summary.getByText(/• Finished /)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Scan complete');
    expect(screen.getByText('Nothing needs attention')).toBeInTheDocument();
  });

  it('shows no share while the record count is unknown', () => {
    renderLayout({
      report: report([], {
        state: 'running',
        discovering: true,
        recordsScanned: 14,
        finishedAt: undefined,
      }),
      scanning: true,
    });
    expect(screen.getByText('Scanning links…')).toBeInTheDocument();
    expect(screen.getByText('Page • English')).toBeInTheDocument();
    expect(screen.getByText('14 records read')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('does not announce 100% before a running scan has finished', () => {
    const { rerender } = renderLayout({
      report: report([], {
        state: 'running',
        discovering: true,
        recordsScanned: 200_000,
        finishedAt: undefined,
      }),
      recordTotal: 200_000,
      scanning: true,
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '99',
    );
    rerender({
      report: report([], {
        state: 'running',
        discovering: false,
        recordsScanned: 200_000,
        finishedAt: undefined,
      }),
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '99',
    );
    rerender({
      report: report([], { recordsScanned: 200_000 }),
      scanning: false,
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Scan complete');
    expect(screen.getByText(/• Finished /)).toBeInTheDocument();
  });

  it('paginates long reports', async () => {
    const user = userEvent.setup();
    const groups = Array.from({ length: 60 }, (_, index) =>
      group('broken', { slug: `broken-${index + 1}` }),
    );
    renderLayout({ report: report(groups) });
    const pages = () =>
      within(screen.getByRole('navigation', { name: 'Links pagination' }));
    expect(table().getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[50]))).not.toBeInTheDocument();
    // The list was scrolled down: the Pane's content is its scroll box.
    const scrollBox = tableElement().closest<HTMLElement>('.Pane__content');
    if (!scrollBox) throw new Error('No scroll box');
    let scrollTop = 400;
    Object.defineProperty(scrollBox, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    await user.click(pages().getByRole('button', { name: 'Next page' }));
    expect(table().getByText(urlOf(groups[50]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[0]))).not.toBeInTheDocument();
    // A new page starts at the top of the list.
    expect(scrollTop).toBe(0);

    await user.selectOptions(screen.getByLabelText('Items per page'), '100');
    expect(
      screen.queryByRole('navigation', { name: 'Links pagination' }),
    ).not.toBeInTheDocument();
    expect(table().getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(table().getByText(urlOf(groups[59]))).toBeInTheDocument();
  });

  it('moves the open row with the keyboard', async () => {
    const user = userEvent.setup();
    const first = group('broken', { slug: 'first' });
    const second = group('broken', { slug: 'second' });
    renderLayout({ report: report([first, second]) });

    rowOf(urlOf(first)).focus();
    await user.keyboard('{Enter}');
    expect(rowOf(urlOf(first))).toHaveAttribute('aria-current', 'true');
    expect(detail().getByText('first.example')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(rowOf(urlOf(second))).toHaveAttribute('aria-current', 'true');
    expect(rowOf(urlOf(second))).toHaveFocus();
    expect(rowOf(urlOf(first))).not.toHaveAttribute('aria-current');
    expect(detail().getByText('second.example')).toBeInTheDocument();

    pressEscape();
    expect(rowOf(urlOf(second))).not.toHaveAttribute('aria-current');
    expect(
      screen.queryByRole('complementary', { name: 'Link' }),
    ).not.toBeInTheDocument();

    // "]" opens the last open row again.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: ']',
      code: 'BracketRight',
    });
    expect(rowOf(urlOf(second))).toHaveAttribute('aria-current', 'true');
    expect(detail().getByText('second.example')).toBeInTheDocument();
  });

  it('shows an empty report as "No links found"', () => {
    renderLayout({ report: report([]) });
    expect(screen.getByText('No links found')).toBeInTheDocument();
    // The blank slate says it: the facts don't repeat it.
    expect(screen.getByRole('note')).toHaveTextContent(
      /^Page • English • 0 records read • Finished/,
    );
    expect(
      screen.queryByRole('button', { name: 'Filter Links' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.Table')).not.toBeInTheDocument();
  });

  it('blocks new scans during a recheck and keeps the settled summary', async () => {
    const user = userEvent.setup();
    const checking = group('checking', { slug: 'rechecking' });
    const broken = group('broken');
    renderLayout({
      report: report([broken, checking], {
        state: 'running',
        finishedAt: undefined,
      }),
      rechecking: true,
      recheckKey: checking.key,
      settled: { state: 'complete', finishedAt: '2026-09-23T12:01:00Z' },
    });
    const scan = screen.getByRole('button', { name: 'Scan links' });
    expect(scan).toHaveAttribute('aria-disabled', 'true');
    expect(await tooltipOf(user, scan)).toBe(
      "You can't start a scan while a link is being rechecked.",
    );
    const scope = screen.getByRole('button', { name: 'More scan options' });
    expect(scope).toHaveAttribute('aria-disabled', 'true');
    expect(await tooltipOf(user, scope)).toBe(
      "You can't choose what to scan while a link is being rechecked.",
    );
    expect(
      screen.queryByRole('button', { name: 'Cancel scan' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Scan complete');
    expect(screen.getByText(/Finished 23\/09\/2026, 12:01/)).toBeVisible();

    await user.click(table().getByText(urlOf(broken)));
    expect(
      detail().getByRole('button', { name: 'Recheck link' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('explains only the statuses whose word needs it', async () => {
    const user = userEvent.setup();
    const unverified = group('unverified');
    renderLayout({ report: report([unverified]) });
    await user.click(table().getByText(urlOf(unverified)));
    expect(detail().getByText('Result: unverified')).toBeInTheDocument();
  });

  it('keeps a rechecked URL in the view with its previous result', () => {
    const broken = group('broken');
    const checking: LinkGroup = {
      ...broken,
      result: { ...broken.result, status: 'checking', message: 'Checking' },
    };
    renderLayout({
      report: report([checking, group('reachable')], {
        state: 'running',
        finishedAt: undefined,
      }),
      rechecking: true,
      recheckKey: broken.key,
      recheckResult: broken.result,
      settled: { state: 'complete', finishedAt: '2026-09-23T12:01:00Z' },
    });
    expect(within(rowOf(urlOf(broken))).getByText('Checking')).toBeVisible();
    // The title bar counts the rechecked link as it was.
    expect(screen.getByText('1 link')).toBeInTheDocument();
    expect(
      screen.queryByText('Nothing needs attention'),
    ).not.toBeInTheDocument();
  });

  it('lists the broken links first, and cycles the sort from page 1', async () => {
    const user = userEvent.setup();
    const groups = Array.from({ length: 60 }, (_, index) =>
      group(index % 2 ? 'broken' : 'unverified', {
        slug: `url-${String(index + 1).padStart(2, '0')}`,
      }),
    );
    renderLayout({ report: report(groups) });
    const firstRow = () =>
      tableElement().querySelector('.Table__row--openable')?.textContent;
    const next = () =>
      within(
        screen.getByRole('navigation', { name: 'Links pagination' }),
      ).getByRole('button', { name: 'Next page' });
    const statusHeader = () => table().getByRole('button', { name: /^Status/ });

    // Ascending severity at first, as in the record panel: broken first.
    expect(firstRow()).toContain('url-02');
    expect(firstRow()).toContain('Broken');
    await user.click(next());
    expect(firstRow()).toContain('url-41');

    // Descending, from page 1.
    await user.click(statusHeader());
    expect(firstRow()).toContain('url-01');
    expect(firstRow()).toContain('Unverified');

    // No sort: discovery order.
    await user.click(next());
    await user.click(statusHeader());
    expect(firstRow()).toContain('url-01');
    await user.click(next());
    expect(firstRow()).toContain('url-51');
  });

  it('stays on the page it fell back to when the list grows again', async () => {
    const user = userEvent.setup();
    const groups = Array.from({ length: 60 }, (_, index) =>
      group('broken', { slug: `broken-${index + 1}` }),
    );
    const { rerender } = renderLayout({ report: report(groups) });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(table().getByText(urlOf(groups[50]))).toBeInTheDocument();

    rerender({ report: report(groups.slice(0, 10)) });
    expect(table().getByText(urlOf(groups[0]))).toBeInTheDocument();
    rerender({ report: report(groups) });
    expect(table().getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[50]))).not.toBeInTheDocument();
  });

  it('leaves a canceled scan without URLs to its summary', () => {
    renderLayout({
      report: report([], { state: 'cancelled' }),
      settled: { state: 'cancelled', finishedAt: '2026-09-23T12:01:00Z' },
    });
    expect(
      within(screen.getByRole('note')).getByText(
        'This report covers only what was checked before you stopped the scan.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('No links found')).not.toBeInTheDocument();
  });

  it('shows a scan that read nothing as a failure, in place of the report', () => {
    renderLayout({
      report: report([], {
        state: 'partial',
        recordsScanned: 0,
        warnings: [
          'Article: Access was refused. Reload the page and scan again.',
          'Author: Access was refused. Reload the page and scan again.',
        ],
      }),
      settled: { state: 'partial', finishedAt: '2026-09-23T12:01:00Z' },
    });
    // The blank slate's title, and the live region that announces it.
    expect(screen.getAllByText("Couldn't read your records")).toHaveLength(2);
    // The reason once, with no summary or list of issues around it.
    expect(
      screen.getAllByText(
        'Access was refused. Reload the page and scan again.',
      ),
    ).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't read your records",
    );
  });

  it('keeps the summary of a scan whose models have no records', () => {
    renderLayout({
      report: report([], {
        state: 'partial',
        recordsScanned: 0,
        warnings: ["Article: Some blocks couldn't be read."],
      }),
      settled: { state: 'partial', finishedAt: '2026-09-23T12:01:00Z' },
      recordTotal: 0,
    });
    // Nothing failed to read: the summary says what the scan left out.
    expect(
      screen.queryByText("Couldn't read your records"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Scan incomplete');
    expect(screen.getByText(/0 records read/)).toBeInTheDocument();
  });

  it('counts invalid and skipped URLs as settled while checking', () => {
    renderLayout({
      report: report([group('queued'), group('checking'), group('invalid')], {
        state: 'running',
        finishedAt: undefined,
      }),
      scanning: true,
    });
    expect(
      screen.getByText(/3 records read • 1 of 3 links checked$/),
    ).toBeInTheDocument();
  });

  it('formats coverage warnings', () => {
    renderLayout({
      report: report([group('broken')], {
        state: 'partial',
        warnings: [
          'Body (en) › Hero: Current content could not be fully read; some links could not be checked.',
        ],
      }),
      settled: { state: 'partial', finishedAt: '2026-09-23T12:01:00Z' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: "Show what couldn't be read" }),
    );
    expect(screen.getByText('Body (English) > Hero')).toBeInTheDocument();
  });

  it('says once that the link checking service refused the plugin, and shows its links as not checked', async () => {
    const user = userEvent.setup();
    const refused = group('unverified');
    refused.result = { ...refused.result, reason: 'proxy-refused' };
    const invalid = group('invalid');
    const { unmount } = renderLayout({ report: report([refused, invalid]) });
    // The summary says it, in place of "Scan complete": one callout.
    const [summary] = screen.getAllByRole('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      within(summary).getByText("Links couldn't be checked"),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      "Links couldn't be checked",
    );
    // Only the invalid link needs attention: the refused one wasn't checked.
    expect(table().getByText(urlOf(invalid))).toBeInTheDocument();
    expect(table().queryByText(urlOf(refused))).not.toBeInTheDocument();
    await pickPreset(user, /^Not checked/);
    expect(table().getByText('Not checked')).toBeInTheDocument();
    // The link's detail doesn't say it again.
    await user.click(table().getByText(urlOf(refused)));
    expect(detail().getByText('Not checked')).toBeInTheDocument();
    expect(detail().queryByText(/marketplace/)).not.toBeInTheDocument();
    unmount();

    // With no other link, no view says the links are fine.
    renderLayout({ report: report([refused]) });
    expect(
      screen.queryByText('Nothing needs attention'),
    ).not.toBeInTheDocument();
  });

  it("calls only the checked links clean when some weren't checked", async () => {
    const user = userEvent.setup();
    const reachable = group('reachable');
    const unchecked = group('cancelled');
    const settled = {
      state: 'cancelled' as const,
      finishedAt: '2026-09-23T12:01:00Z',
    };
    const { unmount } = renderLayout({
      report: report([reachable, unchecked], { state: 'cancelled' }),
      settled,
    });
    expect(
      screen.queryByText('Nothing needs attention'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('No problems found')).toBeInTheDocument();
    expect(
      screen.getByText(
        'None of the checked links is broken, invalid or unverified.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all links' }));
    expect(table().getByText(urlOf(unchecked))).toBeInTheDocument();
    unmount();

    // With no link checked, the summary's "not checked" is all there is to say.
    renderLayout({
      report: report([unchecked], { state: 'cancelled' }),
      settled,
    });
    expect(screen.queryByText('No problems found')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Nothing needs attention'),
    ).not.toBeInTheDocument();
  });

  it('switches to all URLs from a clean view', async () => {
    const user = userEvent.setup();
    const reachable = group('reachable');
    renderLayout({ report: report([reachable]) });
    expect(screen.getByText('Nothing needs attention')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all links' }));
    expect(table().getByText(urlOf(reachable))).toBeInTheDocument();
    expect(title()).toBeVisible();
    await user.click(table().getByText(urlOf(reachable)));
    expect(detail().getByText('Working')).toBeInTheDocument();
  });
});
