import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FindReplaceSnapshot, MatchView } from './contract';
import {
  acmeRecords,
  allMatches,
  createFakeCma,
  type FixtureRecord,
  manyRecords,
  matchesOf,
  recordByKey,
  replaceAll,
  searchFor,
  settle,
  setupController,
} from './findReplace.fixtures';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function matchByText(snapshot: FindReplaceSnapshot, text: string): MatchView {
  const match = allMatches(snapshot).find(
    (candidate) => candidate.text === text,
  );
  if (!match) throw new Error(`No match "${text}"`);
  return match;
}

function slugMatch(snapshot: FindReplaceSnapshot): MatchView {
  const slugField = snapshot.records
    .flatMap((record) => record.fields)
    .find((field) => field.changesUrl);
  const match = slugField?.matches[0];
  if (!match) throw new Error('No slug match');
  return match;
}

describe('grouping', () => {
  it('groups by record (arrival order) and field (document order)', async () => {
    const harness = setupController();
    const snapshot = await searchFor(harness, 'acme');

    expect(snapshot.records.map((record) => record.key)).toEqual([
      'article:a1',
      'article:a2',
      'page:p1',
      'page:p2',
    ]);
    const a1 = recordByKey(snapshot, 'article:a1');
    expect(a1).toMatchObject({
      recordId: 'a1',
      modelId: 'article',
      modelName: 'Article',
      title: 'Acme launches a widget',
      matchCount: 4,
      status: { kind: 'untouched' },
    });
    expect(a1.fields.map((field) => field.path)).toEqual([
      ['Title'],
      ['Slug'],
      ['Body'],
    ]);
    expect(a1.fields.map((field) => field.locale)).toEqual([null, null, null]);
    expect(a1.fields.map((field) => field.changesUrl)).toEqual([
      false,
      true,
      false,
    ]);
    expect(a1.fields[2]?.matches.map((match) => match.text)).toEqual([
      'Acme',
      'acme',
    ]);
    expect(a1.fields[2]?.matches[1]).toMatchObject({
      before: 'Acme is great. Try ',
      after: ' again',
      beforeTruncated: false,
      afterTruncated: false,
    });
  });

  it('shows locales only when the project has two or more', async () => {
    const records: FixtureRecord[] = [
      {
        id: 'a1',
        modelId: 'article',
        attributes: {
          title: { en: 'Acme launches', it: 'Acme lancia' },
          slug: 'launch',
          body: '',
        },
      },
    ];
    const harness = setupController({
      records,
      localizedTitle: true,
      locales: ['en', 'it'],
    });
    const snapshot = await searchFor(harness, 'Acme');
    expect(
      recordByKey(snapshot, 'article:a1').fields.map((field) => field.locale),
    ).toEqual(['en', 'it']);
  });
});

