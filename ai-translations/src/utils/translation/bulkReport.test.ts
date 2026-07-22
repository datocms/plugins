/**
 * Tests for the bulk-translation report builder/serializers. These turn the
 * per-record ProgressUpdate stream into a flat, exportable list of "which
 * record failed and why" — the customer's explicit ask for a bulk report. One
 * row per QC reason (or per record when a record carries only a save error).
 */

import { describe, expect, it } from 'vitest';
import {
  type BulkReportRow,
  buildBulkReportRows,
  fromBulkReportCsv,
  toBulkReportCsv,
  toBulkReportJson,
  toBulkReportPlaintext,
  withMachineTokens,
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

  it('emits one row per free-text warning when there are no structured flags', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '13',
        status: 'completed-with-warnings',
        message: 'Translated "Spring Sale" (#13).',
        warnings: [
          'Field "B" to fr-FR was skipped: rate limit exceeded.',
          'Field "C" to de-DE was skipped: rate limit exceeded.',
        ],
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      recordId: '13',
      severity: 'warning',
      checkId: 'warning',
      fieldPath: '',
      locale: '',
    });
    expect(rows[0].reason).toBe('Field "B" to fr-FR was skipped: rate limit exceeded.');
    expect(rows[1].reason).toContain('de-DE');
    // The success-sounding message must NOT leak in as a reason.
    expect(rows.some((r) => r.reason.includes('Spring Sale'))).toBe(false);
  });

  it('does not duplicate the consolidated reference-copy warning as its own row', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '14',
        status: 'completed-with-warnings',
        message: 'Translated "Winter Collection" (#14).',
        copiedLinkFieldApiKeys: ['related_articles'],
        warnings: ['Copied linked records in "related_articles" into fr-FR.'],
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fieldPath: 'related_articles',
      checkId: 'reference-copy',
    });
  });

  it('emits both warning rows and QC-flag rows on the same record', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '15',
        status: 'completed-with-warnings',
        message: 'Translated with notes',
        warnings: ['Field "B" to fr-FR was skipped: rate limit exceeded.'],
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
    expect(rows.map((r) => r.checkId)).toEqual(['no-op', 'warning']);
  });

  it('reports a free-text warning on an errored record with error severity', () => {
    // A dead locale fails the record but its only report signal is a free-text
    // skip warning (provider failures emit no QcFlag). It must read as an error,
    // not a warning, in both the styled table and the exported Severity column.
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '20',
        status: 'error',
        message: 'Translated "X" (#20) with failures — fr: 0/1 fields translated.',
        warnings: ['Field "title" to French [fr] was skipped: provider failed.'],
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('error');
    expect(rows[0].reason).toContain('was skipped');
  });

  it('does not double-count a QC flag mirrored into the warnings list', () => {
    // recordQcFlag pushes each QC flag into BOTH qcFlags and warnings (for the
    // live tooltip). The report must render it once (as the structured qcFlag
    // row), not twice, so the "N issues" header is not inflated.
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '21',
        status: 'error',
        message: 'Translated "Y" (#21) but 1 value may be incomplete.',
        qcFlags: [
          {
            checkId: 'truncated',
            severity: 'error',
            fieldPath: 'body',
            locale: 'fr',
            message: 'Provider cut the response off.',
          },
        ],
        warnings: [
          'Translation issue — "body" → French [fr]: Provider cut the response off.',
        ],
      },
    ];
    const rows = buildBulkReportRows(progress);
    expect(rows).toHaveLength(1);
    expect(rows[0].checkId).toBe('truncated');
  });

  it('populates recordTitle and editUrl from the label and the URL builder', () => {
    const progress: ProgressUpdate[] = [
      {
        recordIndex: 0,
        recordId: '16',
        status: 'error',
        recordLabel: 'Homepage',
        itemTypeId: 'm1',
        message: 'DatoCMS rejected the record update.',
      },
    ];
    const rows = buildBulkReportRows(
      progress,
      (u) => `https://example.admin.datocms.com/editor/items/${u.recordId}`,
    );
    expect(rows[0]).toMatchObject({
      recordTitle: 'Homepage',
      editUrl: 'https://example.admin.datocms.com/editor/items/16',
    });
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
      'Record ID,Record title,Edit URL,Status,Field,Locale,Severity,Check,Reason,Machine readable status',
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

describe('withMachineTokens', () => {
  const runState = {
    schemaVersion: 1,
    runId: 'run-1',
    checkpoint: 1,
    deviceId: 'd',
    startedAt: 0,
    operation: 'translate',
    policyDigest: 'pd',
    fromLocale: 'en',
    toLocales: ['it'],
    records: [
      {
        recordId: '42',
        itemTypeId: 'm1',
        units: [
          {
            toLocale: 'fr',
            bucket: 'blocked' as const,
            reasons: [{ fieldPath: 'title', code: 'required-blank' as const }],
            flagCheckIds: [],
            updatedAt: 0,
          },
        ],
      },
    ],
  };

  const rows: BulkReportRow[] = [
    {
      recordId: '42',
      status: 'error',
      fieldPath: 'title',
      locale: 'fr',
      severity: 'error',
      checkId: 'required-blank',
      reason: 'x',
    },
    {
      recordId: '99',
      status: 'error',
      fieldPath: 'title',
      locale: 'fr',
      severity: 'error',
      checkId: 'x',
      reason: 'y',
    },
  ];

  it('fills the machine token for a row whose unit is in the RunState', () => {
    const [matched, unmatched] = withMachineTokens(rows, runState);
    expect(matched.machineReadableStatus).toMatch(/^v1:/);
    // A row with no matching unit is unchanged.
    expect(unmatched.machineReadableStatus).toBeUndefined();
  });

  it('passes rows through unchanged when no RunState is given', () => {
    expect(withMachineTokens(rows)).toEqual(rows);
  });
});

describe('fromBulkReportCsv', () => {
  it('round-trips rows (incl. the machine token) through toBulkReportCsv', () => {
    const rows: BulkReportRow[] = [
      {
        recordId: '42',
        recordTitle: 'Backpack, "the" one',
        status: 'error',
        fieldPath: 'title',
        locale: 'fr',
        severity: 'error',
        checkId: 'length-validator',
        reason: 'Too long',
        machineReadableStatus: 'v1:abc-_',
      },
    ];
    const back = fromBulkReportCsv(toBulkReportCsv(rows));
    expect(back).toHaveLength(1);
    expect(back[0].recordId).toBe('42');
    expect(back[0].recordTitle).toBe('Backpack, "the" one');
    expect(back[0].reason).toBe('Too long');
    expect(back[0].machineReadableStatus).toBe('v1:abc-_');
  });
});

describe('toBulkReportPlaintext', () => {
  it('summarizes rows as a human-readable list', () => {
    const text = toBulkReportPlaintext([
      {
        recordId: '42',
        status: 'error',
        recordTitle: 'Backpack',
        fieldPath: 'badge',
        locale: 'es',
        severity: 'error',
        checkId: 'length-validator',
        reason: 'Too long',
      },
    ]);
    expect(text).toMatch(/1 issue.*across 1 record/i);
    expect(text).toMatch(/Backpack/);
    expect(text).toMatch(/badge/);
    expect(text).toMatch(/es/);
    expect(text).toMatch(/Too long/);
  });

  it('handles an empty report', () => {
    expect(toBulkReportPlaintext([])).toMatch(/no issues/i);
  });
});
