/**
 * Tests for the bulk-translation report builder/serializers. These turn the
 * per-record ProgressUpdate stream into a flat, exportable list of "which
 * record failed and why" — the customer's explicit ask for a bulk report. One
 * row per QC reason (or per record when a record carries only a save error).
 */

import { describe, expect, it } from 'vitest';
import {
  buildBulkReportRows,
  toBulkReportCsv,
  toBulkReportJson,
} from './bulkReport';
import type { ProgressUpdate } from './ItemsDropdownUtils';

describe('buildBulkReportRows', () => {
  it('omits clean completed records', () => {
    const progress: ProgressUpdate[] = [
      { recordIndex: 0, recordId: '1', status: 'completed', message: 'ok' },
      { recordIndex: 1, recordId: '2', status: 'processing', message: '…' },
    ];
    expect(buildBulkReportRows(progress)).toEqual([]);
  });

  it('expands a record into one row per structured QC flag', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '42',
        status: 'error',
        message: 'Translated "Hotel" (#42) but 2 value(s) may be incomplete.',
        qcFlags: [
          {
            checkId: 'length-validator',
            severity: 'error',
            fieldPath: 'title',
            locale: 'fr',
            message: 'Translation is 80 characters but the field allows at most 60.',
          },
          {
            checkId: 'truncated',
            severity: 'error',
            fieldPath: 'body',
            locale: 'fr',
            message: 'Provider cut the response off.',
          },
        ],
      },
    ];

    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      recordId: '42',
      status: 'error',
      fieldPath: 'title',
      locale: 'fr',
      severity: 'error',
      checkId: 'length-validator',
    });
    expect(rows[1]).toMatchObject({ fieldPath: 'body', checkId: 'truncated' });
  });

  it('falls back to one row using the message when there are no structured flags', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '7',
        status: 'error',
        message: 'DatoCMS rejected the record update: field "title" exceeds its allowed length.',
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recordId: '7',
      status: 'error',
      severity: 'error',
      checkId: '',
      fieldPath: '',
      locale: '',
    });
    expect(rows[0].reason).toContain('exceeds its allowed length');
  });

  it('includes completed-with-warnings records', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '9',
        status: 'completed-with-warnings',
        message: 'Translated with notes',
        qcFlags: [
          {
            checkId: 'no-op',
            severity: 'warning',
            fieldPath: 'subtitle',
            locale: 'de',
            message: 'Unchanged from source.',
          },
        ],
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('warning');
  });

  it('emits one reason-bearing row per reference-copied link field', () => {
    // The common "completed with warnings" case: no QC flags, only shallow
    // link-field copies. The report must state WHY the record is flagged and
    // WHICH field carried the copied references — not just the record message.
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '11',
        status: 'completed-with-warnings',
        message: 'Translated "Winter Collection" (#11).',
        copiedLinkFieldApiKeys: ['related_articles', 'featured_products'],
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      recordId: '11',
      fieldPath: 'related_articles',
      severity: 'warning',
      checkId: 'reference-copy',
    });
    expect(rows[0].reason).toMatch(/shared references/i);
    expect(rows[1].fieldPath).toBe('featured_products');
  });

  it('keeps reference-copy rows alongside QC-flag rows on the same record', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '12',
        status: 'completed-with-warnings',
        message: 'Translated with notes',
        qcFlags: [
          {
            checkId: 'no-op',
            severity: 'warning',
            fieldPath: 'subtitle',
            locale: 'de',
            message: 'Unchanged from source.',
          },
        ],
        copiedLinkFieldApiKeys: ['related_articles'],
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.checkId)).toEqual(['no-op', 'reference-copy']);
  });
});

describe('toBulkReportCsv', () => {
  it('emits a header and CSV-escapes fields containing commas/quotes/newlines', () => {
    const csv = toBulkReportCsv([
      {
        recordId: '42',
        status: 'error',
        fieldPath: 'title',
        locale: 'fr',
        severity: 'error',
        checkId: 'length-validator',
        reason: 'Too long, "way" too long',
      },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Record ID,Status,Field,Locale,Severity,Check,Reason',
    );
    // The reason has a comma and quotes → must be wrapped and quotes doubled.
    expect(lines[1]).toContain('"Too long, ""way"" too long"');
    expect(lines[1]).toContain('42');
  });
});

describe('toBulkReportJson', () => {
  it('round-trips the rows as pretty JSON', () => {
    const rows = [
      {
        recordId: '42',
        status: 'error' as const,
        fieldPath: 'title',
        locale: 'fr',
        severity: 'error',
        checkId: 'length-validator',
        reason: 'Too long',
      },
    ];
    expect(JSON.parse(toBulkReportJson(rows))).toEqual(rows);
  });
});
