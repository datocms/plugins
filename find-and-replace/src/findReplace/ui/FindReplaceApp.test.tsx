import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import kitFixesCss from '../../kit-fixes.css?raw';
import recipesCss from '../../ui/recipes.css?raw';
import { FindReplaceApp } from './FindReplaceApp';
import {
  disabledPrimary,
  resultsSnapshot,
  runEndedEvent,
  stateBoot,
  stateFixture,
} from './testing/fixtures';
import {
  createMockCtx,
  renderBoot,
  renderSnapshot,
  renderState,
} from './testing/renderPage';

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(() => {
  // The kit Dropdown menu watches its position with an IntersectionObserver.
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: IntersectionObserverMock,
  });
});

afterEach(() => {
  cleanup();
});

function toolbarMeta(): string | null {
  return document.querySelector('.dl-toolbar__subtitle')?.textContent ?? null;
}

function primaryButton(): HTMLButtonElement | null {
  const button = document.querySelector('.dl-kit-button--primary');
  return button instanceof HTMLButtonElement ? button : null;
}

function findInput(): HTMLInputElement | null {
  return screen.queryByRole('textbox', {
    name: 'Find',
  }) as HTMLInputElement | null;
}

function records(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.fr-record'));
}

function progressLabel(): string | null {
  return document.querySelector('.fr-progress__label')?.textContent ?? null;
}

/** The disabled primary's reason, as screen readers get it. */
function primaryReason(): string | null {
  const anchor = document.querySelector('.dl-tooltip-anchor');
  const id = anchor?.getAttribute('aria-describedby');
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
}

/** The declarations of the first top-level rule with exactly this selector. */
function cssRule(source: string, selector: string): string {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(
    code,
  );
  return rule?.[1] ?? '';
}

