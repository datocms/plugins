import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordRunStatus, RecordView } from '../contract';
import { createFakeController } from './testing/fakeController';
import {
  excludingSnapshot,
  makeField,
  makeMatch,
  makeRecord,
  planSnapshot,
  resultsSnapshot,
  stateFixture,
} from './testing/fixtures';
import { renderBoot, renderSnapshot, renderState } from './testing/renderPage';

afterEach(() => {
  cleanup();
});

function sections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.fr-record'));
}

function recordNamed(title: string): HTMLElement {
  const section = screen.getByRole('region', { name: title });
  return section;
}

describe('chunking and "Show more"', () => {
  it('renders 50 records at a time and focuses the first new one', async () => {
    const user = userEvent.setup();
    renderState('S8');
    expect(sections()).toHaveLength(50);
    await user.click(screen.getByRole('button', { name: 'Load more records' }));
    expect(sections()).toHaveLength(100);
    expect(sections()[50]).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Load more records' }));
    expect(sections()).toHaveLength(120);
    expect(sections()[100]).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Load more records' }),
    ).toBeNull();
  });

  it('shows 3 matches, then 20 more per click, and collapses back', async () => {
    const user = userEvent.setup();
    renderState('S8');
    const history = recordNamed('The history of the company');
    const matchLines = () => history.querySelectorAll('.fr-match').length;
    expect(matchLines()).toBe(3);
    // The title field's two matches, then the first body match.
    expect(history.querySelectorAll('.fr-field')).toHaveLength(2);

    await user.click(
      within(history).getByRole('button', { name: 'Show 20 more matches' }),
    );
    expect(matchLines()).toBe(23);
    expect(
      within(history).getByRole('button', { name: 'Show 20 more matches' }),
    ).toHaveFocus();
    expect(
      within(history).getByRole('button', { name: 'Show fewer matches' }),
    ).toBeInTheDocument();

    await user.click(
      within(history).getByRole('button', { name: 'Show 20 more matches' }),
    );
    expect(matchLines()).toBe(43);
    await user.click(
      within(history).getByRole('button', { name: 'Show 9 more matches' }),
    );
    expect(matchLines()).toBe(52);
    expect(
      within(history).queryByRole('button', { name: /more match/ }),
    ).toBeNull();
    expect(
      within(history).getByRole('button', { name: 'Show fewer matches' }),
    ).toHaveFocus();

    await user.click(
      within(history).getByRole('button', { name: 'Show fewer matches' }),
    );
    expect(matchLines()).toBe(3);
    expect(
      within(history).getByRole('button', { name: 'Show 20 more matches' }),
    ).toHaveFocus();
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
    renderSnapshot({ ...resultsSnapshot(), records: [record] });
    expect(
      screen.getByRole('button', { name: 'Show 1 more match' }),
    ).toBeInTheDocument();
  });

  it('resets chunks and expanded records when resultsId changes', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S8');
    await user.click(screen.getByRole('button', { name: 'Load more records' }));
    await user.click(
      within(recordNamed('The history of the company')).getByRole('button', {
        name: 'Show 20 more matches',
      }),
    );
    expect(sections()).toHaveLength(100);
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        search: { ...current.search, resultsId: current.search.resultsId + 1 },
      })),
    );
    expect(sections()).toHaveLength(50);
    expect(
      recordNamed('The history of the company').querySelectorAll('.fr-match'),
    ).toHaveLength(3);
  });

  it('keeps the given order', () => {
    renderState('S7');
    expect(
      sections().map(
        (section) => section.querySelector('.fr-record__title')?.textContent,
      ),
    ).toEqual([
      'Acme launches a new widget',
      'Brand guidelines',
      'About us',
      'Legal notice',
    ]);
  });
});

