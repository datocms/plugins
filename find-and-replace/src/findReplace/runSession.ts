/**
 * The write (SPEC §6.8). A run session starts with the first pass over a
 * frozen plan and lasts until the next search. Each pass writes its records
 * one at a time, in display order; Stop lets the record in flight finish;
 * "Try again" runs the retryable failures again with the replacement they
 * were planned with. Totals accumulate over the passes of the session.
 */

import type { ReplacementTemplate } from '../replacement/replacementTemplate';
import type {
  RecordWriteOutcome,
  UnconfirmedWrite,
  WritePublication,
} from '../replacement/replaceRecord';
import type { DiscoveredTarget } from '../selection/discoverTargets';
import type {
  FailReason,
  FindInput,
  FindReplaceEvent,
  RecordRunStatus,
  ReplaceVerb,
  RunPhase,
  RunTotals,
} from './contract';
import type { RecordOutcomeSummary } from './planning';
import { UnloadGuard, type UnloadTarget } from './unloadGuard';
import { UNTOUCHED } from './viewModel';

/** One record of a pass, frozen when the pass was planned. */
export type PlannedRecord = {
  /** `${modelId}:${recordId}` */
  key: string;
  recordId: string;
  modelId: string;
  /** The targets of its changing matches (included, not no-ops), as discovered. */
  entries: ReadonlyArray<DiscoveredTarget>;
  /** Match key → the text the write puts there (the matches written). */
  inserted: ReadonlyMap<string, string>;
  /** Match key → whether it was included when planned, for every match of the record. */
  inclusion: ReadonlyMap<string, boolean>;
};

export type PassPlan = {
  verb: ReplaceVerb;
  template: ReplacementTemplate;
  /** The search the plan was made from (for "Search again" after a finished run). */
  find: FindInput | null;
  records: ReadonlyArray<PlannedRecord>;
};

/** What the page shows for a record of the session. */
export type SessionRecord = {
  readonly plan: PlannedRecord;
  readonly template: ReplacementTemplate;
  readonly status: RecordRunStatus;
  /** A write was started for it in this session (its row is frozen). */
  readonly attempted: boolean;
  /** Set after a successful write: the title the server returned. */
  readonly title: { value: string | null } | null;
  /** Set after a successful write: what publishing it afterwards needs. */
  readonly publication: WritePublication | null;
};

type MutableSessionRecord = {
  -readonly [Key in keyof SessionRecord]: SessionRecord[Key];
} & {
  /** The last attempt's update, when it failed but may have landed. */
  unconfirmed: UnconfirmedWrite | null;
};

export type PassEnd = {
  /** Records attempted in the pass that just ended, in order. */
  attempted: ReadonlyArray<PlannedRecord>;
  phase: 'stopped' | 'finished';
};

export type RunSessionHooks = {
  /** Something the page shows changed: emit now. */
  changed(): void;
  event(event: FindReplaceEvent): void;
  /** Called when a pass ends, before `changed()` and the `runEnded` event. */
  passEnded(end: PassEnd): void;
};

export type RunSessionOptions = {
  /**
   * Writes one record (`replaceInRecord` in production). `unconfirmed`: the
   * previous attempt's update, which may have landed (a "Try again" pass).
   */
  write: (
    record: PlannedRecord,
    template: ReplacementTemplate,
    unconfirmed: UnconfirmedWrite | null,
  ) => Promise<RecordWriteOutcome>;
  /** Where the `beforeunload` guard goes while a pass runs; null disables it. */
  unloadTarget: UnloadTarget | null;
  hooks: RunSessionHooks;
};

const WRITING: RecordRunStatus = { kind: 'writing' };
const NO_PROGRESS = { done: 0, total: 0, updated: 0 };

function statusOf(outcome: RecordWriteOutcome): RecordRunStatus {
  switch (outcome.status) {
    case 'replaced':
      return { kind: 'replaced', replacedMatches: outcome.replacedMatches };
    case 'skipped':
      return { kind: 'skipped', reason: outcome.reason };
    case 'failed':
      return {
        kind: 'failed',
        reason: outcome.reason,
        retryable: outcome.retryable,
        detail: outcome.detail,
      };
  }
}

function emptyTotals(): RunTotals {
  return {
    replacedMatches: 0,
    replacedRecords: 0,
    skippedRecords: 0,
    staleSkippedRecords: 0,
    failedRecords: 0,
    retryableFailedRecords: 0,
    notAttemptedRecords: 0,
    plannedRecords: 0,
    plannedMatches: 0,
  };
}

