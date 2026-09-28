/**
 * The search lifecycle (SPEC §6.1): debounce and minimum length, validation,
 * discovery runs (network or the record cache), cancel at the first
 * keystroke, Stop, the progress delay, the cap, failed models and their
 * retry, the worker timeout.
 *
 * A new search does not clear the screen when it starts: it stays `pending`
 * (what was shown stays: results, "No matches", idle) until it ends or has
 * run for `progressDelayMs`; only then does it become `searching` (its
 * results stream in, or the spinner shows). A search over cached records
 * usually ends first, so re-searching swaps the results at once, without a
 * blank or partial frame in between (SPEC-ADDENDUM A1).
 */

import type { Client } from '@datocms/cma-client-browser';
import {
  createSelectionDiscoveryController,
  type DiscoveredTarget,
  type MatchTraversedField,
} from '../selection/discoverTargets';
import {
  type DiscoveryController,
  type DiscoveryIssue,
  type DiscoveryRecordSource,
  type DiscoveryResume,
  type DiscoverySnapshot,
  type DiscoveryTimers,
  type ModelScanPosition,
  RESUME_OVERLAP,
} from '../selection/discovery';
import {
  type MatcherWorkerSession,
  validateMatcherSpec,
} from '../selection/matcher';
import type { DiscoveryModel } from '../selection/query';
import type { RequestPool } from '../selection/requestPool';
import { discoveryModelsOf } from '../selection/schemaIndex';
import type {
  DiscoverySpec,
  MatcherSpec,
  MatcherValidation,
  SchemaIndex,
} from '../selection/types';
import type {
  FindInput,
  FindOption,
  FindReplaceLimits,
  PatternProblem,
  ReplaceVerb,
  SearchPhase,
} from './contract';
import { estimateSecondsLeft, matcherSpecOf, sameFind } from './planning';
import type { RecordCache } from './recordCache';
import { ResultSet } from './viewModel';

export type SearchHooks = {
  /** The search state changed: emit now. */
  changed(): void;
  /** Results streamed in or progress moved: emit, throttled. */
  streamed(): void;
  /**
   * The results on screen are about to be replaced (by a new search's
   * results, or an empty set). `carry`: the new search repeats the settings
   * of the one being replaced. `clearing`: no new search follows (idle,
   * invalid, failed).
   */
  resetting(change: { carry: boolean; clearing: boolean }): void;
  /** A search settled (finished, capped, stopped, some models failed). Emits. */
  settled(info: { stopped: boolean; capped: boolean }): void;
  /** The phase became `invalid`. Emits. */
  invalid(problem: PatternProblem): void;
  /** Whether Esc may not clear the query (inclusions changed by hand). */
  hasManualSelection(): boolean;
};

export type SearchSessionOptions = {
  client: Client;
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  locales: ReadonlyArray<string>;
  limits: FindReplaceLimits;
  timers: DiscoveryTimers;
  cache: RecordCache;
  matchField?: MatchTraversedField;
  workerSessionFactory?: () => MatcherWorkerSession;
  hooks: SearchHooks;
  /**
   * Large projects: typing never starts or stops a search; Enter (or
   * "Search again") does. The toggles re-run the search shown on screen.
   */
  enterToSearch?: boolean;
  /** Clock for the time left. Defaults to `Date.now`. */
  now?: () => number;
  /** Request slots and pace shared with the other readers of the page. */
  pool?: RequestPool;
};

export type SearchProgress = { searched: number; total: number | null };

type ModelName = { id: string; name: string };

/** What a settled search reports besides its results. */
type SearchOutcome = {
  progress: SearchProgress;
  capped: boolean;
  stopped: boolean;
  failedModels: ReadonlyArray<ModelName>;
};

/**
 * A new search that hasn't replaced what is on screen yet: its results and
 * settings wait here until it is revealed.
 */
type IncomingSearch = {
  results: ResultSet;
  find: FindInput;
  matcher: MatcherSpec;
  /** Same settings as the results on screen: inclusions carry over. */
  carry: boolean;
  /** It reads on from where a capped search stopped. */
  continued: boolean;
};

/** Where a capped search stopped: "Search again" reads on from there. */
type Continuation = {
  find: FindInput;
  positions: Readonly<Record<string, ModelScanPosition>>;
  /** Records it was going to re-read but didn't get to. */
  recheckLeft: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Records dealt with in the rounds before it: never matched again. */
  skip: ReadonlySet<string>;
};

