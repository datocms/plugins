import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Canvas from 'datocms-react-ui/Canvas';
import { useMemo } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  FindReplaceSnapshot,
  RecordLink,
  RecordPublishStatus,
  RecordRunStatus,
  RecordView,
} from '../contract';
import { createCopy } from './copy';
import { ResultsEnv } from './ResultsEnv';
import { COMPACT_TABLE_QUERY, ResultsTable } from './ResultsTable';
import {
  createFakeController,
  type FakeController,
} from './testing/fakeController';
import {
  excludingSnapshot,
  makeField,
  makeMatch,
  makeRecord,
  manyRecords,
  planSnapshot,
  resultsSnapshot,
  type StateId,
  stateFixture,
} from './testing/fixtures';
import { createMockCtx } from './testing/mockCtx';

const copy = createCopy('en');

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function snapshotOf(id: StateId): FindReplaceSnapshot {
  const { snapshot } = stateFixture(id);
  if (!snapshot) {
    throw new Error(`${id} has no snapshot`);
  }
  return snapshot;
}

function Results({
  snapshot,
  controller,
}: {
  snapshot: FindReplaceSnapshot;
  controller: FakeController;
}) {
  const env = useMemo(() => ({ controller, copy }), [controller]);
  const { run, publish } = snapshot;
  const runActive =
    run.phase === 'running' ||
    run.phase === 'stopping' ||
    publish.phase === 'running' ||
    publish.phase === 'stopping';
  return (
    <ResultsEnv.Provider value={env}>
      <ResultsTable
        key={snapshot.search.resultsId}
        records={snapshot.records}
        selection={snapshot.selection}
        runActive={runActive}
        onSelectAll={(included) => controller.setAllIncluded(included)}
      />
    </ResultsEnv.Provider>
  );
}

function renderTable(
  snapshot: FindReplaceSnapshot,
  options: {
    recordLink?: (recordKey: string) => RecordLink;
    /** The host's admin domain, from which `Canvas` builds the `href` of a `to`. */
    internalDomain?: string | null;
  } = {},
) {
  const mock = createMockCtx('en', { internalDomain: options.internalDomain });
  const controller = createFakeController(snapshot, options);
  const ui = (next: FindReplaceSnapshot) => (
    <Canvas ctx={mock.ctx}>
      <Results snapshot={next} controller={controller} />
    </Canvas>
  );
  const view = render(ui(snapshot));
  return {
    ...view,
    mock,
    controller,
    rerenderWith: (next: FindReplaceSnapshot) => view.rerender(ui(next)),
  };
}

function recordRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-record]'));
}

function recordRow(key: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-record="${key}"]`);
  if (!row) {
    throw new Error(`no row for ${key}`);
  }
  return row;
}

/** The match lines whose match key starts with `prefix`, in order. */
function matchRows(prefix: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[data-match^="${prefix}"]`),
  );
}

/** A kit Button by its visible label (cheaper than a role query on long lists). */
function button(label: string): HTMLElement {
  const element = screen.getByText(label).closest<HTMLElement>('button');
  if (!element) {
    throw new Error(`no button "${label}"`);
  }
  return element;
}

/** The visible where label of a line (no-break spaces read as spaces), or null. */
function whereLabel(line: HTMLElement): string | null {
  const label = line.querySelector('.visually-hidden + [aria-hidden="true"]');
  return label?.textContent?.replace(/ /g, ' ') ?? null;
}

/** The accessible where-name every line keeps. */
function whereName(line: HTMLElement): string {
  return line.querySelector('.visually-hidden')?.textContent ?? '';
}