/** Adds one record's outcome to totals. */
function countRecord(totals: RunTotals, record: SessionRecord): void {
  totals.plannedRecords += 1;
  totals.plannedMatches += record.plan.inserted.size;
  if (!record.attempted) {
    totals.notAttemptedRecords += 1;
    return;
  }
  const { status } = record;
  if (status.kind === 'replaced') {
    totals.replacedRecords += 1;
    totals.replacedMatches += status.replacedMatches;
  } else if (status.kind === 'skipped') {
    totals.skippedRecords += 1;
    if (status.reason === 'stale') totals.staleSkippedRecords += 1;
  } else if (status.kind === 'failed') {
    totals.failedRecords += 1;
    if (status.retryable) totals.retryableFailedRecords += 1;
  }
}

export class RunSession {
  phase: RunPhase = 'none';
  /** The verb of the latest pass. */
  verb: ReplaceVerb = 'replace';
  /** Current pass only. */
  progress: { done: number; total: number; updated: number } = NO_PROGRESS;
  /** Changes whenever anything in the session changes. */
  revision = 0;
  /** The find settings the session's plan came from. */
  find: FindInput | null = null;

  private readonly records = new Map<string, MutableSessionRecord>();
  /** The running pass started over a finished session ("Try again" on the report). */
  private reportPass = false;
  private stopRequested = false;
  private disposed = false;
  private readonly guard: UnloadGuard;

  constructor(private readonly options: RunSessionOptions) {
    this.guard = new UnloadGuard(options.unloadTarget);
  }

  get isActive(): boolean {
    return this.phase === 'running' || this.phase === 'stopping';
  }

  /**
   * The page shows the session as a report (SPEC S16–S18): it finished, or a
   * "Try again" pass runs over a finished session and updates the report in
   * place.
   */
  get showsReport(): boolean {
    return this.phase === 'finished' || (this.isActive && this.reportPass);
  }

  /** The plans of the records the session wrote. */
  *writtenPlans(): Generator<PlannedRecord> {
    for (const record of this.records.values()) {
      if (record.status.kind === 'replaced') yield record.plan;
    }
  }

  record(key: string): SessionRecord | undefined {
    return this.records.get(key);
  }

  isAttempted(key: string): boolean {
    return this.records.get(key)?.attempted === true;
  }

  status(key: string): RecordRunStatus {
    return this.records.get(key)?.status ?? UNTOUCHED;
  }

  /**
   * Starts a pass over a frozen plan. The first pass opens the session; after
   * Stop, a new plan continues it (its untouched records are replaced by the
   * new plan). False when a pass is running or the plan is empty.
   */
  start(plan: PassPlan): boolean {
    if (this.disposed || this.isActive || plan.records.length === 0) {
      return false;
    }
    if (this.phase === 'none') {
      this.records.clear();
      this.find = plan.find;
    } else {
      for (const [key, record] of this.records) {
        if (!record.attempted) this.records.delete(key);
      }
    }
    for (const record of plan.records) {
      this.records.set(record.key, {
        plan: record,
        template: plan.template,
        status: UNTOUCHED,
        attempted: false,
        title: null,
        publication: null,
        unconfirmed: null,
      });
    }
    this.verb = plan.verb;
    void this.runPass(plan.records.map((record) => record.key));
    return true;
  }

  /** Keys (in the order given) of the failed records that may succeed if tried again. */
  retryableKeys(order: Iterable<string>): string[] {
    const keys: string[] = [];
    for (const key of order) {
      const status = this.records.get(key)?.status;
      if (status?.kind === 'failed' && status.retryable) keys.push(key);
    }
    return keys;
  }

  /** "Try again": a pass over the retryable failures, with their own replacement. */
  retry(order: Iterable<string>): boolean {
    if (this.disposed || this.isActive || this.phase === 'none') return false;
    const keys = this.retryableKeys(order);
    if (keys.length === 0) return false;
    void this.runPass(keys);
    return true;
  }

  /** "Stop": the record in flight completes and is reported, then the pass ends. */
  stop(): void {
    if (this.phase !== 'running') return;
    this.stopRequested = true;
    this.phase = 'stopping';
    this.revision += 1;
    this.options.hooks.changed();
  }

  /** The session ends (a new search started). Ignored while a pass runs. */
  end(): void {
    if (this.isActive || this.phase === 'none') return;
    this.records.clear();
    this.phase = 'none';
    this.reportPass = false;
    this.find = null;
    this.progress = NO_PROGRESS;
    this.revision += 1;
  }