describe('find mode and plan mode', () => {
  it('is a read-only list without a replacement', async () => {
    const harness = setupController();
    const snapshot = await searchFor(harness, 'acme');
    expect(snapshot.verb).toBeNull();
    expect(snapshot.selection.ui).toBe('hidden');
    expect(
      allMatches(snapshot).every((match) => match.display.kind === 'highlight'),
    ).toBe(true);
    expect(snapshot.primary).toEqual({
      kind: 'replace',
      verb: 'replace',
      count: 0,
      enabled: false,
      busy: false,
      reason: 'no_replacement',
    });
    expect(snapshot.meta).toEqual({
      kind: 'found',
      matches: 7,
      records: 4,
      capped: false,
    });
    expect(snapshot.plan).toBeNull();
    expect(snapshot.findRow.showEraser).toBe(true);
    expect(eventsSettled(harness)).toEqual([
      {
        type: 'searchSettled',
        matches: 7,
        records: 4,
        capped: false,
        stopped: false,
      },
    ]);
  });

  it('turns the list into the plan when a replacement is typed', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    const snapshot = harness.snapshot();

    expect(snapshot.verb).toBe('replace');
    expect(snapshot.selection).toEqual({ ui: 'enabled', all: 'some' });
    expect(slugMatch(snapshot)).toMatchObject({
      included: false,
      display: { kind: 'highlight' },
    });
    const others = allMatches(snapshot).filter(
      (match) => match !== slugMatch(snapshot),
    );
    expect(others).toHaveLength(6);
    for (const match of others) {
      expect(match.included).toBe(true);
      expect(match.display).toEqual({ kind: 'diff', inserted: 'Globex' });
    }
    expect(snapshot.meta).toEqual({
      kind: 'willChange',
      changing: 6,
      found: 7,
      verb: 'replace',
    });
    expect(snapshot.primary).toEqual({
      kind: 'replace',
      verb: 'replace',
      count: 6,
      enabled: true,
    });
    expect(snapshot.plan).toMatchObject({
      verb: 'replace',
      matchCount: 6,
      recordCount: 4,
      singleRecord: null,
      liveRecordCount: 2,
      slugMatchCount: 0,
      pattern: 'acme',
      regex: false,
      replacementText: 'Globex',
    });
    // Checkboxes: records always, matches only in records with 2+ matches.
    expect(recordByKey(snapshot, 'article:a1').selectable).toBe(true);
    expect(matchesOf(recordByKey(snapshot, 'article:a1'))[0]?.selectable).toBe(
      true,
    );
    expect(matchesOf(recordByKey(snapshot, 'page:p1'))[0]?.selectable).toBe(
      false,
    );
  });

  it('marks unchanged matches "No change" and leaves them out of every count', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Acme');
    const snapshot = harness.snapshot();

    expect(matchByText(snapshot, 'ACME').display).toEqual({
      kind: 'diff',
      inserted: 'Acme',
    });
    // The body's "acme" (the slug's "acme" is left out by default).
    expect(
      recordByKey(snapshot, 'article:a1').fields[2]?.matches[1]?.display,
    ).toEqual({ kind: 'diff', inserted: 'Acme' });
    const unchanged = allMatches(snapshot).filter(
      (match) => match.display.kind === 'noChange',
    );
    expect(unchanged).toHaveLength(4);
    expect(snapshot.meta).toEqual({
      kind: 'willChange',
      changing: 2,
      found: 7,
      verb: 'replace',
    });
    expect(snapshot.plan).toMatchObject({ matchCount: 2, recordCount: 2 });
  });

  it('says "Remove" with the eraser on, and "no replacement" when both are empty', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setRemove(true);
    const removing = harness.snapshot();
    expect(removing.verb).toBe('remove');
    expect(removing.replace).toEqual({ text: '', remove: true });
    expect(matchByText(removing, 'ACME').display).toEqual({
      kind: 'diff',
      inserted: '',
    });
    expect(removing.primary).toMatchObject({
      verb: 'remove',
      count: 6,
      enabled: true,
    });
    expect(removing.plan).toMatchObject({
      verb: 'remove',
      replacementText: '',
    });

    harness.controller.setReplacementText('Globex');
    harness.controller.setRemove(false);
    expect(harness.snapshot().verb).toBe('replace');
    harness.controller.clearReplacement();
    expect(harness.snapshot().replace.text).toBe('');
    expect(harness.snapshot().primary).toMatchObject({
      reason: 'no_replacement',
    });
  });

  it('warns about missing groups, self matches and slug formats, and blocks $`', async () => {
    const harness = setupController();
    harness.controller.setOption('regex', true);
    await searchFor(harness, '(Ac)(me)');
    harness.controller.setReplacementText('$2 $3');
    expect(harness.snapshot().replacementCheck).toEqual({
      problem: null,
      warnings: [{ code: 'group_out_of_range', token: '$3', groupCount: 2 }],
    });
    expect(matchByText(harness.snapshot(), 'ACME').display).toEqual({
      kind: 'diff',
      inserted: 'ME $3',
    });

    harness.controller.setReplacementText('a$`b');
    expect(harness.snapshot().replacementCheck.problem).toEqual({
      code: 'context_token',
    });
    expect(harness.snapshot().primary).toMatchObject({
      reason: 'invalid_replacement',
    });
    expect(harness.snapshot().plan).toBeNull();

    harness.controller.setOption('regex', false);
    await searchFor(harness, 'Acme');
    harness.controller.setReplacementText('Acme Inc');
    expect(harness.snapshot().replacementCheck.warnings).toEqual([
      { code: 'self_match' },
    ]);

    harness.controller.setReplacementText('Globex');
    harness.controller.setMatchIncluded(
      slugMatch(harness.snapshot()).key,
      true,
    );
    expect(harness.snapshot().replacementCheck.warnings).toEqual([
      { code: 'slug_format', count: 1 },
    ]);
    expect(harness.snapshot().plan?.slugMatchCount).toBe(1);
  });
});

