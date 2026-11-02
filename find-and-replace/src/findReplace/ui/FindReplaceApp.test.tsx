import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FindReplaceApp } from './FindReplaceApp';
import {
  disabledPrimary,
  resultsSnapshot,
  runEndedEvent,
  STATE_IDS,
  stateBoot,
  stateFixture,
} from './testing/fixtures';
import {
  createMockCtx,
  renderBoot,
  renderSnapshot,
  renderState,
} from './testing/renderPage';

// Moving through a kit menu scrolls the active option into view, which jsdom
// can't do.
const scrollIntoView = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// ── Queries ─────────────────────────────────────────────────────────────────

/** The toolbar of the page's title. */
function titleBar(): HTMLElement {
  const bar = screen.getByRole('heading', { level: 1 }).parentElement
    ?.parentElement;
  if (!bar) {
    throw new Error('no title bar');
  }
  return bar;
}

/** The text after the title ("9 matches in 4 records"), or null. */
function toolbarMeta(): string | null {
  const title = screen.getByRole('heading', { level: 1 }).parentElement;
  return title?.nextElementSibling?.textContent || null;
}

/** The labels of the title bar's text buttons, in order: the slot. */
function slotLabels(): string[] {
  return within(titleBar())
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((label) => label !== '');
}

/** The title bar's "⋮", or null when nothing applies. */
function titleDots(): HTMLElement | null {
  return within(titleBar()).queryByRole('button', { name: 'Actions' });
}

/** "Options", after Find: the menu of the find options (its label names those that are on). */
function optionsButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Options/ });
}

/** The checkbox options of the open menu, by their text, with their state. */
function checkboxOptions(): Array<[string, string | null]> {
  return within(openMenu())
    .getAllByRole('menuitemcheckbox', { hidden: true })
    .map((option) => [
      option.textContent ?? '',
      option.getAttribute('aria-checked'),
    ]);
}

function checkboxOption(name: string): HTMLElement {
  return within(openMenu()).getByRole('menuitemcheckbox', {
    name,
    hidden: true,
  });
}

/** The label of a checkbox option: what a click lands on. */
function checkboxLabel(name: string): HTMLElement {
  return within(checkboxOption(name)).getByText(name);
}

function input(name: 'Find' | 'Replace with'): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `input[aria-label="${name}"]`,
  );
}

function findInput(): HTMLInputElement | null {
  return input('Find');
}

function replaceInput(): HTMLInputElement | null {
  return input('Replace with');
}

function records(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-record]'));
}

/** The scrolling content of the page's Pane, after its header. */
function paneContent(): HTMLElement {
  const content = screen.getByRole('main').firstElementChild?.lastElementChild;
  if (!(content instanceof HTMLElement)) {
    throw new Error('no pane content');
  }
  return content;
}

/** The open menu (menus render at the end of the body). */
function openMenu(): HTMLElement {
  return screen.getByRole('menu', { hidden: true });
}

/** The options of the open menu, by their text. */
function menuOptions(): string[] {
  return within(openMenu())
    .getAllByRole('menuitem', { hidden: true })
    .map((option) => option.textContent ?? '');
}

function menuOption(text: RegExp): HTMLElement {
  const option = within(openMenu())
    .getAllByRole('menuitem', { hidden: true })
    .find((candidate) => text.test(candidate.textContent ?? ''));
  if (!option) {
    throw new Error(`no option ${text}`);
  }
  return option;
}

async function menuClosed() {
  await waitFor(() =>
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull(),
  );
}

/**
 * A control disabled with a reason: it keeps the focus (aria-disabled), and
 * the reason opens on focus and describes it to screen readers.
 */
async function expectReason(control: HTMLElement, reason: string) {
  expect(control).toHaveAttribute('aria-disabled', 'true');
  expect(control).not.toHaveAttribute('disabled');
  act(() => control.focus());
  await waitFor(() => expect(control).toHaveAccessibleDescription(reason));
}

/**
 * Renders `run` in a frame `width` pixels wide: every `(max-width: …)` media
 * query (the kit's phone and small viewport, the page's own) answers for it.
 */
function atFrameWidth(width: number, run: () => void) {
  const original = window.matchMedia;
  window.matchMedia = (media: string) => {
    const max = /\(max-width:\s*([\d.]+)px\)/.exec(media);
    return {
      ...original(media),
      matches: max !== null && width <= Number(max[1]),
    };
  };
  try {
    run();
  } finally {
    window.matchMedia = original;
  }
}

/** Cmd/Ctrl + Enter: jsdom is not a Mac, so "mod" is Ctrl. The kit's actions read `code`. */
function pressModEnter(element: Element) {
  fireEvent.keyDown(element, {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    ctrlKey: true,
  });
}

// ── States ──────────────────────────────────────────────────────────────────

