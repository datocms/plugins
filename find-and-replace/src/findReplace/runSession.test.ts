import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { literalTemplate } from '../replacement/replacementTemplate';
import type { RecordWriteOutcome } from '../replacement/replaceRecord';
import type { FindReplaceEvent, FindReplaceSnapshot } from './contract';
import {
  allMatches,
  eventsOf,
  httpError,
  manyRecords,
  recordByKey,
  replaceAll,
  searchFor,
  settle,
  setupController,
} from './findReplace.fixtures';
import { type PlannedRecord, RunSession } from './runSession';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

type UpdateBody = { meta: { current_version: string } } & Record<
  string,
  unknown
>;

/** Makes every update take `ms` and records how many ran at once. */
function slowUpdates(
  harness: ReturnType<typeof setupController>,
  ms: number,
): { maxInFlight: () => number } {
  const original = harness.cma.update.getMockImplementation();
  let inFlight = 0;
  let max = 0;
  harness.cma.update.mockImplementation(async (id: string, body: unknown) => {
    inFlight += 1;
    max = Math.max(max, inFlight);
    await new Promise((resolve) => setTimeout(resolve, ms));
    inFlight -= 1;
    return original?.(id, body);
  });
  return { maxInFlight: () => max };
}

function updatedIds(harness: ReturnType<typeof setupController>): string[] {
  return harness.cma.update.mock.calls.map(([id]) => id as string);
}

async function planGlobex(
  harness: ReturnType<typeof setupController>,
  pattern = 'acme',
): Promise<FindReplaceSnapshot> {
  await searchFor(harness, pattern);
  harness.controller.setReplacementText('Globex');
  return harness.snapshot();
}

