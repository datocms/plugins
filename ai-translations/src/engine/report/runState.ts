/**
 * Canonical run state + the reducer that folds engine outcomes into it
 * (persistence spec §2, §7). Record-oriented (versions are a record-level fact);
 * pure with an injected clock; upserts by (recordId, toLocale) so a unit that
 * transitions buckets across lifecycle stages replaces its prior state rather
 * than duplicating.
 */
import type { Bucket, ReasonCode, UnitOutcome } from '../plan/types';
import type { QcCheckId } from '../../utils/translation/qc/types';

/** JSON-artifact upcast boundary — DISTINCT from the machine cell's wireVersion. */
export const RUN_SCHEMA_VERSION = 1;

export interface RunUnitState {
  toLocale: string;
  bucket: Bucket;
  /** Which field blocked + why — fieldPath kept for the report (plan §7). */
  reasons: { fieldPath: string; code: ReasonCode }[];
  flagCheckIds: QcCheckId[];
  /** Epoch ms — DISPLAY ONLY; the recovery ordinal is RunState.checkpoint. */
  updatedAt: number;
}

export interface RunRecordState {
  recordId: string;
  /** The record's model id — enables the per-model resume summary. Optional for
   *  back-compat with artifacts written before it was captured. */
  itemTypeId?: string;
  sourceVersion?: string;
  writtenVersion?: string;
  units: RunUnitState[];
}

export interface RunState {
  schemaVersion: number;
  runId: string;
  /** Monotonic per-run counter, bumped every persist — the recovery ordinal. */
  checkpoint: number;
  deviceId: string;
  startedAt: number;
  operation: string;
  policyDigest: string;
  fromLocale: string;
  toLocales: string[];
  /** The per-model field allowlist the run used — restored into the picker on resume. */
  selectedFieldsByModel?: Record<string, string[]>;
  records: RunRecordState[];
}

/** Run-scope context supplied by the caller (no Date.now/randomness inside). */
export interface RunContext {
  runId: string;
  deviceId: string;
  startedAt: number;
  operation: string;
  policyDigest: string;
  fromLocale: string;
  toLocales: string[];
  selectedFieldsByModel?: Record<string, string[]>;
}

/** Creates an empty RunState for a new run. */
export function createRunState(ctx: RunContext): RunState {
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: ctx.runId,
    checkpoint: 0,
    deviceId: ctx.deviceId,
    startedAt: ctx.startedAt,
    operation: ctx.operation,
    policyDigest: ctx.policyDigest,
    fromLocale: ctx.fromLocale,
    toLocales: ctx.toLocales,
    selectedFieldsByModel: ctx.selectedFieldsByModel,
    records: [],
  };
}

/** Bumps the monotonic checkpoint counter — call on every persist. */
export function bumpCheckpoint(state: RunState): RunState {
  return { ...state, checkpoint: state.checkpoint + 1 };
}

function outcomeToUnit(outcome: UnitOutcome, now: number): RunUnitState {
  return {
    toLocale: outcome.toLocale,
    bucket: outcome.bucket,
    reasons: outcome.reasons.map((r) => ({ fieldPath: r.fieldPath, code: r.code })),
    flagCheckIds: outcome.flags.map((f) => f.checkId),
    updatedAt: now,
  };
}

/**
 * Folds one engine outcome into the run state (pure). Upserts the record by id
 * and the unit by locale; projects preVersion→sourceVersion,
 * postVersion→writtenVersion at the record level, keeping prior versions when the
 * outcome (from a stage that doesn't know them) omits them.
 */
export function foldOutcome(
  state: RunState,
  outcome: UnitOutcome,
  ctx: { now: number },
): RunState {
  const unit = outcomeToUnit(outcome, ctx.now);
  const index = state.records.findIndex((r) => r.recordId === outcome.recordId);

  if (index === -1) {
    const record: RunRecordState = {
      recordId: outcome.recordId,
      itemTypeId: outcome.itemTypeId,
      sourceVersion: outcome.preVersion,
      writtenVersion: outcome.postVersion,
      units: [unit],
    };
    return { ...state, records: [...state.records, record] };
  }

  const existing = state.records[index];
  const unitIndex = existing.units.findIndex((u) => u.toLocale === outcome.toLocale);
  const units =
    unitIndex === -1
      ? [...existing.units, unit]
      : existing.units.map((u, i) => (i === unitIndex ? unit : u));
  const updated: RunRecordState = {
    ...existing,
    itemTypeId: outcome.itemTypeId ?? existing.itemTypeId,
    sourceVersion: outcome.preVersion ?? existing.sourceVersion,
    writtenVersion: outcome.postVersion ?? existing.writtenVersion,
    units,
  };
  return { ...state, records: state.records.map((r, i) => (i === index ? updated : r)) };
}

/** Folds many outcomes in order. */
export function foldOutcomes(
  state: RunState,
  outcomes: readonly UnitOutcome[],
  ctx: { now: number },
): RunState {
  return outcomes.reduce((acc, outcome) => foldOutcome(acc, outcome, ctx), state);
}
