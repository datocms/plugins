import { describe, expect, it } from 'vitest';
import {
  restoreSelectionFromRunState,
  summarizeRunByModel,
} from './runSummary';
import type { RunState } from './runState';

const unit = (toLocale: string, bucket: RunState['records'][0]['units'][0]['bucket']) => ({
  toLocale,
  bucket,
  reasons: [],
  flagCheckIds: [],
  updatedAt: 0,
});

const state: RunState = {
  schemaVersion: 1,
  runId: 'run-1',
  checkpoint: 5,
  deviceId: 'dev-1',
  startedAt: 0,
  operation: 'translate',
  policyDigest: 'pd',
  fromLocale: 'en',
  toLocales: ['it', 'de'],
  selectedFieldsByModel: { m1: ['title', 'body'] },
  records: [
    { recordId: 'r1', itemTypeId: 'm1', units: [unit('it', 'written'), unit('de', 'written')] },
    { recordId: 'r2', itemTypeId: 'm1', units: [unit('it', 'written'), unit('de', 'blocked')] },
    { recordId: 'r3', itemTypeId: 'm2', units: [unit('it', 'not-attempted')] },
  ],
};

describe('summarizeRunByModel', () => {
  it('aggregates written/remaining per model and finds the resume point', () => {
    const summary = summarizeRunByModel(state);

    const m1 = summary.models.find((m) => m.itemTypeId === 'm1');
    expect(m1).toMatchObject({
      totalRecords: 2,
      completedRecords: 1,
      totalUnits: 4,
      writtenUnits: 3,
      remainingUnits: 1,
    });

    const m2 = summary.models.find((m) => m.itemTypeId === 'm2');
    expect(m2).toMatchObject({
      totalRecords: 1,
      completedRecords: 0,
      totalUnits: 1,
      writtenUnits: 0,
      remainingUnits: 1,
    });

    expect(summary.writtenUnits).toBe(3);
    expect(summary.remainingUnits).toBe(2);
    // First record (in order) with unfinished work.
    expect(summary.resumeFromRecordId).toBe('r2');
  });
});

describe('restoreSelectionFromRunState', () => {
  it('projects the run back into the picker selection', () => {
    expect(restoreSelectionFromRunState(state)).toEqual({
      fromLocale: 'en',
      toLocales: ['it', 'de'],
      itemIds: ['r1', 'r2', 'r3'],
      selectedFieldsByModel: { m1: ['title', 'body'] },
    });
  });

  it('falls back to an empty field allowlist on a legacy artifact', () => {
    const legacy = { ...state, selectedFieldsByModel: undefined };
    expect(restoreSelectionFromRunState(legacy).selectedFieldsByModel).toEqual({});
  });
});