/** "Try again" for failed models: they are scanned again and merged in. */
type MergeScan = {
  models: ReadonlyArray<ModelName>;
  /** The outcome of the search being completed. */
  before: SearchOutcome;
};

/** The discovery run of the current search (or merge). */
type ActiveScan = {
  merge: MergeScan | null;
  /** Set when it reads on from where a capped search stopped. */
  resume: DiscoveryResume | null;
  /** Models whose scan delivered and matched every record. */
  completed: Set<string>;
  /** Models whose scan failed, as of the latest discovery snapshot. */
  issues: ReadonlyArray<DiscoveryIssue>;
};

type ScanRequest = {
  matcher: MatcherSpec;
  /** Only these models (a retry of failed models). */
  modelIds?: string[];
  /** Targets kept from before (a retry merges into them). */
  seedTargets?: ReadonlyArray<DiscoveredTarget>;
  /** Models read from the network even when cached. */
  network?: 'all' | ReadonlySet<string>;
  /** Reads on from where a capped search stopped. */
  resume?: DiscoveryResume;
};

const NO_PROGRESS: SearchProgress = { searched: 0, total: null };
const NO_MODELS: ReadonlyArray<ModelName> = [];

/** Text, long text, slug, Structured Text and SEO: every field find and replace can write. */
const SEARCHABLE_FIELD_TYPES: DiscoverySpec['fieldTypes'] = [
  'string',
  'text',
  'slug',
  'structured_text',
  'seo',
];

