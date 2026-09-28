import { describe, expect, it } from 'vitest';
import { expandReplacement } from '../replacement/replacementTemplate';
import type { SearchPhase } from './contract';
import { fixtureSchema } from './findReplace.fixtures';
import {
  compileReplacement,
  deriveBody,
  deriveCallouts,
  deriveMeta,
  deriveNote,
  derivePrimary,
  emptyTally,
  isLiveModel,
  isSelfMatch,
  type MetaInput,
  matcherSpecOf,
  type PrimaryInput,
  planFacts,
  planMatch,
  planToken,
  replacementCheck,
  replaceVerb,
  sameFind,
  selectAllState,
  violatesSlugFormat,
} from './planning';

const literal = {
  pattern: 'acme',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};
const regex = { ...literal, pattern: '(?<first>Ac)(me)', regex: true };

describe('inputs', () => {
  it('derives the verb from the Replace input', () => {
    expect(replaceVerb({ text: '', remove: false })).toBeNull();
    expect(replaceVerb({ text: 'x', remove: false })).toBe('replace');
    expect(replaceVerb({ text: 'x', remove: true })).toBe('remove');
  });

  it('builds the matcher and compares settings', () => {
    expect(matcherSpecOf(regex)).toEqual({
      kind: 'regex',
      pattern: '(?<first>Ac)(me)',
      caseSensitive: false,
      wholeWord: false,
    });
    expect(sameFind(literal, { ...literal })).toBe(true);
    expect(sameFind(literal, { ...literal, wholeWord: true })).toBe(false);
    expect(sameFind(literal, null)).toBe(false);
  });
});

describe('compileReplacement and planMatch', () => {
  it('compiles literal text verbatim and regex templates per match', () => {
    const plain = compileReplacement(
      { text: '$1 & $$', remove: false },
      matcherSpecOf(literal),
    );
    expect(plain.template).toEqual({ kind: 'literal', text: '$1 & $$' });

    const templated = compileReplacement(
      { text: '$<first>-$2 $3', remove: false },
      matcherSpecOf(regex),
    );
    expect(templated.outOfRange).toEqual(['$3']);
    expect(
      templated.template &&
        expandReplacement(templated.template, {
          matchedText: 'Acme',
          captures: ['Ac', 'me'],
          namedCaptures: { first: 'Ac' },
        }),
    ).toBe('Ac-me $3');

    expect(
      compileReplacement({ text: "a$'", remove: false }, matcherSpecOf(regex)),
    ).toMatchObject({
      template: null,
      problem: { code: 'context_token' },
    });
    expect(
      compileReplacement({ text: 'kept', remove: true }, matcherSpecOf(regex)),
    ).toMatchObject({
      verb: 'remove',
      template: { kind: 'literal', text: '' },
      text: '',
    });
    expect(
      compileReplacement({ text: '', remove: false }, matcherSpecOf(literal)),
    ).toMatchObject({
      verb: null,
      template: null,
    });
  });

  it('plans one match: highlight, "No change" or a diff', () => {
    const globex = compileReplacement(
      { text: 'Acme', remove: false },
      matcherSpecOf(literal),
    );
    expect(planMatch(globex, { matchedText: 'ACME' }, true)).toEqual({
      display: { kind: 'diff', inserted: 'Acme' },
      changing: true,
      inserted: 'Acme',
    });
    expect(planMatch(globex, { matchedText: 'Acme' }, true)).toMatchObject({
      display: { kind: 'noChange' },
      changing: false,
    });
    expect(planMatch(globex, { matchedText: 'ACME' }, false)).toMatchObject({
      display: { kind: 'highlight' },
      changing: false,
    });
    const find = compileReplacement(
      { text: '', remove: false },
      matcherSpecOf(literal),
    );
    expect(planMatch(find, { matchedText: 'ACME' }, true).display).toEqual({
      kind: 'highlight',
    });
  });
});