describe('every state renders', () => {
  it('S1 booting: title only, a disabled find row, the 80px spinner', () => {
    renderState('S1');
    expect(screen.getByText('Find and Replace')).toBeInTheDocument();
    expect(primaryButton()).toBeNull();
    expect(toolbarMeta()).toBeNull();
    expect(findInput()).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: 'Replace with' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Match case' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Replace with nothing' }),
    ).toBeNull();
  });

  it('S2 idle: disabled primary with its reason, Find focused, idle state', () => {
    renderState('S2');
    expect(primaryButton()).toHaveTextContent('Replace');
    expect(primaryButton()).toBeDisabled();
    expect(primaryReason()).toBe(
      'You cannot replace anything until the search finds matches',
    );
    expect(findInput()).toHaveFocus();
    expect(findInput()).toHaveAttribute(
      'placeholder',
      'Type something to find…',
    );
    expect(
      screen.getByText('Find and replace across all records'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Replace with nothing' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'All models' })).toBeNull();
  });

  it('S3 typing: ✕ appears, the primary waits for the search', () => {
    renderState('S3');
    expect(findInput()).toHaveValue('Acm');
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeEnabled();
    expect(primaryReason()).toBe(
      'You cannot replace right now as the search is still running',
    );
    expect(
      screen.getByText('Find and replace across all records'),
    ).toBeInTheDocument();
  });

  it('S4 invalid pattern: invalid group and one form line', () => {
    renderState('S4');
    expect(document.querySelector('.fr-find')).toHaveClass(
      'dl-input-group--invalid',
    );
    expect(findInput()).toHaveAttribute(
      'placeholder',
      'Type a regular expression…',
    );
    expect(document.querySelector('.dl-form-error')).toHaveTextContent(
      'Pattern must be a valid regular expression (unterminated group)',
    );
    expect(primaryReason()).toBe(
      'You cannot replace as the pattern is not valid',
    );
    expect(records()).toHaveLength(0);
  });

  it('S5 searching: progress row with a spinner, the body spinner', () => {
    renderState('S5');
    const progress = screen.getByRole('progressbar', {
      name: 'Search progress',
    });
    expect(progress).not.toHaveAttribute('aria-valuenow');
    expect(progressLabel()).toBe('300 records searched');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    const body = document.querySelector('.dl-pane__body');
    expect(body?.children).toHaveLength(1);
    expect(toolbarMeta()).toBeNull();
  });

  it('S6 streaming: determinate bar, live meta, the eraser', () => {
    renderState('S6');
    const progress = screen.getByRole('progressbar', {
      name: 'Search progress',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '1200');
    expect(progress).toHaveAttribute('aria-valuemax', '3400');
    expect(progressLabel()).toBe('1,200 of 3,400 records searched');
    expect(toolbarMeta()).toBe('4 matches in 2 records');
    expect(records()).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Replace with nothing' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('S26 large project: the Enter key cap, described to screen readers, and why Replace waits', () => {
    renderState('S26');
    const input = screen.getByRole('textbox', { name: 'Find' });
    expect(input).toHaveValue('Acme Corp');
    expect(input).toHaveAttribute('placeholder', 'Type, then press Enter…');
    expect(input).toHaveAccessibleDescription('Press Enter to search');
    expect(document.querySelector('.fr-find__enter kbd')).toHaveTextContent(
      'Enter',
    );
    expect(primaryReason()).toBe(
      'You cannot replace until you press Enter to search',
    );
    // The results of the last search stay on screen.
    expect(records()).toHaveLength(4);
  });

  it('S27 large project: records read and the time left', () => {
    renderState('S27');
    expect(progressLabel()).toBe('48,000 of 184,000 records searched');
    expect(document.querySelector('.fr-progress__hint')).toHaveTextContent(
      'About 3 minutes left',
    );
    expect(
      screen.getByRole('textbox', { name: 'Find' }),
    ).not.toHaveAccessibleDescription();
    expect(document.querySelector('.fr-find__enter')).toBeNull();
  });

  it('S28 capped again after reading on: "the next 10,000"', () => {
    renderState('S28');
    expect(document.querySelector('.fr-note')).toHaveTextContent(
      'Showing the next 10,000 matches. Replace them, then search again for the rest.',
    );
  });

  it('S7 results: a read-only list, the model filter, no checkboxes', () => {
    renderState('S7');
    expect(toolbarMeta()).toBe('9 matches in 4 records');
    expect(document.querySelector('.fr-summary')).toHaveTextContent(
      '9 matches in 4 records',
    );
    expect(records()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'All models' })).toBeEnabled();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('Select all')).toBeNull();
    expect(screen.queryByText('Changes the URL')).toBeNull();
    expect(primaryReason()).toBe(
      'You cannot replace until you type a replacement or turn on Replace with nothing',
    );
  });

  it('S8 capped: the note, 50 records and "Load more records"', () => {
    renderState('S8');
    expect(toolbarMeta()).toBe('10,000+ matches in 2,310 records');
    expect(document.querySelector('.fr-note')).toHaveTextContent(
      'Showing the first 10,000 matches. Replace them, then search again for the rest.',
    );
    expect(records()).toHaveLength(50);
    expect(
      screen.getByRole('button', { name: 'Load more records' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show 20 more matches' }),
    ).toBeInTheDocument();
  });

  it('S9 no results: the idle style, the searched pattern and what narrows it', () => {
    renderState('S9');
    expect(toolbarMeta()).toBe('No matches');
    const empty = document.querySelector('.dl-list-empty');
    expect(empty?.querySelector('.dl-list-empty__icon svg')).not.toBeNull();
    expect(empty?.querySelector('.dl-list-empty__title')).toHaveTextContent(
      'No matches for "Acme Corp"',
    );
    expect(empty).toHaveTextContent(
      'Consider broadening your search: turn off Match case, or try different keywords.',
    );
    expect(document.querySelector('.dl-blank-slate')).toBeNull();
    expect(document.querySelector('.fr-summary')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Replace with nothing' }),
    ).toBeNull();
  });

  it('S10a models failed: a warning callout with "Try again"', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S10a');
    const callout = document.querySelector('.dl-callout--warning');
    expect(callout).toHaveTextContent(
      'Couldn\'t search the "Author" and "Legal page" models.',
    );
    // Not a live region: only the one polite region announces (§4.12).
    expect(callout).not.toHaveAttribute('role');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(controller?.callsTo('retryFailedModels')).toHaveLength(1);
  });

  it('S10b search stopped: a plain note', () => {
    renderState('S10b');
    expect(document.querySelector('.fr-note')).toHaveTextContent(
      'Search stopped after 1,200 of 3,400 records, so some matches may be missing.',
    );
    expect(toolbarMeta()).toBe('24 matches in 9 records');
  });

  it('S11 plan: diffs, the strip, "Select all" and a counted primary', () => {
    renderState('S11');
    expect(toolbarMeta()).toBe('8 of 9 matches will change');
    expect(primaryButton()).toHaveTextContent('Replace 8 matches');
    expect(primaryButton()).toBeEnabled();
    const selectAll = screen.getByRole('checkbox', { name: 'Select all' });
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    expect(screen.getByText('Changes the URL')).toBeInTheDocument();
    expect(document.querySelectorAll('.fr-del')).toHaveLength(8);
    expect(document.querySelectorAll('.fr-ins')).toHaveLength(8);
    expect(document.querySelector('.fr-results')).toHaveClass(
      'fr-results--selecting',
    );
  });

  it('S11b remove: the eraser is on and everything says "Remove"', () => {
    renderState('S11b');
    expect(primaryButton()).toHaveTextContent('Remove 3 matches');
    const replaceInput = screen.getByRole('textbox', { name: 'Replace with' });
    expect(replaceInput).toBeDisabled();
    expect(replaceInput).toHaveValue('');
    expect(replaceInput).toHaveAttribute(
      'placeholder',
      'Matches will be removed',
    );
    expect(
      screen.getByRole('button', { name: 'Replace with nothing' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('.fr-ins')).toHaveLength(0);
    expect(document.querySelectorAll('.fr-del')).toHaveLength(3);
  });

  it('S11c no change: the warning line and "No change" tags', () => {
    renderState('S11c');
    expect(document.querySelector('.fr-form-warning')).toHaveTextContent(
      'Your replacement also matches this search, so a later search can find these matches again',
    );
    expect(screen.getAllByText('No change')).toHaveLength(2);
    expect(toolbarMeta()).toBe('5 of 9 matches will change');
  });

  it('S12 excluding: unchecked record and match, counts follow', () => {
    renderState('S12');
    expect(primaryButton()).toHaveTextContent('Replace 6 matches');
    expect(
      screen.getByRole('checkbox', { name: 'Select "Legal notice"' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: 'Select this match in Body (en)',
      }),
    ).not.toBeChecked();
  });

  it('S12b model filter: counts per model, "—" when it could not be searched', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S12b');
    await user.click(screen.getByRole('button', { name: 'All models' }));
    const author = await screen.findByRole('button', {
      name: /Author/,
    });
    expect(author).toHaveTextContent("Author—, couldn't be searched");
    expect(screen.getByRole('button', { name: /^Article/ })).toHaveTextContent(
      'Article6, 6 matches',
    );
    await user.click(screen.getByRole('button', { name: /^Page/ }));
    expect(controller?.callsTo('setModelFilter')).toEqual([['page']]);
  });

  it('S13 confirm: the primary opens the host confirm', async () => {
    const user = userEvent.setup();
    const { mock } = renderState('S13');
    await user.click(screen.getByRole('button', { name: 'Replace 6 matches' }));
    expect(mock.openConfirm).toHaveBeenCalledWith({
      title: 'Replace 6 matches?',
      content:
        'Are you sure you want to replace "Acme" with "Globex" in 3 records? Records in models without draft/published change on your website right away.',
      choices: [
        { label: 'Yes, replace 6 matches', value: true, intent: 'negative' },
      ],
      cancel: { label: 'Cancel', value: false },
    });
  });

  it('S14 replacing: record progress, locked row, busy primary, statuses', () => {
    renderState('S14');
    const progress = screen.getByRole('progressbar', {
      name: 'Replacement progress',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '3');
    expect(progressLabel()).toBe('1 of 3 records processed');
    expect(
      screen.getByText('Keep this page open until it finishes'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(findInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'All models' })).toBeDisabled();
    expect(primaryButton()).toHaveTextContent('Replace 6 matches, in progress');
    expect(primaryButton()).toBeDisabled();
    expect(primaryReason()).toBe(
      'You cannot replace right now as a replacement is in progress',
    );
    expect(screen.getByText('Replaced')).toBeInTheDocument();
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled();
    }
  });

  it('S15 stopping: "Stopping…" is disabled but keeps the focus', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S14');
    const stop = screen.getByRole('button', { name: 'Stop' });
    act(() => stop.focus());
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        run: { ...current.run, phase: 'stopping' },
      })),
    );
    const stopping = screen.getByRole('button', { name: 'Stopping…' });
    expect(stopping).toBe(stop);
    expect(stopping).toHaveAttribute('aria-disabled', 'true');
    // Not the disabled attribute: that would drop the focus to <body>.
    expect(stopping).toBeEnabled();
    expect(stopping).toHaveFocus();
    await user.click(stopping);
    expect(controller?.callsTo('stopReplace')).toHaveLength(0);
  });

  it('the progress row is one thin row with a compact Stop', () => {
    renderState('S14');
    expect(screen.getByRole('button', { name: 'Stop' }).className).toMatch(
      /buttonSize-xxs/,
    );
    expect(cssRule(recipesCss, '.fr-toolbar.fr-toolbar--progress > *')).toMatch(
      /padding-block:\s*4px/,
    );
  });

  it('S16 done: "Search again" and "Publish 2 records" in the slot, a report without checkboxes', () => {
    renderState('S16');
    expect(primaryButton()).toHaveTextContent('Publish 2 records');
    const searchAgain = screen.getByRole('button', { name: 'Search again' });
    expect(searchAgain).toBeEnabled();
    expect(searchAgain).toHaveClass('dl-kit-button--muted');
    // One solid primary, after the soft one.
    expect(document.querySelectorAll('.dl-kit-button--primary')).toHaveLength(
      1,
    );
    expect(toolbarMeta()).toBe('6 matches replaced');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getAllByText('Replaced')).toHaveLength(3);
    expect(document.querySelector('.fr-results')).not.toHaveClass(
      'fr-results--selecting',
    );
  });

  it('S17 failed: the danger callout, inline reasons and "Try again"', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S17');
    expect(toolbarMeta()).toBe('119 matches replaced, 2 records failed');
    expect(document.querySelector('.dl-callout--danger')).toHaveTextContent(
      "Couldn't update 2 records. The reason is under each one.",
    );
    expect(
      screen.getByText('The new value is too long or too short for "Title".'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't save this record. Try again."),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.fr-record--attention')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(controller?.callsTo('retryFailedRecords')).toHaveLength(1);
  });

  it('S18 skipped: the warning callout without an action', () => {
    renderState('S18');
    expect(toolbarMeta()).toBe('115 matches replaced, 3 records skipped');
    expect(document.querySelector('.dl-callout--warning')).toHaveTextContent(
      '3 records changed after the search and were skipped. Search again to include them.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(
      screen.getByText('Changed after the search. Search again to include it.'),
    ).toBeInTheDocument();
  });

  it('S19 stopped: the primary offers the rest', () => {
    renderState('S19');
    expect(toolbarMeta()).toBe('48 of 121 matches replaced');
    expect(primaryButton()).toHaveTextContent('Replace 73 matches');
    expect(primaryButton()).toBeEnabled();
    expect(document.querySelectorAll('.fr-record__check--empty')).toHaveLength(
      1,
    );
  });

  it('S20 every match replaced', () => {
    renderState('S20');
    expect(document.querySelector('.dl-list-empty__title')).toHaveTextContent(
      'Every match has been replaced',
    );
    expect(
      screen.getByText('Type something else to find.'),
    ).toBeInTheDocument();
    expect(toolbarMeta()).toBe('No matches');
  });

  it('S20 after a "Replace with nothing" run says "removed"', () => {
    const { controller } = renderState('S20');
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        noResults: current.noResults && {
          ...current.noResults,
          runVerb: 'remove',
        },
      })),
    );
    expect(document.querySelector('.dl-list-empty__title')).toHaveTextContent(
      'Every match has been removed',
    );
  });

  it('S20 never claims every match is gone while the model filter hides some', () => {
    const { controller } = renderState('S20');
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        noResults: current.noResults && {
          ...current.noResults,
          filteredModelName: 'Page',
          otherModelsHaveMatches: true,
        },
      })),
    );
    const title = document.querySelector('.dl-list-empty__title');
    expect(title).toHaveTextContent(/^No matches for ".*" in "Page"$/);
    expect(
      screen.getByText('Choose All models to see the others.'),
    ).toBeInTheDocument();
  });

  it('S9 keeps the searched pattern in its title while the next search is pending', () => {
    const { controller } = renderState('S9');
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        find: { ...current.find, pattern: 'Acme Co' },
        search: { ...current.search, phase: 'pending' },
      })),
    );
    expect(document.querySelector('.dl-list-empty__title')).toHaveTextContent(
      'No matches for "Acme Corp"',
    );
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        search: { ...current.search, phase: 'settled', resultsId: 2 },
      })),
    );
    expect(document.querySelector('.dl-list-empty__title')).toHaveTextContent(
      'No matches for "Acme Co"',
    );
  });

  it('S21 search failed: a pane state with "Try again", the find row stays usable', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S21');
    expect(screen.getByText("Couldn't search the records")).toBeInTheDocument();
    expect(
      screen.getByText("The Content Management API didn't respond."),
    ).toBeInTheDocument();
    expect(findInput()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(controller?.callsTo('retrySearch')).toHaveLength(1);
  });

  it('S22 unavailable: no find row, no button', () => {
    renderState('S22');
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your account does not have enough privileges to access this area',
      ),
    ).toBeInTheDocument();
    expect(findInput()).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('S23 boot error: "Try again" re-runs the boot', async () => {
    const user = userEvent.setup();
    const { retry } = renderState('S23');
    expect(screen.getByText("Couldn't load your content")).toBeInTheDocument();
    expect(findInput()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('builds a fixture for every state', () => {
    for (const id of [
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
      'S9',
      'S10a',
      'S10b',
      'S11',
      'S11b',
      'S11c',
      'S12',
      'S12b',
      'S13',
      'S14',
      'S15',
      'S16',
      'S17',
      'S18',
      'S19',
      'S20',
      'S21',
      'S22',
      'S23',
    ] as const) {
      const fixture = stateFixture(id);
      expect(fixture.boot !== null || fixture.snapshot !== null).toBe(true);
    }
  });
});

describe('toolbars', () => {
  it('grow with their content: no fixed height, never squeezed by the pane', () => {
    renderState('S14');
    const toolbars = Array.from(
      document.querySelectorAll<HTMLElement>('.fr-toolbar'),
    );
    expect(toolbars).toHaveLength(3);
    expect(
      document.querySelector('.fr-bar')?.closest('.fr-toolbar'),
    ).toHaveClass('fr-toolbar--find');
    expect(
      document.querySelector('.fr-progress')?.closest('.fr-toolbar'),
    ).toHaveClass('fr-toolbar--progress');
    for (const toolbar of toolbars) {
      expect(toolbar.style.height).toBe('');
      expect(toolbar.style.minHeight).toBe('');
      expect(toolbar.style.maxHeight).toBe('');
    }

    // The kit Toolbar is a shrinkable item of the pane's column: flex: none keeps
    // a wrapped find row as tall as its two rows (it spilled over at 580px).
    const base = cssRule(recipesCss, '.fr-toolbar');
    expect(base).toMatch(/(?:^|;)\s*flex:\s*none/);
    expect(base).toMatch(/min-height:\s*60px/);
    const findStack = cssRule(recipesCss, '.fr-toolbar.fr-toolbar--find > *');
    expect(findStack).toMatch(/padding-block:\s*10px/);
    for (const rule of [
      base,
      findStack,
      cssRule(recipesCss, '.fr-toolbar.fr-toolbar--progress'),
    ]) {
      expect(rule).not.toBe('');
      expect(rule).not.toMatch(/(?:^|[;\s])(?:max-)?height:/);
    }
  });
});

describe('styles', () => {
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');

  it('draws a visible keyboard focus inside the input groups and on checkboxes', () => {
    for (const selector of [
      '.dl-input-group__addon--button:focus-visible',
      '.fr-find__clear:focus-visible',
      '.dl-checkbox:focus-visible',
    ]) {
      const rule = cssRule(recipesCss, selector);
      // The focus border as well as the pale halo (the halo alone vanished on muted fills).
      expect({ selector, rule }).toEqual({
        selector,
        rule: expect.stringMatching(
          /--color--focus--border[\s\S]*--color--focus--outline/,
        ),
      });
    }
    expect(
      cssRule(recipesCss, '.dl-input-group__addon--button:focus-visible'),
    ).toMatch(/opacity:\s*1/);
    // A focused kit button isn't faded like a hovered one.
    expect(
      cssRule(
        kitFixesCss,
        '.dl-kit-button.dl-kit-button:focus:not(:hover):not(:active)',
      ),
    ).toMatch(/opacity:\s*1/);
  });

  it('frames diffs with padding, never an outline that covers the text around them', () => {
    const diffRules = code(recipesCss).match(
      /[^{}]*\.fr-(?:del|ins)\b[^{]*\{[^}]*\}/g,
    );
    expect(diffRules?.length).toBeGreaterThan(0);
    for (const rule of diffRules ?? []) {
      expect(rule).not.toMatch(/outline|box-shadow/);
    }
    expect(cssRule(recipesCss, '.fr-del,\n.fr-ins')).toMatch(
      /padding:\s*0 2px/,
    );
  });

  it('keeps the find row on one line only where both inputs stay readable', () => {
    expect(code(recipesCss)).toMatch(
      /@media \(max-width: 959px\) \{\s*\.fr-bar \{[^}]*flex-wrap: wrap/,
    );
    // The filter is exactly as tall as the input groups: the row never grows when it appears.
    expect(cssRule(recipesCss, '.fr-bar__filter .dl-kit-button')).toMatch(
      /height:\s*40px/,
    );
  });
});

describe('find row', () => {
  it('sends every keystroke untrimmed, Enter searches, Esc stops or clears', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S2');
    await user.type(screen.getByRole('textbox', { name: 'Find' }), ' Ac');
    expect(controller?.callsTo('setPattern')).toEqual([[' '], [' A'], [' Ac']]);
    await user.keyboard('{Enter}');
    expect(controller?.callsTo('searchNow')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(controller?.callsTo('stopOrClear')).toHaveLength(1);
  });

  it('✕ clears the search and gives the focus back to Find', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S7');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(controller?.callsTo('clearPattern')).toHaveLength(1);
    expect(findInput()).toHaveFocus();
  });

  it('toggles expose aria-pressed and a name, and call setOption', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S8');
    const wholeWord = screen.getByRole('button', { name: 'Match whole word' });
    expect(wholeWord).toHaveAttribute('aria-pressed', 'true');
    await user.click(wholeWord);
    await user.click(screen.getByRole('button', { name: 'Match case' }));
    await user.click(
      screen.getByRole('button', { name: 'Use regular expression' }),
    );
    expect(controller?.callsTo('setOption')).toEqual([
      ['wholeWord', false],
      ['caseSensitive', true],
      ['regex', true],
    ]);
  });

  it('the Replace field: typing, the eraser, Esc clears, Enter never writes', async () => {
    const user = userEvent.setup();
    const { controller, mock } = renderState('S7');
    const replaceInput = screen.getByRole('textbox', { name: 'Replace with' });
    await user.type(replaceInput, 'Gl');
    expect(controller?.callsTo('setReplacementText')).toEqual([['G'], ['Gl']]);
    await user.keyboard('{Enter}');
    expect(controller?.callsTo('searchNow')).toHaveLength(0);
    expect(controller?.callsTo('replace')).toHaveLength(0);
    expect(mock.openConfirm).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(controller?.callsTo('clearReplacement')).toHaveLength(1);
    await user.click(
      screen.getByRole('button', { name: 'Replace with nothing' }),
    );
    expect(controller?.callsTo('setRemove')).toEqual([[true]]);
  });

  it('shows the regex placeholders', () => {
    renderState('S4');
    expect(
      screen.getByRole('textbox', { name: 'Replace with' }),
    ).toHaveAttribute('placeholder', 'Replace with… ($1 inserts a group)');
  });

  it('Mod+Enter opens the confirm only when the primary is enabled', async () => {
    const user = userEvent.setup();
    const disabled = renderState('S7');
    await user.type(
      screen.getByRole('textbox', { name: 'Find' }),
      '{Control>}{Enter}{/Control}',
    );
    expect(disabled.mock.openConfirm).not.toHaveBeenCalled();
    expect(disabled.controller?.callsTo('searchNow')).toHaveLength(0);
    cleanup();

    const enabled = renderState('S11');
    await user.type(
      screen.getByRole('textbox', { name: 'Replace with' }),
      '{Meta>}{Enter}{/Meta}',
    );
    expect(enabled.mock.openConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('confirm, focus and scrolling', () => {
  it('confirming calls replace(token); cancelling focuses the primary', async () => {
    const user = userEvent.setup();
    const accepted = renderState('S12');
    accepted.mock.openConfirm.mockResolvedValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Replace 6 matches' }));
    await waitFor(() =>
      expect(accepted.controller?.callsTo('replace')).toEqual([['plan-s12']]),
    );
    cleanup();

    const cancelled = renderState('S12');
    cancelled.mock.openConfirm.mockResolvedValueOnce(false);
    findInput()?.focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(primaryButton()).toHaveFocus());
    expect(cancelled.controller?.callsTo('replace')).toHaveLength(0);
  });

  it('moves the focus to Stop when a pass starts, then to "Search again" when it finishes', () => {
    const { controller } = renderState('S13');
    const running = stateFixture('S14').snapshot;
    const finished = stateFixture('S16').snapshot;
    if (!controller || !running || !finished?.run.totals) {
      throw new Error('fixtures');
    }
    const pass = finished.run.totals;
    act(() => {
      controller.emit({ type: 'runStarted' });
      controller.setSnapshot(running);
    });
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
    act(() => {
      controller.setSnapshot(finished);
      controller.emit(runEndedEvent({ pass }));
    });
    expect(screen.getByRole('button', { name: 'Search again' })).toHaveFocus();
  });

  it('waits for the stopped snapshot before focusing the primary', () => {
    const { controller } = renderState('S14');
    const stopped = stateFixture('S19').snapshot;
    if (!controller || !stopped?.run.totals) {
      throw new Error('fixtures');
    }
    const pass = stopped.run.totals;
    act(() => controller.emit(runEndedEvent({ stopped: true, pass })));
    expect(primaryButton()).not.toHaveFocus();
    act(() => controller.setSnapshot(stopped));
    expect(primaryButton()).toHaveTextContent('Replace 73 matches');
    expect(primaryButton()).toHaveFocus();
  });

  it('"Search again" in the slot searches and focuses Find', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S16');
    await user.click(screen.getByRole('button', { name: 'Search again' }));
    expect(controller?.callsTo('searchAgain')).toHaveLength(1);
    expect(findInput()).toHaveFocus();
  });

  it('a new result set scrolls the body to the top', () => {
    const { controller } = renderSnapshot(resultsSnapshot());
    const body = document.querySelector('.dl-pane__body');
    if (!(body instanceof HTMLElement)) {
      throw new Error('no body');
    }
    body.scrollTop = 120;
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        search: { ...current.search, resultsId: current.search.resultsId + 1 },
      })),
    );
    expect(body.scrollTop).toBe(0);
  });

  it('keeps the focus on the primary when it turns from disabled to enabled', () => {
    const { controller } = renderSnapshot({
      ...resultsSnapshot(),
      primary: disabledPrimary('search_running', { count: 36 }),
    });
    const anchor = document.querySelector<HTMLElement>('.dl-tooltip-anchor');
    act(() => anchor?.focus());
    expect(anchor).toHaveFocus();
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        primary: { kind: 'replace', verb: 'replace', count: 36, enabled: true },
      })),
    );
    expect(primaryButton()).toHaveTextContent('Replace 36 matches');
    expect(primaryButton()).toHaveFocus();
    // And back: the disabled primary's anchor takes it.
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        primary: disabledPrimary('search_running', { count: 36 }),
      })),
    );
    expect(document.querySelector('.dl-tooltip-anchor')).toHaveFocus();
  });

  it('when the focused control unmounts, the focus goes back to Find', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S10a');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    act(() =>
      controller?.setSnapshot((current) => ({ ...current, callouts: [] })),
    );
    expect(findInput()).toHaveFocus();
  });
});