describe('every state renders', () => {
  it('S1 booting: the title, a disabled find form and a loading area', () => {
    renderState('S1');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Find and replace' }),
    ).toBeInTheDocument();
    // The title's "?" only: no slot, no "⋮", no meta.
    expect(slotLabels()).toEqual([]);
    expect(titleDots()).toBeNull();
    expect(toolbarMeta()).toBeNull();
    expect(findInput()).toBeDisabled();
    expect(replaceInput()).toBeDisabled();
    expect(optionsButton()).toBeDisabled();
    expect(screen.getByText('Loading the models')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Replace with nothing' }),
    ).toBeNull();
  });

  it('S2 idle: Find focused, the idle state, the primary waits with its reason', async () => {
    renderState('S2');
    expect(findInput()).toHaveFocus();
    // A placeholder names the field, it never instructs.
    expect(findInput()).toHaveAttribute('placeholder', 'Find');
    expect(screen.getByText('No search yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Replace with nothing' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'All models' })).toBeNull();
    expect(slotLabels()).toEqual(['Replace']);
    await expectReason(
      screen.getByRole('button', { name: 'Replace' }),
      'Find some matches to replace first.',
    );
  });

  it('S3 typing: ✕ appears, the primary waits for the search', async () => {
    renderState('S3');
    expect(findInput()).toHaveValue('Acm');
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeEnabled();
    expect(screen.getByText('No search yet')).toBeInTheDocument();
    await expectReason(
      screen.getByRole('button', { name: 'Replace' }),
      'Wait for the search to finish.',
    );
  });

  it('S4 invalid pattern: the problem and its way out, nothing else', async () => {
    renderState('S4');
    // The danger callout says it: the box of the field draws no error ring
    // of its own around the input inside it.
    expect(findInput()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Fix the regular expression (unterminated group), or turn off Use regular expression in Options.',
    );
    // The problem is the description of the field: a screen reader that
    // comes back to Find hears what is wrong.
    expect(findInput()).toHaveAccessibleDescription(
      /^\s*Fix the regular expression \(unterminated group\), or turn off Use regular expression in Options\.\s*$/,
    );
    expect(records()).toHaveLength(0);
    await expectReason(
      screen.getByRole('button', { name: 'Replace' }),
      'Fix the text in Find first.',
    );
  });

  it('S5 searching: a spinner while the total is unknown, one indicator', () => {
    renderState('S5');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('300 records searched')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    // The progress row shows the search: the content stays empty.
    expect(paneContent()).toHaveTextContent('');
    expect(toolbarMeta()).toBeNull();
  });

  it('S6 streaming: a determinate bar, the live meta, Replace with nothing', async () => {
    const user = userEvent.setup();
    renderState('S6');
    // The bar is named by the text next to it.
    const progress = screen.getByRole('progressbar', {
      name: '1,200 of 3,400 records searched',
    });
    // 1,200 of 3,400, as a share of 100.
    expect(progress).toHaveAttribute('aria-valuenow', '35');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(
      screen.getByText('1,200 of 3,400 records searched'),
    ).toBeInTheDocument();
    expect(toolbarMeta()).toBe('4 matches in 2 records');
    expect(records()).toHaveLength(2);
    await user.click(optionsButton());
    expect(checkboxOptions()).toEqual([
      ['Match case', 'false'],
      ['Match whole word', 'false'],
      ['Use regular expression', 'false'],
      ['Replace with nothing', 'false'],
    ]);
  });

  it('S26 large project: the Enter key cap, described to screen readers, and why Replace waits', async () => {
    renderState('S26');
    const find = findInput();
    expect(find).toHaveValue('Acme Corp');
    expect(find).toHaveAttribute('placeholder', 'Find');
    // The magnifier before it adds nothing to the description.
    expect(find).toHaveAccessibleDescription(/^\s*Press Enter to search\.$/);
    expect(find?.parentElement?.querySelector('kbd')).toHaveTextContent('↵');
    // The results of the last search stay on screen.
    expect(records()).toHaveLength(4);
    await expectReason(
      screen.getByRole('button', { name: 'Replace' }),
      'Press Enter to search first.',
    );
  });

  it('S27 large project: records read and the time left', () => {
    renderState('S27');
    expect(
      screen.getByText('48,000 of 184,000 records searched'),
    ).toBeInTheDocument();
    expect(screen.getByText('About 3 minutes left')).toBeInTheDocument();
    expect(findInput()).not.toHaveAccessibleDescription();
    expect(document.querySelector('kbd')).toBeNull();
  });

  it('S28 capped again after reading on: "the next 10,000"', () => {
    renderState('S28');
    expect(
      screen.getByText(
        'Showing the next 10,000 matches. Replace them, then search again for the rest.',
      ),
    ).toBeInTheDocument();
  });

  it('S7 results: a read-only list, the model filter, no checkboxes', async () => {
    renderState('S7');
    expect(toolbarMeta()).toBe('9 matches in 4 records');
    expect(records()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'All models' })).toBeEnabled();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('Changes the URL')).toBeNull();
    await expectReason(
      screen.getByRole('button', { name: 'Replace' }),
      'Type a replacement first, or pick Replace with nothing in Options.',
    );
  });

  it('S8 capped: the note, 50 records and "Load more records"', () => {
    renderState('S8');
    expect(toolbarMeta()).toBe('10,000+ matches in 2,310 records');
    expect(
      screen.getByText(
        'Showing the first 10,000 matches. Replace them, then search again for the rest.',
      ),
    ).toBeInTheDocument();
    expect(records()).toHaveLength(50);
    expect(screen.getByText('Load more records')).toBeInTheDocument();
    expect(screen.getAllByText('Show 20 more matches').length).toBeGreaterThan(
      0,
    );
  });

  it('S9 no results: the searched pattern and what narrows it', () => {
    renderState('S9');
    // The title of the blank slate says it on its own.
    expect(toolbarMeta()).toBeNull();
    expect(optionsButton()).toHaveTextContent('Options: Match case');
    expect(screen.getByText('No matches for “Acme Corp”')).toBeInTheDocument();
    expect(
      screen.getByText('To find more, turn off Match case in Options.'),
    ).toBeInTheDocument();
    expect(records()).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: 'Replace with nothing' }),
    ).toBeNull();
  });

  it('S10a models failed: a text-only warning, the retry in the title bar', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S10a');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't search the “Author” and “Legal page” models.",
    );
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(titleDots()).toBeNull();

    // The next step is a labelled button, before the primary.
    expect(slotLabels()).toEqual(['Search the failed models again', 'Replace']);
    await user.click(
      screen.getByRole('button', { name: 'Search the failed models again' }),
    );
    expect(controller?.callsTo('retryFailedModels')).toHaveLength(1);
  });

  it('S10a with one model names it on the button', () => {
    const { controller } = renderState('S10a');
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        callouts: [
          { kind: 'modelsFailed', modelNames: ['Author'], retryable: true },
        ],
      })),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't search the “Author” model.",
    );
    expect(slotLabels()).toEqual(['Search “Author” again', 'Replace']);
  });

  it('S10b search stopped: a note with the way to search them all', () => {
    renderState('S10b');
    expect(screen.getByText('Some matches may be missing')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The search stopped after 1,200 of 3,400 records. Press Enter in Find to search them all.',
      ),
    ).toBeInTheDocument();
    expect(toolbarMeta()).toBe('24 matches in 9 records');
  });

  it('S11 plan: diffs, checkboxes, "Select all" and a counted primary', () => {
    renderState('S11');
    expect(toolbarMeta()).toBe('8 of 9 matches will change');
    expect(slotLabels()).toEqual(['Replace 8 matches']);
    expect(
      screen.getByRole('button', { name: 'Replace 8 matches' }),
    ).toBeEnabled();
    // Every record takes part (the slug is left out): "Select all" is checked.
    expect(
      screen.getByRole('checkbox', { name: 'Select all rows' }),
    ).toBeChecked();
    expect(screen.getByText('Changes the URL')).toBeInTheDocument();
    expect(document.querySelectorAll('del')).toHaveLength(8);
    expect(document.querySelectorAll('ins')).toHaveLength(8);
  });

  it('S11b remove: Replace with nothing is on and everything says "Remove"', async () => {
    const user = userEvent.setup();
    renderState('S11b');
    expect(slotLabels()).toEqual(['Remove 3 matches']);
    const replace = replaceInput();
    expect(replace).toBeDisabled();
    expect(replace).toHaveValue('');
    expect(replace).toHaveAttribute('placeholder', 'Matches will be removed');
    expect(optionsButton()).toHaveTextContent('Options: Replace with nothing');
    expect(document.querySelectorAll('ins')).toHaveLength(0);
    expect(document.querySelectorAll('del')).toHaveLength(3);
    await user.click(optionsButton());
    expect(
      checkboxOption('Replace with nothing').getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('S11c no change: the note and "No change" tags', () => {
    renderState('S11c');
    // Information, not a risk: a neutral callout, not an alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByText(
        '“Acme” still contains “acme”, so searching again will find these matches again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('No change')).toHaveLength(2);
    expect(toolbarMeta()).toBe('5 of 9 matches will change');
  });

  it('S12 excluding: an unchecked record and match, the count follows', () => {
    renderState('S12');
    expect(slotLabels()).toEqual(['Replace 6 matches']);
    expect(
      screen.getByRole('checkbox', { name: 'Legal notice' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Body, English' }),
    ).not.toBeChecked();
  });

  it('S12b model filter: counts per model, "Couldn\'t search" when it could not be searched', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S12b');
    await user.click(screen.getByRole('button', { name: 'All models' }));
    expect(menuOptions()).toEqual([
      'All models9 matches',
      'Article6 matches',
      "AuthorCouldn't search",
      'Page3 matches',
    ]);
    await user.click(menuOption(/^Page/));
    expect(controller?.callsTo('setModelFilter')).toEqual([['page']]);
  });

  it('S13 confirm: the primary opens the host confirm', async () => {
    const user = userEvent.setup();
    const { mock } = renderState('S13');
    await user.click(screen.getByRole('button', { name: 'Replace 6 matches' }));
    expect(mock.openConfirm).toHaveBeenCalledWith({
      title: 'Replace 6 matches?',
      content:
        "This replaces “Acme” with “Globex” in 3 records. Some of these records aren't saved as drafts, so they change on your website right away.",
      choices: [
        { label: 'Yes, replace 6 matches', value: true, intent: 'negative' },
      ],
      cancel: { label: 'Cancel', value: false },
    });
  });

  it('S14 replacing: record progress, a locked form, a busy primary, statuses', async () => {
    renderState('S14');
    const progress = screen.getByRole('progressbar', {
      name: '1 of 3 records updated',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText('1 of 3 records updated')).toBeInTheDocument();
    // The progress row says what is done: no plan count after the title.
    expect(toolbarMeta()).toBeNull();
    expect(
      screen.getByText('Keep this page open until it finishes'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();

    expect(findInput()).toBeDisabled();
    expect(replaceInput()).toBeDisabled();
    const lockedReason =
      "You can't change the search while records are being updated or published.";
    await expectReason(
      screen.getByRole('button', { name: 'Clear search' }),
      lockedReason,
    );
    await expectReason(
      screen.getByRole('button', { name: 'All models' }),
      lockedReason,
    );
    await expectReason(optionsButton(), lockedReason);

    // The busy primary keeps its counted label.
    const primary = screen.getByRole('button', { name: 'Replace 6 matches' });
    expect(primary).toHaveAttribute('aria-busy', 'true');
    expect(primary).toBeDisabled();

    expect(screen.getByText('Replaced')).toBeInTheDocument();
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled();
    }
  });

  it('S15 stopping: "Stopping…" keeps the focus, says why, and ignores clicks', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S14');
    act(() => screen.getByRole('button', { name: 'Stop' }).focus());
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        run: { ...current.run, phase: 'stopping' },
      })),
    );
    const stopping = screen.getByRole('button', { name: 'Stopping…' });
    expect(stopping).toHaveFocus();
    await expectReason(stopping, 'It stops after the record in progress.');
    await user.click(stopping);
    expect(controller?.callsTo('stopReplace')).toHaveLength(0);
  });

  it('S16 done: "Search again" and "Publish 2 records" in the slot, a report without checkboxes', () => {
    renderState('S16');
    expect(slotLabels()).toEqual(['Search again', 'Publish 2 records']);
    expect(screen.getByRole('button', { name: 'Search again' })).toBeEnabled();
    expect(toolbarMeta()).toBe('6 matches replaced');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getAllByText('Replaced')).toHaveLength(3);
  });

  it('S17 failed: the meta counts them, each row says why, the retry names what it saves again', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S17');
    expect(toolbarMeta()).toBe('119 matches replaced, 2 records failed');
    // No callout repeats it: the toast reported the run.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByText('The new value is too long or too short for “Title”.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't save this record, as DatoCMS didn't respond."),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Failed')).toHaveLength(2);

    expect(titleDots()).toBeNull();
    // Only the record that DatoCMS didn't answer can be saved again.
    expect(slotLabels()).toEqual(['Save 1 record again', 'Search again']);
    await user.click(
      screen.getByRole('button', { name: 'Save 1 record again' }),
    );
    expect(controller?.callsTo('retryFailedRecords')).toHaveLength(1);
  });

  it('both retries show as buttons, and none while a pass runs', () => {
    const failed = stateFixture('S17').snapshot;
    const modelsFailed = stateFixture('S10a').snapshot;
    if (!failed || !modelsFailed) {
      throw new Error('fixtures');
    }
    const { controller } = renderSnapshot({
      ...failed,
      callouts: [...failed.callouts, ...modelsFailed.callouts],
    });
    expect(slotLabels()).toEqual([
      'Save 1 record again',
      'Search the failed models again',
      'Search again',
    ]);
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        findRow: { ...current.findRow, enabled: false },
      })),
    );
    expect(slotLabels()).toEqual(['Search again']);
  });

  it('S18 skipped: the meta counts them, each row says why, no retry', () => {
    renderState('S18');
    expect(toolbarMeta()).toBe('115 matches replaced, 3 records skipped');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(titleDots()).toBeNull();
    expect(slotLabels()).toEqual(['Search again']);
    expect(
      screen.getAllByText('Someone edited it after the search.').length,
    ).toBeGreaterThan(0);
  });

  it('S19 stopped: the primary offers the rest, attempted records are locked', () => {
    renderState('S19');
    expect(toolbarMeta()).toBe('48 of 121 matches replaced');
    expect(
      screen.getByRole('button', { name: 'Replace 73 matches' }),
    ).toBeEnabled();
    const locked = records().filter((row) =>
      within(row).getByRole('checkbox').hasAttribute('disabled'),
    );
    expect(locked).toHaveLength(1);
  });

  it('S20 every match replaced', () => {
    renderState('S20');
    expect(
      screen.getByText('Every match has been replaced'),
    ).toBeInTheDocument();
    // The title alone, as a plain centered message: nothing on screen
    // changes the outcome.
    expect(document.querySelector('.blank-slate__description')).toBeNull();
    expect(document.querySelector('.blank-slate--centered')).not.toBeNull();
    expect(toolbarMeta()).toBeNull();
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
    expect(
      screen.getByText('Every match has been removed'),
    ).toBeInTheDocument();
  });

  it('S20 never claims every match is gone while the model filter hides some', async () => {
    const user = userEvent.setup();
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
    expect(
      screen.getByText(/^No matches for “.*” in “Page”$/),
    ).toBeInTheDocument();
    expect(screen.getByText('Other models have matches.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all models' }));
    expect(controller?.callsTo('setModelFilter')).toEqual([[null]]);
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
    expect(screen.getByText('No matches for “Acme Corp”')).toBeInTheDocument();
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        search: { ...current.search, phase: 'settled', resultsId: 2 },
      })),
    );
    expect(screen.getByText('No matches for “Acme Co”')).toBeInTheDocument();
  });

  it('S21 search failed: "Try again" in the content, the find form stays usable', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S21');
    expect(screen.getByText("Couldn't search the records")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DatoCMS didn't respond. Check your connection, then try again.",
      ),
    ).toBeInTheDocument();
    expect(findInput()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(controller?.callsTo('retrySearch')).toHaveLength(1);
  });

  it('S22 unavailable: the title and the state, no find form, no button', () => {
    renderState('S22');
    expect(
      screen.getByText("Your role can't use Find and replace"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ask a project admin to give your role access in the plugin settings.',
      ),
    ).toBeInTheDocument();
    expect(findInput()).toBeNull();
    // Only the title's "?".
    expect(
      screen.getAllByRole('button').map((button) => button.ariaLabel),
    ).toEqual(['About this page']);
  });

  it('S23 boot error: "Try again" boots again, never the raw error', async () => {
    const user = userEvent.setup();
    const { retry } = renderState('S23');
    expect(screen.getByText("Couldn't load your content")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DatoCMS didn't respond. Check your connection, then try again.",
      ),
    ).toBeInTheDocument();
    expect(findInput()).toBeNull();
    expect(titleDots()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('the title says what the page is for in its "?"', async () => {
    const user = userEvent.setup();
    renderState('S2');
    await user.click(screen.getByRole('button', { name: 'About this page' }));
    expect(
      await screen.findByText(
        'Finds text in the records of your models and replaces it. You review every match, and can leave any out, before anything changes.',
      ),
    ).toBeInTheDocument();
  });

  it('under 600px the meta and "Keep this page open" move above the results', () => {
    atFrameWidth(540, () => {
      renderState('S7');
      expect(toolbarMeta()).toBeNull();
      expect(screen.getByText('9 matches in 4 records')).toBeInTheDocument();
      cleanup();

      // A pass: the progress row has no room for the quiet line, the content says it.
      renderState('S14');
      expect(screen.getByText('1 of 3 records updated')).toBeInTheDocument();
      expect(
        screen.queryByText('Keep this page open until it finishes'),
      ).toBeNull();
      expect(
        screen.getByText('Keep this page open until it finishes.'),
      ).toBeInTheDocument();
      cleanup();

      // A search: only its time left drops.
      renderState('S27');
      expect(screen.queryByText('About 3 minutes left')).toBeNull();
      expect(
        screen.queryByText(/Keep this page open until it finishes/),
      ).toBeNull();
      cleanup();

      // Not a phone: both buttons of the slot keep their labels.
      renderState('S16');
      expect(slotLabels()).toEqual(['Search again', 'Publish 2 records']);
      cleanup();
    });

    // From 600px the meta follows the title, and the quiet line is in the row.
    atFrameWidth(600, () => {
      renderState('S7');
      expect(toolbarMeta()).toBe('9 matches in 4 records');
      cleanup();
      renderState('S14');
      expect(
        screen.getByText('Keep this page open until it finishes'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Keep this page open until it finishes.'),
      ).toBeNull();
    });
  });

  it('on a phone-width frame every button keeps a short label: "Publish", "Save again", "Try again"', () => {
    atFrameWidth(360, () => {
      renderState('S7');
      expect(toolbarMeta()).toBeNull();
      expect(screen.getByText('9 matches in 4 records')).toBeInTheDocument();
      cleanup();

      // The confirm gives the count.
      renderState('S16');
      expect(slotLabels()).toEqual(['Search again', 'Publish']);
      cleanup();

      renderState('S17');
      expect(slotLabels()).toEqual(['Save again', 'Search again']);
      cleanup();

      // The warning callout names the models.
      renderState('S10a');
      expect(slotLabels()).toEqual(['Try again', 'Replace']);
    });
  });

  it('builds a fixture for every state', () => {
    for (const id of STATE_IDS) {
      const fixture = stateFixture(id);
      expect(fixture.boot !== null || fixture.snapshot !== null).toBe(true);
    }
  });
});

// ── Styles ──────────────────────────────────────────────────────────────────

const pageStyles = import.meta.glob<string>('./*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('styles', () => {
  it('paint with tokens only: no raw color values in the CSS modules', () => {
    expect(Object.keys(pageStyles).length).toBeGreaterThan(0);
    for (const [file, source] of Object.entries(pageStyles)) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
      const hit =
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.exec(code)?.[0] ?? null;
      expect({ file, hit }).toEqual({ file, hit: null });
    }
  });
});