function eventsSettled(harness: ReturnType<typeof setupController>) {
  return harness.events.filter((event) => event.type === 'searchSettled');
}

describe('inclusion', () => {
  it('follows record and match checkboxes, and "Select all"', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    expect(harness.snapshot().hasManualSelection).toBe(false);

    harness.controller.setRecordIncluded('page:p1', false);
    let snapshot = harness.snapshot();
    expect(recordByKey(snapshot, 'page:p1').inclusion).toBe('none');
    expect(snapshot.primary).toMatchObject({ count: 5 });
    expect(snapshot.hasManualSelection).toBe(true);

    const body = recordByKey(snapshot, 'article:a1').fields[2];
    harness.controller.setMatchIncluded(body?.matches[1]?.key ?? '', false);
    snapshot = harness.snapshot();
    expect(recordByKey(snapshot, 'article:a1').inclusion).toBe('some');
    expect(snapshot.primary).toMatchObject({ count: 4 });

    harness.controller.setAllIncluded(false);
    snapshot = harness.snapshot();
    expect(snapshot.selection.all).toBe('none');
    expect(snapshot.primary).toMatchObject({ reason: 'nothing_selected' });

    harness.controller.setRecordIncluded('article:a1', true);
    snapshot = harness.snapshot();
    // Including a record includes its slug too (an explicit choice).
    expect(recordByKey(snapshot, 'article:a1').inclusion).toBe('all');
    expect(snapshot.selection.all).toBe('some');
    expect(snapshot.primary).toMatchObject({ count: 4 });

    harness.controller.setAllIncluded(true);
    snapshot = harness.snapshot();
    expect(snapshot.selection.all).toBe('all');
    expect(slugMatch(snapshot).included).toBe(true);
    expect(snapshot.primary).toMatchObject({ count: 7 });
  });

  it('includes only the clicked match of an excluded record', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    harness.controller.setRecordIncluded('article:a1', false);
    const body = recordByKey(harness.snapshot(), 'article:a1').fields[2];
    harness.controller.setMatchIncluded(body?.matches[0]?.key ?? '', true);
    const a1 = recordByKey(harness.snapshot(), 'article:a1');
    expect(matchesOf(a1).map((match) => match.included)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('starts matches that stream in later excluded after "Select all" is turned off', async () => {
    const cma = createFakeCma(manyRecords(60));
    const held: Array<() => void> = [];
    cma.gatePages((query) =>
      query.page.offset >= 30
        ? new Promise<void>((resolve) => {
            held.push(resolve);
          })
        : undefined,
    );
    const harness = setupController({ cma });
    harness.controller.setReplacementText('Globex');
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.snapshot().records).toHaveLength(30);

    harness.controller.setAllIncluded(false);
    for (const resolve of held) resolve();
    await settle();

    const snapshot = harness.snapshot();
    expect(snapshot.records).toHaveLength(60);
    expect(allMatches(snapshot).every((match) => !match.included)).toBe(true);
    expect(snapshot.selection.all).toBe('none');
  });
});

