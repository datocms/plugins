/**
 * Publishing after a finished run, the optional last step. A pass publishes
 * the offered records one at a time, in display order; Stop lets the record
 * in flight finish. Outcomes last until the run session ends, and a failed
 * record that may succeed on a second attempt is offered again.
 */

import type { RecordPublishOutcome } from '../replacement/publishRecord';
import type {
  FindReplaceEvent,
  PublishPhase,
  PublishTotals,
  RecordPublishStatus,
} from './contract';
import { UnloadGuard, type UnloadTarget } from './unloadGuard';

/** A record the pass publishes, frozen when the pass starts. */
export type PublishCandidate = {
  /** `${modelId}:${recordId}` */
  key: string;
  recordId: string;
  /** The version the replacement's update produced. */
  expectedVersion: string;
};

export type PublishSessionHooks = {
  /** Something the page shows changed: emit now. */
  changed(): void;
  event(event: FindReplaceEvent): void;
};

export type PublishSessionOptions = {
  /** Publishes one record (`publishRecord` in production). */
  publish: (candidate: PublishCandidate) => Promise<RecordPublishOutcome>;
  /** Where the `beforeunload` guard goes while a pass runs; null disables it. */
  unloadTarget: UnloadTarget | null;
  hooks: PublishSessionHooks;
};

const PUBLISHING: RecordPublishStatus = { kind: 'publishing' };
const PUBLISHED: RecordPublishStatus = { kind: 'published' };
const NO_PROGRESS = { done: 0, total: 0, published: 0 };

function statusOf(outcome: RecordPublishOutcome): RecordPublishStatus {
  switch (outcome.status) {
    case 'published':
      return PUBLISHED;
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

export class PublishSession {
  phase: PublishPhase = 'none';
  /** Current pass only. */
  progress: { done: number; total: number; published: number } = NO_PROGRESS;
  /** Changes whenever anything in the session changes. */
  revision = 0;

  /** The latest attempt per record key. */
  private readonly statuses = new Map<string, RecordPublishStatus>();
  private stopRequested = false;
  private disposed = false;
  private readonly guard: UnloadGuard;

  constructor(private readonly options: PublishSessionOptions) {
    this.guard = new UnloadGuard(options.unloadTarget);
  }

  get isActive(): boolean {
    return this.phase === 'running' || this.phase === 'stopping';
  }

  /** The latest attempt for this record in the session, if any. */
  status(key: string): RecordPublishStatus | undefined {
    return this.statuses.get(key);
  }

  /** Records published in the session, optionally only some of them. */
  publishedCount(include?: (key: string) => boolean): number {
    let count = 0;
    for (const [key, status] of this.statuses) {
      if (status.kind === 'published' && (!include || include(key))) {
        count += 1;
      }
    }
    return count;
  }

  /** Starts a pass. False when a pass is running or there is nothing to publish. */
  start(candidates: ReadonlyArray<PublishCandidate>): boolean {
    if (this.disposed || this.isActive || candidates.length === 0) {
      return false;
    }
    void this.runPass(candidates);
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

  /** The run session ended (a new search started). Ignored while a pass runs. */
  end(): void {
    if (this.isActive || this.phase === 'none') return;
    this.statuses.clear();
    this.phase = 'none';
    this.progress = NO_PROGRESS;
    this.revision += 1;
  }

  /** No more publishing after the record in flight; nothing is reported any more. */
  dispose(): void {
    this.disposed = true;
    this.stopRequested = true;
    this.guard.set(false);
  }

  private async runPass(
    candidates: ReadonlyArray<PublishCandidate>,
  ): Promise<void> {
    const { hooks } = this.options;
    this.phase = 'running';
    this.stopRequested = false;
    this.progress = { done: 0, total: candidates.length, published: 0 };
    this.revision += 1;
    this.guard.set(true);
    hooks.changed();
    hooks.event({ type: 'publishStarted' });

    const outcomes: RecordPublishOutcome[] = [];
    for (const candidate of candidates) {
      if (this.stopRequested) break;
      // biome-ignore lint/performance/noAwaitInLoops: records are published one at a time, by design.
      const outcome = await this.publishOne(candidate);
      if (this.disposed) return;
      outcomes.push(outcome);
    }
    if (this.disposed) return;
    this.endPass(candidates.length, outcomes);
  }

  private async publishOne(
    candidate: PublishCandidate,
  ): Promise<RecordPublishOutcome> {
    this.statuses.set(candidate.key, PUBLISHING);
    this.revision += 1;
    this.options.hooks.changed();

    let outcome: RecordPublishOutcome;
    try {
      outcome = await this.options.publish(candidate);
    } catch {
      outcome = {
        status: 'failed',
        reason: 'unknown',
        retryable: false,
        detail: null,
      };
    }
    if (this.disposed) return outcome;

    this.statuses.set(candidate.key, statusOf(outcome));
    this.progress = {
      done: this.progress.done + 1,
      total: this.progress.total,
      published:
        this.progress.published + (outcome.status === 'published' ? 1 : 0),
    };
    this.revision += 1;
    this.options.hooks.changed();
    return outcome;
  }

  private endPass(
    planned: number,
    outcomes: ReadonlyArray<RecordPublishOutcome>,
  ): void {
    const pass: PublishTotals = {
      published: 0,
      skipped: 0,
      failed: 0,
      retryableFailed: 0,
      notAttempted: planned - outcomes.length,
      planned,
    };
    let permissionOnly = true;
    for (const outcome of outcomes) {
      if (outcome.status === 'published') pass.published += 1;
      else if (outcome.status === 'skipped') pass.skipped += 1;
      else {
        pass.failed += 1;
        if (outcome.retryable) pass.retryableFailed += 1;
        if (outcome.reason !== 'permission') permissionOnly = false;
      }
    }

    const stopped = pass.notAttempted > 0;
    this.phase = 'done';
    this.stopRequested = false;
    this.revision += 1;
    this.guard.set(false);

    const { hooks } = this.options;
    hooks.changed();
    hooks.event({
      type: 'publishEnded',
      stopped,
      pass,
      allFailedCause:
        pass.published === 0 && pass.failed > 0 && permissionOnly
          ? 'permission'
          : null,
    });
  }
}