// ── Find form ───────────────────────────────────────────────────────────────

describe('find form', () => {
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

  it('ignores Enter and Esc while an input method composes', () => {
    const { controller } = renderState('S3');
    const find = findInput();
    if (!find) {
      throw new Error('no Find');
    }
    fireEvent.keyDown(find, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(find, { key: 'Escape', isComposing: true });
    expect(controller?.callsTo('searchNow')).toHaveLength(0);
    expect(controller?.callsTo('stopOrClear')).toHaveLength(0);
  });

  it('✕ clears the search and gives the focus back to Find', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S7');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(controller?.callsTo('clearPattern')).toHaveLength(1);
    expect(findInput()).toHaveFocus();
  });

  it('Options names every find option, with a checkbox, and stays open while they change', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S8');
    // The trigger names the option that is on.
    expect(optionsButton()).toHaveTextContent('Options: Match whole word');
    await user.click(optionsButton());
    expect(
      checkboxOption('Match whole word').getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(checkboxLabel('Match whole word'));
    await user.click(checkboxLabel('Match case'));
    await user.click(checkboxLabel('Use regular expression'));
    expect(openMenu()).toBeInTheDocument();
    expect(controller?.callsTo('setOption')).toEqual([
      ['wholeWord', false],
      ['caseSensitive', true],
      ['regex', true],
    ]);
  });

  it('with regular expressions on, Options says what $1 does', async () => {
    const user = userEvent.setup();
    renderState('S4');
    // Placeholders stay names in regex mode too.
    expect(replaceInput()).toHaveAttribute('placeholder', 'Replace with');
    expect(optionsButton()).toHaveTextContent('Options: Regular expression');
    await user.click(optionsButton());
    expect(
      within(openMenu()).getByText(
        'In Replace with, $1 inserts the first group of the pattern.',
      ),
    ).toBeInTheDocument();
    // No results yet: Replace with nothing isn't an option.
    expect(checkboxOptions().map(([name]) => name)).toEqual([
      'Match case',
      'Match whole word',
      'Use regular expression',
    ]);
  });

  it('the Replace field: typing, Replace with nothing, Esc clears, Enter never writes', async () => {
    const user = userEvent.setup();
    const { controller, mock } = renderState('S7');
    const replace = screen.getByRole('textbox', { name: 'Replace with' });
    await user.type(replace, 'Gl');
    expect(controller?.callsTo('setReplacementText')).toEqual([['G'], ['Gl']]);
    await user.keyboard('{Enter}');
    expect(controller?.callsTo('searchNow')).toHaveLength(0);
    expect(controller?.callsTo('replace')).toHaveLength(0);
    expect(mock.openConfirm).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(controller?.callsTo('clearReplacement')).toHaveLength(1);
    await user.click(optionsButton());
    await user.click(checkboxLabel('Replace with nothing'));
    expect(controller?.callsTo('setRemove')).toEqual([[true]]);
  });

  it('turning Replace with nothing off brings the typed text back', () => {
    const remove = stateFixture('S11b').snapshot;
    if (!remove) {
      throw new Error('fixtures');
    }
    const { controller } = renderSnapshot({
      ...remove,
      replace: { text: 'Globex', remove: true },
    });
    expect(replaceInput()).toHaveValue('');
    expect(replaceInput()).toBeDisabled();
    act(() => controller.setRemove(false));
    expect(replaceInput()).toBeEnabled();
    expect(replaceInput()).toHaveValue('Globex');
  });

  it('Mod+Enter opens the confirm only when the primary is enabled', async () => {
    const disabled = renderState('S7');
    const find = findInput();
    if (!find) {
      throw new Error('no Find');
    }
    pressModEnter(find);
    await act(async () => {});
    expect(disabled.mock.openConfirm).not.toHaveBeenCalled();
    expect(disabled.controller?.callsTo('searchNow')).toHaveLength(0);
    cleanup();

    const enabled = renderState('S11');
    const replace = replaceInput();
    if (!replace) {
      throw new Error('no Replace with');
    }
    // Not while an input method composes text.
    fireEvent.keyDown(replace, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      ctrlKey: true,
      isComposing: true,
    });
    await act(async () => {});
    expect(enabled.mock.openConfirm).not.toHaveBeenCalled();

    pressModEnter(replace);
    await waitFor(() => expect(enabled.mock.openConfirm).toHaveBeenCalled());
    expect(enabled.controller?.callsTo('setReplacementText')).toHaveLength(0);
  });

  it('Mod+Enter is a shortcut of the page, shown on the primary', async () => {
    const user = userEvent.setup();
    const { mock } = renderState('S11');
    // From anywhere on the page, not only from the fields.
    pressModEnter(document.body);
    await waitFor(() => expect(mock.openConfirm).toHaveBeenCalledTimes(1));

    // The primary's tooltip says what the keys do.
    await user.hover(screen.getByRole('button', { name: 'Replace 8 matches' }));
    expect(await screen.findByText('Replace the matches')).toBeInTheDocument();
  });
});

