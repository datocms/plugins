import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaState, resetMediaState } from '../test/fixtures';
import type { CheckStatus, LinkGroup, ScanReport } from '../types';
import { ReportLayout, type ReportLayoutProps } from './ReportLayout';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);

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
    scope: 'All models • All locales',
    startedAt: '2026-09-23T12:00:00Z',
    finishedAt: '2026-09-23T12:01:00Z',
    ...overrides,
  };
}

/** Owns the collapse state, as the page does. */
function Harness(props: ReportLayoutProps) {
  const [collapsed, setCollapsed] = useState(props.collapsed);
  return (
    <ReportLayout
      {...props}
      collapsed={collapsed}
      onCollapsedChange={(next) => {
        props.onCollapsedChange(next);
        setCollapsed(next);
      }}
    />
  );
}

function renderLayout(overrides: Partial<ReportLayoutProps> = {}) {
  const callbacks = {
    onCollapsedChange: vi.fn(),
    onScan: vi.fn(),
    onChooseScope: vi.fn(),
    onCancel: vi.fn(),
    onExport: vi.fn(),
    onRecheck: vi.fn(),
    onOpenRecord: vi.fn(),
  };
  const props: ReportLayoutProps = {
    report: report([]),
    scanning: false,
    rechecking: false,
    changedRecordIds: new Set<string>(),
    multiLocale: true,
    uiLocale: 'en',
    collapsed: true,
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

function table() {
  return within(screen.getByRole('table', { name: 'Link check results' }));
}

function rowOf(url: string): HTMLTableRowElement {
  const row = table().getByText(url).closest('tr');
  if (!row) throw new Error(`No row for ${url}`);
  return row;
}

function sidebar() {
  return within(screen.getByRole('complementary', { name: 'Link details' }));
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  trigger: RegExp,
  option: string | RegExp,
) {
  await user.click(screen.getByRole('button', { name: trigger }));
  await user.click(screen.getByRole('menuitem', { name: option }));
}

beforeEach(() => resetMediaState());

describe('ReportLayout', () => {
  it('shows the URLs that need attention by default', () => {
    const groups = [group('broken'), group('reachable'), group('skipped')];
    renderLayout({ report: report(groups) });
    expect(screen.getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[1]))).not.toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[2]))).not.toBeInTheDocument();
    expect(screen.getByText('1 URL')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Status: Needs attention' }),
    ).toBeInTheDocument();
  });

  it('combines the status, model, locale and URL filters', async () => {
    const user = userEvent.setup();
    const groups = [
      group('broken'),
      group('broken', { modelId: 'news', locale: 'it' }),
      group('reachable'),
      group('skipped'),
    ];
    const [page, news, reachable] = groups.map(urlOf);
    renderLayout({ report: report(groups) });

    const modelPicker = () =>
      screen
        .getByRole('button', { name: /^Model:/ })
        .closest('.blc-filter-model');
    expect(modelPicker()).not.toHaveClass('blc-filter--set');
    await pick(user, /^Model:/, 'News');
    expect(screen.queryByText(page)).not.toBeInTheDocument();
    expect(screen.getByText(news)).toBeInTheDocument();
    // A narrow pane hides the picker only while it shows every model.
    expect(modelPicker()).toHaveClass('blc-filter--set');

    await pick(user, /^Locale:/, 'English');
    expect(screen.getByText('No results found')).toBeInTheDocument();

    await pick(user, /^Locale:/, 'Italian');
    const search = screen.getByLabelText('Search URLs');
    await user.type(search, 'not-present');
    expect(await screen.findByText('No results found')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'BROKEN-NEWS');
    expect(await screen.findByText(news)).toBeInTheDocument();

    await user.clear(search);
    await pick(user, /^Model:/, 'All models');
    expect(modelPicker()).not.toHaveClass('blc-filter--set');
    await pick(user, /^Locale:/, 'All locales');
    await pick(user, /^Status:/, /^Reachable/);
    expect(screen.getByText(reachable)).toBeInTheDocument();
    expect(screen.queryByText(page)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Status: Reachable' }),
    ).toBeInTheDocument();
  });

  it('hides the model and locale pickers when the report has one of each', () => {
    renderLayout({ report: report([group('broken'), group('unverified')]) });
    expect(
      screen.getByRole('button', { name: /^Status:/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Model:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Locale:/ }),
    ).not.toBeInTheDocument();
  });

  it('clears every filter at once', async () => {
    const user = userEvent.setup();
    const groups = [group('broken'), group('reachable')];
    renderLayout({ report: report(groups) });
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument();

    await pick(user, /^Status:/, /^All URLs/);
    await user.type(screen.getByLabelText('Search URLs'), 'reachable');
    expect(await screen.findByText('1 URL')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Search URLs')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Status: Needs attention' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[1]))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument();
  });

  it('exports while filtered, and explains why export is disabled without URLs', async () => {
    const user = userEvent.setup();
    const { onExport, unmount } = renderLayout({
      report: report([group('broken'), group('reachable')]),
    });
    await user.type(screen.getByLabelText('Search URLs'), 'no-match');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    unmount();

    renderLayout({ report: report([]) });
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(
      screen.getByText('You cannot export the report as it has no URLs'),
    ).toBeInTheDocument();
  });

  it('selects a row, opens the sidebar and opens a record from it', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    const { onOpenRecord, onCollapsedChange } = renderLayout({
      report: report([broken]),
    });
    expect(
      screen.queryByRole('complementary', { name: 'Link details' }),
    ).not.toBeInTheDocument();

    await user.click(table().getByText(urlOf(broken)));
    expect(rowOf(urlOf(broken))).toHaveAttribute('aria-current', 'true');
    expect(onCollapsedChange).toHaveBeenCalledWith(false);

    const link = within(sidebar().getByRole('region', { name: 'Link' }));
    expect(link.getByText('Broken')).toBeInTheDocument();
    expect(link.getByText('404')).toBeInTheDocument();
    // The status word and the HTTP status row already say it.
    expect(link.queryByText('Result: broken')).not.toBeInTheDocument();
    expect(
      link.getByRole('link', {
        name: `${urlOf(broken)} (opens in a new tab)`,
      }),
    ).toHaveAttribute('target', '_blank');
    expect(
      sidebar().getByRole('region', { name: 'Used in 1 record' }),
    ).toBeInTheDocument();

    // Each place: the field and its locale, the fields and blocks around it underneath.
    const record = sidebar().getByRole('button', {
      name: 'Open record Page record',
    });
    const row = record.closest<HTMLElement>('.blc-record-row');
    if (!row) throw new Error('The record button has no row');
    expect(within(row).getByText('Body')).toHaveClass('blc-place-label__field');
    expect(within(row).getByText('English')).toHaveClass(
      'blc-place-label__locale',
    );
    expect(within(row).getByText('Sections > Hero')).toHaveClass(
      'blc-place-label__path',
    );
    // The name stays short; the places are its description.
    expect(record).toHaveAccessibleDescription(
      'Page. Body, English, in Sections > Hero',
    );

    await user.click(record);
    expect(onOpenRecord).toHaveBeenCalledWith('record-page');
  });

  it('names no locale in the places on a single-locale site', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    renderLayout({ report: report([broken]), multiLocale: false });
    await user.click(table().getByText(urlOf(broken)));
    const record = sidebar().getByRole('button', {
      name: 'Open record Page record',
    });
    expect(within(record).queryByText('English')).not.toBeInTheDocument();
    expect(record).toHaveAccessibleDescription(
      'Page. Body, in Sections > Hero',
    );
  });

  it('opens the scope dialog from the toolbar and gives it focus back after a recheck', async () => {
    const user = userEvent.setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const broken = group('broken');
    const { onChooseScope, rerender } = renderLayout({
      report: report([broken]),
    });
    const choose = screen.getByRole('button', { name: 'Choose what to scan…' });
    await user.click(choose);
    expect(onChooseScope).toHaveBeenCalledTimes(1);

    // During a recheck its tooltip anchor takes focus to explain why it's disabled.
    rerender({ report: report([broken]), rechecking: true });
    const reason = screen.getByText(
      'You cannot choose what to scan while a URL is being rechecked',
    );
    const anchor = screen
      .getByRole('button', { name: 'Choose what to scan…' })
      .closest<HTMLElement>('[tabindex="0"]');
    anchor?.focus();
    expect(anchor).toHaveFocus();
    expect(reason).toBeInTheDocument();

    rerender({ report: report([broken]), rechecking: false });
    expect(
      screen.getByRole('button', { name: 'Choose what to scan…' }),
    ).toHaveFocus();
  });

  it('rechecks the selected URL unless a scan is running or the URL is skipped', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    const skipped = group('skipped');
    const { onRecheck, rerender } = renderLayout({
      report: report([broken, skipped]),
    });

    await user.click(table().getByText(urlOf(broken)));
    await user.click(screen.getByRole('button', { name: 'Recheck URL' }));
    expect(onRecheck).toHaveBeenCalledWith(broken);

    rerender({ scanning: true });
    expect(screen.getByRole('button', { name: 'Recheck URL' })).toBeDisabled();
    expect(
      screen.getByText(
        'You cannot recheck a URL while links are being checked',
      ),
    ).toBeInTheDocument();

    rerender({ scanning: false });
    await pick(user, /^Status:/, /^All URLs/);
    await user.click(table().getByText(urlOf(skipped)));
    expect(
      screen.queryByRole('button', { name: 'Recheck URL' }),
    ).not.toBeInTheDocument();
  });

  it('explains that fragments are not verified', async () => {
    const user = userEvent.setup();
    const broken = group('broken', { fragment: true });
    renderLayout({ report: report([broken]) });
    await user.click(table().getByText(urlOf(broken)));
    expect(
      sidebar().getByText(/Some records link to a #fragment of this page/),
    ).toBeInTheDocument();
    // A place that links to a variant of the URL shows it as a link of its own.
    const variant = sidebar().getByRole('link', {
      name: `${urlOf(broken)}#pricing (opens in a new tab)`,
    });
    expect(variant).toHaveAttribute('href', `${urlOf(broken)}#pricing`);
    expect(variant).toHaveAttribute('target', '_blank');
    expect(variant.closest('.blc-record-row__variant')).toHaveTextContent(
      `Links to ${urlOf(broken)}#pricing`,
    );
  });

  it('keeps stale URLs in the default view and tags them', async () => {
    const user = userEvent.setup();
    const stale = group('reachable', { stale: true });
    const { onScan } = renderLayout({
      report: report([stale], { stale: true }),
      changedRecordIds: new Set(['record-page']),
    });
    expect(table().getByText(urlOf(stale))).toBeInTheDocument();
    expect(table().getByText('Content changed')).toBeInTheDocument();
    expect(
      screen.getByText(/Records changed after this scan/),
    ).toBeInTheDocument();

    await user.click(table().getByText(urlOf(stale)));
    expect(
      sidebar().getByText(/A record using this URL changed after the scan/),
    ).toBeInTheDocument();
    expect(sidebar().getByText('Content changed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('reads incomplete and canceled scans from the settled state', async () => {
    const user = userEvent.setup();
    const groups = [group('broken'), group('cancelled')];
    const { onScan, unmount } = renderLayout({
      report: report(groups, {
        state: 'partial',
        warnings: ['News: Record access denied'],
      }),
      settled: { state: 'partial', finishedAt: '2026-09-23T12:01:00Z' },
    });
    expect(
      screen.getByRole('heading', { name: 'Scan incomplete' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Some content couldn't be read, so the links in it aren't in this report:",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('News: Record access denied')).toBeInTheDocument();
    expect(table().getAllByText('Not checked').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('heading', { name: 'Scan complete' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(onScan).toHaveBeenCalledTimes(1);
    unmount();

    renderLayout({
      report: report(groups, { state: 'cancelled' }),
      settled: { state: 'cancelled', finishedAt: '2026-09-23T12:01:00Z' },
    });
    expect(
      screen.getByRole('heading', { name: 'Scan canceled' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You canceled this scan/)).toBeInTheDocument();
    expect(screen.getByText(/Stopped/)).toBeInTheDocument();
  });

  it('shows the progress bar above the results and "Cancel scan" once a URL needs attention', async () => {
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
      screen.getByRole('heading', { name: 'Scanning links (75%)…' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Scan progress' }),
    ).toHaveAttribute('aria-valuenow', '75');
    // The facts start with what the scan covers.
    expect(
      screen.getByText(
        'All models • All locales • 60 records read • 1 of 2 URLs checked',
      ),
    ).toBeInTheDocument();
    // The bar is the only loading indicator: no spinner anywhere.
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(
      document.querySelector('.blc-scan-progress--centered'),
    ).not.toBeInTheDocument();
    expect(table().getByText(urlOf(broken))).toBeInTheDocument();
    expect(screen.getByLabelText('Search URLs')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose what to scan…' }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        'You cannot choose what to scan while a scan is running',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Scan links' }),
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
    expect(
      screen.getByRole('heading', { name: 'Scanning links (50%)…' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('All models • All locales • 60 of 120 records read'),
    ).toBeInTheDocument();
    const centered = () =>
      document.querySelector('.blc-scan-progress--centered');
    expect(centered()).toBeInTheDocument();
    // Nothing to filter, list or keep yet.
    expect(screen.queryByLabelText('Search URLs')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/Results are kept only/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();

    // URLs that don't need attention keep it centered. They add work, which
    // would lower the share: the bar holds.
    const pending = [group('queued'), group('checking')];
    rerender({ report: running(pending) });
    expect(centered()).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Scan progress' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(
      screen.getByText(
        'All models • All locales • 60 of 120 records read • 0 of 2 URLs checked',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Search URLs')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Nothing needs attention yet'),
    ).not.toBeInTheDocument();

    // The first URL that needs attention moves the progress above the results.
    const broken = group('broken');
    rerender({ report: running([...pending, broken]) });
    expect(centered()).not.toBeInTheDocument();
    expect(table().getByText(urlOf(broken))).toBeInTheDocument();
    expect(screen.getByLabelText('Search URLs')).toBeInTheDocument();
  });

  it('shows the summary at the top once a scan ends with nothing needing attention', () => {
    const { rerender } = renderLayout({
      report: report([group('queued')], {
        state: 'running',
        finishedAt: undefined,
      }),
      scanning: true,
    });
    expect(
      document.querySelector('.blc-scan-progress--centered'),
    ).toBeInTheDocument();
    rerender({ report: report([group('reachable')]), scanning: false });
    expect(
      document.querySelector('.blc-scan-progress--centered'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Scan complete' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing needs attention')).toBeInTheDocument();
  });

  it('sweeps the bar while the record count is unknown', () => {
    renderLayout({
      report: report([], {
        state: 'running',
        discovering: true,
        recordsScanned: 14,
        finishedAt: undefined,
      }),
      scanning: true,
    });
    expect(
      screen.getByRole('heading', { name: 'Scanning links…' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Scan progress' }),
    ).not.toHaveAttribute('aria-valuenow');
    expect(
      screen.getByText('All models • All locales • 14 records read'),
    ).toBeInTheDocument();
  });

  it('paginates long reports', async () => {
    const user = userEvent.setup();
    const groups = Array.from({ length: 60 }, (_, index) =>
      group('broken', { slug: `broken-${index + 1}` }),
    );
    renderLayout({ report: report(groups) });
    expect(screen.getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[50]))).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next »' }));
    expect(screen.getByText(urlOf(groups[50]))).toBeInTheDocument();
    expect(screen.queryByText(urlOf(groups[0]))).not.toBeInTheDocument();
    expect(screen.getByText('2')).toHaveAttribute('aria-current', 'page');

    await user.selectOptions(screen.getByLabelText('URLs per page'), '100');
    expect(
      screen.queryByRole('button', { name: 'Next »' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.getByText(urlOf(groups[59]))).toBeInTheDocument();
  });

  it('moves the selection with the keyboard', async () => {
    const user = userEvent.setup();
    const first = group('broken', { slug: 'first' });
    const second = group('broken', { slug: 'second' });
    renderLayout({ report: report([first, second]) });

    rowOf(urlOf(first)).focus();
    await user.keyboard('{Enter}');
    expect(rowOf(urlOf(first))).toHaveAttribute('aria-current', 'true');

    await user.keyboard('{ArrowDown}');
    expect(rowOf(urlOf(second))).toHaveAttribute('aria-current', 'true');
    expect(rowOf(urlOf(second))).toHaveFocus();
    expect(rowOf(urlOf(first))).not.toHaveAttribute('aria-current');

    await user.keyboard('{Escape}');
    expect(rowOf(urlOf(second))).not.toHaveAttribute('aria-current');
  });

  it('shows an empty report as "No links found"', () => {
    renderLayout({ report: report([]) });
    expect(screen.getByText('No links found')).toBeInTheDocument();
    // Nothing to create: the way forward is the docs.
    expect(
      screen.getByRole('link', {
        name: 'Read more about how links are checked.',
      }),
    ).toHaveAttribute('target', '_blank');
    // Nothing to export: the footnote doesn't point to "Export CSV".
    expect(
      screen.getByText('Results are kept only while this page is open.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No URLs found/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Search URLs')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Scan links' })).toBeDisabled();
    expect(
      screen.getByText(
        'You cannot start a scan while a URL is being rechecked',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose what to scan…' }),
    ).toBeDisabled();
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

    await user.click(table().getByText(urlOf(broken)));
    expect(screen.getByRole('button', { name: 'Recheck URL' })).toBeDisabled();
    expect(
      screen.getByText(
        'You cannot recheck a URL while links are being checked',
      ),
    ).toBeInTheDocument();
  });

  it('opens the overlay beside the split and closes it on Escape, the scrim or the toggle', async () => {
    const user = userEvent.setup();
    mediaState.queries['(max-width: 999px)'] = true;
    const broken = group('broken');
    const { onCollapsedChange } = renderLayout({ report: report([broken]) });
    const results = screen.getByRole('table', { name: 'Link check results' });
    const row = rowOf(urlOf(broken));

    await user.click(table().getByText(urlOf(broken)));
    const aside = screen.getByRole('complementary', { name: 'Link details' });
    expect(aside.closest('.blc-overlay')).not.toBeNull();
    expect(aside).toHaveFocus();
    expect(screen.getByRole('table', { name: 'Link check results' })).toBe(
      results,
    );

    await user.keyboard('{Escape}');
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
    expect(
      screen.queryByRole('complementary', { name: 'Link details' }),
    ).not.toBeInTheDocument();
    expect(rowOf(urlOf(broken))).toBe(row);
    expect(row).toHaveFocus();
    // Escape closed the overlay only: the selection stays.
    expect(row).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
    const overlay = screen
      .getByRole('complementary', { name: 'Link details' })
      .closest('.blc-overlay');
    if (!(overlay instanceof HTMLElement)) throw new Error('No overlay');
    await user.click(overlay);
    expect(
      screen.queryByRole('complementary', { name: 'Link details' }),
    ).not.toBeInTheDocument();

    await user.click(table().getByText(urlOf(broken)));
    await user.click(sidebar().getByText('Broken'));
    expect(
      screen.getByRole('complementary', { name: 'Link details' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(
      screen.queryByRole('complementary', { name: 'Link details' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Link check results' })).toBe(
      results,
    );
  });

  it('keeps the report out of reach under the overlay, and closes it only on presses that start on the scrim', async () => {
    const user = userEvent.setup();
    mediaState.queries['(max-width: 999px)'] = true;
    const broken = group('broken');
    renderLayout({ report: report([broken]) });
    const pane = screen
      .getByRole('table', { name: 'Link check results' })
      .closest('.blc-main-pane');
    expect(pane).not.toHaveAttribute('inert');

    await user.click(table().getByText(urlOf(broken)));
    expect(pane).toHaveAttribute('inert');
    const overlay = document.querySelector('.blc-overlay');
    const url = document.querySelector('.blc-overlay .blc-link-url');
    if (!(overlay instanceof HTMLElement) || !(url instanceof HTMLElement))
      throw new Error('No overlay');
    // Selecting the URL's text by dragging past the panel's edge.
    await user.pointer([
      { keys: '[MouseLeft>]', target: url },
      { target: overlay },
      { keys: '[/MouseLeft]', target: overlay },
    ]);
    expect(
      screen.getByRole('complementary', { name: 'Link details' }),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(pane).not.toHaveAttribute('inert');
    expect(rowOf(urlOf(broken))).toHaveFocus();
  });

  it('leaves the overlay closed when the frame narrows with the sidebar open', async () => {
    const user = userEvent.setup();
    const broken = group('broken');
    const { rerender } = renderLayout({
      report: report([broken]),
      collapsed: false,
    });
    const search = screen.getByLabelText('Search URLs');
    await user.type(search, 'bro');

    mediaState.queries['(max-width: 999px)'] = true;
    rerender({});
    expect(document.querySelector('.blc-overlay')).toBeNull();
    expect(search).toHaveFocus();

    // A row still opens it.
    await user.click(table().getByText(urlOf(broken)));
    expect(
      screen.getByRole('complementary', { name: 'Link details' }),
    ).toHaveFocus();
  });

  it('starts a scan in a narrow frame with the overlay closed, even when the sidebar was open', () => {
    mediaState.queries['(max-width: 999px)'] = true;
    renderLayout({ report: report([group('broken')]), collapsed: false });
    expect(document.querySelector('.blc-overlay')).toBeNull();
    expect(
      screen.queryByRole('complementary', { name: 'Link details' }),
    ).not.toBeInTheDocument();
  });

  it('explains only the statuses whose word needs it', async () => {
    const user = userEvent.setup();
    const unverified = group('unverified');
    renderLayout({ report: report([unverified]) });
    await user.click(table().getByText(urlOf(unverified)));
    expect(sidebar().getByText('Result: unverified')).toBeInTheDocument();
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
    expect(within(rowOf(urlOf(broken))).getAllByText('Checking').length).toBe(
      2,
    );
    expect(screen.getByText('1 URL')).toBeInTheDocument();
    expect(screen.getByText(/1 needs attention/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Nothing needs attention' }),
    ).not.toBeInTheDocument();
  });

  it('sorts by a column, cycling ascending, descending and none, from page 1', async () => {
    const user = userEvent.setup();
    const groups = Array.from({ length: 60 }, (_, index) =>
      group(index % 2 ? 'broken' : 'unverified', {
        slug: `url-${String(index + 1).padStart(2, '0')}`,
      }),
    );
    renderLayout({ report: report(groups) });
    const header = () => screen.getByRole('columnheader', { name: /^Status/ });

    await user.click(screen.getByRole('button', { name: 'Next »' }));
    expect(screen.getByText('2')).toHaveAttribute('aria-current', 'page');
    expect(header()).toHaveAttribute('aria-sort', 'none');

    await user.click(screen.getByRole('button', { name: 'Status' }));
    expect(header()).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByText('1')).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: 'Next »' }));
    await user.click(screen.getByRole('button', { name: 'Status' }));
    expect(header()).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByText('1')).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: 'Status' }));
    expect(header()).toHaveAttribute('aria-sort', 'none');
  });

  it('stays on the page it fell back to when the list grows again', async () => {
    const user = userEvent.setup();
    const groups = Array.from({ length: 60 }, (_, index) =>
      group('broken', { slug: `broken-${index + 1}` }),
    );
    const { rerender } = renderLayout({ report: report(groups) });
    await user.click(screen.getByRole('button', { name: 'Next »' }));
    expect(screen.getByText(urlOf(groups[50]))).toBeInTheDocument();

    rerender({ report: report(groups.slice(0, 10)) });
    expect(screen.getByText(urlOf(groups[0]))).toBeInTheDocument();
    rerender({ report: report(groups) });
    expect(screen.getByText(urlOf(groups[0]))).toBeInTheDocument();
    expect(screen.getByText('1')).toHaveAttribute('aria-current', 'page');
  });

  it('leaves a canceled scan without URLs to the coverage callout', () => {
    renderLayout({
      report: report([], { state: 'cancelled' }),
      settled: { state: 'cancelled', finishedAt: '2026-09-23T12:01:00Z' },
    });
    expect(screen.getByText(/You canceled this scan/)).toBeInTheDocument();
    expect(screen.queryByText('No links found')).not.toBeInTheDocument();
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
      screen.getByText(
        'All models • All locales • 3 records read • 1 of 3 URLs checked',
      ),
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
    expect(screen.getByText('Body (English) > Hero')).toBeInTheDocument();
  });
});
