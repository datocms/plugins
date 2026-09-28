import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acmeRecords,
  allMatches,
  eventsOf,
  httpError,
  manyRecords,
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

/** A project above `limits.enterToSearchAbove` (10,000 records). */
const LARGE = 20_000;

function recordIds(harness: ReturnType<typeof setupController>): string[] {
  return harness.snapshot().records.map((record) => record.recordId);
}

describe('large projects: Enter searches', () => {
  it('never searches while typing; Enter does', async () => {
    const harness = setupController({ recordCount: LARGE });
    expect(harness.snapshot().findRow).toMatchObject({
      enterToSearch: true,
      awaitingEnter: false,
    });

    harness.controller.setPattern('Acme');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.cma.rawList).not.toHaveBeenCalled();
    expect(harness.snapshot().search.phase).toBe('idle');
    expect(harness.snapshot().findRow.awaitingEnter).toBe(true);
    expect(harness.snapshot().primary).toMatchObject({
      enabled: false,
      reason: 'press_enter',
    });

    harness.controller.searchNow();
    await settle();
    expect(harness.snapshot().search.phase).toBe('settled');
    expect(harness.snapshot().findRow.awaitingEnter).toBe(false);
    expect(allMatches(harness.snapshot()).length).toBeGreaterThan(0);
  });

  it('searches as you type up to the threshold', async () => {
    const harness = setupController({ recordCount: 10_000 });
    expect(harness.snapshot().findRow.enterToSearch).toBe(false);
    harness.controller.setPattern('Acme');
    await settle();
    expect(harness.snapshot().search.phase).toBe('settled');
  });

  it('searches as you type when the record count is unknown', async () => {
    const harness = setupController({ recordCount: null });
    harness.controller.setPattern('Acme');
    await settle();
    expect(harness.snapshot().search.phase).toBe('settled');
  });

  it('keeps the results and a running search while the text changes, and asks for Enter', async () => {
    const harness = setupController({
      records: manyRecords(60),
      recordCount: LARGE,
    });
    let release: () => void = () => {};
    harness.cma.gatePages((query) =>
      query.page.offset >= 30
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined,
    );
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();
    await vi.advanceTimersByTimeAsync(400);
    expect(harness.snapshot().search.phase).toBe('searching');

    harness.controller.setPattern('Acme corp');
    expect(harness.snapshot().search.phase).toBe('searching');
    expect(harness.snapshot().findRow.awaitingEnter).toBe(true);

    harness.cma.gatePages(null);
    release();
    await settle();
    // The search for "Acme" ran to the end.
    expect(harness.snapshot().search.phase).toBe('settled');
    expect(harness.snapshot().records).toHaveLength(60);
    expect(harness.snapshot().primary).toMatchObject({
      enabled: false,
      reason: 'press_enter',
    });

    // Back to the text on screen: nothing to search.
    harness.controller.setPattern('Acme');
    expect(harness.snapshot().findRow.awaitingEnter).toBe(false);
  });

  it('re-runs the search on screen when a toggle changes, and waits for Enter otherwise', async () => {
    const harness = setupController({ recordCount: LARGE });
    await searchFor(harness, 'Acme');
    const settled = () => eventsOf(harness, 'searchSettled').length;
    const before = settled();

    harness.controller.setOption('caseSensitive', true);
    await settle();
    expect(settled()).toBe(before + 1);
    expect(harness.snapshot().search.phase).toBe('settled');
    expect(harness.snapshot().findRow.awaitingEnter).toBe(false);

    harness.controller.setPattern('Globex');
    harness.controller.setOption('wholeWord', true);
    await settle();
    expect(settled()).toBe(before + 1);
    expect(harness.snapshot().findRow.awaitingEnter).toBe(true);
  });

  it('clears everything when the text is emptied', async () => {
    const harness = setupController({ recordCount: LARGE });
    await searchFor(harness, 'Acme');
    harness.controller.setPattern('');
    expect(harness.snapshot().search.phase).toBe('idle');
    expect(harness.snapshot().records).toEqual([]);
    expect(harness.snapshot().findRow.awaitingEnter).toBe(false);
  });

  it('drops a pattern problem as soon as the text changes', async () => {
    const harness = setupController({ recordCount: LARGE });
    harness.controller.setOption('regex', true);
    await searchFor(harness, 'Acme(');
    expect(harness.snapshot().search.phase).toBe('invalid');

    harness.controller.setPattern('Acme()');
    expect(harness.snapshot().search.phase).toBe('idle');
    expect(harness.snapshot().findRow.awaitingEnter).toBe(true);
  });
});