describe('carry-over', () => {
  it('keeps exclusions on "Search again" while the text is unchanged', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    harness.controller.setRecordIncluded('page:p2', false);
    const excludedMatch = matchByText(harness.snapshot(), 'ACME');
    harness.controller.setMatchIncluded(excludedMatch.key, false);

    const frames: FindReplaceSnapshot[] = [];
    harness.controller.subscribe(() => frames.push(harness.snapshot()));
    harness.controller.searchAgain();
    await settle();

    const firstWithRecords = frames.find((frame) => frame.records.length > 0);
    expect(
      firstWithRecords?.records.find((record) => record.key === 'page:p2')
        ?.inclusion ?? 'none',
    ).toBe('none');
    const snapshot = harness.snapshot();
    expect(recordByKey(snapshot, 'page:p2').inclusion).toBe('none');
    expect(matchByText(snapshot, 'ACME').included).toBe(false);
    expect(snapshot.hasManualSelection).toBe(true);
    expect(snapshot.search.followsRun).toBe(false);
  });

  it('includes a carried match again when its field value changed', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    harness.controller.setMatchIncluded(
      matchByText(harness.snapshot(), 'ACME').key,
      false,
    );
    harness.cma.edit('a2', { body: 'Use ACME carefully, really' });

    // The cache is fresh: "Search again" with fresh data needs the network.
    harness.controller.retrySearch();
    await settle();
    expect(matchByText(harness.snapshot(), 'ACME').included).toBe(true);
  });

  it('keeps a match left out of a field the run wrote left out on "Search again"', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    // a1's body is "Acme is great. Try acme again": leave out the second one.
    const body = recordByKey(harness.snapshot(), 'article:a1').fields[2];
    harness.controller.setMatchIncluded(body?.matches[1]?.key ?? '', false);
    await replaceAll(harness);
    expect(harness.cma.records.get('a1')?.attributes).toMatchObject({
      body: 'Globex is great. Try acme again',
    });

    harness.controller.searchAgain();
    await settle();
    const again = harness.snapshot();
    const a1 = recordByKey(again, 'article:a1');
    expect(a1.fields.map((field) => field.path)).toEqual([['Slug'], ['Body']]);
    expect(matchesOf(a1).map((match) => [match.text, match.included])).toEqual([
      ['acme', false],
      ['acme', false],
    ]);
    expect(again.primary).toMatchObject({
      enabled: false,
      reason: 'nothing_selected',
    });
    expect(again.hasManualSelection).toBe(true);
  });

  it('starts fresh for a different pattern', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setRecordIncluded('page:p2', false);
    await searchFor(harness, 'Acme');
    expect(recordByKey(harness.snapshot(), 'page:p2').inclusion).toBe('all');
    expect(harness.snapshot().hasManualSelection).toBe(false);
  });
});

describe('model filter', () => {
  it('appears after a search with matches in 2+ models and filters every count without a new scan', async () => {
    const harness = setupController();
    expect(harness.snapshot().modelFilter.visible).toBe(false);
    const settled = await searchFor(harness, 'acme');
    expect(settled.modelFilter).toEqual({
      visible: true,
      enabled: true,
      selected: null,
      options: [
        { id: 'article', name: 'Article', matchCount: 5 },
        { id: 'author', name: 'Author', matchCount: 0 },
        { id: 'page', name: 'Page', matchCount: 2 },
      ],
      allMatchCount: 7,
      partial: false,
    });

    harness.controller.setReplacementText('Globex');
    const calls = harness.cma.rawList.mock.calls.length;
    harness.controller.setModelFilter('page');
    const filtered = harness.snapshot();
    expect(harness.cma.rawList.mock.calls.length).toBe(calls);
    expect(filtered.records.map((record) => record.key)).toEqual([
      'page:p1',
      'page:p2',
    ]);
    expect(filtered.modelFilter.selected).toEqual({ id: 'page', name: 'Page' });
    expect(filtered.primary).toMatchObject({ count: 2 });
    expect(filtered.plan).toMatchObject({ recordCount: 2, liveRecordCount: 2 });

    // It persists across a new search.
    await searchFor(harness, 'Acme');
    expect(harness.snapshot().modelFilter.selected?.id).toBe('page');
    expect(
      harness.snapshot().records.every((record) => record.modelId === 'page'),
    ).toBe(true);
  });

  it('stays hidden for matches in one model, and names the filter when it hides every match', async () => {
    const harness = setupController();
    const settled = await searchFor(harness, 'widget');
    expect(settled.modelFilter.visible).toBe(false);

    harness.controller.setModelFilter('page');
    const hidden = harness.snapshot();
    expect(hidden.body).toBe('noResults');
    expect(hidden.noResults).toEqual({
      followsRun: false,
      continued: false,
      runVerb: 'replace',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      filteredModelName: 'Page',
      otherModelsHaveMatches: true,
    });
    expect(hidden.meta).toEqual({ kind: 'noMatches' });
  });
});