  /** No more writes after the one in flight; nothing is reported any more. */
  dispose(): void {
    this.disposed = true;
    this.stopRequested = true;
    this.guard.set(false);
  }

  /** Totals over the session, optionally only for records of some models. */
  totals(inScope?: (modelId: string) => boolean): RunTotals {
    const totals = emptyTotals();
    for (const record of this.records.values()) {
      if (!inScope || inScope(record.plan.modelId)) countRecord(totals, record);
    }
    return totals;
  }

  /** Failed and skipped records of the session, optionally only for some models. */
  outcomes(inScope?: (modelId: string) => boolean): RecordOutcomeSummary {
    const failReasons = new Set<FailReason>();
    const summary = {
      failed: 0,
      retryableFailed: 0,
      failReasons,
      skipped: 0,
      staleSkipped: 0,
    };
    for (const record of this.records.values()) {
      if (inScope && !inScope(record.plan.modelId)) continue;
      const { status } = record;
      if (status.kind === 'failed') {
        summary.failed += 1;
        if (status.retryable) summary.retryableFailed += 1;
        failReasons.add(status.reason);
      } else if (status.kind === 'skipped') {
        summary.skipped += 1;
        if (status.reason === 'stale') summary.staleSkipped += 1;
      }
    }
    return summary;
  }

  private async runPass(keys: ReadonlyArray<string>): Promise<void> {
    const { hooks } = this.options;
    this.reportPass = this.phase === 'finished';
    this.phase = 'running';
    this.stopRequested = false;
    this.progress = { done: 0, total: keys.length, updated: 0 };
    this.revision += 1;
    this.guard.set(true);
    hooks.changed();
    hooks.event({ type: 'runStarted' });

    const attempted: MutableSessionRecord[] = [];
    for (const key of keys) {
      if (this.stopRequested) break;
      const record = this.records.get(key);
      if (!record) continue;
      // biome-ignore lint/performance/noAwaitInLoops: records are written one at a time, by design.
      await this.writeRecord(record);
      if (this.disposed) return;
      attempted.push(record);
    }
    if (this.disposed) return;
    this.endPass(keys, attempted);
  }

  private async writeRecord(record: MutableSessionRecord): Promise<void> {
    record.attempted = true;
    record.status = WRITING;
    this.revision += 1;
    this.options.hooks.changed();

    let outcome: RecordWriteOutcome;
    try {
      outcome = await this.options.write(
        record.plan,
        record.template,
        record.unconfirmed,
      );
    } catch {
      outcome = {
        status: 'failed',
        reason: 'unknown',
        retryable: false,
        detail: null,
      };
    }
    if (this.disposed) return;

    record.status = statusOf(outcome);
    if (outcome.status === 'replaced') {
      record.title = { value: outcome.freshTitle };
      record.publication = outcome.publication;
    }
    // A later attempt may find this update landed after all.
    if (outcome.status === 'failed' && outcome.unconfirmed) {
      record.unconfirmed = outcome.unconfirmed;
    } else if (outcome.status !== 'failed') {
      record.unconfirmed = null;
    }
    this.progress = {
      done: this.progress.done + 1,
      total: this.progress.total,
      updated: this.progress.updated + (outcome.status === 'replaced' ? 1 : 0),
    };
    this.revision += 1;
    this.options.hooks.changed();
  }

  private endPass(
    keys: ReadonlyArray<string>,
    attempted: ReadonlyArray<MutableSessionRecord>,
  ): void {
    const pass = emptyTotals();
    const attemptedKeys = new Set(attempted.map((record) => record.plan.key));
    for (const key of keys) {
      const record = this.records.get(key);
      if (!record) continue;
      countRecord(pass, {
        ...record,
        attempted: attemptedKeys.has(key),
      });
    }

    const phase = [...this.records.values()].some((record) => !record.attempted)
      ? 'stopped'
      : 'finished';
    this.phase = phase;
    this.stopRequested = false;
    this.revision += 1;
    this.guard.set(false);

    const permissionOnly =
      pass.replacedRecords === 0 &&
      pass.failedRecords > 0 &&
      attempted.every(
        (record) =>
          record.status.kind !== 'failed' ||
          record.status.reason === 'permission',
      );

    const { hooks } = this.options;
    hooks.passEnded({
      attempted: attempted.map((record) => record.plan),
      phase,
    });
    hooks.changed();
    hooks.event({
      type: 'runEnded',
      stopped: phase === 'stopped',
      verb: this.verb,
      pass,
      allFailedCause: permissionOnly ? 'permission' : null,
    });
  }
}
