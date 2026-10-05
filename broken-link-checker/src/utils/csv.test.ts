import { describe, expect, it, vi } from 'vitest';
import { prepareUrl } from '../checking/url';
import type { ScanReport } from '../types';
import { downloadReport, reportCsv, reportCsvRows } from './csv';

function report(title = 'Article'): ScanReport {
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
            recordTitle: title,
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
    const csv = reportCsv(report('One, "two"'));
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
    expect(reportCsv(report(title))).toContain(`"'${title}"`);
  });

  it('exports one row per occurrence, including shared URLs from different records', () => {
    const source = report();
    source.groups[0].occurrences.push({
      ...source.groups[0].occurrences[0],
      id: 'two',
      recordId: 'record-2',
      recordTitle: 'Second record',
    });
    const csv = reportCsv(source);
    expect(csv.match(/https:\/\/example.com\/page/g)).toHaveLength(2);
    expect(csv).toContain('"record-1"');
    expect(csv).toContain('"record-2"');
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