describe('checks', () => {
  it('finds self matches in literal mode only', () => {
    expect(isSelfMatch(literal, 'Acme Inc')).toBe(true);
    expect(isSelfMatch({ ...literal, wholeWord: true }, 'Acmeish')).toBe(false);
    expect(isSelfMatch({ ...literal, caseSensitive: true }, 'ACME')).toBe(
      false,
    );
    expect(isSelfMatch(regex, 'Acme')).toBe(false);
    expect(isSelfMatch(literal, '')).toBe(false);
  });

  it('checks slug characters and live models', () => {
    expect(violatesSlugFormat('globex-widget_2')).toBe(false);
    expect(violatesSlugFormat('Globex')).toBe(true);
    expect(violatesSlugFormat('a b')).toBe(true);
    const schema = fixtureSchema();
    expect(isLiveModel(schema, 'page')).toBe(true);
    expect(isLiveModel(schema, 'article')).toBe(false);
  });

  it('lists warnings in order, only with a replacement', () => {
    const compiled = compileReplacement(
      { text: '$3 $3 $<x>', remove: false },
      matcherSpecOf(regex),
    );
    expect(
      replacementCheck({
        replacement: compiled,
        find: regex,
        groupCount: 2,
        slugFormatMatches: 2,
      }),
    ).toEqual({
      problem: null,
      warnings: [
        { code: 'group_out_of_range', token: '$3', groupCount: 2 },
        { code: 'group_out_of_range', token: '$<x>', groupCount: 2 },
        { code: 'slug_format', count: 2 },
      ],
    });
    const removing = compileReplacement(
      { text: 'Acme', remove: true },
      matcherSpecOf(literal),
    );
    expect(
      replacementCheck({
        replacement: removing,
        find: literal,
        groupCount: 0,
        slugFormatMatches: 0,
      }),
    ).toEqual({ problem: null, warnings: [] });
  });
});

describe('primary', () => {
  function input(patch: Partial<PrimaryInput> = {}): PrimaryInput {
    return {
      searchPhase: 'settled',
      runPhase: 'none',
      busy: { verb: 'replace', count: 6 },
      verb: 'replace',
      problem: null,
      tally: { foundMatches: 9, includedMatches: 8, changingMatches: 6 },
      ...patch,
    };
  }

  it.each([
    [{ searchPhase: 'pending' }, 'search_running'],
    [{ searchPhase: 'searching' }, 'search_running'],
    [{ searchPhase: 'invalid' }, 'invalid_pattern'],
    [{ searchPhase: 'idle' }, 'no_matches'],
    [{ searchPhase: 'failed' }, 'no_matches'],
    [
      { tally: { foundMatches: 0, includedMatches: 0, changingMatches: 0 } },
      'no_matches',
    ],
    [{ verb: null }, 'no_replacement'],
    [{ problem: { code: 'context_token' } }, 'invalid_replacement'],
    [
      { tally: { foundMatches: 9, includedMatches: 0, changingMatches: 0 } },
      'nothing_selected',
    ],
    [
      { tally: { foundMatches: 9, includedMatches: 3, changingMatches: 0 } },
      'nothing_changes',
    ],
  ] as Array<
    [Partial<PrimaryInput>, string]
  >)('disables with %j → %s', (patch, reason) => {
    expect(derivePrimary(input(patch))).toMatchObject({
      enabled: false,
      busy: false,
      reason,
      count: 0,
    });
  });

  it('is enabled with the changing count, busy while running, and "Search again" after a finished run', () => {
    expect(derivePrimary(input())).toEqual({
      kind: 'replace',
      verb: 'replace',
      count: 6,
      enabled: true,
    });
    expect(derivePrimary(input({ runPhase: 'stopping', verb: null }))).toEqual({
      kind: 'replace',
      verb: 'replace',
      count: 6,
      enabled: false,
      busy: true,
      reason: 'replacing',
    });
    expect(derivePrimary(input({ runPhase: 'finished' }))).toEqual({
      kind: 'searchAgain',
      publish: null,
    });
    expect(
      derivePrimary(input({ runPhase: 'finished', searchPhase: 'pending' })),
    ).toMatchObject({
      reason: 'search_running',
    });
    expect(derivePrimary(input({ verb: 'remove' }))).toMatchObject({
      verb: 'remove',
    });
  });
});

