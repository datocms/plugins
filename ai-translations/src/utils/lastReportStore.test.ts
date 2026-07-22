import { describe, expect, it } from 'vitest';
import type { BulkReportRow } from './translation/bulkReport';
import {
  clearLastReport,
  loadLastReport,
  saveLastReport,
} from './lastReportStore';

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  };
};

const rows: BulkReportRow[] = [
  {
    recordId: '1',
    status: 'error',
    fieldPath: 'title',
    locale: 'fr',
    severity: 'error',
    checkId: 'length-validator',
    reason: 'Too long',
  },
];

describe('lastReportStore', () => {
  it('round-trips the report through storage', () => {
    const storage = memoryStorage();
    saveLastReport({ rows }, storage);
    expect(loadLastReport(storage)?.rows).toEqual(rows);
  });

  it('returns null when nothing is stored', () => {
    expect(loadLastReport(memoryStorage())).toBeNull();
  });

  it('clears the stored report', () => {
    const storage = memoryStorage();
    saveLastReport({ rows }, storage);
    clearLastReport(storage);
    expect(loadLastReport(storage)).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    expect(() => saveLastReport({ rows }, null)).not.toThrow();
    expect(loadLastReport(null)).toBeNull();
  });
});