describe('live region', () => {
  function liveText(): string {
    return document.querySelector('[aria-live="polite"]')?.textContent ?? '';
  }

  it('announces settled searches, invalid patterns and ended passes only', () => {
    const { controller } = renderState('S7');
    if (!controller) {
      throw new Error('fixtures');
    }
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        meta: { kind: 'found', matches: 12, records: 5, capped: false },
      })),
    );
    expect(liveText()).toBe('');

    act(() =>
      controller.emit({
        type: 'searchSettled',
        matches: 9,
        records: 4,
        capped: false,
        stopped: false,
      }),
    );
    expect(liveText()).toBe('9 matches in 4 records');

    act(() =>
      controller.emit({
        type: 'searchSettled',
        matches: 24,
        records: 9,
        capped: false,
        stopped: true,
      }),
    );
    expect(liveText()).toBe('Search stopped. 24 matches in 9 records');

    act(() =>
      controller.emit({
        type: 'patternInvalid',
        problem: { code: 'zero_width' },
      }),
    );
    expect(liveText()).toBe('Pattern must match at least one character');

    act(() =>
      controller.emit({
        type: 'searchSettled',
        matches: 0,
        records: 0,
        capped: false,
        stopped: false,
      }),
    );
    expect(liveText()).toBe('No matches');
  });

  it('announces the meta of a pass that ended', () => {
    const { controller } = renderState('S17');
    const totals = stateFixture('S17').snapshot?.run.totals;
    if (!controller || !totals) {
      throw new Error('fixtures');
    }
    act(() =>
      controller.emit({
        type: 'runEnded',
        stopped: false,
        verb: 'replace',
        pass: totals,
        allFailedCause: null,
      }),
    );
    expect(liveText()).toBe('119 matches replaced, 2 records failed');
  });
});

