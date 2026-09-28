import {
  ApiError,
  type Client,
  TimeoutError,
} from '@datocms/cma-client-browser';
import { MatcherWorkerTimeoutError } from './matcher';
import {
  DiscoveryCancelledError,
  type DiscoveryModel,
  fetchModelCount,
  fetchModelRecords,
  fetchRecordsByIds,
  isDiscoveryCancelled,
  type PublicationStatus,
  type RawNestedItem,
  type RecordQueryScope,
  throwIfDiscoveryCancelled,
} from './query';
import { RequestPool } from './requestPool';
import type { DiscoverySpec } from './types';

export type { DiscoverySpec } from './types';

export const LARGE_DISCOVERY_THRESHOLD = 5_000;
/** Models scanned at once (their requests share the run's pool). */
export const MODEL_DISCOVERY_CONCURRENCY = 4;
/** Requests of one run in flight at once. */
export const READ_CONCURRENCY = 6;
/**
 * Requests one run may start in any `READ_WINDOW_MS`: two thirds of the
 * CMA's 60 every 3 seconds, so the rest of the dashboard keeps working.
 */
export const READ_REQUESTS_PER_WINDOW = 40;
export const READ_WINDOW_MS = 3_000;
/**
 * A resumed model starts this many records before where it stopped, so
 * records deleted in between don't make it skip any.
 */
export const RESUME_OVERLAP = 30;
/** Background per-model counts run at this concurrency, next to the scan. */
export const MODEL_COUNT_CONCURRENCY = 4;
/** A replayed (cached) model is delivered in batches of this many records. */
export const REPLAY_BATCH_SIZE = 200;

export type DiscoveryStatus =
  | 'idle'
  | 'preflight'
  | 'awaiting_confirmation'
  | 'running'
  | 'completed'
  | 'partial'
  | 'cancelled'
  | 'failed';

/**
 * - `network`: the CMA client failed (`ApiError`, `TimeoutError`) or the
 *   request never got an answer (`TypeError` from fetch).
 * - `unknown`: anything else.
 */
export type DiscoveryErrorCause = 'network' | 'unknown';

export type DiscoveryIssue = {
  modelId: string;
  modelName: string;
  phase: 'preflight' | 'scan';
  message: string;
  cause: DiscoveryErrorCause;
  retryable: boolean;
};

/** Where a model's scan got to: `done`, or the offset of its first record not fully matched. */
export type ModelScanPosition = number | 'done';

/** Continues an earlier run that stopped at `maxTargets`. */
export type DiscoveryResume = {
  /** The earlier run's `positions`. Models not listed start from the beginning. */
  positions: Readonly<Record<string, ModelScanPosition>>;
  /**
   * Records read earlier that still need a look, by model: re-read by id
   * and matched before the model's scan goes on.
   */
  recheck?: ReadonlyMap<string, ReadonlyArray<string>>;
  /**
   * Record ids already dealt with (replaced, or left out on purpose): the
   * resumed scans read past them without matching them, so the records a
   * model re-reads before its position don't come back.
   */
  skip?: ReadonlySet<string>;
};

export type DiscoveryModelEstimate = {
  modelId: string;
  modelName: string;
  count: number | null;
};

export type DiscoveryPreflight = {
  estimatedRecords: number;
  estimates: DiscoveryModelEstimate[];
  issues: DiscoveryIssue[];
  requiresConfirmation: boolean;
};

export type DiscoveryProgress = {
  modelsTotal: number;
  modelsCompleted: number;
  /**
   * Sum of the per-model counts. Blocking counts: known before the scan
   * starts (failed counts add 0). Background counts: null until every count
   * resolved; stays null when one fails.
   */
  recordsEstimated: number | null;
  recordsScanned: number;
  targetsFound: number;
  currentModelId?: string;
  currentModelName?: string;
};

export type DiscoverySnapshot<T> = {
  runId: string | null;
  status: DiscoveryStatus;
  spec: DiscoverySpec | null;
  preflight: DiscoveryPreflight | null;
  progress: DiscoveryProgress;
  /**
   * Distinct targets in arrival order (seed targets first). Materialized only
   * in the snapshot a run settles with and in `snapshot()`: the snapshots
   * emitted while a run is going carry an empty array, so an emit never costs
   * O(targets). Stream them with `onTargets` and count them with
   * `targetCount`.
   */
  targets: T[];
  /** Distinct targets committed so far, seed targets included. */
  targetCount: number;
  issues: DiscoveryIssue[];
  complete: boolean;
  /** The run stopped because `maxTargets` was reached. */
  capped: boolean;
  /**
   * Set when the run settles: where each model's scan got to (models it
   * never reached keep the position they were resumed from, or are absent).
   * A later run continues from here with `resume`.
   */
  positions: Readonly<Record<string, ModelScanPosition>>;
  /** Set when the run settles: `resume.recheck` ids it didn't get to match. */
  recheckLeft: Readonly<Record<string, ReadonlyArray<string>>>;
  /**
   * With status `failed`: the matcher worker timed out. The whole run failed
   * at once (`issues` is empty).
   */
  failureCode?: 'pattern_timeout';
  error?: string;
};

export type DiscoverRecordContext = {
  spec: DiscoverySpec;
  model: DiscoveryModel;
  runId: string;
  signal: AbortSignal;
};

// ─── Record sources ─────────────────────────────────────────────────────────

export type RecordSourceContext = {
  client: Client;
  model: DiscoveryModel;
  scope: RecordQueryScope;
  signal: AbortSignal;
  /** The run's request slots and pace (network sources). */
  pool?: RequestPool;
};

