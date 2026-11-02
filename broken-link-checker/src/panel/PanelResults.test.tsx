import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import { panelContext } from '../test/fixtures';
import type { LinkGroup, LinkOccurrence, ScanReport } from '../types';
import { PanelResults, panelSummaryText } from './PanelResults';

function report(count: number): ScanReport {
  const occurrences: LinkOccurrence[] = Array.from(
    { length: count },
    (_, i) => ({
      id: `place-${i}`,
      recordId: 'record-1',
      recordTitle: 'Complex record',
      modelId: 'article',
      modelName: 'Article',
      fieldPath: 'body.en',
      fieldLabel: `Link ${i}`,
      locale: 'en',
      blockPath: [],
      url: 'https://example.test/shared',
    }),
  );
  return {
    state: 'complete',
    startedAt: '2026-10-02T00:00:00Z',
    recordsScanned: 1,
    discovering: false,
    scope: 'Current form',
    warnings: [],
    groups: [
      {
        key: 'shared',
        prepared: {
          key: 'shared',
          url: 'https://example.test/shared',
          status: 'queued',
          message: '',
        },
        result: { key: 'shared', url: '', status: 'broken', message: '' },
        stale: false,
        occurrences,
      },
    ],
  };
}

function renderResults(count: number) {
  const onGoToField = vi.fn();
  renderInCanvas(
    <PanelResults
      report={report(count)}
      showLocale={false}
      uiLocale="en"
      onGoToField={onGoToField}
    />,
    { ctx: panelContext() },
  );
  return onGoToField;
}

const PLACE = /^Link \d+\s*,\s*go to field$/;

describe('PanelResults places', () => {
  it('lists a place once, with the times the link is there', () => {
    const repeated = report(3);
    const [group] = repeated.groups;
    // The link twice in the same field, then once in another one.
    group.occurrences = [
      { ...group.occurrences[0], id: 'a', fieldLabel: 'Body' },
      { ...group.occurrences[0], id: 'b', fieldLabel: 'Body' },
      { ...group.occurrences[0], id: 'c', fieldLabel: 'Intro' },
    ];
    renderInCanvas(
      <PanelResults
        report={repeated}
        showLocale={false}
        uiLocale="en"
        onGoToField={vi.fn()}
      />,
      { ctx: panelContext() },
    );
    expect(
      screen.getByRole('button', {
        name: /^Body\s*2 times\s*,\s*go to field$/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Intro\s*,\s*go to field$/ }),
    ).toBeInTheDocument();
  });

  it('preserves the existing expansion for small location lists', async () => {
    const user = userEvent.setup();
    const onGoToField = renderResults(8);
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(5);
    await user.click(
      screen.getByRole('button', { name: 'Show 3 more places' }),
    );
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(8);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /^Link 7\s*,\s*go to field$/ }),
    );
    expect(onGoToField).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'place-7' }),
    );
  });

  it('pages a large location list 50 places at a time', async () => {
    const user = userEvent.setup();
    renderResults(201);
    await user.click(screen.getByRole('button', { name: 'Browse 201 places' }));
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(50);
    // Named after its URL: each URL's pages are a landmark of their own.
    const pages = screen.getByRole('navigation', {
      name: 'Places of https://example.test/shared pagination',
    });
    // Compact pages show 3 numbers at a time: "Next" reaches the last one.
    for (let page = 1; page < 5; page += 1)
      fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(
      within(pages).getByRole('button', { name: 'Go to page 5' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: PLACE })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /^Link 200\s*,\s*go to field$/ }),
    ).toBeInTheDocument();
  });
});

describe('a refused check in the panel', () => {
  function refusedReport(withInvalid: boolean): ScanReport {
    const base = report(1);
    const [shared] = base.groups;
    const refused = (key: string): LinkGroup => ({
      ...shared,
      key,
      result: {
        key,
        url: '',
        status: 'unverified',
        message: '',
        reason: 'proxy-refused',
      },
    });
    const invalid: LinkGroup = {
      ...shared,
      key: 'invalid',
      result: { ...shared.result, key: 'invalid', status: 'invalid' },
    };
    const groups = [refused('a'), refused('b')];
    return { ...base, groups: withInvalid ? [invalid, ...groups] : groups };
  }

  it('counts its links as not checked, apart from the links with a problem', async () => {
    const user = userEvent.setup();
    const mixed = refusedReport(true);
    expect(panelSummaryText({ report: mixed, uiLocale: 'en' })).toBe(
      '1 of 3 links needs attention. 2 not checked',
    );
    expect(
      panelSummaryText({ report: refusedReport(false), uiLocale: 'en' }),
    ).toBe("2 links weren't checked");
    renderInCanvas(
      <PanelResults
        report={mixed}
        showLocale={false}
        uiLocale="en"
        onGoToField={vi.fn()}
      />,
      { ctx: panelContext() },
    );
    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(screen.queryByText('Not checked')).not.toBeInTheDocument();
    // Links that weren't checked aren't known to be without problems.
    await user.click(screen.getByRole('button', { name: 'Show all links' }));
    expect(screen.getAllByText('Not checked')).toHaveLength(2);
  });
});