describe('toasts', () => {
  it('fires exactly one toast per ended pass, also in StrictMode', async () => {
    const { controller, mock } = renderState('S16', { strict: true });
    const totals = stateFixture('S16').snapshot?.run.totals;
    if (!controller || !totals) {
      throw new Error('fixtures');
    }
    expect(controller.listenerCounts().events).toBe(1);
    act(() =>
      controller.emit({
        type: 'runEnded',
        stopped: false,
        verb: 'replace',
        pass: totals,
        allFailedCause: null,
      }),
    );
    expect(mock.notice).toHaveBeenCalledTimes(1);
    expect(mock.notice).toHaveBeenCalledWith(
      '6 matches successfully replaced!',
    );
    expect(mock.customToast).not.toHaveBeenCalled();
  });

  it('runs the CTA the user clicked when the run session is still open', async () => {
    const { controller, mock } = renderState('S18');
    const totals = stateFixture('S18').snapshot?.run.totals;
    if (!controller || !totals) {
      throw new Error('fixtures');
    }
    mock.customToast.mockResolvedValueOnce('searchAgain');
    act(() =>
      controller.emit({
        type: 'runEnded',
        stopped: false,
        verb: 'replace',
        pass: totals,
        allFailedCause: null,
      }),
    );
    await waitFor(() =>
      expect(controller.callsTo('searchAgain')).toHaveLength(1),
    );
    expect(mock.customToast).toHaveBeenCalledWith({
      type: 'warning',
      message:
        '115 matches replaced, 3 records skipped as they changed after the search.',
      cta: { label: 'Search again', value: 'searchAgain' },
      dismissOnPageChange: true,
    });
  });

  it('ignores a CTA once a new search has ended the run session', async () => {
    const { controller, mock } = renderState('S17');
    const totals = stateFixture('S17').snapshot?.run.totals;
    if (!controller || !totals) {
      throw new Error('fixtures');
    }
    let clickRetry: (value: unknown) => void = () => {};
    mock.customToast.mockReturnValueOnce(
      new Promise((resolve) => {
        clickRetry = resolve;
      }),
    );
    act(() =>
      controller.emit({
        type: 'runEnded',
        stopped: false,
        verb: 'replace',
        pass: totals,
        allFailedCause: null,
      }),
    );
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        run: { ...current.run, phase: 'none' },
      })),
    );
    await act(async () => clickRetry('retry'));
    expect(controller.callsTo('retryFailedRecords')).toHaveLength(0);
  });
});