export type RecordSourceScanContext = RecordSourceContext & {
  /**
   * Hand over the next records of the model, in order (a network page, or a
   * replayed batch). Awaited: it matches them and commits their targets. It
   * throws a cancellation error once the run was cancelled, capped or failed,
   * which the source should let propagate.
   */
  onRecords: (records: ReadonlyArray<RawNestedItem>) => Promise<void>;
  /** Offset of the first record to deliver (a resumed model). Default 0. */
  startOffset?: number;
};

/**
 * Where the records of one model come from during a run. `scan` resolves only
 * after every record of the model was handed to `onRecords` and processed;
 * it rejects when the run was cancelled, capped before the end, or failed. A
 * cache can therefore store what a scan delivered once it resolves.
 */
export type ModelRecordSource = {
  /** Number of records `scan` will deliver (used for progress estimates). */
  count(context: RecordSourceContext): Promise<number>;
  scan(context: RecordSourceScanContext): Promise<void>;
};

/** Picks the source of each model for one run (called once per model). */
export type DiscoveryRecordSource = (
  model: DiscoveryModel,
) => ModelRecordSource;

/**
 * The CMA: `total_count` for counts; for the scan, pages of 500 (30 when the
 * model can hold blocks), several requested ahead through the run's pool.
 */
export const networkRecordSource: ModelRecordSource = {
  count: ({ client, model, scope, signal, pool }) =>
    fetchModelCount(client, model, scope, signal, pool),
  scan: async ({
    client,
    model,
    scope,
    signal,
    pool,
    startOffset,
    onRecords,
  }) => {
    await fetchModelRecords(client, model, scope, {
      signal,
      pool,
      startOffset,
      collect: false,
      onRecords,
    });
  },
};

export type ReplayRecordSourceOptions = {
  /** Records per `onRecords` call. Defaults to `REPLAY_BATCH_SIZE`. */
  batchSize?: number;
  /**
   * Awaited between batches so the page stays responsive. Defaults to a
   * zero-delay `setTimeout`.
   */
  yieldToEventLoop?: () => Promise<void>;
};

function defaultYieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

/**
 * Replays records already in memory (the controller's record cache) through
 * the same matching path as the network, without any request. Records must
 * have been fetched as the network source reads them (current version, and
 * nested when the model can hold blocks), for this model.
 */
export function replayRecordSource(
  records: ReadonlyArray<RawNestedItem>,
  options: ReplayRecordSourceOptions = {},
): ModelRecordSource {
  const batchSize = Math.max(1, options.batchSize ?? REPLAY_BATCH_SIZE);
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop;

  return {
    count: async () => records.length,
    scan: async ({ signal, onRecords, startOffset = 0 }) => {
      const first = Math.max(0, startOffset);
      for (let start = first; start < records.length; start += batchSize) {
        if (start > first) {
          // biome-ignore lint/performance/noAwaitInLoops: yielding between batches is the point.
          await yieldToEventLoop();
        }
        throwIfDiscoveryCancelled(signal);
        await onRecords(records.slice(start, start + batchSize));
      }
    },
  };
}

const defaultRecordSource: DiscoveryRecordSource = () => networkRecordSource;

// ─── Options ────────────────────────────────────────────────────────────────

export type DiscoveryTimers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type DiscoveryControllerBaseOptions<T> = {
  client: Client;
  models: DiscoveryModel[];
  targetKey: (target: T) => string;
  modelIdsForSpec?: (spec: DiscoverySpec) => string[];
  queryScopeForSpec?: (spec: DiscoverySpec) => RecordQueryScope;
  onCancel?: (runId: string) => void;
  onRunFinished?: (runId: string) => void;
};

export type DiscoveryControllerOptions<T> = DiscoveryControllerBaseOptions<T> &
  (
    | {
        /** Targets of one record. Called once per record, in order. */
        discoverRecord: (
          record: RawNestedItem,
          context: DiscoverRecordContext,
        ) => T[] | Promise<T[]>;
        discoverRecords?: undefined;
      }
    | {
        /**
         * Targets of several records at once (one network page or one
         * replayed batch), one array per record in input order. Lets the
         * matcher run once per page instead of once per record.
         */
        discoverRecords: (
          records: ReadonlyArray<RawNestedItem>,
          context: DiscoverRecordContext,
        ) => Promise<T[][]>;
        discoverRecord?: undefined;
      }
  );

