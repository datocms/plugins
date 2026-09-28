import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupFacts } from '../report/view';
import type { ExtractionResult, LinkOccurrence, ScanReport } from '../types';
import { flushDelay, ScanSession } from './session';

function occurrence(
  url: string,
  id: string,
  recordId = 'record-1',
): LinkOccurrence {
  return {
    id,
    recordId,
    recordTitle: `Record ${recordId}`,
    modelId: 'model-1',
    modelName: 'Article',
    fieldPath: 'body',
    fieldLabel: 'Body',
    locale: 'en',
    blockPath: [],
    url,
  };
}

function extraction(
  occurrences: LinkOccurrence[],
  warnings: string[] = [],
): ExtractionResult {
  return { occurrences, warnings };
}

function fixture() {
  const reports: ScanReport[] = [];
  const controller = new AbortController();
  const session = new ScanSession('Articles', controller.signal, (report) =>
    reports.push(report),
  );
  return {
    session,
    controller,
    reports,
    latest: () => reports[reports.length - 1],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ScanSession', () => {
  it('deduplicates page fragments across records while keeping distinct queries and every occurrence', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchRequest);
    const { session, latest } = fixture();
    session.addRecord(
      extraction([
        occurrence('https://EXAMPLE.com:443/article#one', 'one'),
        occurrence('https://example.com/article?locale=en', 'two'),
      ]),
    );
    session.addRecord(
      extraction([
        occurrence('https://example.com/article#two', 'three', 'record-2'),
        occurrence('https://example.com/article?locale=fr', 'four', 'record-2'),
      ]),
    );
    await session.finish();
    expect(fetchRequest).toHaveBeenCalledTimes(3);
    expect(latest()).toMatchObject({
      state: 'complete',
      discovering: false,
      recordsScanned: 2,
    });
    expect(latest().groups).toHaveLength(3);
    expect(
      latest().groups.find(
        (group) => group.key === 'https://example.com/article',
      )?.occurrences,
    ).toHaveLength(2);
    expect(
      latest().groups.every((group) => group.result.status === 'reachable'),
    ).toBe(true);
    expect(latest().finishedAt).toBeDefined();
    session.dispose();
  });

  it('retains invalid and skipped locations without passing them to the proxy', async () => {
    const fetchRequest = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchRequest);
    const { session, latest } = fixture();
    session.addRecord(
      extraction([
        occurrence('/relative', 'one'),
        occurrence('https://', 'two'),
        occurrence('http://127.0.0.1', 'three'),
      ]),
    );
    await session.finish();
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(latest().groups.map((group) => group.result.status)).toEqual([
      'skipped',
      'invalid',
      'skipped',
    ]);
    expect(latest().state).toBe('complete');
    session.dispose();
  });

  it('preserves reading warnings and marks a completed partial read as incomplete', async () => {
    const { session, latest } = fixture();
    session.addRecord(extraction([], ['An embedded block could not be read.']));
    session.warn('A page of records could not be read.');
    session.warn('A page of records could not be read.');
    await session.finish();
    expect(latest()).toMatchObject({ state: 'partial', recordsScanned: 1 });
    expect(latest().warnings).toEqual([
      'An embedded block could not be read.',
      'A page of records could not be read.',
    ]);
    session.dispose();
  });

  it('finishes cancellation with every discovered URL settled and ignores subsequent records', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchRequest);
    const { session, controller, latest } = fixture();
    session.addRecord(
      extraction([
        occurrence('https://example.com/one', 'one'),
        occurrence('https://example.com/two', 'two'),
      ]),
    );
    controller.abort();
    session.addRecord(
      extraction([occurrence('https://other.example/three', 'three')]),
    );
    await session.finish();
    expect(latest()).toMatchObject({
      state: 'cancelled',
      recordsScanned: 1,
      discovering: false,
    });
    expect(latest().groups.map((group) => group.result.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    session.dispose();
  });

  it('marks cancellation even when all discovered URLs already finished', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchRequest);
    const { session, controller, latest } = fixture();
    session.addRecord(extraction([occurrence('https://example.com/', 'one')]));
    await vi.waitFor(() => {
      session.flush();
      expect(latest().groups[0].result.status).toBe('reachable');
    });
    controller.abort();
    await session.finish();
    expect(latest().state).toBe('cancelled');
    expect(latest().groups[0].result.status).toBe('reachable');
    session.dispose();
  });

  it('does not mutate a previously delivered report when appending occurrences', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchRequest);
    const { session, latest } = fixture();
    session.addRecord(extraction([occurrence('https://example.com/', 'one')]));
    session.flush();
    const earlier = latest();
    session.addRecord(
      extraction([occurrence('https://example.com/', 'two', 'record-2')]),
    );
    await session.finish();
    expect(earlier.recordsScanned).toBe(1);
    expect(earlier.groups[0].occurrences).toHaveLength(1);
    expect(latest().groups[0].occurrences).toHaveLength(2);
    session.dispose();
  });

  it('reuses unchanged groups between reports and copies a group that grows', () => {
    const { session, latest } = fixture();
    session.addRecord(
      extraction([occurrence('/one', 'one'), occurrence('/two', 'two')]),
    );
    session.flush();
    const [one, two] = latest().groups;
    session.addRecord(extraction([occurrence('/one', 'three', 'record-2')]));
    session.flush();
    const [grown, unchanged] = latest().groups;
    expect(unchanged).toBe(two);
    expect(grown).not.toBe(one);
    expect(one.occurrences.map((entry) => entry.id)).toEqual(['one']);
    expect(grown.occurrences.map((entry) => entry.id)).toEqual([
      'one',
      'three',
    ]);
    // The facts the session collected match facts read from scratch.
    expect(groupFacts(grown)).toEqual(
      groupFacts({ ...grown, occurrences: [...grown.occurrences] }),
    );
    expect(groupFacts(grown).recordCount).toBe(2);
    session.dispose();
  });

  it('keeps the occurrences array of a group whose check result changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 })),
    );
    const { session, latest } = fixture();
    session.addRecord(extraction([occurrence('https://example.com/', 'one')]));
    session.flush();
    const before = latest().groups[0];
    await vi.waitFor(() => {
      session.flush();
      expect(latest().groups[0].result.status).toBe('reachable');
    });
    expect(latest().groups[0]).not.toBe(before);
    expect(latest().groups[0].occurrences).toBe(before.occurrences);
    await session.finish();
    session.dispose();
  });

  it('publishes large reports less often', () => {
    expect(flushDelay(0)).toBe(80);
    expect(flushDelay(50_000)).toBe(80);
    expect(flushDelay(500_000)).toBe(500);
    expect(flushDelay(50_000_000)).toBe(2_000);
  });

  it('waits longer before publishing a report that has grown large', () => {
    vi.useFakeTimers();
    const { session, reports } = fixture();
    session.addRecord(
      extraction(
        Array.from({ length: 200_000 }, (_, i) =>
          occurrence('/everywhere', `link-${i}`),
        ),
      ),
    );
    vi.advanceTimersByTime(199);
    expect(reports).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(reports).toHaveLength(1);
    expect(reports[0].groups[0].occurrences).toHaveLength(200_000);
    session.dispose();
  });
});