export const INITIAL_FIND: FindInput = {
  pattern: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

function patternProblemOf(
  validation: Exclude<MatcherValidation, { valid: true }>,
): PatternProblem {
  return validation.code === 'zero_width'
    ? { code: 'zero_width' }
    : { code: 'invalid_regex', cause: validation.cause };
}

function failureCause(
  snapshot: DiscoverySnapshot<DiscoveredTarget>,
): 'network' | 'unknown' {
  const { issues } = snapshot;
  return issues.length > 0 && issues.every((issue) => issue.cause === 'network')
    ? 'network'
    : 'unknown';
}

/** Marks each model whose record source delivered everything (`scan` resolved). */
function trackCompletion(
  source: DiscoveryRecordSource,
  completed: Set<string>,
): DiscoveryRecordSource {
  return (model) => {
    const inner = source(model);
    return {
      count: (context) => inner.count(context),
      scan: async (context) => {
        await inner.scan(context);
        completed.add(model.id);
      },
    };
  };
}

export class SearchSession {
  /** The controlled Find input. */
  find: FindInput = INITIAL_FIND;
  phase: SearchPhase = 'idle';
  /** What the body shows: the phase itself, or the phase before `pending`. */
  shownPhase: SearchPhase = 'idle';
  resultsId = 0;
  results: ResultSet;
  /** Settings and matcher of the search that produced `results`. */
  resultsFind: FindInput | null = null;
  resultsMatcher: MatcherSpec | null = null;
  showProgress = false;
  progress: SearchProgress = NO_PROGRESS;
  capped = false;
  stopped = false;
  failedModels: ReadonlyArray<ModelName> = NO_MODELS;
  patternProblem: PatternProblem | null = null;
  failure: { cause: 'network' | 'unknown' } | null = null;
  followsRun = false;
  /** Find settings of the last finished run session. */
  runFind: FindInput | null = null;
  /** The verb of the last finished run session. */
  runVerb: ReplaceVerb = 'replace';
  /** The results on screen read on from where a capped search stopped. */
  continued = false;
  /** Every searchable model, by name. */
  readonly models: ReadonlyArray<DiscoveryModel>;

  private readonly discovery: DiscoveryController<DiscoveredTarget>;
  private readonly hooks: SearchHooks;
  /** Identifies the current search; bumped by anything that ends it. */
  private sequence = 0;
  private scanning = false;
  private activeScan: ActiveScan | null = null;
  /** A started search that hasn't replaced the results on screen yet. */
  private incoming: IncomingSearch | null = null;
  /** A search runs while the phase is still `pending` (nothing of it shown yet). */
  private holding = false;
  /** The current search's progress while `holding` (`progress` is on screen). */
  private heldProgress: SearchProgress = NO_PROGRESS;
  private debounceHandle: unknown = null;
  private progressHandle: unknown = null;
  private disposed = false;
  /** Set when a search settles capped; any other search clears it. */
  private continuation: Continuation | null = null;
  /** When the running search began reading (for the time left). */
  private scanStartedAt: number | null = null;
  /** Records the running search replays from the cache (not in its pace). */
  private scanReplayed = 0;

  constructor(private readonly options: SearchSessionOptions) {
    this.hooks = options.hooks;
    this.results = this.emptyResults();
    this.models = discoveryModelsOf(options.schema).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    this.discovery = createSelectionDiscoveryController({
      client: options.client,
      schema: options.schema,
      siteId: options.siteId,
      environment: options.environment,
      workerSessionFactory: options.workerSessionFactory,
      matchField: options.matchField,
    });
  }

  // ─── Inputs ───────────────────────────────────────────────────────────────

  setPattern(pattern: string): void {
    if (this.disposed || pattern === this.find.pattern) return;
    this.find = { ...this.find, pattern };
    if (pattern.length === 0) {
      this.toIdle();
    } else if (this.options.enterToSearch) {
      // Enter searches: what runs and what is shown stay as they are.
      this.dropStaleProblem();
    } else if (pattern.length < this.minLength()) {
      this.toIdle();
    } else {
      this.toPending();
    }
    this.hooks.changed();
  }

  setOption(option: FindOption, on: boolean): void {
    if (this.disposed || this.find[option] === on) return;
    this.find = { ...this.find, [option]: on };
    const { length } = this.find.pattern;
    if (this.options.enterToSearch) {
      // Refining the search on screen runs it again; otherwise Enter does.
      if (length > 0 && this.showsPattern()) {
        this.start();
        return;
      }
      this.dropStaleProblem();
      this.hooks.changed();
      return;
    }
    if (length > 0 && length >= this.minLength()) {
      this.start();
      return;
    }
    if (length > 0) this.toIdle();
    this.hooks.changed();
  }

  /**
   * Enter: any length; on unchanged settings it searches again, except while
   * a search that reads for a long time (large projects, or reading on
   * after the cap) is already running for them.
   */
  searchNow(): void {
    if (this.disposed || this.find.pattern.length === 0) return;
    if (this.runsForField() && (this.enterToSearch || this.readsOn())) return;
    this.start();
  }

  /** Same as Enter, with every model read from the network. */
  retrySearch(): void {
    if (this.disposed || this.find.pattern.length === 0) return;
    this.start('all');
  }

  /**
   * The search on screen stopped at the cap (not stopped by hand) and the
   * field still holds its settings: "Search again" can read on from there.
   */
  canContinue(): boolean {
    const continuation = this.continuation;
    return (
      !this.disposed &&
      continuation !== null &&
      this.phase === 'settled' &&
      sameFind(this.find, continuation.find)
    );
  }

  /**
   * "Search again" once the matches of a capped search were replaced: reads
   * on from where it stopped, after re-reading `recheck` (records it showed
   * that still need a look); records in `skip` (dealt with) are read past.
   * Falls back to a new search when it can't.
   */
  continueSearch(
    recheck: ReadonlyMap<string, ReadonlyArray<string>>,
    skip: ReadonlySet<string>,
  ): void {
    const continuation = this.continuation;
    if (!(continuation && this.canContinue())) {
      this.searchNow();
      return;
    }
    const ids = new Map<string, Set<string>>();
    const add = (modelId: string, recordIds: Iterable<string>): void => {
      const set = ids.get(modelId) ?? new Set<string>();
      for (const id of recordIds) set.add(id);
      ids.set(modelId, set);
    };
    for (const [modelId, recordIds] of Object.entries(
      continuation.recheckLeft,
    )) {
      add(modelId, recordIds);
    }
    for (const [modelId, recordIds] of recheck) add(modelId, recordIds);
    this.start(undefined, {
      positions: continuation.positions,
      recheck: new Map([...ids].map(([modelId, set]) => [modelId, [...set]])),
      skip: new Set([...continuation.skip, ...skip]),
    });
  }

  /** Large projects: typing never starts a search, Enter does. */
  get enterToSearch(): boolean {
    return this.options.enterToSearch ?? false;
  }

  /**
   * Large projects: the field holds settings no search ran or runs for;
   * Enter searches them.
   */
  get awaitingEnter(): boolean {
    if (!this.options.enterToSearch || this.find.pattern.length === 0) {
      return false;
    }
    return !sameFind(this.find, this.incoming?.find ?? this.resultsFind);
  }

  /**
   * Seconds the running search still needs at its pace so far; null while
   * that isn't known yet.
   */
  secondsLeft(): number | null {
    if (this.phase !== 'searching' || this.scanStartedAt === null) return null;
    // Replayed records take a moment: the pace is the network's alone.
    const { searched, total } = this.progress;
    const replayed = this.scanReplayed;
    return estimateSecondsLeft(
      {
        searched: Math.max(0, searched - replayed),
        total: total === null ? null : Math.max(0, total - replayed),
      },
      this.now() - this.scanStartedAt,
    );
  }

  clearPattern(): void {
    if (this.disposed) return;
    this.find = { ...this.find, pattern: '' };
    this.toIdle();
    this.hooks.changed();
  }

  stopOrClear(): 'stopped' | 'cleared' | 'kept' {
    if (this.disposed) return 'kept';
    if (this.phase === 'searching') {
      this.stopSearch();
      return 'stopped';
    }
    if (this.find.pattern.length > 0 && !this.hooks.hasManualSelection()) {
      this.clearPattern();
      return 'cleared';
    }
    return 'kept';
  }

  /**
   * Stop: what was found stays, and the search settles as stopped. Models
   * whose scan had already failed stay listed as failed.
   */
  stopSearch(): void {
    if (this.disposed || !(this.phase === 'searching' || this.holding)) return;
    const scan = this.activeScan;
    // Delivers what was found so far and the models that failed.
    this.cancelActivity();
    this.reveal();
    if (scan?.merge) {
      this.settleMerge(scan.merge, scan.completed, null, true);
      return;
    }
    this.settle({
      progress: this.progress,
      stopped: true,
      capped: false,
      failedModels: this.failedModelsOf(scan?.issues ?? []),
    });
  }

  /**
   * "Try again" for failed models: only those are scanned again (from the
   * network), and what they hold is merged into the results. Whatever
   * happens, the results, inclusions and run session stay; models that fail
   * again are listed again.
   */
  retryFailedModels(): void {
    const matcher = this.resultsMatcher;
    if (
      this.disposed ||
      this.phase !== 'settled' ||
      this.failedModels.length === 0 ||
      !matcher ||
      !this.canRetryModels
    ) {
      return;
    }
    const models = this.failedModels;
    const modelIds = models.map((model) => model.id);
    const merge: MergeScan = {
      models,
      before: {
        progress: this.progress,
        capped: this.capped,
        stopped: this.stopped,
        failedModels: models,
      },
    };
    this.cancelActivity();
    this.phase = 'pending';
    this.holding = true;
    this.heldProgress = NO_PROGRESS;
    this.startProgressTimer();
    this.hooks.changed();
    this.beginScan(
      {
        matcher,
        modelIds,
        seedTargets: this.results.allTargets(),
        network: new Set(modelIds),
      },
      merge,
    );
  }

  /**
   * "Try again" for failed models merges them into the results: not when the
   * results are capped (seeded with them the merge couldn't add anything;
   * reading on after replacing reads those models from where they failed) or
   * read on from an earlier search (it would read them from the start).
   */
  get canRetryModels(): boolean {
    return !(this.capped || this.continued);
  }

  /** The debounce the next keystroke would use. */
  debounceMs(): number {
    const { limits, cache } = this.options;
    return cache.covers(this.models.map((model) => model.id))
      ? limits.cachedDebounceMs
      : limits.debounceMs;
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelActivity();
    this.dropIncoming();
    this.disposed = true;
  }

  // ─── Transitions ──────────────────────────────────────────────────────────

  private minLength(): number {
    return Math.max(1, this.options.limits.minAutoSearchLength);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** A search for the field's pattern is running, held or on screen. */
  private showsPattern(): boolean {
    const shown =
      this.phase === 'searching' || this.phase === 'settled'
        ? this.resultsFind
        : null;
    const searched = this.incoming?.find ?? shown;
    return searched !== null && searched.pattern === this.find.pattern;
  }

  /** A search for the field's settings is running or held. */
  private runsForField(): boolean {
    return (
      (this.holding || this.phase === 'searching') &&
      sameFind(this.find, this.incoming?.find ?? this.resultsFind)
    );
  }

  /** The running (or held) search reads on from where a capped one stopped. */
  private readsOn(): boolean {
    return this.incoming?.continued ?? this.continued;
  }

  /** Records a scan replays from the cache (read in a moment, no request). */
  private replayedRecords(request: ScanRequest): number {
    const { network, resume } = request;
    if (network === 'all') return 0;
    let total = 0;
    for (const id of request.modelIds ?? this.models.map((model) => model.id)) {
      const position = resume?.positions[id];
      const records = this.options.cache.fresh(id);
      if (network?.has(id) || position === 'done' || !records) continue;
      const start =
        typeof position === 'number'
          ? Math.max(0, position - RESUME_OVERLAP)
          : 0;
      total += Math.max(0, records.length - start);
    }
    return total;
  }

  /** Enter mode: a pattern problem describes settings the field no longer holds. */
  private dropStaleProblem(): void {
    if (this.phase === 'invalid') this.toIdle();
  }

  private emptyResults(): ResultSet {
    return new ResultSet({ showLocales: this.options.locales.length > 1 });
  }

  /**
   * Stops the timers and any running discovery at once (no further page is
   * requested). Targets found so far are still delivered.
   */
  private cancelActivity(): void {
    const { timers } = this.options;
    if (this.debounceHandle !== null) {
      timers.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.clearProgressTimer();
    if (this.scanning) {
      this.scanning = false;
      this.discovery.cancel();
    }
    this.activeScan = null;
    this.sequence += 1;
  }

  private clearProgressTimer(): void {
    if (this.progressHandle !== null) {
      this.options.timers.clearTimeout(this.progressHandle);
      this.progressHandle = null;
    }
    this.showProgress = false;
  }

  /** Forgets a search that never showed anything; the screen keeps what it shows. */
  private dropIncoming(): void {
    this.incoming = null;
    this.holding = false;
  }

  /** Replaces the results with `next` (an empty set by default; new `resultsId`). */
  private resetResults(
    change: { carry: boolean; clearing: boolean },
    next: ResultSet = this.emptyResults(),
  ): void {
    this.hooks.resetting(change);
    this.results = next;
    this.resultsId += 1;
  }

  private resetOutcome(): void {
    this.progress = NO_PROGRESS;
    this.capped = false;
    this.stopped = false;
    this.failedModels = NO_MODELS;
    this.patternProblem = null;
    this.failure = null;
  }

  private toIdle(): void {
    this.cancelActivity();
    this.dropIncoming();
    if (this.phase !== 'idle' || !this.results.isEmpty) {
      this.resetResults({ carry: false, clearing: true });
    }
    this.resultsFind = null;
    this.resultsMatcher = null;
    this.phase = 'idle';
    this.shownPhase = 'idle';
    this.followsRun = false;
    this.continued = false;
    this.continuation = null;
    this.resetOutcome();
  }

  /** A search is scheduled; the previous results stay until it shows something. */
  private toPending(): void {
    this.cancelActivity();
    this.dropIncoming();
    // `shownPhase` already names what the body shows.
    this.phase = 'pending';
    // Non-null only in their own phases (the lines belong to the old pattern).
    this.patternProblem = null;
    this.failure = null;
    const sequence = this.sequence;
    this.debounceHandle = this.options.timers.setTimeout(() => {
      this.debounceHandle = null;
      if (sequence === this.sequence) this.start();
    }, this.debounceMs());
  }

  private startProgressTimer(): void {
    const sequence = this.sequence;
    this.progressHandle = this.options.timers.setTimeout(() => {
      this.progressHandle = null;
      if (sequence !== this.sequence) return;
      this.reveal();
      this.showProgress = true;
      this.hooks.changed();
    }, this.options.limits.progressDelayMs);
  }

  private start(network?: 'all', resume?: DiscoveryResume): void {
    this.cancelActivity();
    this.dropIncoming();
    this.continuation = null;
    const find = this.find;
    const matcher = matcherSpecOf(find);
    const validation = validateMatcherSpec(matcher);
    if (!validation.valid) {
      this.becomeInvalid(find, patternProblemOf(validation));
      return;
    }

    this.incoming = {
      results: this.emptyResults(),
      find,
      matcher,
      carry: sameFind(find, this.resultsFind),
      continued: resume !== undefined,
    };
    this.holding = true;
    this.heldProgress = NO_PROGRESS;
    this.phase = 'pending';
    this.patternProblem = null;
    this.failure = null;
    this.startProgressTimer();
    this.hooks.changed();
    this.beginScan({ matcher, network, resume }, null);
  }

  /**
   * The running search replaces what is on screen and becomes `searching`: a
   * new search swaps in its results (inclusions carry over or reset, the run
   * session ends); a merge keeps them.
   */
  private reveal(): void {
    if (!this.holding) return;
    const { incoming } = this;
    this.dropIncoming();
    this.phase = 'searching';
    this.shownPhase = 'searching';
    if (incoming) {
      this.resetResults(
        { carry: incoming.carry, clearing: false },
        incoming.results,
      );
      this.resultsFind = incoming.find;
      this.resultsMatcher = incoming.matcher;
      // Reading on skipped the records dealt with: finding nothing proves
      // nothing about them.
      this.followsRun =
        !incoming.continued && sameFind(incoming.find, this.runFind);
      this.continued = incoming.continued;
      this.resetOutcome();
    }
    this.progress = this.heldProgress;
  }

  private becomeInvalid(find: FindInput | null, problem: PatternProblem): void {
    this.clearProgressTimer();
    this.dropIncoming();
    this.resetResults({ carry: false, clearing: true });
    this.resultsFind = find;
    this.resultsMatcher = null;
    this.phase = 'invalid';
    this.shownPhase = 'invalid';
    this.followsRun = false;
    this.continued = false;
    this.resetOutcome();
    this.patternProblem = problem;
    this.hooks.invalid(problem);
  }

  private becomeFailed(cause: 'network' | 'unknown'): void {
    this.clearProgressTimer();
    // The failure belongs to the settings that ran (Enter mode compares them).
    this.resultsFind = this.incoming?.find ?? this.resultsFind;
    this.resultsMatcher = null;
    this.dropIncoming();
    this.resetResults({ carry: false, clearing: true });
    this.phase = 'failed';
    this.shownPhase = 'failed';
    this.followsRun = false;
    this.continued = false;
    this.resetOutcome();
    this.failure = { cause };
    this.hooks.changed();
  }

  private settle(outcome: SearchOutcome): void {
    this.clearProgressTimer();
    this.dropIncoming();
    this.phase = 'settled';
    this.shownPhase = 'settled';
    this.progress = outcome.progress;
    this.stopped = outcome.stopped;
    this.capped = outcome.capped;
    this.failedModels =
      outcome.failedModels.length > 0 ? outcome.failedModels : NO_MODELS;
    this.hooks.settled({ stopped: outcome.stopped, capped: outcome.capped });
  }

  /**
   * A retry of failed models ended (finished, stopped, failed or timed out):
   * the results stay as they are, merged; retried models that didn't scan
   * completely are listed as failed again. The search it completes keeps its
   * stopped/capped state (its other models weren't scanned any further).
   * Called once revealed, so `progress` is the retry's own.
   */
  private settleMerge(
    merge: MergeScan,
    completed: ReadonlySet<string>,
    final: DiscoverySnapshot<DiscoveredTarget> | null,
    stoppedNow: boolean,
  ): void {
    const { before } = merge;
    this.settle({
      progress: {
        searched: before.progress.searched + this.progress.searched,
        total: before.progress.total,
      },
      stopped: before.stopped || stoppedNow,
      capped: before.capped || (final?.capped ?? false),
      failedModels: merge.models.filter((model) => !completed.has(model.id)),
    });
  }

  private failedModelsOf(
    issues: ReadonlyArray<DiscoveryIssue>,
  ): ReadonlyArray<ModelName> {
    const names = new Map(this.models.map((model) => [model.id, model.name]));
    return issues
      .filter((issue) => issue.phase === 'scan')
      .map((issue) => ({
        id: issue.modelId,
        name: names.get(issue.modelId) ?? issue.modelName,
      }));
  }

  // ─── Discovery ────────────────────────────────────────────────────────────

  private discoverySpec(matcher: MatcherSpec): DiscoverySpec {
    return {
      workflow: 'text',
      granularity: 'exact_match',
      rootModelIds: this.models.map((model) => model.id),
      locales: [...this.options.locales],
      publicationStatuses: [],
      fieldTypes: SEARCHABLE_FIELD_TYPES,
      matcher,
    };
  }

  private yieldToEventLoop = (): Promise<void> =>
    new Promise((resolve) => {
      this.options.timers.setTimeout(resolve, 0);
    });

  private beginScan(request: ScanRequest, merge: MergeScan | null): void {
    const scan: ActiveScan = {
      merge,
      resume: request.resume ?? null,
      completed: new Set(),
      issues: [],
    };
    this.activeScan = scan;
    void this.scan(this.sequence, request, scan);
  }

  private async scan(
    sequence: number,
    request: ScanRequest,
    scan: ActiveScan,
  ): Promise<void> {
    const { cache, limits, timers } = this.options;
    // After a run, the records it wrote are re-read into the cache first.
    await cache.whenRefreshed();
    if (sequence !== this.sequence) return;

    this.scanning = true;
    this.scanStartedAt = this.now();
    this.scanReplayed = this.replayedRecords(request);
    let final: DiscoverySnapshot<DiscoveredTarget> | null = null;
    try {
      final = await this.discovery.run(this.discoverySpec(request.matcher), {
        confirmedLargeRun: true,
        counts: 'background',
        maxTargets: limits.maxMatches,
        emitIntervalMs: limits.emitIntervalMs,
        timers,
        now: this.options.now,
        pool: this.options.pool,
        resume: request.resume,
        modelIds: request.modelIds,
        seedTargets: request.seedTargets,
        recordSource: trackCompletion(
          cache.recordSource({
            network: request.network,
            yieldToEventLoop: this.yieldToEventLoop,
          }),
          scan.completed,
        ),
        onTargets: (added) => {
          if (sequence === this.sequence) this.addTargets(added);
        },
        onSnapshot: (snapshot) => {
          if (sequence !== this.sequence) return;
          scan.issues = snapshot.issues;
          this.trackProgress(snapshot);
        },
      });
    } catch {
      final = null;
    }
    if (sequence !== this.sequence) return;
    this.scanning = false;
    this.activeScan = null;
    this.finish(final, scan);
  }

  /** New targets: kept aside until the search is revealed, else streamed. */
  private addTargets(added: ReadonlyArray<DiscoveredTarget>): void {
    const { incoming } = this;
    if (incoming) {
      incoming.results.add(added);
      return;
    }
    if (this.results.add(added) > 0) this.hooks.streamed();
  }

  private trackProgress(snapshot: DiscoverySnapshot<DiscoveredTarget>): void {
    const progress = {
      searched: snapshot.progress.recordsScanned,
      total: snapshot.progress.recordsEstimated,
    };
    if (this.holding) {
      // Nothing on screen shows it yet.
      this.heldProgress = progress;
      return;
    }
    if (
      progress.searched === this.progress.searched &&
      progress.total === this.progress.total
    ) {
      return;
    }
    this.progress = progress;
    this.hooks.streamed();
  }

  private finish(
    final: DiscoverySnapshot<DiscoveredTarget> | null,
    scan: ActiveScan,
  ): void {
    if (scan.merge) {
      // A retry never throws away what was found before it.
      this.reveal();
      this.settleMerge(
        scan.merge,
        scan.completed,
        final,
        final?.status === 'cancelled',
      );
      return;
    }
    if (!final) {
      this.becomeFailed('unknown');
      return;
    }
    if (final.status === 'failed' && final.failureCode === 'pattern_timeout') {
      this.becomeInvalid(this.incoming?.find ?? this.resultsFind, {
        code: 'too_slow',
      });
      return;
    }
    if (final.status === 'failed') {
      this.becomeFailed(failureCause(final));
      return;
    }

    this.reveal();
    if (final.capped && final.status !== 'cancelled') {
      this.continuation = {
        find: this.resultsFind ?? this.find,
        positions: final.positions,
        recheckLeft: final.recheckLeft,
        skip: scan.resume?.skip ?? new Set(),
      };
    }
    this.settle({
      progress: this.progress,
      stopped: final.status === 'cancelled',
      capped: final.capped,
      failedModels: this.failedModelsOf(final.issues),
    });
  }
}