export type DiscoveryRunOptions<T> = {
  /** Blocking counts only: don't stop above `LARGE_DISCOVERY_THRESHOLD`. */
  confirmedLargeRun?: boolean;
  /** Blocking counts only: counts computed earlier (skips counting). */
  preflight?: DiscoveryPreflight;
  /** Scan only these models, in this order (instead of the spec's). */
  modelIds?: string[];
  /** Targets known from an earlier run: kept first, and never added twice. */
  seedTargets?: Iterable<T>;
  /** Every snapshot of this run, as it is emitted. */
  onSnapshot?: (snapshot: DiscoverySnapshot<T>) => void;
  /**
   * Stop when this many distinct targets (seeds included) were found: the
   * record being committed loses its excess targets, no further page is
   * requested, and the run settles `completed` (or `partial`) with
   * `capped: true`.
   */
  maxTargets?: number;
  /**
   * - `blocking` (default): count every model first (`preflight`), stop at
   *   `awaiting_confirmation` above `LARGE_DISCOVERY_THRESHOLD` unless
   *   `confirmedLargeRun`, then scan.
   * - `background`: scan at once; the counts run next to the scan (4 at a
   *   time) and only fill `progress.recordsEstimated`. A failed count leaves
   *   it null and is never an issue.
   */
  counts?: 'blocking' | 'background';
  /**
   * Targets as they are committed, in arrival order: what was added since the
   * previous call, at most once every `emitIntervalMs`, plus a final call
   * before the snapshot the run settles (or is cancelled) with. Seed targets
   * are never passed. `cancel()` makes that final call synchronously.
   */
  onTargets?: (added: ReadonlyArray<T>) => void;
  /** Minimum interval between two `onTargets` calls. Default 0 (every page). */
  emitIntervalMs?: number;
  /** Where each model's records come from. Defaults to the network. */
  recordSource?: DiscoveryRecordSource;
  /** Timers used to throttle `onTargets` and pace requests. Defaults to globalThis. */
  timers?: DiscoveryTimers;
  /** Clock for pacing requests. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Request slots and pace to share (with other readers of the same
   * project). Defaults to one shared by every run of this controller.
   */
  pool?: RequestPool;
  /** Continue a run that stopped at `maxTargets` (see `DiscoveryResume`). */
  resume?: DiscoveryResume;
};

type SnapshotListener<T> = (snapshot: DiscoverySnapshot<T>) => void;

function defaultModelIdsForSpec(spec: DiscoverySpec): string[] {
  if (spec.workflow === 'browse' && spec.browse?.rootModelId) {
    return [spec.browse.rootModelId];
  }
  return [...new Set(spec.rootModelIds)];
}

function defaultQueryScopeForSpec(spec: DiscoverySpec): RecordQueryScope {
  return {
    publicationStatuses: [...new Set(spec.publicationStatuses)],
    locales: [...new Set(spec.locales)],
    ...(spec.workflow === 'browse' && spec.browse?.recordId
      ? { recordIds: [spec.browse.recordId] }
      : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown discovery error.';
}

/** `network` for CMA client and fetch failures, `unknown` otherwise. */
export function discoveryErrorCause(error: unknown): DiscoveryErrorCause {
  return error instanceof ApiError ||
    error instanceof TimeoutError ||
    error instanceof TypeError
    ? 'network'
    : 'unknown';
}

async function mapWithConcurrency<T>(
  values: ReadonlyArray<T>,
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      // biome-ignore lint/performance/noAwaitInLoops: each worker handles one value at a time; concurrency comes from the parallel workers.
      await worker(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, runWorker),
  );
}

function emptyProgress(): DiscoveryProgress {
  return {
    modelsTotal: 0,
    modelsCompleted: 0,
    recordsEstimated: null,
    recordsScanned: 0,
    targetsFound: 0,
  };
}

function initialSnapshot<T>(): DiscoverySnapshot<T> {
  return {
    runId: null,
    status: 'idle',
    spec: null,
    preflight: null,
    progress: emptyProgress(),
    targets: [],
    targetCount: 0,
    issues: [],
    complete: false,
    capped: false,
    positions: {},
    recheckLeft: {},
  };
}

/**
 * The distinct targets of one run, in arrival order, and the throttled
 * `onTargets` stream over them.
 */
class TargetStream<T> {
  private readonly keys = new Set<string>();
  private readonly arrived: T[] = [];
  private pending: T[] = [];
  private cooldown: unknown = null;
  private closed = false;
  private reachedCap = false;
  private lastCutShort = false;

  constructor(
    private readonly options: {
      targetKey: (target: T) => string;
      maxTargets?: number;
      onTargets?: (added: ReadonlyArray<T>) => void;
      emitIntervalMs: number;
      timers: DiscoveryTimers;
    },
  ) {}

  get count(): number {
    return this.arrived.length;
  }

  get capped(): boolean {
    return this.reachedCap;
  }

  /**
   * The last `commit` reached `maxTargets` while its record still had new
   * targets, which were dropped: the record was only partly committed.
   */
  get cutShort(): boolean {
    return this.lastCutShort;
  }

  /** Known targets: kept first, never streamed. */
  seed(targets: Iterable<T>): void {
    for (const target of targets) {
      const key = this.options.targetKey(target);
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.arrived.push(target);
    }
    this.checkCap();
  }

  /**
   * Commits the targets of one record. Returns false once `maxTargets` is
   * reached (the rest of this record's targets were dropped).
   */
  commit(targets: ReadonlyArray<T>): boolean {
    this.lastCutShort = false;
    if (this.reachedCap) return false;
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index] as T;
      const key = this.options.targetKey(target);
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.arrived.push(target);
      if (this.options.onTargets) this.pending.push(target);
      if (this.checkCap()) {
        this.lastCutShort = targets
          .slice(index + 1)
          .some((rest) => !this.keys.has(this.options.targetKey(rest)));
        return false;
      }
    }
    return true;
  }

  /**
   * Commits the targets of consecutive records (`perRecord[i]` for record i).
   * Returns how many records were committed: all of them, or up to the one
   * that reached `maxTargets`.
   */
  commitRecords(
    perRecord: ReadonlyArray<ReadonlyArray<T>>,
    recordCount: number,
  ): number {
    let committed = 0;
    while (committed < recordCount) {
      const open = this.commit(perRecord[committed] ?? []);
      committed += 1;
      if (!open) break;
    }
    return committed;
  }

  /** After a batch of commits: streams now, or when the interval allows. */
  schedule(): void {
    if (this.closed || this.pending.length === 0) return;
    if (this.options.emitIntervalMs <= 0) {
      this.deliver();
      return;
    }
    if (this.cooldown !== null) return;
    this.deliver();
    this.startCooldown();
  }

  /** The final delivery; nothing is streamed afterwards. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.cooldown !== null) {
      this.options.timers.clearTimeout(this.cooldown);
      this.cooldown = null;
    }
    this.deliver();
  }

  materialize(): T[] {
    return [...this.arrived];
  }

  private checkCap(): boolean {
    const { maxTargets } = this.options;
    if (maxTargets !== undefined && this.arrived.length >= maxTargets) {
      this.reachedCap = true;
    }
    return this.reachedCap;
  }

  private deliver(): void {
    if (this.pending.length === 0) return;
    const added = this.pending;
    this.pending = [];
    this.options.onTargets?.(added);
  }

  private startCooldown(): void {
    this.cooldown = this.options.timers.setTimeout(() => {
      this.cooldown = null;
      if (this.closed || this.pending.length === 0) return;
      this.deliver();
      this.startCooldown();
    }, this.options.emitIntervalMs);
  }
}

const globalTimers: DiscoveryTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Why a run stopped scanning before every model finished, other than cancel(). */
type ScanStop =
  | { kind: 'capped' }
  | { kind: 'timeout'; error: MatcherWorkerTimeoutError };