describe('lines above the card', () => {
  it('a capped search whose replacement matches itself still warns: a later search can find the matches again', () => {
    const capped = stateFixture('S8').snapshot;
    if (!capped) {
      throw new Error('fixtures');
    }
    renderSnapshot({
      ...capped,
      replace: { text: 'THE', remove: false },
      note: { kind: 'capped', selfMatch: true, continued: false },
      replacementCheck: { problem: null, warnings: [{ code: 'self_match' }] },
    });
    expect(document.querySelector('.fr-note')).toHaveTextContent(
      'Showing the first 10,000 matches. Replace them, then search again for the rest.',
    );
    expect(document.querySelector('.fr-form-warning')).toHaveTextContent(
      'Your replacement also matches this search, so a later search can find these matches again',
    );
  });
});

describe('model filter', () => {
  function trigger(): HTMLElement {
    return screen.getByRole('button', { name: 'All models' });
  }

  function option(name: RegExp): HTMLElement {
    return within(document.body).getByRole('button', { name });
  }

  it('works from the keyboard: opens on the chosen option, arrows move, Enter picks', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S12b');
    act(() => trigger().focus());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(option(/^All models.+/)).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(option(/^Article/)).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(option(/^Page/)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(option(/^Author/)).toHaveFocus();
    await user.keyboard('{End}');
    expect(option(/^Page/)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(option(/^All models.+/)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(option(/^Page/)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(controller?.callsTo('setModelFilter')).toEqual([['page']]);
    // The menu closed and the focus went back to the trigger, not to <body>.
    expect(document.querySelector('.fr-option')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('Esc closes the menu and returns to the trigger; Tab closes it and moves on', async () => {
    const user = userEvent.setup();
    renderState('S12b');
    act(() => trigger().focus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(option(/^All models.+/)).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(document.querySelector('.fr-option')).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(option(/^All models.+/)).toHaveFocus());
    // Tab from an option: the menu closes and the focus is back on the trigger before the
    // browser's own Tab runs, so it moves on to the control after the trigger (the menu itself
    // sits at the end of <body>).
    act(() => {
      fireEvent.keyDown(option(/^All models.+/), { key: 'Tab' });
    });
    expect(document.querySelector('.fr-option')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('above 5 options, opens in the search input and moves on to the options', async () => {
    const user = userEvent.setup();
    const names = ['Article', 'Author', 'Event', 'FAQ', 'Page', 'Product'];
    const { controller } = renderSnapshot({
      ...resultsSnapshot(),
      modelFilter: {
        ...resultsSnapshot().modelFilter,
        options: names.map((name) => ({
          id: name.toLowerCase(),
          name,
          matchCount: 1,
        })),
        allMatchCount: 6,
      },
    });
    act(() => trigger().focus());
    await user.keyboard('{Enter}');
    const search = await waitFor(() => {
      const input = within(document.body).getByPlaceholderText('Search...');
      expect(input).toHaveFocus();
      return input;
    });
    await user.keyboard('{ArrowDown}');
    expect(option(/^All models.+/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(option(/^Article/)).toHaveFocus();
    // Typing on an option goes to the search input.
    await user.keyboard('p');
    expect(search).toHaveFocus();
    // Enter in the search picks the first option it shows.
    await user.keyboard('{Enter}');
    expect(controller.callsTo('setModelFilter')).toEqual([[null]]);
    expect(trigger()).toHaveFocus();

    // Space on an option picks it (it isn't typed into the search).
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        within(document.body).getByPlaceholderText('Search...'),
      ).toHaveFocus(),
    );
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(option(/^Author/)).toHaveFocus();
    await user.keyboard(' ');
    expect(controller.callsTo('setModelFilter')).toEqual([[null], ['author']]);
    expect(trigger()).toHaveFocus();
  });

  it('closes when a run disables it', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S12b');
    await user.click(trigger());
    expect(document.querySelector('.fr-option')).not.toBeNull();
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        modelFilter: { ...current.modelFilter, enabled: false },
      })),
    );
    expect(document.querySelector('.fr-option')).toBeNull();
    expect(trigger()).toBeDisabled();
  });

  it('is hidden until the snapshot says so and shows the selected model', () => {
    const { controller } = renderSnapshot(resultsSnapshot());
    expect(
      screen.getByRole('button', { name: 'All models' }),
    ).toBeInTheDocument();
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        modelFilter: {
          ...current.modelFilter,
          selected: { id: 'article', name: 'Article' },
        },
      })),
    );
    expect(screen.getByRole('button', { name: 'Article' })).toBeInTheDocument();
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        modelFilter: { ...current.modelFilter, visible: false },
      })),
    );
    expect(screen.queryByRole('button', { name: 'Article' })).toBeNull();
  });

  it('shows partial counts with a "+"', async () => {
    const user = userEvent.setup();
    renderState('S8');
    await user.click(screen.getByRole('button', { name: 'All models' }));
    const menu = document.querySelector('.fr-option')?.closest('div[style]');
    expect(menu).not.toBeNull();
    expect(
      within(document.body).getByRole('button', { name: /^Article/ }),
    ).toHaveTextContent('Article6,912+, 6,912 matches');
  });
});