describe('meta', () => {
  function input(patch: Partial<MetaInput> = {}): MetaInput {
    return {
      shownPhase: 'settled',
      capped: false,
      runPhase: 'none',
      runVerb: 'replace',
      frozen: null,
      runTotals: {
        replacedMatches: 48,
        skippedRecords: 1,
        failedRecords: 2,
        plannedMatches: 121,
        publishedRecords: 0,
      },
      verb: null,
      problem: null,
      tally: { foundMatches: 9, foundRecords: 4, changingMatches: 0 },
      ...patch,
    };
  }

  it('describes the search', () => {
    expect(deriveMeta(input())).toEqual({
      kind: 'found',
      matches: 9,
      records: 4,
      capped: false,
    });
    expect(deriveMeta(input({ capped: true }))).toMatchObject({ capped: true });
    expect(
      deriveMeta(
        input({
          tally: { foundMatches: 0, foundRecords: 0, changingMatches: 0 },
        }),
      ),
    ).toEqual({
      kind: 'noMatches',
    });
    expect(deriveMeta(input({ shownPhase: 'idle' }))).toEqual({ kind: 'none' });
    expect(deriveMeta(input({ shownPhase: 'invalid' }))).toEqual({
      kind: 'none',
    });
    expect(
      deriveMeta(
        input({
          shownPhase: 'searching',
          tally: { foundMatches: 0, foundRecords: 0, changingMatches: 0 },
        }),
      ),
    ).toEqual({ kind: 'none' });
    expect(
      deriveMeta(input({ shownPhase: 'searching', capped: true })),
    ).toMatchObject({
      kind: 'found',
      capped: false,
    });
  });

  it('reconciles with the primary in plan mode', () => {
    expect(
      deriveMeta(
        input({
          verb: 'replace',
          tally: { foundMatches: 9, foundRecords: 4, changingMatches: 8 },
        }),
      ),
    ).toEqual({ kind: 'willChange', changing: 8, found: 9, verb: 'replace' });
    expect(
      deriveMeta(
        input({
          verb: 'remove',
          tally: { foundMatches: 9, foundRecords: 4, changingMatches: 9 },
        }),
      ),
    ).toMatchObject({ kind: 'found' });
  });

  it('describes the run', () => {
    const frozen = {
      kind: 'willChange',
      changing: 6,
      found: 9,
      verb: 'replace',
    } as const;
    expect(deriveMeta(input({ runPhase: 'running', frozen }))).toBe(frozen);
    expect(
      deriveMeta(input({ runPhase: 'finished', runVerb: 'remove' })),
    ).toEqual({
      kind: 'runFinished',
      verb: 'remove',
      replacedMatches: 48,
      skippedRecords: 1,
      failedRecords: 2,
      publishedRecords: 0,
    });
    expect(deriveMeta(input({ runPhase: 'stopped' }))).toEqual({
      kind: 'runStopped',
      verb: 'replace',
      replacedMatches: 48,
      plannedMatches: 121,
    });
  });
});