/** Shared by the models of one scan: they stop together. */
type ScanState = { stop: ScanStop | null; issues: DiscoveryIssue[] };

/** How far one model's scan got in this run. */
type ModelCursor = { start: number; committed: number; done: boolean };

type CommitOptions = {
  onCommitted?: (fully: number) => void;
  skip?: ReadonlySet<string>;
};

/** Everything one run needs; also the active run while it goes. */
type RunContext<T> = {
  runId: string;
  spec: DiscoverySpec;
  scope: RecordQueryScope;
  models: ReadonlyArray<DiscoveryModel>;
  abortController: AbortController;
  listener?: SnapshotListener<T>;
  stream: TargetStream<T>;
  sourceFor: (model: DiscoveryModel) => ModelRecordSource;
  /** The scan's stop reason and the models that failed so far. */
  scan: ScanState;
  /** Every request of the run goes through it. */
  pool: RequestPool;
  resume: DiscoveryResume | null;
  /** Models this run scanned (or skipped as done), by id. */
  cursors: Map<string, ModelCursor>;
  /** `resume.recheck` ids not matched yet, by model. */
  recheckLeft: Map<string, Set<string>>;
};

/** Where a model resumed from `previous` starts reading (a little before it). */
function resumeStart(previous: ModelScanPosition | undefined): number {
  return typeof previous === 'number'
    ? Math.max(0, previous - RESUME_OVERLAP)
    : 0;
}

/**
 * Where each model's scan got to. A model this run didn't reach keeps the
 * position it was resumed from; one resumed and stopped again never goes
 * back before that position.
 */
function positionsOf<T>(run: RunContext<T>): Record<string, ModelScanPosition> {
  const positions: Record<string, ModelScanPosition> = {
    ...(run.resume?.positions ?? {}),
  };
  for (const [modelId, cursor] of run.cursors) {
    const previous = positions[modelId];
    positions[modelId] = cursor.done
      ? 'done'
      : Math.max(
          typeof previous === 'number' ? previous : 0,
          cursor.start + cursor.committed,
        );
  }
  return positions;
}

/** Issues in the order of the run's models. */
function sortIssues(
  models: ReadonlyArray<DiscoveryModel>,
  issues: ReadonlyArray<DiscoveryIssue>,
): DiscoveryIssue[] {
  const order = new Map(models.map((model, index) => [model.id, index]));
  return [...issues].sort(
    (left, right) =>
      (order.get(left.modelId) ?? 0) - (order.get(right.modelId) ?? 0),
  );
}

export class DiscoveryController<T> {
  private readonly modelsById: Map<string, DiscoveryModel>;
  private readonly listeners = new Set<SnapshotListener<T>>();
  private active: RunContext<T> | undefined;
  private runSequence = 0;
  /** Shared by the runs of this controller (unless a run brings its own). */
  private pool: RequestPool | null = null;
  private currentSnapshot: DiscoverySnapshot<T> = initialSnapshot<T>();
  /** Targets of the current (or last) run; source of `snapshot().targets`. */
  private stream: TargetStream<T> | null = null;

  constructor(private readonly options: DiscoveryControllerOptions<T>) {
    this.modelsById = new Map(options.models.map((model) => [model.id, model]));
  }

  snapshot(): DiscoverySnapshot<T> {
    return {
      ...this.currentSnapshot,
      progress: { ...this.currentSnapshot.progress },
      targets: this.stream?.materialize() ?? [],
      issues: [...this.currentSnapshot.issues],
    };
  }

