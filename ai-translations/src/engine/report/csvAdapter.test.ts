import { describe, expect, it } from 'vitest';
import { deserializeRunStateCsv, serializeRunStateCsv } from './csvAdapter';
import { runUnitFromMachineToken } from './machineToken';
import type { RunState } from './runState';

const state: RunState = {
  schemaVersion: 1,
  runId: 'run-1',
  checkpoint: 3,
  deviceId: 'dev-1',
  startedAt: 0,
  operation: 'translate',
  policyDigest: 'pd',
  fromLocale: 'en',
  toLocales: ['it', 'es'],
  records: [
    {
      recordId: 'rec-1',
      units: [
        {
          toLocale: 'it',
          bucket: 'blocked',
          reasons: [{ fieldPath: 'title', code: 'required-blank' }],
          flagCheckIds: [],
          updatedAt: 0,
        },
        {
          toLocale: 'es',
          bucket: 'written',
          reasons: [],
          flagCheckIds: ['no-op'],
          updatedAt: 0,
        },
      ],
    },
    {
      recordId: 'rec-2',
      units: [
        {
          toLocale: 'it',
          bucket: 'not-attempted',
          reasons: [],
          flagCheckIds: [],
          updatedAt: 0,
        },
      ],
    },
  ],
};

const lines = () => serializeRunStateCsv(state).split(/\r?\n/);

describe('serializeRunStateCsv', () => {
  it('prepends a run-header row with runId, checkpoint, schemaVersion and unit count', () => {
    const header = lines()[0];
    expect(header).toMatch(/runId=run-1/);
    expect(header).toMatch(/checkpoint=3/);
    expect(header).toMatch(/schemaVersion=1/);
    expect(header).toMatch(/units=3/);
  });

  it('emits a column header then one data row per record × locale unit', () => {
    const rows = lines();
    expect(rows[1]).toBe('record_id,locale,bucket,machine_readable_status');
    const dataRows = rows.slice(2).filter(Boolean);
    expect(dataRows).toHaveLength(3);
  });

  it('emits a machine_readable_status cell that decodes back to the unit', () => {
    const firstDataRow = lines().slice(2).filter(Boolean)[0];
    const [recordId, locale, bucket, token] = firstDataRow.split(',');
    expect(recordId).toBe('rec-1');
    expect(locale).toBe('it');
    expect(bucket).toBe('blocked');

    const decoded = runUnitFromMachineToken(token);
    expect(decoded.recordId).toBe('rec-1');
    expect(decoded.unit.toLocale).toBe('it');
    expect(decoded.unit.bucket).toBe('blocked');
  });
});

describe('deserializeRunStateCsv', () => {
  it('reconstructs records, locales and buckets from an exported CSV', () => {
    const back = deserializeRunStateCsv(serializeRunStateCsv(state));
    expect(back.runId).toBe('run-1');
    expect(back.checkpoint).toBe(3);
    expect(back.records.map((r) => r.recordId).sort()).toEqual(['rec-1', 'rec-2']);
    const rec1 = back.records.find((r) => r.recordId === 'rec-1');
    expect(rec1?.units.map((u) => u.bucket).sort()).toEqual([
      'blocked',
      'written',
    ]);
    expect(new Set(back.toLocales)).toEqual(new Set(['it', 'es']));
  });

  it('preserves a blocked unit’s reason code through the token', () => {
    const back = deserializeRunStateCsv(serializeRunStateCsv(state));
    const blocked = back.records
      .flatMap((r) => r.units)
      .find((u) => u.bucket === 'blocked');
    expect(blocked?.reasons.map((r) => r.code)).toEqual(['required-blank']);
  });
});
