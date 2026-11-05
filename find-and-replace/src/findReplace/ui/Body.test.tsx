import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Canvas from 'datocms-react-ui/Canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FindReplaceSnapshot } from '../contract';
import { Body } from './Body';
import { createCopy } from './copy';
import { ResultsEnv } from './ResultsEnv';
import { createFakeController } from './testing/fakeController';
import { type StateId, stateFixture } from './testing/fixtures';
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

function renderBody(snapshot: FindReplaceSnapshot, narrow = false) {
  const handlers = {
    onRetrySearch: vi.fn(),
    onSelectAll: vi.fn(),
    onShowAllModels: vi.fn(),
  };
  const controller = createFakeController(snapshot);
  const ui = (next: FindReplaceSnapshot, patternAlertKey = 0) => (
    <Canvas ctx={createMockCtx().ctx}>
      <ResultsEnv.Provider value={{ controller, copy }}>
        <Body
          snapshot={next}
          copy={copy}
          narrow={narrow}
          patternAlertKey={patternAlertKey}
          {...handlers}
        />
      </ResultsEnv.Provider>
    </Canvas>
  );
  const view = render(ui(snapshot));
  return {
    ...view,
    handlers,
    rerenderWith: (next: FindReplaceSnapshot, patternAlertKey?: number) =>
      view.rerender(ui(next, patternAlertKey)),
  };
}

describe('the states of the body', () => {
  it('explains the page before the first search', () => {
    const idle = snapshotOf('S2');
    renderBody(idle);
    expect(screen.getByText('No search yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Matches show here as you type. Nothing changes until you review them and confirm.',
      ),
    ).toBeInTheDocument();
    cleanup();

    renderBody({ ...idle, findRow: { ...idle.findRow, enterToSearch: true } });
    // The Enter key shows as a key cap (↵), with its name for screen readers
    expect(
      screen.getByText(/^Matches show here when you press/),
    ).toHaveTextContent(
      'Matches show here when you press ↵Enter. Nothing changes until you review them and confirm.',
    );
  });

  it('shows nothing for a blank body, nor while the progress row shows the search', () => {
    const { container } = renderBody({ ...snapshotOf('S2'), body: 'blank' });
    expect(container).toHaveTextContent('');
    cleanup();
    // One indicator: the progress row under the find form.
    const searching = renderBody(snapshotOf('S5'));
    expect(searching.container).toHaveTextContent('');
  });

  it('offers "Try again" after a failed search, without the raw error', async () => {
    const user = userEvent.setup();
    const { handlers } = renderBody(snapshotOf('S21'));
    expect(screen.getByText("Couldn't search the records")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DatoCMS didn't respond. Check your connection, then try again.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(handlers.onRetrySearch).toHaveBeenCalledTimes(1);
  });

  it('shows only the pattern problem for an invalid pattern', () => {
    renderBody(snapshotOf('S4'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Fix the regular expression (unterminated group), or turn off Use regular expression in Options.',
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('mounts the pattern alert again for each invalid pattern, also with the same text', () => {
    const invalid = snapshotOf('S4');
    const { rerenderWith } = renderBody(invalid);
    const first = screen.getByRole('alert');
    rerenderWith(invalid, 0);
    expect(screen.getByRole('alert')).toBe(first);
    rerenderWith(invalid, 1);
    const second = screen.getByRole('alert');
    expect(second).not.toBe(first);
    expect(second).toHaveTextContent(
      'Fix the regular expression (unterminated group), or turn off Use regular expression in Options.',
    );
  });
});

describe('no results', () => {
  it('quotes the searched pattern, and keeps it while the next search is pending', () => {
    const settled = snapshotOf('S9');
    const { rerenderWith } = renderBody(settled);
    expect(screen.getByText('No matches for “Acme Corp”')).toBeInTheDocument();
    expect(
      screen.getByText('To find more, turn off Match case in Options.'),
    ).toBeInTheDocument();

    rerenderWith({
      ...settled,
      find: { ...settled.find, pattern: 'Acme Corporation' },
      search: { ...settled.search, phase: 'pending' },
    });
    expect(screen.getByText('No matches for “Acme Corp”')).toBeInTheDocument();
  });

  it('leads back to all models when the filter hides the matches', async () => {
    const user = userEvent.setup();
    const base = snapshotOf('S9');
    const filtered: FindReplaceSnapshot = {
      ...base,
      noResults: {
        followsRun: false,
        continued: false,
        runVerb: 'replace',
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        filteredModelName: 'Page',
        otherModelsHaveMatches: true,
      },
    };
    const { handlers } = renderBody(filtered);
    expect(
      screen.getByText('No matches for “Acme Corp” in “Page”'),
    ).toBeInTheDocument();
    expect(screen.getByText('Other models have matches.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all models' }));
    expect(handlers.onShowAllModels).toHaveBeenCalledTimes(1);
  });

  it('puts the callouts and the note above it', () => {
    renderBody({
      ...snapshotOf('S20'),
      note: { kind: 'searchStopped', searched: 1200, total: 3400 },
    });
    expect(screen.getByText('Some matches may be missing')).toBeInTheDocument();
    expect(screen.getByText(/^The search stopped after/)).toHaveTextContent(
      'The search stopped after 1,200 of 3,400 records. Press ↵Enter in Find to search them all.',
    );
    expect(
      screen.getByText('Every match has been replaced'),
    ).toBeInTheDocument();
  });
});

describe('above the results', () => {
  it('stacks the replacement problem, the warnings, the callouts and the note, with no buttons', () => {
    const plan = snapshotOf('S11c');
    renderBody({
      ...plan,
      replacementCheck: {
        problem: { code: 'context_token' },
        warnings: [
          { code: 'self_match', pattern: 'Acme', replacement: 'Acme Inc.' },
          { code: 'slug_format', count: 2 },
        ],
      },
      callouts: [
        {
          kind: 'modelsFailed',
          modelNames: ['Author'],
          retryable: true,
        },
      ],
      note: { kind: 'capped', selfMatch: false, continued: false },
    });
    const texts = [
      "Replacement can't use $` or $'.",
      '“Acme Inc.” still contains “Acme”, so searching again will find these matches again.',
      'Slugs only allow lowercase letters, numbers, hyphens and underscores, so 2 slug changes will probably fail.',
      "Couldn't search the “Author” model.",
      'Showing the first 10,000 matches. Replace them, then search again for the rest.',
    ];
    const found = texts.map((text) => screen.getByText(text));
    // In this order, each in its own callout with only its text.
    for (const [index, element] of found.entries()) {
      const next = found[index + 1];
      if (next) {
        expect(
          element.compareDocumentPosition(next) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    }
    for (const alert of screen.getAllByRole('alert')) {
      expect(within(alert).queryByRole('button')).toBeNull();
    }
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('shows the meta line above the results only under 600px', () => {
    const results = snapshotOf('S7');
    renderBody(results);
    expect(screen.queryByText('9 matches in 4 records')).toBeNull();
    cleanup();
    renderBody(results, true);
    expect(screen.getByText('9 matches in 4 records')).toBeInTheDocument();
  });

  it('shows no callout for failed or skipped records: the rows and the meta say it', () => {
    renderBody({
      ...snapshotOf('S17'),
      callouts: [
        {
          kind: 'recordsFailed',
          count: 3,
          retryable: true,
          singleReason: null,
        },
        { kind: 'recordsSkipped', count: 2, allStale: true },
      ],
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Couldn't update/)).toBeNull();
    expect(screen.queryByText(/were skipped/)).toBeNull();
  });
});