describe('chunks and "Show more"', () => {
  it('renders 50 records at a time and focuses the first new one', async () => {
    const user = userEvent.setup();
    renderTable(snapshotOf('S8'));
    expect(recordRows()).toHaveLength(50);
    await user.click(button('Load more records'));
    expect(recordRows()).toHaveLength(100);
    expect(recordRows()[50]).toHaveFocus();
    await user.click(button('Load more records'));
    expect(recordRows()).toHaveLength(120);
    expect(recordRows()[100]).toHaveFocus();
    expect(screen.queryByText('Load more records')).toBeNull();
  });

  it('shows 3 matches, then 20 more per click, and collapses back', async () => {
    const user = userEvent.setup();
    const [history] = manyRecords();
    renderTable({ ...resultsSnapshot(), records: [history] });
    const lines = () => matchRows('history:').length;
    expect(lines()).toBe(3);

    await user.click(button('Show 20 more matches'));
    expect(lines()).toBe(23);
    expect(button('Show 20 more matches')).toHaveFocus();
    expect(button('Show fewer matches')).toBeInTheDocument();

    await user.click(button('Show 20 more matches'));
    expect(lines()).toBe(43);
    await user.click(button('Show 9 more matches'));
    expect(lines()).toBe(52);
    expect(screen.queryByText(/more match/)).toBeNull();
    expect(button('Show fewer matches')).toHaveFocus();

    await user.click(button('Show fewer matches'));
    expect(lines()).toBe(3);
    expect(button('Show 20 more matches')).toHaveFocus();
  });

  it('says "Show 1 more match" when one is left', () => {
    const record = makeRecord({
      modelId: 'article',
      modelName: 'Article',
      recordId: 'four',
      title: 'Four matches',
      fields: [
        makeField({
          key: 'four:body',
          path: ['Body'],
          matches: [0, 1, 2, 3].map((index) =>
            makeMatch({ key: `four:${index}`, text: 'Acme' }),
          ),
        }),
      ],
    });
    renderTable({ ...resultsSnapshot(), records: [record] });
    expect(button('Show 1 more match')).toBeInTheDocument();
  });

  it('starts again from the first chunk, at rest, for a new result set', async () => {
    const user = userEvent.setup();
    const snapshot = snapshotOf('S8');
    const { rerenderWith } = renderTable(snapshot);
    await user.click(button('Load more records'));
    await user.click(button('Show 20 more matches'));
    expect(recordRows()).toHaveLength(100);
    expect(matchRows('history:')).toHaveLength(23);

    rerenderWith({
      ...snapshot,
      search: { ...snapshot.search, resultsId: snapshot.search.resultsId + 1 },
    });
    expect(recordRows()).toHaveLength(50);
    expect(matchRows('history:')).toHaveLength(3);
  });

  it('keeps the order of the snapshot', () => {
    renderTable(snapshotOf('S7'));
    expect(recordRows().map((row) => row.dataset.record)).toEqual([
      'article:launch',
      'article:brand',
      'page:about',
      'page:legal',
    ]);
    expect(recordRow('article:brand')).toHaveTextContent('Brand guidelines');
  });
});

describe('on a frame under 720px wide', () => {
  /** Answers the narrow-table media query (and the kit's small viewport) while `run` renders. */
  function narrowly(run: () => void) {
    const original = window.matchMedia;
    window.matchMedia = (media: string) => ({
      ...original(media),
      matches: media === COMPACT_TABLE_QUERY || media === '(max-width: 1024px)',
    });
    try {
      run();
    } finally {
      window.matchMedia = original;
    }
  }

  it('holds the model, the count, the status and every snippet in one column', () => {
    narrowly(() => {
      renderTable(snapshotOf('S14'));
      // One column: the others would be dropped by the table.
      expect(screen.getByText('Record')).toBeInTheDocument();
      for (const label of ['Match', 'Model', 'Status']) {
        expect(screen.queryByText(label, { exact: true })).toBeNull();
      }
      const replaced = recordRow('article:launch');
      expect(replaced).toHaveTextContent('Article · 3 matches');
      expect(within(replaced).getByText('Replaced')).toBeInTheDocument();
      expect(
        within(recordRow('article:brand')).getByText('Updating…'),
      ).toBeInTheDocument();
      // Each match line keeps its snippet next to its place.
      const [line] = matchRows('launch:');
      expect(line.querySelector('mark, del, ins')).not.toBeNull();
      expect(whereName(line)).not.toBe('');
    });
  });

  it('leaves the layout of the wide table as it is', () => {
    const stored = {
      columns: [
        { name: 'record', width: 2 },
        { name: 'status', width: 1 },
      ],
    };
    localStorage.setItem(
      'find-and-replace.resultsTable',
      JSON.stringify(stored),
    );
    narrowly(() => {
      renderTable(snapshotOf('S7'));
      expect(screen.getByText('Record')).toBeInTheDocument();
    });
    expect(
      JSON.parse(localStorage.getItem('find-and-replace.resultsTable') ?? ''),
    ).toEqual(stored);
  });
});

