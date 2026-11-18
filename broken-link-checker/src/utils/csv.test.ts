import { describe, expect, it, vi } from 'vitest';
import { prepareUrl } from '../checking/url';
import type { ScanReport } from '../types';
import {
  downloadReport,
  loadRecordTitles,
  reportCsv,
  reportCsvRows,
  reportRecordIds,
} from './csv';

function report(): ScanReport {
  const prepared = prepareUrl('https://example.com/page?x=1#heading');
  return {
    state: 'partial',
    startedAt: '2026-09-23T12:00:00.000Z',
    finishedAt: '2026-09-23T12:01:00.000Z',
    discovering: false,
    scope: 'Articles',
    recordsScanned: 1,
    warnings: ['Some records could not be read.'],
    groups: [
      {
        key: prepared.key,
        prepared,
        stale: true,
        result: {
          key: prepared.key,
          url: prepared.url,
          status: 'broken',
          httpStatus: 404,
          message: 'HTTP 404',
          checkedAt: '2026-09-23T12:00:30.000Z',
          method: 'GET',
        },
        occurrences: [
          {
            id: 'one',
            recordId: 'record-1',
            modelId: 'model-1',
            modelName: 'Articles',
            fieldPath: 'body',
            fieldLabel: 'Body "copy"\nnext line',
            locale: 'fr',
            blockPath: ['Section 1', 'Body'],
            url: 'https://example.com/page?x=1#heading',
          },
        ],
      },
    ],
  };
}

describe('reportCsv', () => {
  it('exports the original location, result and incomplete/stale state with valid CSV escaping', () => {
    const csv = reportCsv(report(), new Map([['record-1', 'One, "two"']]));
    expect(csv.startsWith('\uFEFF"URL","Status"')).toBe(true);
    expect(csv).toContain(
      '"https://example.com/page?x=1#heading","broken","404"',
    );
    expect(csv).toContain('"One, ""two"""');
    expect(csv).toContain('"Body ""copy""\nnext line"');
    expect(csv).toContain('"fr","Section 1 → Body","Yes","partial"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it.each([
    '=SUM(1,1)',
    '+1',
    '-1',
    '@title',
    '  =SUM(1,1)',
    '\t+1',
    '\r-1',
  ])('exports formula-like record titles as text: %s', (title) => {
    expect(reportCsv(report(), new Map([['record-1', title]]))).toContain(
      `"'${title}"`,
    );
  });

  it('exports one row per occurrence, including shared URLs from different records', () => {
    const source = report();
    source.groups[0].occurrences.push({
      ...source.groups[0].occurrences[0],
      id: 'two',
      recordId: 'record-2',
    });
    const csv = reportCsv(source);
    expect(csv.match(/https:\/\/example.com\/page/g)).toHaveLength(2);
    expect(csv).toContain('"record-1"');
    expect(csv).toContain('"record-2"');
  });

  it('leaves the title empty for a record that the host does not present', () => {
    const csv = reportCsv(report(), new Map([['other', 'Other']]));
    expect(csv).toContain('"2026-09-23T12:00:30.000Z","","record-1"');
  });

  it('walks rows lazily without reading later URL groups up front', () => {
    const source = report();
    const entry = source.groups[0];
    let reads = 0;
    source.groups.push({
      ...entry,
      get occurrences() {
        reads += 1;
        return entry.occurrences;
      },
    });
    const rows = reportCsvRows(source);
    expect(rows.next().value).toMatch(/^\uFEFF"URL"/);
    expect(reads).toBe(0);
    expect(rows.next().value).toContain('"record-1"');
    expect(reads).toBe(0);
    expect(rows.next().value).toContain('"record-1"');
    expect(reads).toBe(1);
  });

  it('releases the object URL even when the browser rejects the download click', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:test-report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {
        throw new Error('Download blocked');
      });
    try {
      await expect(downloadReport(report())).rejects.toThrow(
        'Download blocked',
      );
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-report');
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('loadRecordTitles', () => {
  it('asks the host in steps of 500 records, and skips the records that are gone', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `r${index}`);
    const load = vi.fn(async (batch: string[]) =>
      batch.map((id) =>
        id === 'r1' ? null : { id, title: `Title ${id}`, image: null },
      ),
    );
    const titles = await loadRecordTitles(ids, load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0]).toEqual(['r500']);
    expect(titles.get('r0')).toBe('Title r0');
    expect(titles.has('r1')).toBe(false);
    expect(titles.get('r500')).toBe('Title r500');
  });
});

describe('reportRecordIds', () => {
  it('names each saved record once', () => {
    const source = report();
    source.groups[0].occurrences.push(
      { ...source.groups[0].occurrences[0], id: 'again' },
      {
        ...source.groups[0].occurrences[0],
        id: 'unsaved',
        recordId: undefined,
      },
    );
    expect(reportRecordIds(source)).toEqual(['record-1']);
  });
});
