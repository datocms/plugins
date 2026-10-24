import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_URL } from '../constants';
import type { ScanProgress } from '../report/view';
import { renderInCanvas } from '../test/canvas';
import type { CheckStatus, LinkGroup, ScanReport } from '../types';
import { FirstRunOverview, NoAccessState, NoModelsState } from './PageStates';
import { ResultsEmpty } from './ResultsEmpty';
import { ScanProgressBlock, ScanProgressSlate } from './ScanProgressBlock';
import { ScanAnnouncement, ScanSummary } from './ScanSummary';

function group(status: CheckStatus, slug: string = status): LinkGroup {
  const url = `https://${slug}.example/`;
  return {
    key: url,
    prepared: { key: url, url, status: 'queued', message: 'Prepared' },
    result: { key: url, url, status, message: `Result: ${status}` },
    occurrences: [],
    stale: false,
  };
}

function report(
  groups: LinkGroup[],
  overrides: Partial<ScanReport> = {},
): ScanReport {
  return {
    groups,
    state: 'complete',
    recordsScanned: 2,
    discovering: false,
    warnings: [],
    scope: 'All models • All locales',
    startedAt: '2026-09-23T12:00:00Z',
    finishedAt: '2026-09-23T12:01:00Z',
    ...overrides,
  };
}