  subscribe(listener: SnapshotListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async preflight(
    spec: DiscoverySpec,
    signal?: AbortSignal,
    onlyModelIds?: string[],
    recordSource: DiscoveryRecordSource = defaultRecordSource,
  ): Promise<DiscoveryPreflight> {
    const models = this.modelsForSpec(spec, onlyModelIds);
    const scope = this.queryScopeForSpec(spec);
    const countSignal = signal ?? new AbortController().signal;
    const estimates: DiscoveryModelEstimate[] = [];
    const issues: DiscoveryIssue[] = [];

    await mapWithConcurrency(
      models,
      MODEL_DISCOVERY_CONCURRENCY,
      async (model) => {
        try {
          const count = await recordSource(model).count({
            client: this.options.client,
            model,
            scope,
            signal: countSignal,
          });
          throwIfDiscoveryCancelled(signal);
          estimates.push({ modelId: model.id, modelName: model.name, count });
        } catch (error) {
          if (isDiscoveryCancelled(error)) {
            throw error;
          }
          throwIfDiscoveryCancelled(signal);
          estimates.push({
            modelId: model.id,
            modelName: model.name,
            count: null,
          });
          issues.push({
            modelId: model.id,
            modelName: model.name,
            phase: 'preflight',
            message: errorMessage(error),
            cause: discoveryErrorCause(error),
            retryable: true,
          });
        }
      },
    );

    estimates.sort((left, right) =>
      left.modelName.localeCompare(right.modelName),
    );
    issues.sort((left, right) => left.modelName.localeCompare(right.modelName));
    const estimatedRecords = estimates.reduce(
      (sum, estimate) => sum + (estimate.count ?? 0),
      0,
    );

    return {
      estimatedRecords,
      estimates,
      issues,
      requiresConfirmation: estimatedRecords > LARGE_DISCOVERY_THRESHOLD,
    };
  }

  async run(
    spec: DiscoverySpec,
    options: DiscoveryRunOptions<T> = {},
  ): Promise<DiscoverySnapshot<T>> {
    this.cancel();
    const run = this.startRun(spec, options);
    const countsAbortController = new AbortController();
    // The cap, cancel() or a timeout stops the counts at once.
    run.abortController.signal.addEventListener(
      'abort',
      () => countsAbortController.abort(),
      { once: true },
    );

    try {
      if (options.counts === 'background') {
        void this.runBackgroundCounts(run, countsAbortController.signal);
      } else if (!(await this.runPreflight(run, options))) {
        return this.snapshot();
      }
      const state = await this.scanModels(run);
      this.assertActive(run.runId);
      this.settle(run, state);
    } catch (error) {
      this.abandon(run, error);
    } finally {
      countsAbortController.abort();
    }
    return this.snapshot();
  }

  retry(
    spec: DiscoverySpec,
    previous: DiscoverySnapshot<T>,
    options: Omit<DiscoveryRunOptions<T>, 'modelIds' | 'seedTargets'> = {},
  ): Promise<DiscoverySnapshot<T>> {
    const failedModelIds = previous.issues
      .filter((issue) => issue.phase === 'scan' && issue.retryable)
      .map((issue) => issue.modelId);
    return this.run(spec, {
      ...options,
      confirmedLargeRun: true,
      modelIds: failedModelIds,
      seedTargets: previous.targets,
    });
  }

  /**
   * Stops the active run at once: no further page is requested and late
   * results are ignored. Targets not yet streamed are passed to the run's
   * `onTargets` synchronously, then the `cancelled` snapshot is emitted. It
   * lists the models whose scan had already failed (`issues`).
   */
  cancel(): void {
    if (!this.active) {
      return;
    }
    const { runId, abortController, listener, stream, models, scan } =
      this.active;
    abortController.abort();
    this.options.onCancel?.(runId);
    this.active = undefined;
    stream.close();
    if (this.currentSnapshot.runId === runId) {
      this.currentSnapshot = {
        ...this.currentSnapshot,
        status: 'cancelled',
        issues:
          this.currentSnapshot.status === 'running'
            ? sortIssues(models, scan.issues)
            : this.currentSnapshot.issues,
        complete: false,
      };
      this.emit(listener, true);
    }
  }

  /** Cancels any active run and removes all discovery results and issues. */
  reset(): void {
    this.cancel();
    this.active = undefined;
    this.stream = null;
    this.currentSnapshot = initialSnapshot<T>();
    this.emit();
  }

  private startRun(
    spec: DiscoverySpec,
    options: DiscoveryRunOptions<T>,
  ): RunContext<T> {
    const recordSource = options.recordSource ?? defaultRecordSource;
    const sources = new Map<string, ModelRecordSource>();
    const stream = new TargetStream<T>({
      targetKey: this.options.targetKey,
      maxTargets: options.maxTargets,
      onTargets: options.onTargets,
      emitIntervalMs: options.emitIntervalMs ?? 0,
      timers: options.timers ?? globalTimers,
    });
    stream.seed(options.seedTargets ?? []);
    const timers = options.timers ?? globalTimers;
    const run: RunContext<T> = {
      runId: `selection-${++this.runSequence}`,
      spec,
      scope: this.queryScopeForSpec(spec),
      models: this.modelsForSpec(spec, options.modelIds),
      abortController: new AbortController(),
      listener: options.onSnapshot,
      stream,
      sourceFor: (model) => {
        const source = sources.get(model.id) ?? recordSource(model);
        sources.set(model.id, source);
        return source;
      },
      scan: { stop: stream.capped ? { kind: 'capped' } : null, issues: [] },
      pool: options.pool ?? this.sharedPool(timers, options.now),
      resume: options.resume ?? null,
      cursors: new Map(),
      // Filled up front: a model the run never reaches keeps its rechecks.
      recheckLeft: new Map(
        [...(options.resume?.recheck ?? [])].map(([modelId, ids]) => [
          modelId,
          new Set(ids),
        ]),
      ),
    };
    this.stream = stream;
    this.active = run;

    this.currentSnapshot = {
      ...initialSnapshot<T>(),
      runId: run.runId,
      status: options.counts === 'background' ? 'running' : 'preflight',
      spec,
      progress: {
        ...emptyProgress(),
        modelsTotal: run.models.length,
        targetsFound: stream.count,
      },
      targetCount: stream.count,
    };
    this.emit(run.listener);
    return run;
  }

  /** The pool this controller's runs share when they bring none. */
  private sharedPool(
    timers: DiscoveryTimers,
    now: (() => number) | undefined,
  ): RequestPool {
    if (!this.pool) {
      this.pool = new RequestPool({
        concurrency: READ_CONCURRENCY,
        perWindow: READ_REQUESTS_PER_WINDOW,
        windowMs: READ_WINDOW_MS,
        timers,
        now,
      });
    }
    return this.pool;
  }

  /**
   * Blocking counts before the scan. Resolves false when the run stops here
   * (above the large-run threshold without confirmation).
   */
  private async runPreflight(
    run: RunContext<T>,
    options: DiscoveryRunOptions<T>,
  ): Promise<boolean> {
    const signal = run.abortController.signal;
    const preflight =
      options.preflight ??
      (await this.preflight(run.spec, signal, options.modelIds, run.sourceFor));
    this.assertActive(run.runId, signal);

    this.currentSnapshot = {
      ...this.currentSnapshot,
      preflight,
      issues: [...preflight.issues],
      progress: {
        ...this.currentSnapshot.progress,
        recordsEstimated: preflight.estimatedRecords,
      },
    };

    if (preflight.requiresConfirmation && !options.confirmedLargeRun) {
      this.currentSnapshot = {
        ...this.currentSnapshot,
        status: 'awaiting_confirmation',
      };
      run.stream.close();
      this.finishRun(run.runId);
      this.emit(run.listener, true);
      return false;
    }

    this.currentSnapshot = {
      ...this.currentSnapshot,
      status: 'running',
      issues: [],
    };
    this.emit(run.listener);
    return true;
  }

  /**
   * Scans every model (2 at a time) and resolves with the reason the scan
   * stopped early, if any, and the failed models. Cancellation rejects.
   */
  private async scanModels(run: RunContext<T>): Promise<ScanState> {
    await mapWithConcurrency(run.models, MODEL_DISCOVERY_CONCURRENCY, (model) =>
      this.scanModel(run, model, run.scan),
    );
    return run.scan;
  }

  private async scanModel(
    run: RunContext<T>,
    model: DiscoveryModel,
    state: ScanState,
  ): Promise<void> {
    if (state.stop) return;
    const signal = run.abortController.signal;
    this.assertActive(run.runId, signal);
    this.setCurrentModel(run.runId, model, run.listener);

    try {
      await this.recheckModel(run, model, state);
      const previous = run.resume?.positions[model.id];
      if (previous === 'done') {
        run.cursors.set(model.id, { start: 0, committed: 0, done: true });
      } else {
        const cursor: ModelCursor = {
          start: resumeStart(previous),
          committed: 0,
          done: false,
        };
        run.cursors.set(model.id, cursor);
        await run.sourceFor(model).scan({
          client: this.options.client,
          model,
          scope: run.scope,
          signal,
          pool: run.pool,
          startOffset: cursor.start,
          onRecords: (records) =>
            this.commitRecords(run, model, records, state, {
              skip: run.resume?.skip,
              onCommitted: (fully) => {
                cursor.committed += fully;
              },
            }),
        });
        cursor.done = true;
      }
      this.assertActive(run.runId);
      this.markModelDone(run);
    } catch (error) {
      this.handleModelError(run, model, state, error);
    }
  }

  /**
   * A resumed run first re-reads the model's `resume.recheck` records by id
   * and matches them. Ids it doesn't get to (the run stopped first) stay in
   * `recheckLeft`; ids of records that no longer exist are dropped.
   */
  private async recheckModel(
    run: RunContext<T>,
    model: DiscoveryModel,
    state: ScanState,
  ): Promise<void> {
    const left = run.recheckLeft.get(model.id);
    if (!left || left.size === 0) return;
    const ids = [...left];
    const found = new Set<string>();

    // Batch by batch, as they arrive: matched like scan pages.
    await fetchRecordsByIds(this.options.client, model, ids, {
      signal: run.abortController.signal,
      pool: run.pool,
      collect: false,
      onRecords: async (batch) => {
        for (const record of batch) found.add(record.id);
        let matched = 0;
        await this.commitRecords(run, model, batch, state, {
          onCommitted: (fully) => {
            for (const record of batch.slice(matched, matched + fully)) {
              left.delete(record.id);
            }
            matched += fully;
          },
        });
      },
    });
    this.assertActive(run.runId, run.abortController.signal);
    // Records that no longer exist: nothing left to look at.
    for (const id of ids) {
      if (!found.has(id)) left.delete(id);
    }
  }

  /** The record that reached the cap had matches left: the next round rechecks it in full. */
  private keepForRecheck(
    run: RunContext<T>,
    modelId: string,
    recordId: string,
  ): void {
    const left = run.recheckLeft.get(modelId) ?? new Set<string>();
    left.add(recordId);
    run.recheckLeft.set(modelId, left);
  }

  private handleModelError(
    run: RunContext<T>,
    model: DiscoveryModel,
    state: ScanState,
    error: unknown,
  ): void {
    if (!this.isActive(run.runId)) {
      throw new DiscoveryCancelledError();
    }
    if (error instanceof MatcherWorkerTimeoutError) {
      if (state.stop?.kind !== 'timeout') {
        state.stop = { kind: 'timeout', error };
        run.abortController.abort();
      }
      return;
    }
    // Aborted by the cap, or by a timeout in another model.
    if (state.stop) return;
    if (isDiscoveryCancelled(error)) throw error;

    // Targets already committed from this model stay (a retry dedupes).
    state.issues.push({
      modelId: model.id,
      modelName: model.name,
      phase: 'scan',
      message: errorMessage(error),
      cause: discoveryErrorCause(error),
      retryable: true,
    });
    this.markModelDone(run);
  }

  /**
   * Matches records and commits their targets, record by record, in order.
   * `onCommitted` is told, as they commit (once or in several steps), how
   * many more of the records had every target committed; the record that
   * reaches `maxTargets` doesn't count. Records in `skip` commit no target.
   */
  private async commitRecords(
    run: RunContext<T>,
    model: DiscoveryModel,
    records: ReadonlyArray<RawNestedItem>,
    state: ScanState,
    options: CommitOptions = {},
  ): Promise<void> {
    const signal = run.abortController.signal;
    this.assertActive(run.runId, signal);
    if (records.length === 0) return;
    const context: DiscoverRecordContext = {
      spec: run.spec,
      model,
      runId: run.runId,
      signal,
    };

    if (this.options.discoverRecords) {
      await this.commitBatch(run, records, state, context, options);
    } else {
      await this.commitOneByOne(run, records, state, context, options);
    }
    // Reaching the cap aborts the run: the source's scan must reject, even
    // when these were the model's last records, so nothing treats it as a
    // complete scan.
    throwIfDiscoveryCancelled(signal);
  }

  /** `discoverRecords`: one matcher call for the whole page. */
  private async commitBatch(
    run: RunContext<T>,
    records: ReadonlyArray<RawNestedItem>,
    state: ScanState,
    context: DiscoverRecordContext,
    { onCommitted, skip }: CommitOptions,
  ): Promise<void> {
    const discovered =
      (await this.options.discoverRecords?.(records, context)) ?? [];
    this.assertActive(run.runId, context.signal);
    const committed = run.stream.commitRecords(
      skip
        ? discovered.map((targets, index) =>
            skip.has(records[index]?.id ?? '') ? [] : targets,
          )
        : discovered,
      records.length,
    );
    onCommitted?.(run.stream.capped ? committed - 1 : committed);
    const cut = records[committed - 1];
    if (run.stream.capped && run.stream.cutShort && cut) {
      this.keepForRecheck(run, context.model.id, cut.id);
    }
    this.afterCommit(run, context.model, committed, state);
  }

  /** `discoverRecord`: one matcher call per record. */
  private async commitOneByOne(
    run: RunContext<T>,
    records: ReadonlyArray<RawNestedItem>,
    state: ScanState,
    context: DiscoverRecordContext,
    { onCommitted, skip }: CommitOptions,
  ): Promise<void> {
    for (const record of records) {
      const targets = skip?.has(record.id)
        ? []
        : // biome-ignore lint/performance/noAwaitInLoops: records are discovered and committed one at a time, in order.
          ((await this.options.discoverRecord?.(record, context)) ?? []);
      this.assertActive(run.runId, context.signal);
      const open = run.stream.commit(targets);
      if (open) onCommitted?.(1);
      if (!open && run.stream.cutShort) {
        this.keepForRecheck(run, context.model.id, record.id);
      }
      this.afterCommit(run, context.model, 1, state);
      if (!open) break;
    }
  }

  /** Progress, streaming and the cap check after some records were committed. */
  private afterCommit(
    run: RunContext<T>,
    model: DiscoveryModel,
    scanned: number,
    state: ScanState,
  ): void {
    const { stream } = run;
    this.currentSnapshot = {
      ...this.currentSnapshot,
      targetCount: stream.count,
      progress: {
        ...this.currentSnapshot.progress,
        recordsScanned: this.currentSnapshot.progress.recordsScanned + scanned,
        targetsFound: stream.count,
        currentModelId: model.id,
        currentModelName: model.name,
      },
    };
    stream.schedule();
    this.emit(run.listener);
    if (stream.capped && !state.stop) {
      state.stop = { kind: 'capped' };
      run.abortController.abort();
    }
  }

  private markModelDone(run: RunContext<T>): void {
    this.currentSnapshot = {
      ...this.currentSnapshot,
      progress: {
        ...this.currentSnapshot.progress,
        modelsCompleted: this.currentSnapshot.progress.modelsCompleted + 1,
      },
    };
    this.emit(run.listener);
  }

  /** Streams the last targets, then emits the snapshot the run settles with. */
  private settle(run: RunContext<T>, { stop, issues }: ScanState): void {
    run.stream.close();
    this.currentSnapshot = {
      ...this.currentSnapshot,
      positions: positionsOf(run),
      recheckLeft: Object.fromEntries(
        [...run.recheckLeft]
          .filter(([, left]) => left.size > 0)
          .map(([modelId, left]) => [modelId, [...left]]),
      ),
    };

    if (stop?.kind === 'timeout') {
      this.currentSnapshot = {
        ...this.currentSnapshot,
        status: 'failed',
        issues: [],
        complete: false,
        failureCode: 'pattern_timeout',
        error: stop.error.message,
      };
    } else {
      const sortedIssues = sortIssues(run.models, issues);
      const capped = stop?.kind === 'capped';
      const allModelsFailed =
        run.models.length > 0 && sortedIssues.length === run.models.length;
      this.currentSnapshot = {
        ...this.currentSnapshot,
        status: allModelsFailed
          ? 'failed'
          : sortedIssues.length > 0
            ? 'partial'
            : 'completed',
        issues: sortedIssues,
        complete: sortedIssues.length === 0 && !capped,
        capped,
        ...(allModelsFailed
          ? { error: 'Could not scan any of the selected models.' }
          : {}),
      };
    }
    this.finishRun(run.runId);
    this.emit(run.listener, true);
  }

  /** Ends a run that threw: cancelled (emitted once) or failed. */
  private abandon(run: RunContext<T>, error: unknown): void {
    if (this.currentSnapshot.runId !== run.runId) return;
    const cancelled = isDiscoveryCancelled(error);
    const alreadyEmitted =
      cancelled && this.currentSnapshot.status === 'cancelled';
    if (!alreadyEmitted) {
      this.currentSnapshot = cancelled
        ? { ...this.currentSnapshot, status: 'cancelled', complete: false }
        : {
            ...this.currentSnapshot,
            status: 'failed',
            complete: false,
            error: errorMessage(error),
          };
    }
    run.stream.close();
    this.finishRun(run.runId);
    if (!alreadyEmitted) this.emit(run.listener, true);
  }

  /**
   * Background counts: `recordsEstimated` becomes their sum once every one
   * resolved. A failure (or the run ending first) leaves it null.
   */
  private async runBackgroundCounts(
    run: RunContext<T>,
    signal: AbortSignal,
  ): Promise<void> {
    let total = 0;
    let resolved = 0;
    let failed = false;

    await mapWithConcurrency(
      run.models,
      MODEL_COUNT_CONCURRENCY,
      async (model) => {
        if (failed || signal.aborted) return;
        try {
          const count = await this.estimate(run, model, signal);
          // Added after the await: counts resolve concurrently.
          total += count;
          resolved += 1;
        } catch {
          // A count only feeds the estimate: without it the total stays unknown.
          failed = true;
        }
      },
    );

    if (failed || signal.aborted || resolved !== run.models.length) return;
    if (!this.isActive(run.runId)) return;
    this.currentSnapshot = {
      ...this.currentSnapshot,
      progress: { ...this.currentSnapshot.progress, recordsEstimated: total },
    };
    this.emit(run.listener);
  }

  /** Records the run will look at in a model: its count, minus what a resumed run skips, plus rechecks. */
  private async estimate(
    run: RunContext<T>,
    model: DiscoveryModel,
    signal: AbortSignal,
  ): Promise<number> {
    const rechecks = run.resume?.recheck?.get(model.id)?.length ?? 0;
    const previous = run.resume?.positions[model.id];
    if (previous === 'done') return rechecks;
    const count = await run.sourceFor(model).count({
      client: this.options.client,
      model,
      scope: run.scope,
      signal,
      pool: run.pool,
    });
    return rechecks + Math.max(0, count - resumeStart(previous));
  }

  /** The spec's (or the given) models, in the order given, without duplicates. */
  private modelsForSpec(
    spec: DiscoverySpec,
    onlyModelIds?: string[],
  ): DiscoveryModel[] {
    const configuredIds =
      onlyModelIds ??
      (this.options.modelIdsForSpec ?? defaultModelIdsForSpec)(spec);
    const selected = configuredIds.length
      ? configuredIds
          .map((id) => this.modelsById.get(id))
          .filter((model): model is DiscoveryModel => Boolean(model))
      : [...this.modelsById.values()];
    return [...new Map(selected.map((model) => [model.id, model])).values()];
  }

  private queryScopeForSpec(spec: DiscoverySpec): RecordQueryScope {
    return (this.options.queryScopeForSpec ?? defaultQueryScopeForSpec)(spec);
  }

  private isActive(runId: string): boolean {
    return this.active?.runId === runId;
  }

  private assertActive(runId: string, signal?: AbortSignal): void {
    throwIfDiscoveryCancelled(signal);
    if (!this.isActive(runId)) {
      throw new DiscoveryCancelledError();
    }
  }

  private finishRun(runId: string): void {
    if (this.active?.runId === runId) {
      this.active = undefined;
    }
    this.options.onRunFinished?.(runId);
  }

  private setCurrentModel(
    runId: string,
    model: DiscoveryModel,
    listener?: SnapshotListener<T>,
  ): void {
    if (!this.isActive(runId)) {
      return;
    }
    this.currentSnapshot = {
      ...this.currentSnapshot,
      progress: {
        ...this.currentSnapshot.progress,
        currentModelId: model.id,
        currentModelName: model.name,
      },
    };
    this.emit(listener);
  }

  /**
   * Intermediate snapshots are cheap (no targets); `final` ones materialize
   * the targets.
   */
  private emit(listener?: SnapshotListener<T>, final = false): void {
    const snapshot = final
      ? this.snapshot()
      : {
          ...this.currentSnapshot,
          progress: { ...this.currentSnapshot.progress },
          targets: [],
          issues: [...this.currentSnapshot.issues],
        };
    listener?.(snapshot);
    for (const registered of this.listeners) {
      registered(snapshot);
    }
  }
}

export function createDiscoveryController<T>(
  options: DiscoveryControllerOptions<T>,
): DiscoveryController<T> {
  return new DiscoveryController(options);
}

export function recordStatus(record: RawNestedItem): PublicationStatus {
  const status = record.meta.status;
  return status === 'updated' || status === 'published' ? status : 'draft';
}

export function recordUpdatedAt(record: RawNestedItem): string | null {
  return record.meta.updated_at ?? null;
}

export function recordCurrentVersion(record: RawNestedItem): string | null {
  return record.meta.current_version ?? null;
}