describe('host updates', () => {
  it('re-renders on a new ctx object without remounting or re-subscribing', () => {
    const { boot, controller } = stateBoot('S7');
    const { rerender, mock } = renderBoot(boot);
    const input = findInput();
    const next = createMockCtx();
    // A theme switch: a new ctx object whose primitives are the same.
    rerender(<FindReplaceApp ctx={{ ...next.ctx }} boot={boot} />);
    expect(findInput()).toBe(input);
    expect(controller?.listenerCounts()).toEqual({ snapshot: 1, events: 1 });
    expect(mock.openConfirm).not.toHaveBeenCalled();
  });
});

describe('publish after a run', () => {
  it('confirms with the host (positive intent), then publishes with the offer token', async () => {
    const user = userEvent.setup();
    const { controller, mock } = renderState('S16');
    mock.openConfirm.mockResolvedValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Publish 2 records' }));
    expect(mock.openConfirm).toHaveBeenCalledWith({
      title: 'Publish 2 records?',
      content:
        "Only the replaced text goes live, as these records had no other unpublished changes. 1 other replaced record stays unpublished, as publishing it would also publish changes that aren't part of this replacement.",
      choices: [
        { label: 'Yes, publish 2 records', value: true, intent: 'positive' },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    await waitFor(() =>
      expect(controller?.callsTo('publish')).toEqual([['publish-token']]),
    );
  });

  it('cancelling publishes nothing', async () => {
    const user = userEvent.setup();
    const { controller, mock } = renderState('S16');
    mock.openConfirm.mockResolvedValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Publish 2 records' }));
    await waitFor(() => expect(mock.openConfirm).toHaveBeenCalledTimes(1));
    expect(controller?.callsTo('publish')).toHaveLength(0);
  });

  it('S24 publishing: busy primary, locked find row, progress with Stop', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S24');
    const primary = primaryButton();
    expect(primary).toBeDisabled();
    expect(primary).toHaveTextContent('Publish 2 records');
    expect(
      screen.queryByRole('button', { name: 'Search again' }),
    ).not.toBeInTheDocument();
    expect(findInput()).toBeDisabled();
    expect(progressLabel()).toBe('1 of 2 records published');
    expect(screen.getByText('Published')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(controller?.callsTo('stopPublish')).toHaveLength(1);
  });

  it('S25 published: the status, the meta, and why the others stayed unpublished', () => {
    renderState('S25');
    expect(toolbarMeta()).toBe('6 matches replaced, 1 record published');
    expect(primaryButton()).toBeNull();
    expect(screen.getAllByText('Published')).toHaveLength(1);
    expect(
      screen.getByText(
        'Not published, as it already had other unpublished changes.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Couldn\'t publish, as "Published on" can\'t be empty.'),
    ).toBeInTheDocument();
  });

  it('moves the focus to Stop when publishing starts and back to the slot when it ends', () => {
    const { controller, mock } = renderState('S16');
    const publishing = stateFixture('S24').snapshot;
    const published = stateFixture('S25').snapshot;
    if (!controller || !publishing || !published) {
      throw new Error('fixtures');
    }
    act(() => {
      controller.emit({ type: 'publishStarted' });
      controller.setSnapshot(publishing);
    });
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
    act(() => {
      controller.setSnapshot(published);
      controller.emit({
        type: 'publishEnded',
        stopped: false,
        pass: {
          published: 1,
          skipped: 0,
          failed: 1,
          retryableFailed: 0,
          notAttempted: 0,
          planned: 2,
        },
        allFailedCause: null,
      });
    });
    expect(screen.getByRole('button', { name: 'Search again' })).toHaveFocus();
    expect(mock.customToast).toHaveBeenCalledWith({
      type: 'alert',
      message: "One record published, 1 record couldn't be published.",
      dismissOnPageChange: true,
    });
  });

  it('a fully published pass is a success notice', () => {
    const { controller, mock } = renderState('S24');
    act(() =>
      controller?.emit({
        type: 'publishEnded',
        stopped: false,
        pass: {
          published: 2,
          skipped: 0,
          failed: 0,
          retryableFailed: 0,
          notAttempted: 0,
          planned: 2,
        },
        allFailedCause: null,
      }),
    );
    expect(mock.notice).toHaveBeenCalledWith(
      '2 records successfully published!',
    );
  });
});