const progress: ScanProgress = {
  records: 60,
  found: 2,
  checkable: 2,
  checked: 1,
  left: 1,
  attention: 1,
  blocked: 0,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('page states', () => {
  it('explains the missing API access, with no scan controls', () => {
    renderInCanvas(<NoAccessState />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'API access needed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You can still check the record you're editing/),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('tells an empty environment from a role that reads no model', async () => {
    const user = userEvent.setup();
    const { unmount } = renderInCanvas(<NoModelsState hasModels />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'No models to scan' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your role can't read the records of any model/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    unmount();

    const { ctx } = renderInCanvas(
      <NoModelsState hasModels={false} schemaPath="/environments/dev/schema" />,
    );
    expect(
      screen.getByText("This environment doesn't have any models yet."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Open Schema' }));
    expect(ctx.navigateTo).toHaveBeenCalledWith('/environments/dev/schema');
  });

  it('offers the first scan and its scope choice', async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    const onChooseScope = vi.fn();
    renderInCanvas(
      <FirstRunOverview onScan={onScan} onChooseScope={onChooseScope} />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Link checker' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Scan links' }));
    expect(onScan).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'More scan options' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Choose what to scan…' }),
    );
    expect(onChooseScope).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});

describe('scan progress', () => {
  it('centers the progress, with the bar only once the share is known', () => {
    const { rerender } = renderInCanvas(
      <ScanProgressSlate
        placement="area"
        scope="All models • All locales"
        progress={progress}
        fraction={0.756}
        discovering
        recordTotal={120}
        uiLocale="en"
      />,
    );
    expect(screen.getByText('Scanning links (75%)…')).toBeInTheDocument();
    expect(screen.getByText('All models • All locales')).toBeInTheDocument();
    expect(
      screen.getByText('60 of 120 records read • 1 of 2 URLs processed'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Scanning links' }),
    ).toHaveAttribute('aria-valuenow', '75');

    rerender(
      <ScanProgressSlate
        placement="section"
        scope="All models • All locales"
        progress={{ ...progress, found: 0 }}
        fraction={null}
        discovering
        uiLocale="en"
      />,
    );
    expect(screen.getByText('Scanning links…')).toBeInTheDocument();
    expect(screen.getByText('60 records read')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows one line above the results, with a spinner while the share is unknown', () => {
    const { container, rerender } = renderInCanvas(
      <ScanProgressBlock
        scope="Page • English"
        progress={progress}
        fraction={0.5}
        discovering={false}
        uiLocale="en"
      />,
    );
    expect(
      screen.getByText(
        'Scanning links (50%)… • Page • English • 60 records read • 1 of 2 URLs processed',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(container.querySelector('.Spinner')).not.toBeInTheDocument();

    rerender(
      <ScanProgressBlock
        scope="Page • English"
        progress={progress}
        fraction={null}
        discovering
        uiLocale="en"
      />,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelector('.Spinner')).toBeInTheDocument();
    expect(
      screen.getByText(/^Scanning links… • Page • English • 60 records read/),
    ).toBeInTheDocument();
  });
});

describe('scan summary', () => {
  it('says that a scan is complete, what it covered and when it finished, in the date settings', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T18:00:00Z'));
    renderInCanvas(
      <ScanSummary
        report={report([group('broken'), group('blocked')])}
        notCheckedCount={0}
        uiLocale="en"
      />,
    );
    const callout = screen.getByRole('note');
    expect(within(callout).getByText('Scan complete')).toBeInTheDocument();
    expect(
      within(callout).getByText(
        'All models • All locales • 2 records read • 2 URLs found • 1 needs attention • 1 blocked • Finished today, 12:01',
      ),
    ).toBeInTheDocument();
    // The title bar's "Scan links" scans again: the summary has no button.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says in a note of its own that records changed after a scan', () => {
    renderInCanvas(
      <ScanSummary
        report={report([group('broken')], { stale: true })}
        notCheckedCount={0}
        uiLocale="en"
      />,
    );
    // The summary, then the stale note, which says how to refresh the results.
    const [summary, stale] = screen.getAllByRole('note');
    expect(within(summary).getByText('Scan complete')).toBeInTheDocument();
    expect(
      within(summary).queryByText(/^Records changed after this scan/),
    ).not.toBeInTheDocument();
    expect(within(stale).getByText('Content changed')).toBeInTheDocument();
    expect(
      within(stale).getByText(
        'Records changed after this scan, so some results may be out of date. Scan again to refresh them.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains a canceled scan, its stop date and stale records, without an action', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    renderInCanvas(
      <ScanSummary
        report={report([group('cancelled')], {
          state: 'cancelled',
          stale: true,
        })}
        notCheckedCount={1}
        uiLocale="en"
      />,
    );
    const callout = screen.getByRole('alert');
    expect(within(callout).getByText('Scan canceled')).toBeInTheDocument();
    expect(
      within(callout).getByText(
        "It covers only the records read and the URLs processed until then. URLs that weren't checked show as “Not checked”.",
      ),
    ).toBeInTheDocument();
    expect(
      within(callout).getByText(/• Stopped 23\/09\/2026, 12:01$/),
    ).toBeInTheDocument();
    // The stale note follows the warning, as a neutral note of its own.
    expect(
      within(callout).queryByText(/^Records changed after this scan/),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('note')).getByText(
        /^Records changed after this scan/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains an incomplete scan: the unread content, or the URLs not checked', async () => {
    const user = userEvent.setup();
    const { rerender } = renderInCanvas(
      <ScanSummary
        report={report([group('broken')], {
          state: 'partial',
          warnings: Array.from(
            { length: 6 },
            (_, index) => `News › Body (en) › Link ${index}: Not found`,
          ),
        })}
        notCheckedCount={2}
        uiLocale="en"
      />,
    );
    const callout = screen.getByRole('alert');
    expect(within(callout).getByText('Scan incomplete')).toBeInTheDocument();
    expect(
      within(callout).getByText(
        "Some content couldn't be read, so the links in it aren't in this report:",
      ),
    ).toBeInTheDocument();
    expect(within(callout).getAllByRole('listitem')).toHaveLength(5);
    expect(within(callout).getAllByRole('listitem')[0]).toHaveTextContent(
      'News > Body (en) > Link 0: Not found',
    );
    // The control of the list sits right after the callout, never in it.
    const toggle = screen.getByRole('button', { name: 'Show all 6 issues' });
    expect(callout).not.toContainElement(toggle);
    await user.click(toggle);
    expect(within(callout).getAllByRole('listitem')).toHaveLength(6);

    rerender(
      <ScanSummary
        report={report([group('broken')], { state: 'partial' })}
        notCheckedCount={2}
        uiLocale="en"
      />,
    );
    expect(
      within(screen.getByRole('alert')).getByText(
        "2 URLs weren't checked. Recheck them one by one, or scan again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('keeps the settled state and finish time during a recheck', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    renderInCanvas(
      <ScanSummary
        report={report([group('broken')], {
          state: 'running',
          finishedAt: undefined,
        })}
        settled={{ state: 'partial', finishedAt: '2026-09-23T12:01:00Z' }}
        notCheckedCount={0}
        uiLocale="en"
      />,
    );
    const callout = screen.getByRole('alert');
    expect(within(callout).getByText('Scan incomplete')).toBeInTheDocument();
    expect(
      within(callout).getByText(/Finished 23\/09\/2026, 12:01$/),
    ).toBeInTheDocument();
  });

  it('announces the headline once the scan settles', () => {
    const running = report([], { state: 'running', finishedAt: undefined });
    const { rerender } = renderInCanvas(
      <ScanAnnouncement report={running} scanning />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    rerender(<ScanAnnouncement report={report([])} scanning={false} />);
    expect(status).toHaveTextContent('Scan complete');
  });

  it('announces an incomplete or canceled scan by its headline too', () => {
    const { rerender } = renderInCanvas(
      <ScanAnnouncement
        report={report([], { state: 'partial' })}
        scanning={false}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Scan incomplete');
    rerender(
      <ScanAnnouncement
        report={report([], { state: 'cancelled' })}
        scanning={false}
      />,
    );
    expect(status).toHaveTextContent('Scan canceled');
  });
});

describe('empty results', () => {
  it('says that a scan found no links, with the docs', () => {
    renderInCanvas(
      <ResultsEmpty
        kind="noLinks"
        total={0}
        partial={false}
        onShowAll={vi.fn()}
        uiLocale="en"
      />,
    );
    expect(screen.getByText('No links found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Documentation/ })).toHaveAttribute(
      'href',
      DOCS_URL,
    );
  });

  it('says that nothing needs attention, and switches to all URLs', async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    const { rerender } = renderInCanvas(
      <ResultsEmpty
        kind="clean"
        total={1500}
        partial
        onShowAll={onShowAll}
        uiLocale="en"
      />,
    );
    expect(
      screen.getByText(
        'None of the 1,500 URLs found is broken, invalid or unverified in the content that could be read.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all URLs' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);

    rerender(
      <ResultsEmpty
        kind="cleanSoFar"
        total={3}
        partial={false}
        onShowAll={onShowAll}
        uiLocale="en"
      />,
    );
    expect(screen.getByText('Nothing needs attention yet')).toBeInTheDocument();
  });

  it('says that the filters keep nothing', () => {
    const { container } = renderInCanvas(
      <ResultsEmpty
        kind="noMatch"
        total={3}
        partial={false}
        onShowAll={vi.fn()}
        uiLocale="en"
      />,
    );
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByText('Nothing matches the filter.')).toBeInTheDocument();
    expect(
      container.querySelector('.blank-slate--section'),
    ).toBeInTheDocument();
  });
});