describe('body, notes and callouts', () => {
  it('keeps the previous body while pending', () => {
    const body = (
      phase: SearchPhase,
      shownPhase: SearchPhase,
      showProgress = false,
      shownRecords = 0,
    ) => deriveBody({ phase, shownPhase, showProgress, shownRecords });
    expect(body('idle', 'idle')).toBe('idle');
    expect(body('searching', 'searching')).toBe('blank');
    expect(body('searching', 'searching', true)).toBe('spinner');
    expect(body('searching', 'searching', true, 2)).toBe('results');
    expect(body('settled', 'settled')).toBe('noResults');
    expect(body('invalid', 'invalid')).toBe('invalid');
    expect(body('failed', 'failed')).toBe('searchFailed');
    expect(body('pending', 'settled', false, 3)).toBe('results');
    expect(body('pending', 'settled')).toBe('noResults');
    expect(body('pending', 'idle')).toBe('idle');
    expect(body('pending', 'failed')).toBe('blank');
  });

  it('notes a cap or a stop on settled results', () => {
    const base = {
      shownPhase: 'settled' as const,
      capped: false,
      stopped: false,
      progress: { searched: 1200, total: null },
      selfMatch: false,
    };
    expect(deriveNote(base)).toBeNull();
    expect(deriveNote({ ...base, capped: true, selfMatch: true })).toEqual({
      kind: 'capped',
      selfMatch: true,
      continued: false,
    });
    expect(deriveNote({ ...base, capped: true, continued: true })).toEqual({
      kind: 'capped',
      selfMatch: false,
      continued: true,
    });
    expect(deriveNote({ ...base, stopped: true })).toEqual({
      kind: 'searchStopped',
      searched: 1200,
      total: null,
    });
    expect(
      deriveNote({ ...base, shownPhase: 'searching', stopped: true }),
    ).toBeNull();
  });

  it('lists callouts in order', () => {
    expect(
      deriveCallouts({
        showRecordOutcomes: true,
        outcomes: {
          failed: 2,
          retryableFailed: 0,
          failReasons: new Set(['permission']),
          skipped: 3,
          staleSkipped: 2,
        },
        failedModelNames: ['Author'],
      }),
    ).toEqual([
      {
        kind: 'recordsFailed',
        count: 2,
        retryable: false,
        singleReason: 'permission',
      },
      { kind: 'recordsSkipped', count: 3, allStale: false },
      { kind: 'modelsFailed', modelNames: ['Author'], retryable: true },
    ]);
    expect(
      deriveCallouts({
        showRecordOutcomes: false,
        outcomes: {
          failed: 2,
          retryableFailed: 1,
          failReasons: new Set(['network', 'validation']),
          skipped: 0,
          staleSkipped: 0,
        },
        failedModelNames: [],
      }),
    ).toEqual([]);
  });
});

describe('plan facts', () => {
  const parts = {
    resultsId: 1,
    resultsRevision: 3,
    find: literal,
    replace: { text: 'Globex', remove: false },
    modelFilter: null,
    inclusionRevision: 0,
    runRevision: 0,
  };

  it('derives a token from everything the plan depends on', () => {
    const token = planToken(parts);
    expect(planToken({ ...parts })).toBe(token);
    for (const patch of [
      { resultsId: 2 },
      { resultsRevision: 4 },
      { find: { ...literal, caseSensitive: true } },
      { replace: { text: 'Globex', remove: true } },
      { modelFilter: 'page' },
      { inclusionRevision: 1 },
      { runRevision: 1 },
    ]) {
      expect(planToken({ ...parts, ...patch })).not.toBe(token);
    }
  });

  it('builds the confirm facts from the tally', () => {
    const tally = {
      ...emptyTally(),
      changingMatches: 3,
      changingRecords: 1,
      liveRecords: 1,
      slugMatches: 1,
      firstChangingRecord: { id: 'a1', title: null },
    };
    expect(
      planFacts({
        token: 't',
        verb: 'remove',
        tally,
        find: literal,
        replacementText: 'ignored',
      }),
    ).toEqual({
      token: 't',
      verb: 'remove',
      matchCount: 3,
      recordCount: 1,
      singleRecord: { id: 'a1', title: null },
      liveRecordCount: 1,
      slugMatchCount: 1,
      pattern: 'acme',
      regex: false,
      replacementText: '',
    });
    expect(
      selectAllState(
        { ...emptyTally(), selectableRecords: 2, selectableAll: 1 },
        true,
      ),
    ).toBe('some');
    expect(
      selectAllState(
        { ...emptyTally(), selectableRecords: 2, selectableNone: 2 },
        true,
      ),
    ).toBe('none');
    expect(selectAllState(emptyTally(), false)).toBe('none');
  });
});