describe('time left', () => {
  it('estimates the time left from the pace so far, once it has run for 5 s', async () => {
    const harness = setupController({ records: manyRecords(300) });
    harness.cma.gatePages(
      () => new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    );
    harness.controller.setPattern('Acme');
    harness.controller.searchNow();

    // Streamed progress reaches the snapshot within `emitIntervalMs`.
    await vi.advanceTimersByTimeAsync(3_500);
    expect(harness.snapshot().search.showProgress).toBe(true);
    expect(harness.snapshot().search.progress).toEqual({
      searched: 30,
      total: 300,
    });
    // Under 5 s: too early to tell.
    expect(harness.snapshot().search.secondsLeft).toBeNull();

    // The first page came in at 3 s, the 6 asked for with it at 6 s: 210 of
    // 300 records in 6 s, so the other 90 should take about 3 s.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(harness.snapshot().search.progress).toEqual({
      searched: 210,
      total: 300,
    });
    expect(harness.snapshot().search.secondsLeft).toBe(3);

    await settle();
    expect(harness.snapshot().search.secondsLeft).toBeNull();
  });
});

describe('"Search again" after a capped round reads on', () => {
  async function cappedRound(maxMatches = 40) {
    const harness = setupController({
      records: manyRecords(100),
      limits: { maxMatches },
    });
    const snapshot = await searchFor(harness, 'Acme');
    expect(snapshot.search.capped).toBe(true);
    harness.controller.setReplacementText('Nimbus');
    return harness;
  }

  it('reads on from where the capped search stopped', async () => {
    const harness = await cappedRound();
    expect(recordIds(harness).slice(-1)).toEqual(['m0040']);
    await replaceAll(harness);
    const pagesBefore = harness.cma.pageCalls('article').length;

    harness.controller.searchAgain();
    await settle();
    const again = harness.snapshot();

    // m0040 (offset 39) reached the cap: reading goes on 30 records before it.
    const offsets = harness.cma
      .pageCalls('article')
      .slice(pagesBefore)
      .map((query) => query.page.offset);
    expect(offsets[0]).toBe(9);
    expect(recordIds(harness)[0]).toBe('m0041');
    // Reading on proves nothing about the records it read past.
    expect(again.search).toMatchObject({
      capped: true,
      continued: true,
      followsRun: false,
    });
    expect(again.note).toEqual({
      kind: 'capped',
      selfMatch: false,
      continued: true,
    });
    expect(recordIds(harness).slice(-1)).toEqual(['m0080']);

    // And on again, to the end.
    await replaceAll(harness);
    harness.controller.searchAgain();
    await settle();
    expect(harness.snapshot().search).toMatchObject({
      capped: false,
      continued: true,
    });
    expect(recordIds(harness)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `m${String(81 + index).padStart(4, '0')}`,
      ),
    );

    // Everything replaced: the next "Search again" reads everything again.
    await replaceAll(harness);
    const pagesDone = harness.cma.pageCalls('article').length;
    harness.controller.searchAgain();
    await settle();
    expect(
      harness.cma.pageCalls('article').slice(pagesDone)[0]?.page.offset,
    ).toBe(0);
    expect(harness.snapshot().body).toBe('noResults');
  });

  it('does not bring back replaced records, even when the replacement matches again', async () => {
    const harness = await cappedRound();
    // "Acme" → "ACME" matches "Acme" again (case-insensitive search).
    harness.controller.setReplacementText('ACME');
    await replaceAll(harness);

    harness.controller.searchAgain();
    await settle();

    const ids = recordIds(harness);
    expect(ids[0]).toBe('m0041');
    expect(ids).not.toContain('m0039');
    expect(harness.snapshot().search.continued).toBe(true);
  });

  it('looks again at records that failed, and not at those left out', async () => {
    const harness = await cappedRound();
    harness.cma.failUpdates('m0005', [
      httpError(422, [{ code: 'VALIDATION_INVALID' }]),
    ]);
    harness.controller.setRecordIncluded('article:m0007', false);
    await replaceAll(harness);
    expect(harness.snapshot().run.phase).toBe('finished');

    harness.controller.searchAgain();
    await settle();

    const ids = recordIds(harness);
    expect(ids).toContain('m0005');
    expect(ids).not.toContain('m0007');
    expect(
      harness.cma.idCalls().some((query) => query.filter.ids === 'm0005'),
    ).toBe(true);
  });

  it('starts over after a stopped replacement', async () => {
    const harness = await cappedRound();
    const { plan } = harness.snapshot();
    if (!plan) throw new Error('Expected a plan');
    harness.controller.replace(plan.token);
    harness.controller.stopReplace();
    await settle();
    expect(harness.snapshot().run.phase).toBe('stopped');
    const pagesBefore = harness.cma.pageCalls('article').length;

    harness.controller.searchNow();
    await settle();

    expect(
      harness.cma.pageCalls('article').slice(pagesBefore)[0]?.page.offset,
    ).toBe(0);
    expect(harness.snapshot().search.continued).toBe(false);
  });

  it('starts over for different text', async () => {
    const harness = await cappedRound();
    await replaceAll(harness);
    const pagesBefore = harness.cma.pageCalls('article').length;

    harness.controller.setPattern('Nimbus');
    harness.controller.searchNow();
    await settle();

    expect(
      harness.cma.pageCalls('article').slice(pagesBefore)[0]?.page.offset,
    ).toBe(0);
    expect(harness.snapshot().search.continued).toBe(false);
  });

  it('starts over when the search was not capped', async () => {
    const harness = setupController({ records: acmeRecords() });
    await searchFor(harness, 'Acme');
    harness.controller.setReplacementText('Nimbus');
    harness.controller.setAllIncluded(true);
    await replaceAll(harness);
    harness.controller.searchAgain();
    await settle();
    expect(harness.snapshot().search.continued).toBe(false);
  });
});