describe('plan token', () => {
  it('changes with anything that changes the plan, and a stale token writes nothing', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    const tokens = new Set<string | undefined>([
      harness.snapshot().plan?.token,
    ]);

    harness.controller.setReplacementText('Globex!');
    tokens.add(harness.snapshot().plan?.token);
    harness.controller.setRecordIncluded('page:p1', false);
    tokens.add(harness.snapshot().plan?.token);
    harness.controller.setModelFilter('article');
    tokens.add(harness.snapshot().plan?.token);
    const beforeSearch = harness.snapshot().plan?.token ?? '';
    await searchFor(harness, 'acme');
    tokens.add(harness.snapshot().plan?.token);
    expect(tokens.size).toBe(5);

    expect(harness.controller.replace(beforeSearch)).toBe(false);
    expect(harness.controller.replace('nonsense')).toBe(false);
    await settle();
    expect(harness.cma.rawFind).not.toHaveBeenCalled();
    expect(harness.cma.update).not.toHaveBeenCalled();
    expect(harness.snapshot().run.phase).toBe('none');
  });
});

describe('snapshots', () => {
  it('returns the same snapshot until the next emit, and shares unchanged views', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Globex');
    const before = harness.snapshot();
    expect(harness.snapshot()).toBe(before);

    harness.controller.setRecordIncluded('page:p1', false);
    const after = harness.snapshot();
    expect(after).not.toBe(before);
    expect(recordByKey(after, 'page:p1')).not.toBe(
      recordByKey(before, 'page:p1'),
    );
    for (const key of ['article:a1', 'article:a2', 'page:p2']) {
      expect(recordByKey(after, key)).toBe(recordByKey(before, key));
    }
    expect(after.modelFilter).toBe(before.modelFilter);
    expect(after.search).toBe(before.search);

    // Only the flipped match changes inside a record.
    const a1Before = recordByKey(after, 'article:a1');
    const bodyMatch = a1Before.fields[2]?.matches[1];
    harness.controller.setMatchIncluded(bodyMatch?.key ?? '', false);
    const a1After = recordByKey(harness.snapshot(), 'article:a1');
    expect(a1After).not.toBe(a1Before);
    expect(a1After.fields[0]).toBe(a1Before.fields[0]);
    expect(a1After.fields[1]).toBe(a1Before.fields[1]);
    expect(a1After.fields[2]?.matches[0]).toBe(a1Before.fields[2]?.matches[0]);
    expect(a1After.fields[2]?.matches[1]).not.toBe(bodyMatch);
  });

  it('binds every method, so the page can pass them around', async () => {
    const harness = setupController();
    const { setPattern, searchNow, getSnapshot, recordLink } =
      harness.controller;
    setPattern('acme');
    searchNow();
    await settle();
    expect(getSnapshot().records).toHaveLength(4);
    expect(recordLink('article:a1')).toEqual({
      kind: 'href',
      href: 'https://acme.admin.datocms.com/editor/item_types/article/items/a1/edit',
    });
  });

  it('shows the eraser once there are results, and keeps it while a new search runs', async () => {
    const harness = setupController({ records: acmeRecords() });
    expect(harness.snapshot().findRow.showEraser).toBe(false);
    await searchFor(harness, 'acme');
    expect(harness.snapshot().findRow.showEraser).toBe(true);
    harness.controller.setPattern('acmex');
    expect(harness.snapshot().findRow.showEraser).toBe(true);
    await settle();
    expect(harness.snapshot().records).toEqual([]);
    expect(harness.snapshot().findRow.showEraser).toBe(false);
    expect(harness.snapshot().body).toBe('noResults');
    harness.controller.setRemove(true);
    expect(harness.snapshot().findRow.showEraser).toBe(true);
  });
});