// ── Confirm, focus and scrolling ────────────────────────────────────────────

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
    const find = findInput();
    if (!find) {
      throw new Error('no Find');
    }
    act(() => find.focus());
    pressModEnter(find);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Replace 6 matches' }),
      ).toHaveFocus(),
    );
    expect(cancelled.controller?.callsTo('replace')).toHaveLength(0);
  });

  it('opens one confirm at a time', async () => {
    const user = userEvent.setup();
    const { mock } = renderState('S12');
    mock.openConfirm.mockReturnValueOnce(new Promise(() => {}));
    const primary = screen.getByRole('button', { name: 'Replace 6 matches' });
    await user.click(primary);
    await user.click(primary);
    expect(mock.openConfirm).toHaveBeenCalledTimes(1);
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
    expect(document.activeElement).toBe(document.body);
    act(() => controller.setSnapshot(stopped));
    expect(
      screen.getByRole('button', { name: 'Replace 73 matches' }),
    ).toHaveFocus();
  });

  it('"Search again" in the slot searches and focuses Find', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S16');
    await user.click(screen.getByRole('button', { name: 'Search again' }));
    expect(controller?.callsTo('searchAgain')).toHaveLength(1);
    expect(findInput()).toHaveFocus();
  });

  it('a new result set, and the end of a pass, scroll the content to the top', () => {
    const { controller } = renderSnapshot(resultsSnapshot());
    const content = paneContent();
    content.scrollTop = 120;
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        search: { ...current.search, resultsId: current.search.resultsId + 1 },
      })),
    );
    expect(content.scrollTop).toBe(0);

    content.scrollTop = 80;
    act(() => controller.emit(runEndedEvent()));
    expect(content.scrollTop).toBe(0);
  });

  it('keeps the focus on the primary when it turns from disabled to enabled, and back', () => {
    const { controller } = renderSnapshot({
      ...resultsSnapshot(),
      primary: disabledPrimary('search_running', { count: 36 }),
    });
    act(() => screen.getByRole('button', { name: 'Replace' }).focus());
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        primary: { kind: 'replace', verb: 'replace', count: 36, enabled: true },
      })),
    );
    expect(
      screen.getByRole('button', { name: 'Replace 36 matches' }),
    ).toHaveFocus();
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        primary: disabledPrimary('search_running', { count: 36 }),
      })),
    );
    expect(screen.getByRole('button', { name: 'Replace' })).toHaveFocus();
  });

  it('when the focused control unmounts, the focus goes back to Find', () => {
    const { controller } = renderState('S10a');
    const retry = screen.getByRole('button', {
      name: 'Search the failed models again',
    });
    act(() => retry.focus());
    expect(retry).toHaveFocus();
    // The retry no longer applies: its button goes.
    act(() =>
      controller?.setSnapshot((current) => ({ ...current, callouts: [] })),
    );
    expect(
      screen.queryByRole('button', { name: 'Search the failed models again' }),
    ).toBeNull();
    expect(findInput()).toHaveFocus();
  });
});