describe('reading on: what the review found', () => {
  it('finds the matches the cap cut from a record, after that record was replaced', async () => {
    const harness = setupController({
      records: manyRecords(100, 3),
      limits: { maxMatches: 40 },
    });
    await searchFor(harness, 'Acme');
    // m0014 is shown with 1 of its 3 matches.
    const cut = harness
      .snapshot()
      .records.find((record) => record.recordId === 'm0014');
    expect(cut?.matchCount).toBe(1);
    harness.controller.setReplacementText('Nimbus');
    await replaceAll(harness);

    harness.controller.searchAgain();
    await settle();

    const again = harness
      .snapshot()
      .records.find((record) => record.recordId === 'm0014');
    expect(again?.matchCount).toBe(2);
  });

  it('never brings back records dealt with two rounds earlier', async () => {
    const harness = setupController({
      records: manyRecords(100, 2),
      limits: { maxMatches: 40 },
    });
    await searchFor(harness, 'Acme');
    // "Acme Inc" still matches "Acme".
    harness.controller.setReplacementText('Acme Inc');
    const seen = new Set(recordIds(harness));
    for (let round = 0; round < 3; round += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each round needs the one before it.
      await replaceAll(harness);
      harness.controller.searchAgain();
      await settle();
      const ids = recordIds(harness);
      expect(ids.filter((id) => seen.has(id))).toEqual([]);
      for (const id of ids) seen.add(id);
    }
  });

  it('says "No more matches" when reading on finds nothing, not that every match was replaced', async () => {
    const records = [
      ...manyRecords(40),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `z${index}`,
        modelId: 'article' as const,
        attributes: {
          title: `Other ${index}`,
          slug: `other-${index}`,
          body: 'Nothing here',
        },
      })),
    ];
    const harness = setupController({ records, limits: { maxMatches: 40 } });
    await searchFor(harness, 'Acme');
    harness.controller.setReplacementText('Nimbus');
    harness.controller.setRecordIncluded('article:m0005', false);
    await replaceAll(harness);

    harness.controller.searchAgain();
    await settle();

    const snapshot = harness.snapshot();
    expect(snapshot.body).toBe('noResults');
    expect(snapshot.noResults).toMatchObject({
      followsRun: false,
      continued: true,
    });
  });

  it('ignores Enter while a continued search is reading', async () => {
    const harness = await (async () => {
      const h = setupController({
        records: manyRecords(100),
        limits: { maxMatches: 40 },
      });
      await searchFor(h, 'Acme');
      h.controller.setReplacementText('Nimbus');
      await replaceAll(h);
      return h;
    })();
    harness.cma.gatePages(
      () => new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    );
    harness.controller.searchAgain();
    await vi.advanceTimersByTimeAsync(1_000);
    harness.controller.searchNow();
    harness.cma.gatePages(null);
    await settle();

    expect(harness.snapshot().search.continued).toBe(true);
    expect(recordIds(harness)[0]).toBe('m0041');
  });

  it('offers no "Try again" for failed models on capped results', async () => {
    const harness = setupController({
      records: [
        ...manyRecords(100),
        {
          id: 'p1',
          modelId: 'page',
          attributes: { title: 'Acme page', body: 'Acme' },
        },
      ],
      limits: { maxMatches: 40 },
    });
    harness.cma.failModel('page', httpError(500));
    await searchFor(harness, 'Acme');

    const { callouts } = harness.snapshot();
    expect(callouts).toEqual([
      { kind: 'modelsFailed', modelNames: ['Page'], retryable: false },
    ]);
    const pages = harness.cma.pageCalls('page').length;
    harness.controller.retryFailedModels();
    await settle();
    expect(harness.cma.pageCalls('page')).toHaveLength(pages);
  });

  it('shows no Enter hint after the search that ran fails', async () => {
    const harness = setupController({ recordCount: LARGE });
    for (const model of ['article', 'page', 'author']) {
      harness.cma.failModel(model, new TypeError('Failed to fetch'));
    }
    await searchFor(harness, 'Acme');
    expect(harness.snapshot().search.phase).toBe('failed');
    expect(harness.snapshot().findRow.awaitingEnter).toBe(false);
  });

  it('offers no "Search again" for text not searched yet', async () => {
    const harness = setupController({ recordCount: LARGE });
    await searchFor(harness, 'Acme');
    harness.controller.setReplacementText('Nimbus');
    harness.controller.setAllIncluded(true);
    await replaceAll(harness);
    expect(harness.snapshot().primary.kind).toBe('searchAgain');

    harness.controller.setPattern('Legal');
    expect(harness.snapshot().primary).toMatchObject({
      kind: 'replace',
      enabled: false,
      reason: 'press_enter',
    });
  });
});
