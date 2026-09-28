import { describe, expect, it } from 'vitest';
import { prepareUrl } from '../checking/url';
import type { ScanReport } from '../types';
import { reportCsv } from './csv';

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
});