describe('a run pass', () => {
  it('writes records one at a time, in display order, locked to each fresh read', async () => {
    const harness = setupController();
    await planGlobex(harness);
    const updates = slowUpdates(harness, 50);
    const frames: FindReplaceSnapshot[] = [];
    harness.controller.subscribe(() => frames.push(harness.snapshot()));

    expect(await replaceAll(harness)).toBe(true);

    expect(updatedIds(harness)).toEqual(['a1', 'a2', 'p1', 'p2']);
    expect(updates.maxInFlight()).toBe(1);
    expect(harness.cma.rawFind.mock.calls.map(([id]) => id)).toEqual([
      'a1',
      'a2',
      'p1',
      'p2',
    ]);
    for (const [id, body] of harness.cma.update.mock.calls) {
      expect((body as UpdateBody).meta.current_version).toBe(`${id}-v1`);
    }
    // The slug was left out: only the title and the body change.
    expect(harness.cma.records.get('a1')?.attributes).toMatchObject({
      title: 'Globex launches a widget',
      slug: 'acme-widget',
      body: 'Globex is great. Try Globex again',
    });

    const running = frames.find((frame) => frame.run.phase === 'running');
    expect(running?.findRow.enabled).toBe(false);
    expect(running?.selection.ui).toBe('disabled');
    expect(running?.modelFilter.enabled).toBe(false);
    expect(running?.primary).toEqual({
      kind: 'replace',
      verb: 'replace',
      count: 6,
      enabled: false,
      busy: true,
      reason: 'replacing',
    });
    expect(running?.meta).toEqual({
      kind: 'willChange',
      changing: 6,
      found: 7,
      verb: 'replace',
    });
    expect(running?.plan).toBeNull();
    const writingA2 = frames.find(
      (frame) =>
        frame.records.find((record) => record.key === 'article:a2')?.status
          .kind === 'writing',
    );
    expect(writingA2?.run.progress).toEqual({ done: 1, total: 4, updated: 1 });
    expect(writingA2 && recordByKey(writingA2, 'article:a1').status).toEqual({
      kind: 'replaced',
      replacedMatches: 3,
    });
    expect(harness.events.map((event) => event.type)).toEqual([
      'searchSettled',
      'runStarted',
      'runEnded',
    ]);
  });

  it('ends finished: a report of attempted records with "Search again"', async () => {
    const harness = setupController();
    await planGlobex(harness);
    harness.controller.setRecordIncluded('page:p2', false);
    await replaceAll(harness);
    const done = harness.snapshot();

    expect(done.run.phase).toBe('finished');
    expect(done.primary).toEqual({ kind: 'searchAgain', publish: null });
    expect(done.selection.ui).toBe('hidden');
    expect(done.records.map((record) => record.key)).toEqual([
      'article:a1',
      'article:a2',
      'page:p1',
    ]);
    const a1 = recordByKey(done, 'article:a1');
    expect(a1.title).toBe('Globex launches a widget');
    expect(a1.selectable).toBe(false);
    expect(a1.fields[0]?.matches[0]?.display).toEqual({
      kind: 'final',
      inserted: 'Globex',
    });
    // The slug was not part of the write.
    expect(a1.fields[1]?.matches[0]?.display).toEqual({ kind: 'highlight' });
    expect(done.meta).toEqual({
      kind: 'runFinished',
      verb: 'replace',
      replacedMatches: 5,
      skippedRecords: 0,
      failedRecords: 0,
      publishedRecords: 0,
    });
    expect(done.run.totals).toMatchObject({
      replacedMatches: 5,
      replacedRecords: 3,
      plannedRecords: 3,
      plannedMatches: 5,
    });
    const [ended] = eventsOf(harness, 'runEnded');
    expect(ended).toMatchObject({
      stopped: false,
      verb: 'replace',
      allFailedCause: null,
      pass: { replacedMatches: 5, replacedRecords: 3, notAttemptedRecords: 0 },
    });

    // The report is frozen.
    harness.controller.setReplacementText('Initech');
    const edited = harness.snapshot();
    expect(edited.records).toBe(done.records);
    expect(edited.primary).toEqual({ kind: 'searchAgain', publish: null });
  });

  it('never writes records whose included matches would not change', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setReplacementText('Acme');
    await replaceAll(harness);
    expect(updatedIds(harness)).toEqual(['a1', 'a2']);
    expect(harness.cma.rawFind.mock.calls.map(([id]) => id)).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('never writes records hidden by the model filter', async () => {
    const harness = setupController();
    await planGlobex(harness);
    harness.controller.setModelFilter('page');
    await replaceAll(harness);
    expect(updatedIds(harness)).toEqual(['p1', 'p2']);
  });

  it('stops after the record in flight, then resumes with the rest', async () => {
    const harness = setupController({ records: manyRecords(4) });
    await planGlobex(harness, 'Acme');
    slowUpdates(harness, 100);
    const { plan } = harness.snapshot();
    harness.controller.replace(plan?.token ?? '');
    await vi.advanceTimersByTimeAsync(50);
    harness.controller.stopReplace();
    expect(harness.snapshot().run.phase).toBe('stopping');
    await settle();

    const stopped = harness.snapshot();
    expect(updatedIds(harness)).toEqual(['m0001']);
    expect(stopped.run.phase).toBe('stopped');
    expect(stopped.records.map((record) => record.key)).toEqual([
      'article:m0002',
      'article:m0003',
      'article:m0004',
      'article:m0001',
    ]);
    expect(recordByKey(stopped, 'article:m0002')).toMatchObject({
      status: { kind: 'untouched' },
      selectable: true,
    });
    expect(recordByKey(stopped, 'article:m0001').selectable).toBe(false);
    expect(stopped.primary).toEqual({
      kind: 'replace',
      verb: 'replace',
      count: 3,
      enabled: true,
    });
    expect(stopped.meta).toEqual({
      kind: 'runStopped',
      verb: 'replace',
      replacedMatches: 1,
      plannedMatches: 4,
    });
    expect(stopped.selection.ui).toBe('enabled');
    expect(eventsOf(harness, 'runEnded')[0]).toMatchObject({
      stopped: true,
      pass: { replacedRecords: 1, notAttemptedRecords: 3, plannedRecords: 4 },
    });

    // The untouched rows follow the replacement; the attempted one doesn't.
    harness.controller.setReplacementText('Initech');
    const edited = harness.snapshot();
    expect(recordByKey(edited, 'article:m0001')).toBe(
      recordByKey(stopped, 'article:m0001'),
    );
    expect(
      recordByKey(edited, 'article:m0002').fields[0]?.matches[0]?.display,
    ).toEqual({ kind: 'diff', inserted: 'Initech' });

    await replaceAll(harness);
    expect(updatedIds(harness)).toEqual(['m0001', 'm0002', 'm0003', 'm0004']);
    const finished = harness.snapshot();
    expect(finished.run.phase).toBe('finished');
    expect(finished.run.totals).toMatchObject({
      replacedMatches: 4,
      replacedRecords: 4,
      plannedRecords: 4,
      notAttemptedRecords: 0,
    });
    expect(harness.cma.records.get('m0004')?.attributes).toMatchObject({
      body: 'Initech',
    });
  });

  it('reports stale, invalid and network failures, and retries only the retryable one', async () => {
    const harness = setupController();
    await planGlobex(harness);
    // Someone edits a selected field value of a2 after the search.
    harness.cma.edit('a2', { body: 'Use ACME with care' });
    // A field of a1 outside the write changes (its slug was left out): a1 is
    // still replaced, and the edit is kept.
    harness.cma.edit('a1', { slug: 'acme-widget-2' });
    harness.cma.failUpdates('p1', [
      httpError(422, [
        {
          code: 'INVALID_FIELD',
          details: { field_id: 'page-body', code: 'VALIDATION_LENGTH' },
        },
      ]),
    ]);
    harness.cma.failUpdates('p2', [new TypeError('Failed to fetch')]);
    await replaceAll(harness);
    const done = harness.snapshot();

    expect(done.records.map((record) => [record.key, record.status])).toEqual([
      [
        'page:p1',
        {
          kind: 'failed',
          reason: 'validation',
          retryable: false,
          detail: { fieldLabel: 'Body', code: 'length' },
        },
      ],
      [
        'page:p2',
        { kind: 'failed', reason: 'network', retryable: true, detail: null },
      ],
      ['article:a2', { kind: 'skipped', reason: 'stale' }],
      ['article:a1', { kind: 'replaced', replacedMatches: 3 }],
    ]);
    expect(harness.cma.records.get('a1')?.attributes).toMatchObject({
      title: 'Globex launches a widget',
      slug: 'acme-widget-2',
      body: 'Globex is great. Try Globex again',
    });
    expect(recordByKey(done, 'page:p1').fields[0]?.matches[0]?.display).toEqual(
      { kind: 'diff', inserted: 'Globex' },
    );
    expect(done.callouts).toEqual([
      {
        kind: 'recordsFailed',
        count: 2,
        retryable: true,
        singleReason: null,
      },
      { kind: 'recordsSkipped', count: 1, allStale: true },
    ]);
    expect(done.meta).toEqual({
      kind: 'runFinished',
      verb: 'replace',
      replacedMatches: 3,
      skippedRecords: 1,
      failedRecords: 2,
      publishedRecords: 0,
    });

    harness.controller.setReplacementText('Initech');
    harness.cma.update.mockClear();
    harness.controller.retryFailedRecords();
    await settle();
    expect(updatedIds(harness)).toEqual(['p2']);
    expect(harness.cma.records.get('p2')?.attributes).toMatchObject({
      body: 'Globex Corp, legal',
    });
    const retried = harness.snapshot();
    expect(recordByKey(retried, 'page:p2').status).toEqual({
      kind: 'replaced',
      replacedMatches: 1,
    });
    expect(retried.run.totals).toMatchObject({
      replacedMatches: 4,
      replacedRecords: 2,
      failedRecords: 1,
      retryableFailedRecords: 0,
      skippedRecords: 1,
      staleSkippedRecords: 1,
    });
    expect(retried.callouts[0]).toEqual({
      kind: 'recordsFailed',
      count: 1,
      retryable: false,
      singleReason: 'validation',
    });
    const passes = eventsOf(harness, 'runEnded');
    expect(passes[1]?.pass).toMatchObject({
      replacedRecords: 1,
      plannedRecords: 1,
      plannedMatches: 1,
    });
  });

  it('updates the report in place on "Try again": no strip, no "Select all", same records and callouts', async () => {
    const harness = setupController();
    await planGlobex(harness);
    harness.controller.setRecordIncluded('page:p1', false);
    harness.cma.edit('a2', { body: 'Use ACME with care' });
    harness.cma.failUpdates('p2', [new TypeError('Failed to fetch')]);
    harness.cma.failModel('author', new TypeError('Failed to fetch'));
    await replaceAll(harness);
    const report = harness.snapshot();
    expect(report.run.phase).toBe('finished');
    expect(report.selection.ui).toBe('hidden');
    const reportKeys = report.records.map((record) => record.key);
    expect(reportKeys).not.toContain('page:p1');

    slowUpdates(harness, 50);
    const frames: FindReplaceSnapshot[] = [];
    harness.controller.subscribe(() => frames.push(harness.snapshot()));
    harness.controller.retryFailedRecords();
    await settle();

    const running = frames.filter((frame) => frame.run.phase === 'running');
    expect(running.length).toBeGreaterThan(0);
    for (const frame of running) {
      expect(frame.selection.ui).toBe('hidden');
      expect(frame.records.map((record) => record.key)).toEqual(reportKeys);
      expect(frame.callouts).toEqual(report.callouts);
      expect(frame.meta).toEqual(report.meta);
    }
    const retried = harness.snapshot();
    expect(retried.run.phase).toBe('finished');
    expect(recordByKey(retried, 'page:p2').status.kind).toBe('replaced');
    expect(retried.callouts).toEqual([
      { kind: 'recordsSkipped', count: 1, allStale: true },
    ]);
  });

  it('keeps "Select all" and the callouts as they were while a pass runs', async () => {
    const harness = setupController();
    await planGlobex(harness);
    // The slug is left out by default: "Select all" is indeterminate.
    expect(harness.snapshot().selection.all).toBe('some');
    slowUpdates(harness, 50);
    const frames: FindReplaceSnapshot[] = [];
    harness.controller.subscribe(() => frames.push(harness.snapshot()));
    await replaceAll(harness);

    const running = frames.filter(
      (frame) =>
        frame.run.phase === 'running' || frame.run.phase === 'stopping',
    );
    // Past the first record (the one with the slug) too.
    expect(running.some((frame) => frame.run.progress.done >= 2)).toBe(true);
    for (const frame of running) {
      expect(frame.selection).toEqual({ ui: 'disabled', all: 'some' });
    }
  });

  it('reports a retried update that had landed as replaced, without writing it again', async () => {
    const harness = setupController();
    await planGlobex(harness);
    const update = harness.cma.update.getMockImplementation();
    // The update of a2 lands, but the answer is a gateway error.
    harness.cma.update.mockImplementation(async (id: string, body: unknown) => {
      const result = await update?.(id, body);
      if (id === 'a2') throw httpError(502);
      return result;
    });
    await replaceAll(harness);
    expect(recordByKey(harness.snapshot(), 'article:a2').status).toMatchObject({
      kind: 'failed',
      retryable: true,
    });
    expect(harness.cma.records.get('a2')?.attributes).toMatchObject({
      body: 'Use Globex carefully',
    });

    harness.cma.update.mockClear();
    if (update) harness.cma.update.mockImplementation(update);
    harness.controller.retryFailedRecords();
    await settle();
    const retried = harness.snapshot();
    expect(updatedIds(harness)).toEqual([]);
    expect(recordByKey(retried, 'article:a2')).toMatchObject({
      status: { kind: 'replaced', replacedMatches: 1 },
      title: 'Brand guidelines',
    });
    expect(retried.callouts).toEqual([]);
    expect(retried.meta).toMatchObject({
      kind: 'runFinished',
      replacedMatches: 6,
      skippedRecords: 0,
      failedRecords: 0,
    });
  });

  it('writes a retried record whose earlier update did not land', async () => {
    const harness = setupController();
    await planGlobex(harness);
    harness.cma.failUpdates('a2', [httpError(503)]);
    await replaceAll(harness);
    harness.cma.update.mockClear();
    harness.controller.retryFailedRecords();
    await settle();
    expect(updatedIds(harness)).toEqual(['a2']);
    expect(recordByKey(harness.snapshot(), 'article:a2').status.kind).toBe(
      'replaced',
    );
  });

  it('flags a pass where every record failed on permissions', async () => {
    const harness = setupController();
    await planGlobex(harness);
    for (const id of ['a1', 'a2', 'p1', 'p2']) {
      harness.cma.failUpdates(id, [httpError(403)]);
    }
    await replaceAll(harness);
    expect(eventsOf(harness, 'runEnded')[0]?.allFailedCause).toBe('permission');
    expect(harness.snapshot().callouts[0]).toEqual({
      kind: 'recordsFailed',
      count: 4,
      retryable: false,
      singleReason: 'permission',
    });
  });

  it('reports a record deleted since the search as skipped', async () => {
    const harness = setupController();
    await planGlobex(harness);
    harness.cma.remove('p1');
    await replaceAll(harness);
    expect(recordByKey(harness.snapshot(), 'page:p1').status).toEqual({
      kind: 'skipped',
      reason: 'deleted',
    });
    expect(harness.snapshot().callouts).toEqual([
      { kind: 'recordsSkipped', count: 1, allStale: false },
    ]);
  });

  it('guards against closing the tab while a pass runs', async () => {
    const harness = setupController();
    await planGlobex(harness);
    const { plan } = harness.snapshot();
    harness.controller.replace(plan?.token ?? '');
    expect(harness.unload.addEventListener).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function),
    );
    const [, listener] = harness.unload.addEventListener.mock.calls[0] ?? [];
    const event = new Event('beforeunload', { cancelable: true });
    (listener as (event: Event) => void)(event);
    expect(event.defaultPrevented).toBe(true);

    await settle();
    expect(harness.unload.removeEventListener).toHaveBeenCalledWith(
      'beforeunload',
      listener,
    );
  });

  it('stops writing and removes the guard on dispose', async () => {
    const harness = setupController();
    await planGlobex(harness);
    slowUpdates(harness, 100);
    const { plan } = harness.snapshot();
    harness.controller.replace(plan?.token ?? '');
    await vi.advanceTimersByTimeAsync(10);
    expect(harness.cma.update).toHaveBeenCalledTimes(1);

    harness.controller.dispose();
    expect(harness.unload.removeEventListener).toHaveBeenCalled();
    const version = harness.snapshot().version;
    await settle();
    expect(harness.cma.update).toHaveBeenCalledTimes(1);
    expect(harness.cma.rawFind).toHaveBeenCalledTimes(1);
    expect(harness.snapshot().version).toBe(version);
  });

  it('shows "Every match has been replaced." when "Search again" finds nothing', async () => {
    const harness = setupController();
    await planGlobex(harness);
    harness.controller.setAllIncluded(true);
    await replaceAll(harness);
    harness.controller.searchAgain();
    await settle();
    const again = harness.snapshot();
    expect(again.run.phase).toBe('none');
    expect(again.search.followsRun).toBe(true);
    expect(again.body).toBe('noResults');
    expect(again.noResults?.followsRun).toBe(true);
    expect(again.noResults?.runVerb).toBe('replace');
    expect(again.meta).toEqual({ kind: 'noMatches' });
    expect(allMatches(again)).toEqual([]);
  });

  it('says the finished session removed the matches after a "Replace with nothing" run', async () => {
    const harness = setupController();
    await searchFor(harness, 'acme');
    harness.controller.setRemove(true);
    harness.controller.setAllIncluded(true);
    await replaceAll(harness);
    harness.controller.searchAgain();
    await settle();
    const again = harness.snapshot();
    expect(again.run.phase).toBe('none');
    expect(again.noResults).toMatchObject({
      followsRun: true,
      runVerb: 'remove',
    });
  });
});

