import { describe, expect, it } from 'vitest';
import type { ProgressUpdate } from './translation/ItemsDropdownUtils';
import { buildTranslationReportRows, toCsv } from './csvExport';

describe('toCsv', () => {
  it('joins headers and rows with CRLF', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', '2'],
          ['3', '4'],
        ],
      ),
    ).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    expect(toCsv(['x'], [['a,b']])).toBe('x\r\n"a,b"');
    expect(toCsv(['x'], [['he said "hi"']])).toBe('x\r\n"he said ""hi"""');
    expect(toCsv(['x'], [['line1\nline2']])).toBe('x\r\n"line1\nline2"');
  });

  it('treats null/undefined as empty strings', () => {
    expect(toCsv(['x', 'y'], [[null, undefined]])).toBe('x,y\r\n,');
  });

  it('neutralizes leading formula characters (CSV injection)', () => {
    expect(toCsv(['x'], [['=SUM(A1:A2)']])).toBe("x\r\n'=SUM(A1:A2)");
    expect(toCsv(['x'], [['+1']])).toBe("x\r\n'+1");
    expect(toCsv(['x'], [['-cmd']])).toBe("x\r\n'-cmd");
    expect(toCsv(['x'], [['@foo']])).toBe("x\r\n'@foo");
    // combined with quoting when the value also contains a comma
    expect(toCsv(['x'], [['=a,b']])).toBe('x\r\n"\'=a,b"');
    // ordinary values are untouched
    expect(toCsv(['x'], [['Hello']])).toBe('x\r\nHello');
  });
});

describe('buildTranslationReportRows', () => {
  const opts = {
    fromLocale: 'en',
    toLocales: ['it', 'fr'],
    buildUrl: (u: ProgressUpdate) => `https://x/${u.recordId}`,
  };

  it('maps statuses and columns for finished records', () => {
    const updates: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: 'r1',
        status: 'completed',
        recordLabel: 'A',
        itemTypeId: 'm1',
        updatedAt: '2026-07-08T21:00:00.000Z',
        translatedFieldApiKeys: ['title'],
        translatedFieldIds: ['f1'],
        copiedLinkFieldApiKeys: ['related'],
        copiedLinkFieldIds: ['f2'],
        warnings: ['copied refs'],
      },
      {
        recordIndex: 1,
        recordId: 'r2',
        status: 'completed',
        recordLabel: 'B',
        translatedFieldApiKeys: ['title'],
      },
      {
        recordIndex: 2,
        recordId: 'r3',
        status: 'error',
        recordLabel: 'C',
        warnings: ['boom'],
      },
    ];

    const { headers, rows } = buildTranslationReportRows(updates, opts);
    const col = (name: string) => headers.indexOf(name);

    expect(rows).toHaveLength(3);
    // r1: completed + warnings → warning
    expect(rows[0][col('status')]).toBe('warning');
    expect(rows[0][col('record_id')]).toBe('r1');
    expect(rows[0][col('title')]).toBe('A');
    expect(rows[0][col('edit_url')]).toBe('https://x/r1');
    expect(rows[0][col('source_locale')]).toBe('en');
    expect(rows[0][col('target_locales')]).toBe('it, fr');
    expect(rows[0][col('updated_at')]).toBe('2026-07-08T21:00:00.000Z');
    expect(rows[0][col('translated_field_api_keys')]).toBe('title');
    expect(rows[0][col('translated_field_ids')]).toBe('f1');
    expect(rows[0][col('copied_link_field_api_keys')]).toBe('related');
    expect(rows[0][col('copied_link_field_ids')]).toBe('f2');
    expect(rows[0][col('notes')]).toBe('copied refs');
    // r2: completed, no warnings → success
    expect(rows[1][col('status')]).toBe('success');
    // r3: error → failure
    expect(rows[2][col('status')]).toBe('failure');
  });

  it('skips in-progress updates', () => {
    const updates: ProgressUpdate[] = [
      { recordIndex: 0, recordId: 'r1', status: 'processing' },
    ];
    const { rows } = buildTranslationReportRows(updates, opts);
    expect(rows).toHaveLength(0);
  });

  it('emits a "warning" row for the completed-with-warnings status', () => {
    // The bulk emitter reports warned successes (QC warning or copied reference)
    // as `completed-with-warnings`. Such records must appear in the report — they
    // are the "which records warned and why" rows the export exists to surface.
    const updates: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: 'r1',
        status: 'completed-with-warnings',
        recordLabel: 'A',
        copiedLinkFieldApiKeys: ['related'],
        warnings: ['Copied linked records in "related" into it.'],
      },
    ];
    const { headers, rows } = buildTranslationReportRows(updates, opts);
    const col = (name: string) => headers.indexOf(name);
    expect(rows).toHaveLength(1);
    expect(rows[0][col('status')]).toBe('warning');
    expect(rows[0][col('copied_link_field_api_keys')]).toBe('related');
    expect(rows[0][col('notes')]).toContain('related');
  });
});
