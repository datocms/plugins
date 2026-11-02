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

  it('shows the 4th match rather than a row that would hide only it', () => {
    const record = (count: number) =>
      makeRecord({
        modelId: 'article',
        modelName: 'Article',
        recordId: `n${count}`,
        title: `${count} matches`,
        fields: [
          makeField({
            key: `n${count}:body`,
            path: ['Body'],
            matches: Array.from({ length: count }, (_, index) =>
              makeMatch({ key: `n${count}:${index}`, text: 'Acme' }),
            ),
          }),
        ],
      });
    renderTable({ ...resultsSnapshot(), records: [record(4), record(5)] });
    expect(matchRows('n4:')).toHaveLength(4);
    expect(matchRows('n5:')).toHaveLength(3);
    expect(screen.queryByText('Show 1 more match')).toBeNull();
    expect(screen.queryByText('Show fewer matches')).toBeNull();
    expect(button('Show 2 more matches')).toBeInTheDocument();
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
      // Only some of its matches were included: the words say so.
      expect(replaced).toHaveTextContent('Article · 2 of 3 matches');
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

describe('columns', () => {
  it('adds Status only once a pass gave a record a status', () => {
    renderTable(snapshotOf('S7'));
    expect(screen.getByText('Model', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Status', { exact: true })).toBeNull();
    cleanup();
    renderTable(snapshotOf('S14'));
    expect(screen.getByText('Status', { exact: true })).toBeInTheDocument();
  });
});

describe('selection', () => {
  it('says how many matches of a record are included when only some are', () => {
    renderTable(excludingSnapshot());
    const launch = recordRow('article:launch');
    expect(
      within(launch).getByText(/^\d+ of \d+ matches$/),
    ).toBeInTheDocument();
    // A record with every match (or none) included keeps its plain count.
    expect(
      within(recordRow('page:about')).queryByText(/ of /),
    ).not.toBeInTheDocument();
    cleanup();
    // No selection (find mode): the plain count.
    renderTable(resultsSnapshot());
    expect(screen.queryByText(/^\d+ of \d+ matches$/)).toBeNull();
    cleanup();
    // The report keeps the words of the selection the pass used.
    renderTable(snapshotOf('S16'));
    expect(
      within(recordRow('article:launch')).getByText('2 of 3 matches'),
    ).toBeInTheDocument();
  });

  it('record checkboxes say whether the record takes part, and ask for the negated value', async () => {
    const user = userEvent.setup();
    const { controller } = renderTable(excludingSnapshot());
    // Only some matches: the record takes part, so it is checked ("2 of 3
    // matches" says the rest), and a click leaves it out.
    const launch = screen.getByRole('checkbox', {
      name: 'Acme launches a new widget',
    });
    expect(launch).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Legal notice' }),
    ).not.toBeChecked();
    await user.click(launch);
    await user.click(screen.getByRole('checkbox', { name: 'About us' }));
    await user.click(screen.getByRole('checkbox', { name: 'Legal notice' }));
    expect(controller.callsTo('setRecordIncluded')).toEqual([
      ['article:launch', false],
      ['page:about', false],
      ['page:legal', true],
    ]);
  });

  it('checks "Select all" when every record takes part, slugs left out or not', async () => {
    const user = userEvent.setup();
    const { controller } = renderTable(planSnapshot());
    // The slug of "Brand guidelines" starts left out: the record still takes part.
    expect(
      within(recordRow('article:brand')).getByRole('checkbox'),
    ).toBeChecked();
    const all = screen.getByRole('checkbox', { name: 'Select all rows' });
    expect(all).toBeChecked();
    await user.click(all);
    expect(controller.callsTo('setAllIncluded')).toEqual([[false]]);
    cleanup();
    // A record left out: unchecked.
    renderTable(excludingSnapshot());
    expect(
      screen.getByRole('checkbox', { name: 'Select all rows' }),
    ).not.toBeChecked();
  });

  it('match checkboxes and "Select all" ask for the negated value', async () => {
    const user = userEvent.setup();
    const { controller } = renderTable(excludingSnapshot());
    await user.click(screen.getByRole('checkbox', { name: 'Body, English' }));
    const [titleEn] = screen.getAllByRole('checkbox', {
      name: 'Title, English',
    });
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

  it('only selectable lines get a live checkbox', async () => {
    const user = userEvent.setup();
    const { controller } = renderTable(planSnapshot());
    // One match: its line takes the record's own checkbox, live and agreeing.
    expect(within(recordRow('page:legal')).getByRole('checkbox')).toBeEnabled();
    const [legalLine] = matchRows('legal:');
    const lone = within(legalLine).getByRole('checkbox');
    expect(lone).toBeEnabled();
    expect(lone).toBeChecked();
    await user.click(lone);
    expect(controller.callsTo('setRecordIncluded')).toEqual([
      ['page:legal', false],
    ]);
    expect(controller.callsTo('setMatchIncluded')).toEqual([]);

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
  it('shows the label on every line, so later lines of a field never look empty', async () => {
    const user = userEvent.setup();
    const [history] = manyRecords();
    renderTable({ ...resultsSnapshot(), records: [history] });
    const lines = () => matchRows('history:');
    expect(lines().map(whereLabel)).toEqual([
      'Title · English',
      'Title · English',
      'Body · English',
    ]);
    // Every line keeps an accessible name, numbered within its field.
    expect(lines().map(whereName)).toEqual([
      'Title, English, match 1',
      'Title, English, match 2',
      'Body, English, match 1',
    ]);

    await user.click(button('Show 20 more matches'));
    const labels = lines().map(whereLabel);
    expect(labels).toHaveLength(23);
    expect(new Set(labels)).toEqual(
      new Set(['Title · English', 'Body · English']),
    );
    expect(whereName(lines()[22])).toBe('Body, English, match 21');
  });

  it('is plain text: the path joined with " › " and the language after " · "', () => {
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
    expect(whereLabel(line)).toBe(
      'Content › Section 2 › Quote › Text · Italian',
    );
    expect(whereName(line)).toBe('Content › Section 2 › Quote › Text, Italian');
  });

  it('marks a slug with "Changes the URL" only while the selection shows', async () => {
    const tip =
      "Replacing text in a slug changes the record's URL, so slugs are left out unless you select them.";
    renderTable(snapshotOf('S7'));
    expect(screen.queryByText('Changes the URL')).toBeNull();
    cleanup();

    // In the report, only on a slug the pass left out: it kept the old text.
    renderTable(snapshotOf('S16'));
    const [, leftOut] = matchRows('brand:');
    expect(within(leftOut).getByText('Changes the URL')).toBeInTheDocument();
    expect(screen.getAllByText('Changes the URL')).toHaveLength(1);
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

  const STATUS_WORDS = /^(Replaced|Skipped|Failed|Published|Not published)$/;

  const cases: Array<{
    status: RecordRunStatus;
    publish?: RecordPublishStatus;
    word: string | null;
    reason: string | null;
    /** The editor fixes it in the record: "Open record in a new tab" follows the reason. */
    open?: boolean;
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
      reason: 'Someone edited it after the search.',
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
      open: true,
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
    // The text was replaced, but the record isn't live: the dot says so.
    {
      status: { kind: 'replaced', replacedMatches: 1 },
      publish: {
        kind: 'failed',
        reason: 'validation',
        retryable: false,
        detail: { fieldLabel: 'Published on', code: 'required' },
      },
      word: 'Not published',
      reason: "Couldn't publish, as “Published on” can't be empty.",
      open: true,
    },
    {
      status: { kind: 'replaced', replacedMatches: 1 },
      publish: { kind: 'skipped', reason: 'changed' },
      word: 'Not published',
      reason: 'Not published, as it was edited after the replacement.',
    },
  ];

  for (const { status, publish, word, reason, open = false } of cases) {
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
      // Visible text, not only the row's icon that shows on hover.
      expect(screen.queryAllByText('Open record in a new tab')).toHaveLength(
        open ? 1 : 0,
      );
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
        "You can't open records while they are being updated.",
      ),
    ).toBeInTheDocument();
  });
});