describe('selection', () => {
  it('record checkboxes ask for the negated value', async () => {
    const user = userEvent.setup();
    const { controller } = renderTable(excludingSnapshot());
    // "Some" has no mixed look in the kit: it shows unchecked and includes all.
    const launch = screen.getByRole('checkbox', {
      name: 'Acme launches a new widget',
    });
    expect(launch).not.toBeChecked();
    await user.click(launch);
    await user.click(screen.getByRole('checkbox', { name: 'About us' }));
    await user.click(screen.getByRole('checkbox', { name: 'Legal notice' }));
    expect(controller.callsTo('setRecordIncluded')).toEqual([
      ['article:launch', true],
      ['page:about', false],
      ['page:legal', true],
    ]);
  });

  it('match checkboxes and "Select all" ask for the negated value', async () => {
    const user = userEvent.setup();
    const { controller } = renderTable(excludingSnapshot());
    await user.click(screen.getByRole('checkbox', { name: 'Body, en' }));
    const [titleEn] = screen.getAllByRole('checkbox', { name: 'Title, en' });
    await user.click(titleEn);
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(controller.callsTo('setMatchIncluded')).toEqual([
      ['launch:body:en:0', true],
      ['launch:title:en:0', false],
    ]);
    expect(controller.callsTo('setAllIncluded')).toEqual([[true]]);
  });

  it('only the checkbox toggles a row, never a click on its text or its pill', async () => {
    const user = userEvent.setup();
    const { controller } = renderTable(planSnapshot());
    const row = recordRow('article:brand');

    // A click (the first of a double click that selects a word) on the title
    // or on a snippet changes nothing.
    fireEvent.click(within(row).getByText('Brand guidelines'));
    const [titleLine, slugLine] = matchRows('brand:');
    fireEvent.click(titleLine.querySelector('mark') ?? titleLine);
    // Nor does a tap on "Changes the URL" to read why slugs are left out.
    await user.click(within(slugLine).getByText('Changes the URL'));
    expect(controller.callsTo('setRecordIncluded')).toEqual([]);
    expect(controller.callsTo('setMatchIncluded')).toEqual([]);

    await user.click(within(slugLine).getByRole('checkbox'));
    await user.click(within(row).getByRole('checkbox'));
    expect(controller.callsTo('setMatchIncluded')).toHaveLength(1);
    expect(controller.callsTo('setRecordIncluded')).toHaveLength(1);
    // In a browser the box takes no pointer: the click lands on its cell.
    const cell = within(row).getByRole('checkbox').parentElement?.parentElement;
    if (cell) {
      fireEvent.click(cell);
    }
    expect(controller.callsTo('setRecordIncluded')).toHaveLength(2);
  });

  it('only selectable lines get a live checkbox', () => {
    renderTable(planSnapshot());
    // One match: the record checkbox decides, the line shows its inclusion.
    expect(within(recordRow('page:legal')).getByRole('checkbox')).toBeEnabled();
    const [legalLine] = matchRows('legal:');
    const lone = within(legalLine).getByRole('checkbox');
    expect(lone).toBeDisabled();
    expect(lone).toBeChecked();

    const brand = matchRows('brand:');
    expect(brand).toHaveLength(3);
    for (const line of brand) {
      expect(within(line).getByRole('checkbox')).toBeEnabled();
    }
    // The slug starts left out.
    expect(within(brand[1]).getByRole('checkbox')).not.toBeChecked();
  });

  it('has no checkboxes in find mode or in a finished report', () => {
    renderTable(snapshotOf('S7'));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    cleanup();
    renderTable(snapshotOf('S16'));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('locks attempted records, and every checkbox while a run is going', () => {
    renderTable(snapshotOf('S19'));
    expect(
      within(recordRow('article:launch')).getByRole('checkbox'),
    ).toBeDisabled();
    expect(within(recordRow('article:q3')).getByRole('checkbox')).toBeEnabled();
    expect(
      screen.getByRole('checkbox', { name: 'Select all rows' }),
    ).toBeEnabled();
    cleanup();

    renderTable(snapshotOf('S14'));
    expect(
      screen.queryByRole('checkbox', { name: 'Select all rows' }),
    ).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeDisabled();
    }
  });
});

describe('tree', () => {
  it('opens every record, and its toggle hides and shows its lines', async () => {
    const user = userEvent.setup();
    renderTable(snapshotOf('S7'));
    expect(matchRows('brand:').length).toBeGreaterThan(0);
    const toggle = within(recordRow('article:brand')).getByRole('button', {
      name: 'Brand guidelines',
      expanded: true,
    });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(matchRows('brand:')).toHaveLength(0);
    // The other records keep their lines.
    expect(matchRows('about:').length).toBeGreaterThan(0);

    await user.click(toggle);
    expect(matchRows('brand:').length).toBeGreaterThan(0);
  });
});

describe('where labels', () => {
  it('shows the label on the first line of each field only', async () => {
    const user = userEvent.setup();
    const [history] = manyRecords();
    renderTable({ ...resultsSnapshot(), records: [history] });
    const lines = () => matchRows('history:');
    expect(lines().map(whereLabel)).toEqual(['Title · en', null, 'Body · en']);
    // Every line keeps an accessible name, numbered within its field.
    expect(lines().map(whereName)).toEqual([
      'Title, en, match 1',
      'Title, en, match 2',
      'Body, en, match 1',
    ]);

    await user.click(button('Show 20 more matches'));
    const labels = lines().map(whereLabel);
    expect(labels).toHaveLength(23);
    expect(labels.filter((label) => label !== null)).toEqual([
      'Title · en',
      'Body · en',
    ]);
    expect(whereName(lines()[22])).toBe('Body, en, match 21');
  });

  it('is plain text: the path joined with " › " and the locale after " · "', () => {
    const record = makeRecord({
      modelId: 'article',
      modelName: 'Article',
      recordId: 'deep',
      title: 'Deep',
      fields: [
        makeField({
          key: 'deep:field',
          path: ['Content', 'Section 2', 'Quote', 'Text'],
          locale: 'it',
          matches: [makeMatch({ key: 'deep:0', text: 'Acme' })],
        }),
      ],
    });
    renderTable({ ...resultsSnapshot(), records: [record] });
    const [line] = matchRows('deep:');
    expect(whereLabel(line)).toBe('Content › Section 2 › Quote › Text · it');
    expect(whereName(line)).toBe('Content › Section 2 › Quote › Text, it');
  });

  it('marks a slug with "Changes the URL" only while the selection shows', async () => {
    const tip =
      "Replacing text in a slug changes the record's URL, so slugs are left out unless you select them.";
    renderTable(snapshotOf('S7'));
    expect(screen.queryByText('Changes the URL')).toBeNull();
    cleanup();

    renderTable(snapshotOf('S11'));
    const [, slugLine] = matchRows('brand:');
    expect(whereLabel(slugLine)).toBe('Slug');
    const pill = within(slugLine).getByText('Changes the URL');
    // The checkbox of the line reads it too (jsdom drops the space that a
    // browser keeps after the comma).
    expect(
      within(slugLine).getByRole('checkbox', {
        name: /^Slug, ?Changes the URL$/,
      }),
    ).toBeInTheDocument();
    // The explanation opens on keyboard focus, not only on hover.
    const focusable = pill.closest('[tabindex="0"]');
    expect(focusable).not.toBeNull();
    act(() => {
      (focusable as HTMLElement | null)?.focus();
    });
    expect(await screen.findByText(tip)).toBeInTheDocument();
  });
});

describe('statuses, reasons and links', () => {
  function withStatus(
    status: RecordRunStatus,
    title: string | null = 'A record',
    publish: RecordPublishStatus = { kind: 'none' },
  ): RecordView {
    return makeRecord({
      modelId: 'article',
      modelName: 'Article',
      recordId: 'rec',
      title,
      status,
      publish,
      fields: [
        makeField({
          key: 'rec:title',
          path: ['Title'],
          matches: [makeMatch({ key: 'rec:0', text: 'Acme' })],
        }),
      ],
    });
  }

  const STATUS_WORDS = /^(Replaced|Skipped|Failed|Published)$/;

  const cases: Array<{
    status: RecordRunStatus;
    publish?: RecordPublishStatus;
    word: string | null;
    reason: string | null;
  }> = [
    { status: { kind: 'untouched' }, word: null, reason: null },
    {
      status: { kind: 'replaced', replacedMatches: 1 },
      word: 'Replaced',
      reason: null,
    },
    {
      status: { kind: 'skipped', reason: 'stale' },
      word: 'Skipped',
      reason: 'Changed after the search. Search again to include it.',
    },
    {
      status: { kind: 'skipped', reason: 'unsupported' },
      word: 'Skipped',
      reason: "This field type can't be replaced yet.",
    },
    {
      status: {
        kind: 'failed',
        reason: 'validation',
        retryable: false,
        detail: { fieldLabel: 'Slug', code: 'format' },
      },
      word: 'Failed',
      reason: "The new value doesn't have the format “Slug” requires.",
    },
    {
      status: {
        kind: 'failed',
        reason: 'permission',
        retryable: false,
        detail: null,
      },
      word: 'Failed',
      reason: "Your role can't edit this record.",
    },
    {
      status: { kind: 'replaced', replacedMatches: 1 },
      publish: { kind: 'published' },
      word: 'Published',
      reason: null,
    },
    {
      status: { kind: 'replaced', replacedMatches: 1 },
      publish: { kind: 'held', reason: 'other_changes' },
      word: 'Replaced',
      reason: 'Not published, as it already had other unpublished changes.',
    },
  ];

  for (const { status, publish, word, reason } of cases) {
    const name = `${status.kind}${'reason' in status ? ` (${status.reason})` : ''}${publish ? `, publish ${publish.kind}` : ''}`;
    it(`renders ${name}`, () => {
      renderTable({
        ...resultsSnapshot(),
        records: [withStatus(status, 'A record', publish)],
      });
      const row = recordRow('article:rec');
      const words = within(row).queryAllByText(STATUS_WORDS);
      expect(words.map((element) => element.textContent)).toEqual(
        word ? [word] : [],
      );
      if (reason) {
        expect(screen.getByText(reason)).toBeInTheDocument();
      } else {
        expect(screen.queryByText(/\.$/)).toBeNull();
      }
    });
  }

  it('shows a spinner with "Updating…" and "Publishing…"', () => {
    renderTable({
      ...resultsSnapshot(),
      records: [withStatus({ kind: 'writing' })],
    });
    expect(
      within(recordRow('article:rec')).getByText('Updating…'),
    ).toBeTruthy();
    cleanup();
    renderTable({
      ...resultsSnapshot(),
      records: [
        withStatus({ kind: 'replaced', replacedMatches: 1 }, 'A record', {
          kind: 'publishing',
        }),
      ],
    });
    const row = recordRow('article:rec');
    expect(within(row).getByText('Publishing…')).toBeTruthy();
    expect(within(row).queryByText('Replaced')).toBeNull();
  });

  it('falls back to "Record <id>" without a title', () => {
    renderTable({
      ...resultsSnapshot(),
      records: [withStatus({ kind: 'untouched' }, '   ')],
    });
    expect(recordRow('article:rec')).toHaveTextContent('Record rec');
  });

  it('opens a record in a new tab, as a link to a page of the CMS', () => {
    // A `to`: `Canvas` builds the `href` on the project's domain. A
    // `target="_blank"` link opens with no opener in every browser.
    renderTable(snapshotOf('S7'), { internalDomain: 'acme.admin.datocms.com' });
    const [link] = screen.getAllByRole('link', {
      name: 'Open record in a new tab',
    });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute(
      'href',
      'https://acme.admin.datocms.com/editor/item_types/article/items/launch/edit',
    );
    // It works while a pass runs: a new tab doesn't leave the page.
    cleanup();
    renderTable(snapshotOf('S14'), {
      internalDomain: 'acme.admin.datocms.com',
    });
    for (const running of screen.getAllByRole('link', {
      name: 'Open record in a new tab',
    })) {
      expect(running).not.toHaveAttribute('aria-disabled');
      expect(running).toHaveAttribute('href');
    }
  });

  it('without an internal domain it navigates in the same tab, never while a pass runs', async () => {
    const user = userEvent.setup();
    const pathLink = (key: string): RecordLink => ({
      kind: 'path',
      path: `/editor/items/${key}/edit`,
    });
    const { mock } = renderTable(snapshotOf('S7'), { recordLink: pathLink });
    // No URL of the page exists without the domain: a button, with no
    // `href` that a new tab would open on the plugin's origin.
    expect(screen.queryAllByRole('link', { name: 'Open record' })).toEqual([]);
    const [open] = screen.getAllByRole('button', { name: 'Open record' });
    expect(open).not.toHaveAttribute('href');
    await user.click(open);
    expect(mock.navigateTo).toHaveBeenCalledWith(
      '/editor/items/article:launch/edit',
    );
    cleanup();

    const locked = renderTable(snapshotOf('S14'), { recordLink: pathLink });
    const buttons = screen.getAllByRole('button', { name: 'Open record' });
    for (const button of buttons) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
    }
    await user.click(buttons[0]);
    expect(locked.mock.navigateTo).not.toHaveBeenCalled();
    await user.hover(buttons[0]);
    expect(
      await screen.findByText(
        'You cannot open records while they are being updated.',
      ),
    ).toBeInTheDocument();
  });
});