describe('RunSession', () => {
  function planned(key: string, matches: number): PlannedRecord {
    const inserted = new Map(
      Array.from({ length: matches }, (_, index) => [`${key}#${index}`, 'x']),
    );
    return {
      key,
      recordId: key,
      modelId: 'article',
      entries: [],
      inserted,
      inclusion: new Map([...inserted.keys()].map((match) => [match, true])),
    };
  }

  function session(outcomes: Record<string, RecordWriteOutcome[]>) {
    const events: FindReplaceEvent[] = [];
    const ended: string[][] = [];
    const run = new RunSession({
      write: async (record) =>
        outcomes[record.key]?.shift() ?? {
          status: 'replaced',
          replacedMatches: record.inserted.size,
          freshTitle: null,
          publication: { statusBefore: 'published', versionAfter: 'v2' },
        },
      unloadTarget: null,
      hooks: {
        changed: () => undefined,
        event: (event) => events.push(event),
        passEnded: (end) =>
          ended.push(end.attempted.map((record) => record.key)),
      },
    });
    return { run, events, ended };
  }

  it('accumulates totals over "Try again" passes', async () => {
    const network: RecordWriteOutcome = {
      status: 'failed',
      reason: 'network',
      retryable: true,
      detail: null,
    };
    const { run, events, ended } = session({ b: [network] });
    run.start({
      verb: 'replace',
      template: literalTemplate('x'),
      find: null,
      records: [planned('a', 2), planned('b', 3)],
    });
    await vi.runAllTimersAsync();
    expect(run.phase).toBe('finished');
    expect(run.totals()).toMatchObject({
      replacedMatches: 2,
      failedRecords: 1,
      retryableFailedRecords: 1,
      plannedMatches: 5,
    });

    expect(run.retry(['a', 'b'])).toBe(true);
    await vi.runAllTimersAsync();
    expect(ended).toEqual([['a', 'b'], ['b']]);
    expect(run.totals()).toMatchObject({
      replacedMatches: 5,
      replacedRecords: 2,
      failedRecords: 0,
      plannedRecords: 2,
      plannedMatches: 5,
    });
    expect(events.filter((event) => event.type === 'runStarted')).toHaveLength(
      2,
    );
    expect(run.retry(['a', 'b'])).toBe(false);
  });

  it('refuses an empty plan and a second pass while one runs', () => {
    const { run } = session({});
    const template = literalTemplate('x');
    expect(
      run.start({ verb: 'replace', template, find: null, records: [] }),
    ).toBe(false);
    expect(
      run.start({
        verb: 'replace',
        template,
        find: null,
        records: [planned('a', 1)],
      }),
    ).toBe(true);
    expect(
      run.start({
        verb: 'replace',
        template,
        find: null,
        records: [planned('b', 1)],
      }),
    ).toBe(false);
  });
});