describe('selection', () => {
  it('record checkboxes ask for the negated value and show "mixed"', async () => {
    const user = userEvent.setup();
    const { controller } = renderSnapshot(excludingSnapshot());
    const launch = screen.getByRole('checkbox', {
      name: 'Select "Acme launches a new widget"',
    }) as HTMLInputElement;
    expect(launch.indeterminate).toBe(true);
    await user.click(launch);
    await user.click(
      screen.getByRole('checkbox', { name: 'Select "About us"' }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Select "Legal notice"' }),
    );
    expect(controller.callsTo('setRecordIncluded')).toEqual([
      ['article:launch', true],
      ['page:about', false],
      ['page:legal', true],
    ]);
  });

  it('match checkboxes and "Select all" ask for the negated value', async () => {
    const user = userEvent.setup();
    const { controller } = renderSnapshot(excludingSnapshot());
    await user.click(
      screen.getByRole('checkbox', { name: 'Select this match in Body (en)' }),
    );
    const [titleEn] = screen.getAllByRole('checkbox', {
      name: 'Select this match in Title (en)',
    });
    await user.click(titleEn);
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(controller.callsTo('setMatchIncluded')).toEqual([
      ['launch:body:en:0', true],
      ['launch:title:en:0', false],
    ]);
    expect(controller.callsTo('setAllIncluded')).toEqual([[true]]);
  });

  it('match checkboxes exist only in records with 2+ matches', () => {
    renderSnapshot(planSnapshot());
    const legal = recordNamed('Legal notice');
    expect(within(legal).getAllByRole('checkbox')).toHaveLength(1);
    const brand = recordNamed('Brand guidelines');
    expect(within(brand).getAllByRole('checkbox')).toHaveLength(4);
  });

  it('checked match checkboxes stay in the Tab order', async () => {
    const user = userEvent.setup();
    renderSnapshot(planSnapshot());
    const launch = screen.getByRole('checkbox', {
      name: 'Select "Acme launches a new widget"',
    });
    launch.focus();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getAllByRole('checkbox', {
        name: 'Select this match in Title (en)',
      })[0],
    );
    expect(document.activeElement).toBeChecked();
  });

  it('no strip in find mode or in the finished report', () => {
    renderState('S7');
    expect(document.querySelector('.fr-record__check')).toBeNull();
    cleanup();
    renderState('S16');
    expect(document.querySelector('.fr-record__check')).toBeNull();
  });

  it('attempted records keep an empty strip cell', () => {
    renderState('S19');
    const replaced = recordNamed('Globex launches a new widget');
    expect(replaced.querySelector('.fr-record__check--empty')).not.toBeNull();
    expect(within(replaced).queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('record head', () => {
  it('is one line: bold title, then "{model} · {n} matches" as plain text', () => {
    renderState('S7');
    const launch = recordNamed('Acme launches a new widget');
    const head = launch.querySelector('.fr-record__head');
    expect(head?.querySelector('.fr-record__title')).toHaveTextContent(
      'Acme launches a new widget',
    );
    expect(head?.querySelector('.fr-record__meta')).toHaveTextContent(
      'Article · 3 matches',
    );
    expect(head?.querySelector('.dl-row-tag')).toBeNull();
    expect(launch.querySelector('.dl-record__model')).toBeNull();
    expect(
      recordNamed('Legal notice').querySelector('.fr-record__meta'),
    ).toHaveTextContent('Page · 1 match');
  });
});

describe('where-cells', () => {
  /** The visible where-labels (no-break spaces read as spaces). */
  function whereCells(scope: ParentNode): Array<string | null> {
    return Array.from(scope.querySelectorAll('.fr-match')).map(
      (line) =>
        line
          .querySelector('.fr-match__where .fr-where__label')
          ?.textContent?.replace(/\u00a0/g, ' ') ?? null,
    );
  }

  function lineNames(scope: ParentNode): string[] {
    return Array.from(scope.querySelectorAll('.fr-match')).map(
      (line) =>
        line.querySelector('.fr-match__where > .fr-sr-only')?.textContent ?? '',
    );
  }

  it('shows the where-cell on the first match of each field only', () => {
    renderState('S8');
    const history = recordNamed('The history of the company');
    // Title has 2 matches, then the first body match.
    expect(whereCells(history)).toEqual(['Title · en', null, 'Body · en']);
    const later = history.querySelectorAll('.fr-match')[1];
    expect(later.querySelector('.fr-match__where')).toHaveClass(
      'fr-match__where--empty',
    );
    // Every line keeps an accessible name, numbered within its field.
    expect(lineNames(history)).toEqual([
      'Title, en, match 1',
      'Title, en, match 2',
      'Body, en, match 1',
    ]);

    const values = recordNamed('Our values');
    expect(whereCells(values)).toEqual(['Body · en', null, null]);
  });

  it('keeps one where-cell per field after "Show more"', async () => {
    const user = userEvent.setup();
    renderState('S8');
    const history = recordNamed('The history of the company');
    await user.click(
      within(history).getByRole('button', { name: 'Show 20 more matches' }),
    );
    const cells = whereCells(history);
    expect(cells).toHaveLength(23);
    expect(cells.filter((cell) => cell !== null)).toEqual([
      'Title · en',
      'Body · en',
    ]);
    expect(lineNames(history)[22]).toBe('Body, en, match 21');
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
    renderSnapshot({ ...planSnapshot(), records: [record] });
    const where = document.querySelector('.fr-match__where');
    expect(where?.querySelector('.fr-where__label')).toHaveTextContent(
      'Content › Section 2 › Quote › Text · it',
    );
    expect(where?.querySelector('.fr-where__label')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(where?.querySelector('.fr-sr-only')).toHaveTextContent(
      'Content › Section 2 › Quote › Text, it',
    );
    expect(document.querySelector('.dl-chip')).toBeNull();
    expect(where?.querySelector('.dl-tooltip-anchor')).toBeNull();
  });

  it('puts the checkbox before the where-cell and the slug tag under its label, in plan mode only', () => {
    renderState('S7');
    expect(screen.queryByText('Changes the URL')).toBeNull();
    const launch = recordNamed('Acme launches a new widget');
    expect(whereCells(launch)).toEqual([
      'Title · en',
      'Title · it',
      'Body · en',
    ]);
    expect(launch.querySelector('.dl-chip')).toBeNull();
    cleanup();
    renderState('S11');
    const brand = recordNamed('Brand guidelines');
    expect(whereCells(brand)).toEqual([
      'Title · en',
      'Slug',
      'SEO › Description · en',
    ]);
    const slugLine = brand.querySelectorAll('.fr-match')[1];
    const children = Array.from(slugLine.children).map(
      (child) => child.className,
    );
    expect(children).toEqual([
      'dl-checkbox fr-match__check',
      'fr-match__where',
      'fr-match__snippet',
    ]);
    const tag = within(slugLine as HTMLElement).getByText('Changes the URL');
    expect(tag).toHaveClass('dl-row-tag');
    expect(tag.closest('.fr-match__where')).not.toBeNull();
  });

  it('explains "Changes the URL" on keyboard focus and to screen readers, not only on hover', async () => {
    const tip =
      "Replacing text in a slug changes the record's URL, so slugs are left out unless you select them";
    renderState('S11');
    const tag = screen.getByText('Changes the URL');
    expect(tag).toHaveAttribute('tabindex', '0');
    const describedBy = tag.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)).toHaveTextContent(tip);
    act(() => {
      tag.focus();
    });
    // The tooltip opens on focus: its text and the hidden description.
    expect(await screen.findAllByText(tip)).toHaveLength(2);
  });
});

describe('the checkbox column', () => {
  it('is reserved only when a record shown has match checkboxes', () => {
    renderState('S11');
    const card = document.querySelector('.fr-results');
    expect(card).toHaveClass('fr-results--match-checks');
    expect(recordNamed('Brand guidelines')).toHaveClass(
      'fr-record--match-checks',
    );
    expect(recordNamed('Legal notice')).not.toHaveClass(
      'fr-record--match-checks',
    );
    cleanup();

    // Plan mode where no record has 2+ matches: the strip, but no reserved column.
    renderState('S11b');
    expect(document.querySelector('.fr-record__check')).not.toBeNull();
    expect(document.querySelectorAll('.fr-match__check')).toHaveLength(0);
    expect(document.querySelector('.fr-results')).not.toHaveClass(
      'fr-results--match-checks',
    );
    expect(document.querySelector('.fr-record--match-checks')).toBeNull();
    cleanup();

    // Find mode.
    renderState('S7');
    expect(document.querySelector('.fr-results')).not.toHaveClass(
      'fr-results--match-checks',
    );
  });

  it('names each match checkbox of a field with 2+ matches by its number', () => {
    const matches = [0, 1, 2].map((index) =>
      makeMatch({ key: `multi:${index}`, text: 'Acme', selectable: true }),
    );
    const record = makeRecord({
      modelId: 'article',
      modelName: 'Article',
      recordId: 'multi',
      title: 'Multi',
      selectable: true,
      fields: [
        makeField({
          key: 'multi:body',
          path: ['Body'],
          locale: 'en',
          matches,
        }),
      ],
    });
    renderSnapshot({ ...planSnapshot(), records: [record] });
    const names = Array.from(document.querySelectorAll('.fr-match__check')).map(
      (box) => box.getAttribute('aria-label'),
    );
    expect(names).toEqual([
      'Select match 1 in Body (en)',
      'Select match 2 in Body (en)',
      'Select match 3 in Body (en)',
    ]);
  });
});

describe('statuses, reasons and links', () => {
  function withStatus(status: RecordRunStatus, title = 'A record'): RecordView {
    return makeRecord({
      modelId: 'article',
      modelName: 'Article',
      recordId: 'rec',
      title,
      status,
      fields: [
        makeField({
          key: 'rec:title',
          path: ['Title'],
          matches: [makeMatch({ key: 'rec:0', text: 'Acme' })],
        }),
      ],
    });
  }

  const cases: Array<{
    status: RecordRunStatus;
    word: string | null;
    reason: string | null;
    attention: boolean;
    iconClass: string | null;
  }> = [
    {
      status: { kind: 'untouched' },
      word: null,
      reason: null,
      attention: false,
      iconClass: null,
    },
    {
      status: { kind: 'replaced', replacedMatches: 1 },
      word: 'Replaced',
      reason: null,
      attention: false,
      iconClass: 'dl-log-status--success',
    },
    {
      status: { kind: 'skipped', reason: 'stale' },
      word: 'Skipped',
      reason: 'Changed after the search. Search again to include it.',
      attention: true,
      iconClass: 'dl-log-status--warning',
    },
    {
      status: { kind: 'skipped', reason: 'deleted' },
      word: 'Skipped',
      reason: 'This record no longer exists.',
      attention: true,
      iconClass: 'dl-log-status--warning',
    },
    {
      status: { kind: 'skipped', reason: 'unsupported' },
      word: 'Skipped',
      reason: "This field type can't be replaced yet.",
      attention: true,
      iconClass: 'dl-log-status--warning',
    },
    {
      status: {
        kind: 'failed',
        reason: 'validation',
        retryable: false,
        detail: { fieldLabel: 'Slug', code: 'format' },
      },
      word: 'Failed',
      reason: 'The new value doesn\'t have the format "Slug" requires.',
      attention: true,
      iconClass: 'dl-log-status--failed',
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
      attention: true,
      iconClass: 'dl-log-status--failed',
    },
    {
      status: {
        kind: 'failed',
        reason: 'unknown',
        retryable: false,
        detail: null,
      },
      word: 'Failed',
      reason: "Couldn't save this record.",
      attention: true,
      iconClass: 'dl-log-status--failed',
    },
  ];

  for (const { status, word, reason, attention, iconClass } of cases) {
    it(`renders ${status.kind}${'reason' in status ? ` (${status.reason})` : ''}`, () => {
      renderSnapshot({ ...resultsSnapshot(), records: [withStatus(status)] });
      const section = recordNamed('A record');
      const slot = section.querySelector('.fr-record__status');
      if (word) {
        expect(slot).toHaveTextContent(word);
        expect(slot?.querySelector('svg')).not.toBeNull();
        expect(slot?.firstElementChild).toHaveClass(iconClass ?? '');
      } else {
        expect(slot).toBeEmptyDOMElement();
      }
      const reasonLine = section.querySelector('.fr-record__reason');
      if (reason) {
        expect(reasonLine).toHaveTextContent(reason);
      } else {
        expect(reasonLine).toBeNull();
      }
      expect(section.classList.contains('fr-record--attention')).toBe(
        attention,
      );
    });
  }

  it('shows a spinner and "Updating…" while writing', () => {
    renderSnapshot({
      ...resultsSnapshot(),
      records: [withStatus({ kind: 'writing' })],
    });
    const slot = recordNamed('A record').querySelector('.fr-record__status');
    expect(slot?.querySelector('.fr-status-spinner')).not.toBeNull();
    expect(slot).toHaveTextContent('Updating…');
  });

  it('falls back to "Record #id" without a title', () => {
    renderSnapshot({
      ...resultsSnapshot(),
      records: [withStatus({ kind: 'untouched' }, '')],
    });
    expect(
      screen.getByRole('region', { name: 'Record #rec' }),
    ).toBeInTheDocument();
  });

  it('opens a record in a new tab', () => {
    renderState('S7');
    const [link] = screen.getAllByRole('link', {
      name: 'Open record in a new tab',
    });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(link).toHaveAttribute(
      'href',
      'https://acme.admin.datocms.com/editor/item_types/article/items/launch/edit',
    );
  });

  it('without an internal domain it navigates in the same tab, never while running', async () => {
    const user = userEvent.setup();
    const pathLink = (key: string) => ({
      kind: 'path' as const,
      path: `/editor/items/${key}/edit`,
    });
    const idle = createFakeController(resultsSnapshot(), {
      recordLink: pathLink,
    });
    const { mock } = renderBoot({ status: 'ready', controller: idle });
    const [open] = screen.getAllByRole('button', { name: 'Open record' });
    await user.click(open);
    expect(mock.navigateTo).toHaveBeenCalledWith(
      '/editor/items/article:launch/edit',
    );
    cleanup();

    const running = stateFixture('S14').snapshot;
    if (!running) {
      throw new Error('fixture');
    }
    const busy = createFakeController(running, { recordLink: pathLink });
    renderBoot({ status: 'ready', controller: busy });
    for (const button of screen.getAllByRole('button', {
      name: 'Open record',
    })) {
      expect(button).toBeDisabled();
    }
    const anchor = screen
      .getAllByRole('button', { name: 'Open record' })[0]
      .closest('.dl-tooltip-anchor');
    const id = anchor?.getAttribute('aria-describedby');
    expect(id ? document.getElementById(id) : null).toHaveTextContent(
      'You cannot open records right now as a replacement is in progress',
    );
  });
});
