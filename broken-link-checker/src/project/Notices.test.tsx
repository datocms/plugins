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
import { ScanAnnouncement, ScanFailed, ScanSummary } from './ScanSummary';

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
    // The whole project: the facts don't name it.
    scope: '',
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
      screen.getByRole('heading', {
        level: 1,
        name: "Link checker can't read your records",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/you can check a record from its “Broken links” panel/),
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
    // The bar shows the share: the title doesn't repeat it.
    expect(screen.getByText('Scanning links…')).toBeInTheDocument();
    expect(screen.getByText('All models • All locales')).toBeInTheDocument();
    expect(
      screen.getByText('60 of 120 records read • 1 of 2 links checked'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Scanning links' }),
    ).toHaveAttribute('aria-valuenow', '75');

    // The whole project has no scope to name.
    rerender(
      <ScanProgressSlate
        placement="section"
        scope=""
        progress={{ ...progress, found: 0 }}
        fraction={null}
        discovering
        uiLocale="en"
      />,
    );
    expect(screen.getByText('Scanning links…')).toBeInTheDocument();
    expect(screen.getByText('60 records read')).toBeInTheDocument();
    expect(
      screen.queryByText('All models • All locales'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    // Before the first record, the count tells nothing.
    rerender(
      <ScanProgressSlate
        placement="area"
        scope=""
        progress={{ ...progress, records: 0, found: 0 }}
        fraction={0}
        discovering
        recordTotal={120}
        uiLocale="en"
      />,
    );
    expect(screen.queryByText(/records read/)).not.toBeInTheDocument();
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
        'Scanning links… • Page • English • 60 records read • 1 of 2 links checked',
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
  it('gives the facts of a complete scan, in the date settings, with no title', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T18:00:00Z'));
    const { rerender } = renderInCanvas(
      <ScanSummary
        report={report([group('broken'), group('blocked')])}
        notCheckedCount={0}
        uiLocale="en"
      />,
    );
    const callout = screen.getByRole('note');
    // The title bar counts the links of the view: the facts don't.
    expect(callout).toHaveTextContent(
      /^2 records read • 2 links found • Finished today, 12:01$/,
    );
    // The title bar's "Scan links" scans again: the summary has no button.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    // A scope the user narrowed comes first.
    rerender(
      <ScanSummary
        report={report([group('broken')], { scope: 'Page • English' })}
        notCheckedCount={0}
        uiLocale="en"
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      /^Page • English • 2 records read • 1 link found • Finished/,
    );
  });

  it('says in the summary that records changed after a scan', () => {
    renderInCanvas(
      <ScanSummary
        report={report([group('broken')], { stale: true })}
        notCheckedCount={0}
        uiLocale="en"
      />,
    );
    // One callout: the stale sentence, then the facts.
    const summary = screen.getByRole('note');
    expect(
      within(summary).getByText(
        'Some records changed after this scan: scan again to refresh the report.',
      ),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/^2 records read/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says once that no link could be checked when the service refused the plugin, and what to do', () => {
    const refused = group('unverified');
    refused.result = { ...refused.result, reason: 'proxy-refused' };
    renderInCanvas(
      <ScanSummary
        report={report([refused, group('invalid')])}
        notCheckedCount={1}
        uiLocale="en"
      />,
    );
    const callout = screen.getByRole('alert');
    expect(
      within(callout).getByText("Links couldn't be checked"),
    ).toBeInTheDocument();
    expect(
      within(callout).getByText(
        "The link checking service only accepts this plugin when it's installed from the marketplace. Ask a project admin to install it from there.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Scan complete')).not.toBeInTheDocument();
  });

  it('shows a scan that read nothing as a failure, with each reason once', () => {
    renderInCanvas(
      <ScanFailed
        report={report([], {
          state: 'partial',
          recordsScanned: 0,
          warnings: [
            'Article: Access was refused. Reload the page and scan again.',
            'Author: Access was refused. Reload the page and scan again.',
          ],
        })}
      />,
    );
    expect(screen.getByText("Couldn't read your records")).toBeInTheDocument();
    expect(
      screen.getByText('Access was refused. Reload the page and scan again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Article/)).not.toBeInTheDocument();
  });

  it('explains a canceled scan, its stop date and stale records, without an action', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const { rerender } = renderInCanvas(
      <ScanSummary
        report={report([group('cancelled')], {
          state: 'cancelled',
          stale: true,
        })}
        notCheckedCount={1}
        uiLocale="en"
      />,
    );
    // The user's own stop is no alarm: no title, the neutral tone.
    const callout = screen.getByRole('note');
    expect(
      within(callout).queryByText('Scan canceled'),
    ).not.toBeInTheDocument();
    expect(
      within(callout).getByText(
        'This report covers only what was checked before you stopped the scan.',
      ),
    ).toBeInTheDocument();
    // The links left unchecked count apart from the problems.
    expect(
      within(callout).getByText(
        /^2 records read • 1 link found • 1 not checked • Stopped 23\/09\/2026, 12:01$/,
      ),
    ).toBeInTheDocument();
    // The stale sentence is in the same callout: callouts never stack.
    expect(
      within(callout).getByText(/^Some records changed after this scan/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    // With content that couldn't be read too, it says two things: a title
    // and the warning tone.
    rerender(
      <ScanSummary
        report={report([group('cancelled')], {
          state: 'cancelled',
          warnings: ['News: Record access denied'],
        })}
        notCheckedCount={1}
        uiLocale="en"
      />,
    );
    expect(
      within(screen.getByRole('alert')).getByText('Scan canceled'),
    ).toBeInTheDocument();
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
        "Some content couldn't be read, so its links aren't in this report.",
      ),
    ).toBeInTheDocument();
    expect(within(callout).queryByRole('listitem')).not.toBeInTheDocument();
    // The control of the list sits right after the callout, never in it.
    const toggle = screen.getByRole('button', {
      name: "Show what couldn't be read",
    });
    expect(callout).not.toContainElement(toggle);
    await user.click(toggle);
    // One reason, once: the places that give it come before it.
    expect(within(callout).getByRole('listitem')).toHaveTextContent(
      'News > Body (en) > Link 0, News > Body (en) > Link 1, News > Body (en) > Link 2, News > Body (en) > Link 3, News > Body (en) > Link 4, News > Body (en) > Link 5: Not found',
    );

    rerender(
      <ScanSummary
        report={report([group('broken')], { state: 'partial' })}
        notCheckedCount={2}
        uiLocale="en"
      />,
    );
    expect(
      within(screen.getByRole('alert')).getByText(
        "2 links weren't checked. Recheck them one by one, or scan again.",
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
    rerender(
      <ScanAnnouncement
        report={report([], {
          state: 'partial',
          recordsScanned: 0,
          warnings: ['Article: Access was refused.'],
        })}
        scanning={false}
      />,
    );
    expect(status).toHaveTextContent("Couldn't read your records");
  });
});

describe('empty results', () => {
  it('says that a scan found no links, with the docs', () => {
    renderInCanvas(
      <ResultsEmpty
        kind="noLinks"
        total={0}
        partial={false}
        showingAll={false}
        onShowAll={vi.fn()}
      />,
    );
    expect(screen.getByText('No links found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Documentation/ })).toHaveAttribute(
      'href',
      DOCS_URL,
    );
  });

  it('says that nothing needs attention, and switches to all links', async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    const { rerender } = renderInCanvas(
      <ResultsEmpty
        kind="clean"
        total={1500}
        partial
        showingAll={false}
        onShowAll={onShowAll}
      />,
    );
    // The summary above counts the links.
    expect(
      screen.getByText(
        'None of the links found is broken, invalid or unverified in the content that could be read.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all links' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);

    rerender(
      <ResultsEmpty
        kind="cleanSoFar"
        total={3}
        partial={false}
        showingAll={false}
        onShowAll={onShowAll}
      />,
    );
    expect(screen.getByText('Nothing needs attention yet')).toBeInTheDocument();
  });

  it('says that the filters keep nothing, and searches all links from a narrower view', async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    const { container, rerender } = renderInCanvas(
      <ResultsEmpty
        kind="noMatch"
        total={3}
        partial={false}
        showingAll={false}
        onShowAll={onShowAll}
      />,
    );
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByText('Nothing matches the filter.')).toBeInTheDocument();
    expect(
      container.querySelector('.blank-slate--section'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all links' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);

    rerender(
      <ResultsEmpty
        kind="noMatch"
        total={3}
        partial={false}
        showingAll
        onShowAll={onShowAll}
      />,
    );
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