// ── Live region ─────────────────────────────────────────────────────────────

describe('live region', () => {
  function liveText(): string {
    return document.querySelector('[aria-live="polite"]')?.textContent ?? '';
  }

  it('announces settled searches and ended passes only', () => {
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

    // An invalid pattern is a danger callout, an alert of its own: the live
    // region doesn't read it a second time.
    act(() =>
      controller.emit({
        type: 'patternInvalid',
        problem: { code: 'zero_width' },
      }),
    );
    expect(liveText()).toBe('Search stopped. 24 matches in 9 records');

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

  it('reads the same pattern problem again for each invalid pattern', () => {
    const { controller } = renderState('S4');
    const problem = controller?.getSnapshot().search.patternProblem;
    if (!controller || !problem) {
      throw new Error('fixtures');
    }
    const first = screen.getByRole('alert');
    // Enter again on the same pattern: the same problem, the same text.
    act(() => controller.emit({ type: 'patternInvalid', problem }));
    const second = screen.getByRole('alert');
    expect(second).not.toBe(first);
    expect(second).toHaveTextContent(first.textContent ?? '');
  });

  it('reads the same text twice as two announcements', () => {
    const { controller } = renderState('S7');
    const settled = {
      type: 'searchSettled',
      matches: 9,
      records: 4,
      capped: false,
      stopped: false,
    } as const;
    act(() => controller?.emit(settled));
    const first = document.querySelector('[aria-live="polite"] > *');
    act(() => controller?.emit(settled));
    const second = document.querySelector('[aria-live="polite"] > *');
    expect(second).toHaveTextContent('9 matches in 4 records');
    expect(second).not.toBe(first);
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

// ── Toasts ──────────────────────────────────────────────────────────────────

describe('toasts', () => {
  it('fires exactly one toast per ended pass, also in StrictMode', () => {
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
    expect(mock.notice).toHaveBeenCalledWith('6 matches replaced');
    expect(mock.customToast).not.toHaveBeenCalled();
  });

  it('a toast after skips or failures has no button: the title bar holds the next steps', () => {
    const { controller, mock } = renderState('S18');
    const totals = stateFixture('S18').snapshot?.run.totals;
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
    expect(mock.customToast).toHaveBeenCalledWith({
      type: 'warning',
      message: '115 matches replaced, 3 records skipped.',
      dismissOnPageChange: true,
    });
    expect(slotLabels()).toEqual(['Search again']);
  });
});

// ── Lines above the results ─────────────────────────────────────────────────

describe('lines above the results', () => {
  it('a capped search whose replacement matches itself still says a later search can find the matches again', () => {
    const capped = stateFixture('S8').snapshot;
    if (!capped) {
      throw new Error('fixtures');
    }
    renderSnapshot({
      ...capped,
      replace: { text: 'THE', remove: false },
      note: { kind: 'capped', selfMatch: true, continued: false },
      replacementCheck: {
        problem: null,
        warnings: [{ code: 'self_match', pattern: 'the', replacement: 'THE' }],
      },
    });
    expect(
      screen.getByText(
        'Showing the first 10,000 matches. Replace them, then search again for the rest.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '“THE” still contains “the”, so searching again will find these matches again.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the replacement problem first, then the warnings in order', () => {
    const plan = stateFixture('S11').snapshot;
    if (!plan) {
      throw new Error('fixtures');
    }
    renderSnapshot({
      ...plan,
      replacementCheck: {
        problem: { code: 'context_token' },
        warnings: [
          { code: 'self_match', pattern: 'Acme', replacement: 'Acme Inc.' },
          { code: 'group_out_of_range', token: '$2', groupCount: 1 },
        ],
      },
    });
    expect(
      screen.getAllByRole('alert').map((alert) => alert.textContent),
    ).toEqual([
      "Replacement can't use $` or $'.",
      'Replacement uses $2, but the pattern only has 1 group.',
    ]);
    // The note that the replacement still contains the search sits between them, as no alert.
    const note = screen.getByText(
      '“Acme Inc.” still contains “Acme”, so searching again will find these matches again.',
    );
    expect(note.closest('[role="alert"]')).toBeNull();
    // The problem belongs to Replace with: described by it (the callout
    // shows it; the box draws no error ring of its own).
    expect(replaceInput()).not.toHaveAttribute('aria-invalid');
    expect(replaceInput()).toHaveAccessibleDescription(
      "Replacement can't use $` or $'.",
    );
    expect(findInput()).not.toHaveAttribute('aria-invalid');
    expect(findInput()).not.toHaveAccessibleDescription(/Replacement/);
  });

  it('updates a warning in place when its count changes, so it is not read out again', () => {
    const plan = stateFixture('S11').snapshot;
    if (!plan) {
      throw new Error('fixtures');
    }
    const slugs = (count: number) => ({
      problem: null,
      warnings: [{ code: 'slug_format', count } as const],
    });
    const { controller } = renderSnapshot({
      ...plan,
      replacementCheck: slugs(1),
    });
    const before = screen.getByRole('alert');
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        replacementCheck: slugs(2),
      })),
    );
    const after = screen.getByRole('alert');
    expect(after).toBe(before);
    expect(after).toHaveTextContent('so 2 slug changes will probably fail.');
  });
});

// ── Model filter ────────────────────────────────────────────────────────────

describe('model filter', () => {
  function trigger(name = 'All models'): HTMLElement {
    return screen.getByRole('button', { name });
  }

  it('is hidden until the snapshot says so and shows the selected model', () => {
    const { controller } = renderSnapshot(resultsSnapshot());
    expect(trigger()).toBeInTheDocument();
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        modelFilter: {
          ...current.modelFilter,
          selected: { id: 'article', name: 'Article' },
        },
      })),
    );
    expect(trigger('Model: Article')).toBeInTheDocument();
    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        modelFilter: { ...current.modelFilter, visible: false },
      })),
    );
    expect(screen.queryByRole('button', { name: 'Model: Article' })).toBeNull();
  });

  it('shows partial counts with a "+"', async () => {
    const user = userEvent.setup();
    renderState('S8');
    await user.click(trigger());
    expect(menuOption(/^Article/)).toHaveTextContent('Article6,912+ matches');
  });

  it('a pick sets the filter, closes the menu and gives the focus back to the trigger', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S12b');
    await user.click(trigger());
    await user.click(menuOption(/^Article/));
    expect(controller?.callsTo('setModelFilter')).toEqual([['article']]);
    await menuClosed();
    expect(trigger()).toHaveFocus();
  });

  it('works from the keyboard (the kit menu): Enter opens, arrows move, Enter picks, Esc closes', async () => {
    const { controller } = renderState('S12b');
    // The kit reads the legacy key codes, which user-event leaves at 0.
    const press = (element: Element, key: string, keyCode: number) =>
      fireEvent.keyDown(element, { key, keyCode, which: keyCode });

    act(() => trigger().focus());
    press(trigger(), 'Enter', 13);
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    press(openMenu(), 'ArrowDown', 40);
    press(openMenu(), 'Enter', 13);
    expect(controller?.callsTo('setModelFilter')).toHaveLength(1);
    await menuClosed();

    act(() => trigger().focus());
    press(trigger(), 'Enter', 13);
    press(openMenu(), 'Escape', 27);
    await menuClosed();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('above 5 options, the menu has a search field', async () => {
    const user = userEvent.setup();
    const names = ['Article', 'Author', 'Event', 'FAQ', 'Page', 'Product'];
    renderSnapshot({
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
    await user.click(trigger());
    expect(
      within(openMenu()).getByRole('textbox', { hidden: true }),
    ).toBeInTheDocument();
    expect(menuOptions()).toHaveLength(7);
  });

  it('closes when a run disables it, and says why it waits', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S12b');
    await user.click(trigger());
    expect(openMenu()).toBeInTheDocument();
    act(() =>
      controller?.setSnapshot((current) => ({
        ...current,
        modelFilter: { ...current.modelFilter, enabled: false },
      })),
    );
    await menuClosed();
    await expectReason(
      trigger(),
      "You can't change the search while records are being updated or published.",
    );
  });
});

// ── Host updates ────────────────────────────────────────────────────────────

describe('host updates', () => {
  it('re-renders on a new ctx object without remounting or re-subscribing', () => {
    const { boot, controller } = stateBoot('S7');
    const { rerender, mock } = renderBoot(boot);
    const find = findInput();
    const next = createMockCtx();
    // A theme switch: a new ctx object whose primitives are the same.
    rerender(<FindReplaceApp ctx={{ ...next.ctx }} boot={boot} />);
    expect(findInput()).toBe(find);
    expect(controller?.listenerCounts()).toEqual({ snapshot: 1, events: 1 });
    expect(mock.openConfirm).not.toHaveBeenCalled();
  });

  it('a new controller gets a fresh page', async () => {
    const user = userEvent.setup();
    const first = stateBoot('S8');
    const { rerender, mock } = renderBoot(first.boot);
    await user.click(screen.getByText('Load more records'));
    expect(records()).toHaveLength(100);
    const second = stateBoot('S8');
    rerender(<FindReplaceApp ctx={mock.ctx} boot={second.boot} />);
    expect(records()).toHaveLength(50);
    expect(first.controller?.listenerCounts()).toEqual({
      snapshot: 0,
      events: 0,
    });
  });
});

// ── Publishing ──────────────────────────────────────────────────────────────

describe('publish after a run', () => {
  it('confirms with the host (positive intent), then publishes with the offer token', async () => {
    const user = userEvent.setup();
    const { controller, mock } = renderState('S16');
    mock.openConfirm.mockResolvedValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Publish 2 records' }));
    expect(mock.openConfirm).toHaveBeenCalledWith({
      title: 'Publish 2 records?',
      content:
        'Only the replaced text goes live. 1 other record stays unpublished, as it has other unpublished changes.',
      choices: [
        { label: 'Yes, publish 2 records', value: true, intent: 'positive' },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    await waitFor(() =>
      expect(controller?.callsTo('publish')).toEqual([['publish-token']]),
    );
  });

  it('cancelling publishes nothing and focuses the slot', async () => {
    const user = userEvent.setup();
    const { controller, mock } = renderState('S16');
    mock.openConfirm.mockResolvedValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Publish 2 records' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Search again' }),
      ).toHaveFocus(),
    );
    expect(mock.openConfirm).toHaveBeenCalledTimes(1);
    expect(controller?.callsTo('publish')).toHaveLength(0);
  });

  it('S24 publishing: the busy publish alone, a locked form, progress with Stop', async () => {
    const user = userEvent.setup();
    const { controller } = renderState('S24');
    expect(slotLabels()).toEqual(['Publish 2 records']);
    const publish = screen.getByRole('button', { name: 'Publish 2 records' });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute('aria-busy', 'true');
    expect(findInput()).toBeDisabled();
    expect(screen.getByText('1 of 2 records published')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: '1 of 2 records published' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Publishing…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(controller?.callsTo('stopPublish')).toHaveLength(1);
  });

  it('S25 published: the status, the meta, and why the others stayed unpublished', () => {
    renderState('S25');
    expect(toolbarMeta()).toBe('6 matches replaced, 1 record published');
    expect(slotLabels()).toEqual(['Search again']);
    expect(screen.getAllByText('Published')).toHaveLength(1);
    expect(
      screen.getByText(
        'Not published, as it already had other unpublished changes.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't publish, as “Published on” can't be empty."),
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
    expect(mock.notice).toHaveBeenCalledWith('2 records published');
  });
});
