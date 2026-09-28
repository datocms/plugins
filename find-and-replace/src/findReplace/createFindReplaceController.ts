/**
 * The find and replace controller: composes the search session, the
 * inclusion model, the plan, the run session and the record cache, and
 * serves the page one immutable, structurally shared snapshot at a time.
 */

import { publishRecord } from '../replacement/publishRecord';
import { replaceInRecord } from '../replacement/replaceRecord';
import type { DiscoveredTarget } from '../selection/discoverTargets';
import {
  type DiscoveryTimers,
  READ_CONCURRENCY,
  READ_REQUESTS_PER_WINDOW,
  READ_WINDOW_MS,
} from '../selection/discovery';
import {
  fieldValueIdentity,
  selectionTargetFieldValue,
  stableSerialize,
} from '../selection/identity';
import { captureGroupInfo } from '../selection/matcher';
import { RequestPool } from '../selection/requestPool';
import type { MatcherSpec } from '../selection/types';
import {
  type CalloutView,
  type CreateFindReplaceControllerOptions,
  DEFAULT_LIMITS,
  type FindOption,
  type FindReplaceController,
  type FindReplaceEvent,
  type FindReplaceLimits,
  type FindReplaceSnapshot,
  type MetaView,
  type ModelFilterView,
  type NoResultsView,
  type PrimaryView,
  type PublishHoldReason,
  type PublishOffer,
  type RecordLink,
  type RecordPublishStatus,
  type RecordView,
  type ReplaceInput,
  type ReplacementCheck,
  type ReplaceVerb,
  type RunState,
  type SearchState,
  type SelectionView,
} from './contract';
import {
  carryOver,
  hasManualSelection,
  type InclusionState,
  initialInclusion,
  isIncluded,
  setAllIncluded,
  setMatchIncluded,
  setRecordIncluded,
} from './inclusion';
import { parseRecordKey, recordLink } from './links';
import {
  type CompiledReplacement,
  compileReplacement,
  deriveBody,
  deriveCallouts,
  deriveMeta,
  deriveNote,
  derivePrimary,
  emptyTally,
  isLiveModel,
  type MatchPlan,
  matcherSpecOf,
  type PlanTally,
  planFacts,
  planMatch,
  planToken,
  replacementCheck,
  replaceVerb,
  selectAllState,
  violatesSlugFormat,
} from './planning';
import { type PublishCandidate, PublishSession } from './publishSession';
import { RecordCache } from './recordCache';
import {
  type PassEnd,
  type PlannedRecord,
  RunSession,
  type SessionRecord,
} from './runSession';
import { SearchSession } from './searchSession';
import {
  HIGHLIGHT,
  type MatchEntry,
  type MatchState,
  NOT_PUBLISHABLE,
  type RecordEntry,
  recordMatches,
  recordView,
  reuseArray,
  sortAfterPass,
  UNTOUCHED,
} from './viewModel';

type UnloadTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

const globalTimers: DiscoveryTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultUnloadTarget(): UnloadTarget | null {
  return typeof window === 'undefined' ? null : window;
}

/** Deep equality for the small snapshot parts (a few levels, plain data). */
function sameData(left: unknown, right: unknown, depth: number): boolean {
  if (Object.is(left, right)) return true;
  if (
    depth === 0 ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => sameData(leftRecord[key], rightRecord[key], depth - 1))
  );
}

/** `previous` when it holds the same data as `next`, so identities stay stable. */
function reuse<T>(previous: T | undefined, next: T): T {
  return previous !== undefined && sameData(previous, next, 4)
    ? previous
    : next;
}

type RecordCounts = { changing: number };

/** Whether publishing a replaced record would put only the replacement live. */
type Publishability =
  | { kind: 'ready'; expectedVersion: string }
  | { kind: 'held'; reason: PublishHoldReason };

const READY_TO_PUBLISH: RecordPublishStatus = { kind: 'ready' };
const HELD: Readonly<Record<PublishHoldReason, RecordPublishStatus>> = {
  other_changes: { kind: 'held', reason: 'other_changes' },
  never_published: { kind: 'held', reason: 'never_published' },
};

/**
 * What stays as it was when the running pass started: while records are
 * written, only their statuses and final text change (SPEC S14).
 */
type FrozenChrome = {
  meta: MetaView;
  selectAll: SelectionView['all'];
  callouts: ReadonlyArray<CalloutView>;
};

function countMatch(
  tally: PlanTally,
  counts: RecordCounts,
  match: MatchEntry,
  included: boolean,
  plan: MatchPlan,
): void {
  if (included) tally.includedMatches += 1;
  if (!plan.changing) return;
  tally.changingMatches += 1;
  counts.changing += 1;
  if (!match.isSlug) return;
  tally.slugMatches += 1;
  if (plan.inserted !== null && violatesSlugFormat(plan.inserted)) {
    tally.slugFormatMatches += 1;
  }
}

class FindReplaceStore {
  private readonly limits: FindReplaceLimits;
  private readonly timers: DiscoveryTimers;
  private readonly cache: RecordCache;
  private readonly search: SearchSession;
  private readonly run: RunSession;
  private readonly publishing: PublishSession;
  private readonly canPublishModel: (modelId: string) => boolean;

  private replaceInput: ReplaceInput = { text: '', remove: false };
  private inclusion: InclusionState = initialInclusion();
  private inclusionRevision = 0;
  private modelFilter: string | null = null;
  /** Records re-sorted after a pass (for one result set). */
  private displayOrder: { resultsId: number; records: RecordEntry[] } | null =
    null;
  /** Model filter shown: re-evaluated only when a search settles or clears. */
  private filterLatch = false;
  /** Eraser shown: sticky while a new search is pending or running. */
  private eraserLatch = false;
  /** The meta, "Select all" and callouts frozen while a pass runs. */
  private frozen: FrozenChrome | null = null;
  private busy: { verb: ReplaceVerb; count: number } = {
    verb: 'replace',
    count: 0,
  };
  /** Records the running publish pass set out to publish. */
  private publishBusyCount = 0;
  private readonly views = new Map<string, RecordView>();
  private viewsResultsId = -1;
  private readonly compiled = new Map<string, CompiledReplacement>();
  private groupCountMemo: { key: string; count: number } | null = null;

  private snapshot: FindReplaceSnapshot;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<
    (event: FindReplaceEvent) => void
  >();
  private cooldown: unknown = null;
  private dirty = false;
  private disposed = false;

  constructor(private readonly options: CreateFindReplaceControllerOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.timers = options.timers ?? globalTimers;
    this.canPublishModel = options.canPublishModel ?? (() => false);
    const unloadTarget =
      options.unloadTarget === undefined
        ? defaultUnloadTarget()
        : options.unloadTarget;
    // Every read of the page (searches, the post-run refresh) shares one
    // budget: at most READ_CONCURRENCY in flight, READ_REQUESTS_PER_WINDOW
    // started per READ_WINDOW_MS.
    const readPool = new RequestPool({
      concurrency: READ_CONCURRENCY,
      perWindow: READ_REQUESTS_PER_WINDOW,
      windowMs: READ_WINDOW_MS,
      timers: this.timers,
      now: options.now,
    });
    this.cache = new RecordCache({
      maxRecords: this.limits.cacheMaxRecords,
      maxBytes: this.limits.cacheMaxBytes,
      ttlMs: this.limits.cacheTtlMs,
      pool: readPool,
    });
    this.search = new SearchSession({
      client: options.client,
      schema: options.schema,
      siteId: options.siteId,
      environment: options.environment,
      locales: options.locales,
      limits: this.limits,
      timers: this.timers,
      cache: this.cache,
      matchField: options.matchField,
      workerSessionFactory: options.workerSessionFactory,
      enterToSearch:
        options.recordCount != null &&
        options.recordCount > this.limits.enterToSearchAbove,
      now: options.now,
      pool: readPool,
      hooks: {
        changed: () => this.emitNow(),
        streamed: () => this.emitStreamed(),
        resetting: (change) => this.onResultsReset(change),
        settled: (info) => this.onSettled(info),
        invalid: (problem) => {
          this.filterLatch = false;
          this.emitNow();
          this.dispatch({ type: 'patternInvalid', problem });
        },
        hasManualSelection: () => hasManualSelection(this.inclusion),
      },
    });
    this.run = new RunSession({
      write: (record, template, unconfirmed) =>
        replaceInRecord({
          client: options.client,
          schema: options.schema,
          siteId: options.siteId,
          environment: options.environment,
          locales: options.locales,
          entries: record.entries,
          template,
          unconfirmed,
        }),
      unloadTarget,
      hooks: {
        changed: () => this.emitNow(),
        event: (event) => this.dispatch(event),
        passEnded: (end) => this.onPassEnded(end),
      },
    });
    this.publishing = new PublishSession({
      publish: (candidate) =>
        publishRecord({
          client: options.client,
          schema: options.schema,
          recordId: candidate.recordId,
          expectedVersion: candidate.expectedVersion,
        }),
      unloadTarget,
      hooks: {
        changed: () => this.emitNow(),
        event: (event) => this.dispatch(event),
      },
    });
    this.snapshot = this.build();
  }

  // ─── Store ────────────────────────────────────────────────────────────────

  getSnapshot(): FindReplaceSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeEvents(listener: (event: FindReplaceEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private emitNow(): void {
    if (this.disposed) return;
    this.dirty = false;
    this.snapshot = this.build();
    for (const listener of [...this.listeners]) listener();
  }

  /** Streaming changes: at most one emit every `emitIntervalMs`. */
  private emitStreamed(): void {
    if (this.disposed) return;
    if (this.cooldown !== null) {
      this.dirty = true;
      return;
    }
    this.emitNow();
    this.startCooldown();
  }

  private startCooldown(): void {
    this.cooldown = this.timers.setTimeout(() => {
      this.cooldown = null;
      if (!this.dirty || this.disposed) return;
      this.emitNow();
      this.startCooldown();
    }, this.limits.emitIntervalMs);
  }

  private dispatch(event: FindReplaceEvent): void {
    if (this.disposed) return;
    for (const listener of [...this.eventListeners]) listener(event);
  }

  /** A replace or publish pass is running: the page is read-only. */
  private get writing(): boolean {
    return this.run.isActive || this.publishing.isActive;
  }

  /** Mutations are ignored while a pass runs (the page disables them) and after dispose. */
  private get locked(): boolean {
    return this.disposed || this.writing;
  }

  // ─── Find ─────────────────────────────────────────────────────────────────

  setPattern(pattern: string): void {
    if (!this.locked) this.search.setPattern(pattern);
  }

  setOption(option: FindOption, on: boolean): void {
    if (!this.locked) this.search.setOption(option, on);
  }

  searchNow(): void {
    if (!this.locked) this.searchOrContinue();
  }

  clearPattern(): void {
    if (!this.locked) this.search.clearPattern();
  }

  stopOrClear(): 'stopped' | 'cleared' | 'kept' {
    return this.locked ? 'kept' : this.search.stopOrClear();
  }

  stopSearch(): void {
    if (!this.disposed) this.search.stopSearch();
  }

  searchAgain(): void {
    if (!this.locked) this.searchOrContinue();
  }

  /**
   * After a finished run on results that stopped at the cap, the search reads
   * on from there; otherwise it starts over.
   */
  private searchOrContinue(): void {
    if (this.run.phase === 'finished' && this.search.canContinue()) {
      const { recheck, skip } = this.recordsToRevisit();
      this.search.continueSearch(recheck, skip);
    } else {
      this.search.searchNow();
    }
  }

  /**
   * The records on screen, sorted for reading on. `recheck` (by model):
   * their matches still need a look, as they were planned but not replaced
   * (failed, skipped, never written), or never planned while holding an
   * included match (out of the model filter). `skip`: dealt with, as they
   * were replaced, or left out entirely.
   */
  private recordsToRevisit(): {
    recheck: Map<string, string[]>;
    skip: Set<string>;
  } {
    const recheck = new Map<string, string[]>();
    const skip = new Set<string>();
    for (const entry of this.search.results.records) {
      const session = this.run.record(entry.key);
      const unfinished = session
        ? session.status.kind !== 'replaced'
        : this.holdsIncludedMatch(entry);
      if (!unfinished) {
        skip.add(entry.recordId);
        continue;
      }
      const ids = recheck.get(entry.modelId) ?? [];
      ids.push(entry.recordId);
      recheck.set(entry.modelId, ids);
    }
    return { recheck, skip };
  }

  private holdsIncludedMatch(entry: RecordEntry): boolean {
    for (const match of recordMatches(entry)) {
      if (isIncluded(this.inclusion, match)) return true;
    }
    return false;
  }

  retryFailedModels(): void {
    if (
      !this.locked &&
      this.run.phase !== 'finished' &&
      this.search.canRetryModels
    ) {
      this.search.retryFailedModels();
    }
  }

  retrySearch(): void {
    if (!this.locked) this.search.retrySearch();
  }

  // ─── Replacement ──────────────────────────────────────────────────────────

  setReplacementText(text: string): void {
    if (this.locked || text === this.replaceInput.text) return;
    this.replaceInput = { ...this.replaceInput, text };
    this.emitNow();
  }

  setRemove(on: boolean): void {
    if (this.locked || on === this.replaceInput.remove) return;
    this.replaceInput = { ...this.replaceInput, remove: on };
    this.emitNow();
  }

  clearReplacement(): void {
    this.setReplacementText('');
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  private get selectionLocked(): boolean {
    return this.locked || this.run.phase === 'finished';
  }

  private setInclusion(next: InclusionState): void {
    if (next === this.inclusion) return;
    this.inclusion = next;
    this.inclusionRevision += 1;
    this.emitNow();
  }

  setAllIncluded(included: boolean): void {
    if (this.selectionLocked) return;
    const inScope: MatchEntry[] = [];
    const outOfScope: MatchEntry[] = [];
    for (const entry of this.search.results.records) {
      const selectable =
        this.inFilter(entry.modelId) && !this.run.isAttempted(entry.key);
      for (const match of recordMatches(entry)) {
        (selectable ? inScope : outOfScope).push(match);
      }
    }
    this.setInclusion(
      setAllIncluded(this.inclusion, included, { inScope, outOfScope }),
    );
  }

  setRecordIncluded(recordKey: string, included: boolean): void {
    const entry = this.search.results.record(recordKey);
    if (this.selectionLocked || !entry || this.run.isAttempted(recordKey)) {
      return;
    }
    this.setInclusion(
      setRecordIncluded(
        this.inclusion,
        recordKey,
        included,
        recordMatches(entry),
      ),
    );
  }

  setMatchIncluded(matchKey: string, included: boolean): void {
    const match = this.search.results.match(matchKey);
    const entry = match
      ? this.search.results.record(match.recordKey)
      : undefined;
    if (
      this.selectionLocked ||
      !match ||
      !entry ||
      this.run.isAttempted(entry.key)
    ) {
      return;
    }
    this.setInclusion(
      setMatchIncluded(this.inclusion, match, included, recordMatches(entry)),
    );
  }

  // ─── Model filter ─────────────────────────────────────────────────────────

  setModelFilter(modelId: string | null): void {
    if (this.locked) return;
    const next =
      modelId !== null &&
      this.search.models.some((model) => model.id === modelId)
        ? modelId
        : null;
    if (next === this.modelFilter) return;
    this.modelFilter = next;
    this.emitNow();
  }

  private inFilter(modelId: string): boolean {
    return this.modelFilter === null || this.modelFilter === modelId;
  }

  private readonly inScope = (modelId: string): boolean =>
    this.inFilter(modelId);

  // ─── Run ──────────────────────────────────────────────────────────────────

  replace(token: string): boolean {
    if (this.locked) return false;
    if (this.dirty) this.emitNow();
    const { plan } = this.snapshot;
    if (!plan || plan.token !== token) return false;

    const display = this.displayReplacement();
    if (!(display.verb && display.template)) return false;
    const records = this.freezePlan(display);
    if (records.length === 0) return false;

    this.freezeChrome();
    this.busy = { verb: display.verb, count: plan.matchCount };
    return this.run.start({
      verb: display.verb,
      template: display.template,
      find: this.search.resultsFind,
      records,
    });
  }

  stopReplace(): void {
    if (!this.disposed) this.run.stop();
  }

  retryFailedRecords(): void {
    if (this.locked) return;
    const keys = this.run.retryableKeys(
      this.shownRecordEntries().map((entry) => entry.key),
    );
    if (keys.length === 0) return;
    let count = 0;
    for (const key of keys) {
      count += this.run.record(key)?.plan.inserted.size ?? 0;
    }
    if (this.dirty) this.emitNow();
    this.freezeChrome();
    this.busy = { verb: this.run.verb, count };
    this.run.retry(keys);
  }

  // ─── Publish ──────────────────────────────────────────────────────────────

  publish(token: string): boolean {
    if (this.locked) return false;
    if (this.dirty) this.emitNow();
    const { primary } = this.snapshot;
    if (primary.kind !== 'searchAgain' || primary.publish?.token !== token) {
      return false;
    }
    const { candidates } = this.publishCandidates();
    if (candidates.length === 0) return false;
    this.publishBusyCount = candidates.length;
    return this.publishing.start(candidates);
  }

  stopPublish(): void {
    if (!this.disposed) this.publishing.stop();
  }

  /**
   * A replaced record may be published afterwards only when that puts just
   * the replacement live: its model has drafts, the role can publish it, and
   * it was fully published right before the write.
   */
  private publishability(session: SessionRecord): Publishability | null {
    const { publication } = session;
    if (session.status.kind !== 'replaced' || !publication) return null;
    const { modelId } = session.plan;
    if (
      isLiveModel(this.options.schema, modelId) ||
      !this.canPublishModel(modelId)
    ) {
      return null;
    }
    if (publication.statusBefore === 'published') {
      return publication.versionAfter === null
        ? null
        : { kind: 'ready', expectedVersion: publication.versionAfter };
    }
    return {
      kind: 'held',
      reason:
        publication.statusBefore === 'draft'
          ? 'never_published'
          : 'other_changes',
    };
  }

  private recordPublishStatus(session: SessionRecord): RecordPublishStatus {
    const attempt = this.publishing.status(session.plan.key);
    if (attempt) return attempt;
    const publishability = this.publishability(session);
    if (!publishability) return NOT_PUBLISHABLE;
    if (publishability.kind === 'ready') return READY_TO_PUBLISH;
    // Held records are explained once publishing has happened, not before.
    return this.publishing.phase === 'none'
      ? NOT_PUBLISHABLE
      : HELD[publishability.reason];
  }

  /** In display order: records the next pass publishes, and the replaced ones it leaves out. */
  private publishCandidates(): {
    candidates: PublishCandidate[];
    held: number;
  } {
    const candidates: PublishCandidate[] = [];
    let held = 0;
    for (const entry of this.shownRecordEntries()) {
      const session = this.run.record(entry.key);
      const publishability = session?.attempted
        ? this.publishability(session)
        : null;
      if (!publishability) continue;
      if (publishability.kind === 'held') {
        held += 1;
        continue;
      }
      const attempt = this.publishing.status(entry.key);
      if (attempt && !(attempt.kind === 'failed' && attempt.retryable)) {
        continue;
      }
      candidates.push({
        key: entry.key,
        recordId: entry.recordId,
        expectedVersion: publishability.expectedVersion,
      });
    }
    return { candidates, held };
  }

  private publishOffer(): PublishOffer | null {
    const { candidates, held } = this.publishCandidates();
    if (candidates.length === 0) return null;
    return {
      token: [
        'publish',
        this.search.resultsId,
        this.run.revision,
        this.publishing.revision,
        this.modelFilter ?? '',
      ].join(':'),
      recordCount: candidates.length,
      heldCount: held,
    };
  }

  private freezeChrome(): void {
    const { meta, selection, callouts } = this.snapshot;
    this.frozen = { meta, selectAll: selection.all, callouts };
  }

  /** The changing matches of the records in scope, frozen in display order. */
  private freezePlan(display: CompiledReplacement): PlannedRecord[] {
    const planned: PlannedRecord[] = [];
    for (const entry of this.shownRecordEntries()) {
      if (this.run.isAttempted(entry.key)) continue;
      const record = this.freezeRecord(entry, display);
      if (record) planned.push(record);
    }
    return planned;
  }

  private freezeRecord(
    entry: RecordEntry,
    display: CompiledReplacement,
  ): PlannedRecord | null {
    const inserted = new Map<string, string>();
    const inclusion = new Map<string, boolean>();
    const targets: DiscoveredTarget[] = [];
    for (const match of recordMatches(entry)) {
      const included = isIncluded(this.inclusion, match);
      inclusion.set(match.key, included);
      const plan = planMatch(display, match.ref, included);
      if (plan.changing && plan.inserted !== null) {
        inserted.set(match.key, plan.inserted);
        targets.push(match.target);
      }
    }
    if (targets.length === 0) return null;
    return {
      key: entry.key,
      recordId: entry.recordId,
      modelId: entry.modelId,
      entries: targets,
      inserted,
      inclusion,
    };
  }

  // ─── Links and lifetime ───────────────────────────────────────────────────

  recordLink(recordKey: string): RecordLink {
    const parsed = parseRecordKey(recordKey);
    const linkOptions = {
      internalDomain: this.options.links.internalDomain,
      isEnvironmentPrimary: this.options.links.isEnvironmentPrimary,
      environment: this.options.environment,
    };
    return parsed
      ? recordLink(linkOptions, parsed.modelId, parsed.recordId)
      : recordLink(linkOptions, '', recordKey);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.cooldown !== null) {
      this.timers.clearTimeout(this.cooldown);
      this.cooldown = null;
    }
    this.search.dispose();
    this.run.dispose();
    this.publishing.dispose();
    this.cache.clear();
    this.listeners.clear();
    this.eventListeners.clear();
  }

  // ─── Session hooks ────────────────────────────────────────────────────────

  private onResultsReset(change: { carry: boolean; clearing: boolean }): void {
    this.inclusion = change.carry
      ? carryOver(
          this.inclusion,
          this.search.results.matches(),
          this.writtenExclusions(),
        )
      : initialInclusion();
    this.inclusionRevision += 1;
    this.publishing.end();
    this.run.end();
    this.frozen = null;
    this.displayOrder = null;
    if (change.clearing) this.filterLatch = false;
  }

  private onSettled(info: { stopped: boolean; capped: boolean }): void {
    const { results } = this.search;
    this.filterLatch = results.modelsWithMatches >= 2;
    this.emitNow();
    const filter = this.modelFilter;
    this.dispatch({
      type: 'searchSettled',
      matches:
        filter === null ? results.matchCount : results.modelMatchCount(filter),
      records:
        filter === null
          ? results.recordCount
          : results.modelRecordCount(filter),
      capped: info.capped,
      stopped: info.stopped,
    });
  }

  private onPassEnded(end: PassEnd): void {
    this.displayOrder = {
      resultsId: this.search.resultsId,
      records: sortAfterPass(this.orderedRecords(), (entry) =>
        this.run.status(entry.key),
      ),
    };
    this.frozen = null;
    if (end.phase === 'finished') {
      this.search.runFind = this.run.find;
      this.search.runVerb = this.run.verb;
    }
    this.refreshCache(end.attempted);
  }

  /**
   * Field values the run session wrote while one of their matches was left
   * out (by the user, or as a slug): what remains in them after the write is
   * what was left out, so it starts excluded in the next search.
   */
  private writtenExclusions(): Set<string> {
    const fields = new Set<string>();
    for (const plan of this.run.writtenPlans()) {
      const entry = this.search.results.record(plan.key);
      if (!entry) continue;
      const written = new Set(
        plan.entries.map((target) =>
          fieldValueIdentity(selectionTargetFieldValue(target.target)),
        ),
      );
      for (const match of recordMatches(entry)) {
        if (
          written.has(match.fieldKey) &&
          plan.inclusion.get(match.key) === false
        ) {
          fields.add(match.fieldKey);
        }
      }
    }
    return fields;
  }

  /** The records a pass attempted are re-read into the cache. */
  private refreshCache(attempted: ReadonlyArray<PlannedRecord>): void {
    const idsByModel = new Map<string, string[]>();
    for (const record of attempted) {
      const ids = idsByModel.get(record.modelId) ?? [];
      ids.push(record.recordId);
      idsByModel.set(record.modelId, ids);
    }
    if (idsByModel.size === 0) return;
    const models = new Map(
      this.search.models.map((model) => [model.id, model]),
    );
    void this.cache.refresh(
      this.options.client,
      (modelId) => models.get(modelId),
      idsByModel,
    );
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  private compile(matcher: MatcherSpec): CompiledReplacement {
    const key = stableSerialize([matcher, this.replaceInput]);
    const cached = this.compiled.get(key);
    if (cached) return cached;
    if (this.compiled.size >= 4) this.compiled.clear();
    const compiled = compileReplacement(this.replaceInput, matcher);
    this.compiled.set(key, compiled);
    return compiled;
  }

  /** The replacement compiled against the matcher of the results it previews. */
  private displayReplacement(): CompiledReplacement {
    return this.compile(
      this.search.resultsMatcher ?? matcherSpecOf(this.search.find),
    );
  }

  private groupCount(matcher: MatcherSpec): number {
    const key = `${matcher.kind}:${matcher.pattern}`;
    if (this.groupCountMemo?.key !== key) {
      this.groupCountMemo = { key, count: captureGroupInfo(matcher).count };
    }
    return this.groupCountMemo.count;
  }

  private orderedRecords(): ReadonlyArray<RecordEntry> {
    const { results, resultsId } = this.search;
    const order = this.displayOrder;
    if (!order || order.resultsId !== resultsId) return results.records;
    if (order.records.length !== results.recordCount) {
      // Records merged after the sort (a retry of failed models) go last.
      const known = new Set(order.records.map((entry) => entry.key));
      order.records = [
        ...order.records,
        ...results.records.filter((entry) => !known.has(entry.key)),
      ];
    }
    return order.records;
  }

  /** In scope, in display order; the report shows only what the session attempted. */
  private shownRecordEntries(): RecordEntry[] {
    const report = this.run.showsReport;
    return this.orderedRecords().filter(
      (entry) =>
        this.inFilter(entry.modelId) &&
        (!report || this.run.isAttempted(entry.key)),
    );
  }

  private selectionUi(verb: ReplaceVerb | null): SelectionView['ui'] {
    if (verb === null || this.run.showsReport) return 'hidden';
    return this.run.isActive ? 'disabled' : 'enabled';
  }

  private liveView(
    entry: RecordEntry,
    display: CompiledReplacement,
    selectionVisible: boolean,
    tally: PlanTally,
  ): RecordView {
    const counts: RecordCounts = { changing: 0 };
    const selectableMatches = selectionVisible && entry.matchCount >= 2;
    const stateOf = (match: MatchEntry): MatchState => {
      const included = isIncluded(this.inclusion, match);
      const plan = planMatch(display, match.ref, included);
      countMatch(tally, counts, match, included, plan);
      return {
        included,
        selectable: selectableMatches,
        display: plan.display,
      };
    };
    const view = recordView(
      entry,
      {
        title: entry.title,
        selectable: selectionVisible,
        status: UNTOUCHED,
        publish: NOT_PUBLISHABLE,
      },
      stateOf,
      this.views.get(entry.key),
    );

    tally.selectableRecords += 1;
    if (view.inclusion === 'all') tally.selectableAll += 1;
    if (view.inclusion === 'none') tally.selectableNone += 1;
    if (counts.changing > 0) {
      tally.changingRecords += 1;
      if (isLiveModel(this.options.schema, entry.modelId)) {
        tally.liveRecords += 1;
      }
      tally.firstChangingRecord ??= { id: entry.recordId, title: view.title };
    }
    return view;
  }

  /** A record attempted in the run session: frozen with what its write used. */
  private frozenView(entry: RecordEntry, session: SessionRecord): RecordView {
    const written = session.status.kind === 'replaced';
    const stateOf = (match: MatchEntry): MatchState => {
      const included = session.plan.inclusion.get(match.key) ?? false;
      const inserted = session.plan.inserted.get(match.key);
      if (inserted === undefined) {
        return { included, selectable: false, display: HIGHLIGHT };
      }
      return {
        included,
        selectable: false,
        display: written
          ? { kind: 'final', inserted }
          : { kind: 'diff', inserted },
      };
    };
    return recordView(
      entry,
      {
        title: session.title ? session.title.value : entry.title,
        selectable: false,
        status: session.status,
        publish: this.recordPublishStatus(session),
      },
      stateOf,
      this.views.get(entry.key),
    );
  }

  private buildRecords(
    display: CompiledReplacement,
    selectionUi: SelectionView['ui'],
    tally: PlanTally,
  ): ReadonlyArray<RecordView> {
    if (this.viewsResultsId !== this.search.resultsId) {
      this.views.clear();
      this.viewsResultsId = this.search.resultsId;
    }
    const views: RecordView[] = [];
    for (const entry of this.shownRecordEntries()) {
      tally.foundMatches += entry.matchCount;
      tally.foundRecords += 1;
      const session = this.run.record(entry.key);
      const view = session?.attempted
        ? this.frozenView(entry, session)
        : this.liveView(entry, display, selectionUi !== 'hidden', tally);
      this.views.set(entry.key, view);
      views.push(view);
    }
    return reuseArray(this.snapshot?.records, views);
  }

  private updateEraserLatch(tally: PlanTally): void {
    const { phase } = this.search;
    if (tally.foundMatches > 0) {
      this.eraserLatch = true;
    } else if (phase !== 'pending' && phase !== 'searching') {
      this.eraserLatch = false;
    }
  }

  private searchState(): SearchState {
    const { search } = this;
    return {
      phase: search.phase,
      resultsId: search.resultsId,
      showProgress: search.showProgress,
      progress: search.progress,
      capped: search.capped,
      stopped: search.stopped,
      failedModels: search.failedModels,
      patternProblem: search.patternProblem,
      failure: search.failure,
      followsRun: search.followsRun,
      continued: search.continued,
      secondsLeft: search.secondsLeft(),
    };
  }

  private selectedModel(): { id: string; name: string } | null {
    const model = this.search.models.find(
      (candidate) => candidate.id === this.modelFilter,
    );
    return model ? { id: model.id, name: model.name } : null;
  }

  private modelFilterView(): ModelFilterView {
    const { search } = this;
    const failed = new Set(search.failedModels.map((model) => model.id));
    return {
      visible: this.modelFilter !== null || this.filterLatch,
      enabled: !this.writing,
      selected: this.selectedModel(),
      options: search.models.map((model) => ({
        id: model.id,
        name: model.name,
        matchCount: failed.has(model.id)
          ? null
          : search.results.modelMatchCount(model.id),
      })),
      allMatchCount: search.results.matchCount,
      partial: search.capped || search.stopped,
    };
  }

  private noResultsView(): NoResultsView {
    const { search } = this;
    const settings = search.resultsFind ?? search.find;
    const selected = this.selectedModel();
    return {
      followsRun: search.followsRun,
      continued: search.continued,
      runVerb: search.runVerb,
      caseSensitive: settings.caseSensitive,
      wholeWord: settings.wholeWord,
      regex: settings.regex,
      filteredModelName: selected?.name ?? null,
      otherModelsHaveMatches:
        selected !== null && search.results.matchCount > 0,
    };
  }

  private runState(): RunState {
    const { run } = this;
    const ended = run.phase === 'stopped' || run.phase === 'finished';
    return {
      phase: run.phase,
      verb: run.verb,
      progress: run.progress,
      totals: ended ? run.totals() : null,
    };
  }

  private replacementCheck(tally: PlanTally): ReplacementCheck {
    const matcher = matcherSpecOf(this.search.find);
    return replacementCheck({
      replacement: this.compile(matcher),
      find: this.search.find,
      groupCount: this.groupCount(matcher),
      slugFormatMatches: tally.slugFormatMatches,
    });
  }

  private primaryView(
    verb: ReplaceVerb | null,
    display: CompiledReplacement,
    tally: PlanTally,
  ): PrimaryView {
    if (this.publishing.isActive) {
      return { kind: 'publishing', count: this.publishBusyCount };
    }
    const primary = derivePrimary({
      searchPhase: this.search.phase,
      awaitingEnter: this.search.awaitingEnter,
      runPhase: this.run.phase,
      busy: this.busy,
      verb,
      problem: display.problem,
      tally,
    });
    if (primary.kind !== 'searchAgain') return primary;
    const publish = this.publishOffer();
    return publish ? { kind: 'searchAgain', publish } : primary;
  }

  private metaView(
    verb: ReplaceVerb | null,
    display: CompiledReplacement,
    tally: PlanTally,
  ): MetaView {
    const { search, run } = this;
    const totals = run.totals(this.inScope);
    return deriveMeta({
      shownPhase: search.shownPhase,
      capped: search.capped,
      runPhase: run.phase,
      runVerb: run.verb,
      frozen: this.frozen?.meta ?? null,
      runTotals: {
        replacedMatches: totals.replacedMatches,
        skippedRecords: totals.skippedRecords,
        failedRecords: totals.failedRecords,
        plannedMatches: totals.plannedMatches,
        publishedRecords: this.publishing.publishedCount((key) =>
          this.inFilter(parseRecordKey(key)?.modelId ?? ''),
        ),
      },
      verb,
      problem: display.problem,
      tally,
    });
  }

  private planView(
    primary: PrimaryView,
    display: CompiledReplacement,
    tally: PlanTally,
  ): FindReplaceSnapshot['plan'] {
    if (primary.kind !== 'replace' || !primary.enabled || !display.verb) {
      return null;
    }
    const { search } = this;
    const token = planToken({
      resultsId: search.resultsId,
      resultsRevision: search.results.revision,
      find: search.find,
      replace: this.replaceInput,
      modelFilter: this.modelFilter,
      inclusionRevision: this.inclusionRevision,
      runRevision: this.run.revision,
    });
    return planFacts({
      token,
      verb: display.verb,
      tally,
      find: search.resultsFind ?? search.find,
      replacementText: display.text,
    });
  }

  private build(): FindReplaceSnapshot {
    const { search, run } = this;
    const previous: FindReplaceSnapshot | undefined = this.snapshot;
    const verb = replaceVerb(this.replaceInput);
    const display = this.displayReplacement();
    const selectionUi = this.selectionUi(verb);
    const tally = emptyTally();
    const records = this.buildRecords(display, selectionUi, tally);
    this.updateEraserLatch(tally);

    const check = this.replacementCheck(tally);
    const primary = this.primaryView(verb, display, tally);
    const { shownPhase } = search;
    const body = deriveBody({
      phase: search.phase,
      shownPhase,
      showProgress: search.showProgress,
      shownRecords: records.length,
    });
    const recordOutcomesShown =
      run.phase === 'stopped' || run.phase === 'finished';
    const frozen = run.isActive ? this.frozen : null;

    return {
      version: ++this.version,
      find: search.find,
      replace: this.replaceInput,
      verb,
      findRow: reuse(previous?.findRow, {
        enabled: !this.writing,
        showClear: search.find.pattern.length > 0,
        showEraser: this.replaceInput.remove || this.eraserLatch,
        enterToSearch: search.enterToSearch,
        awaitingEnter: search.awaitingEnter,
      }),
      search: reuse(previous?.search, this.searchState()),
      replacementCheck: reuse(previous?.replacementCheck, check),
      modelFilter: reuse(previous?.modelFilter, this.modelFilterView()),
      primary: reuse(previous?.primary, primary),
      meta: reuse(previous?.meta, this.metaView(verb, display, tally)),
      body,
      note: reuse(
        previous?.note,
        deriveNote({
          shownPhase,
          capped: search.capped,
          continued: search.continued,
          stopped: search.stopped,
          progress: search.progress,
          selfMatch: check.warnings.some(
            (warning) => warning.code === 'self_match',
          ),
        }),
      ),
      callouts: reuse(
        previous?.callouts,
        frozen?.callouts ??
          deriveCallouts({
            showRecordOutcomes: recordOutcomesShown,
            outcomes: run.outcomes(this.inScope),
            failedModelNames:
              run.phase === 'finished'
                ? []
                : search.failedModels
                    .filter((model) => this.inFilter(model.id))
                    .map((model) => model.name),
            modelsRetryable: search.canRetryModels,
          }),
      ),
      noResults: reuse(
        previous?.noResults,
        body === 'noResults' ? this.noResultsView() : null,
      ),
      selection: reuse(previous?.selection, {
        ui: selectionUi,
        all:
          frozen?.selectAll ?? selectAllState(tally, this.inclusion.baseline),
      }),
      records,
      run: reuse(previous?.run, this.runState()),
      plan: reuse(previous?.plan, this.planView(primary, display, tally)),
      publish: reuse(previous?.publish, {
        phase: this.publishing.phase,
        progress: this.publishing.progress,
      }),
      hasManualSelection: hasManualSelection(this.inclusion),
    };
  }
}

/**
 * Creates the controller behind the find and replace page. Every method is
 * bound, so the page may pass them around freely.
 */
export function createFindReplaceController(
  options: CreateFindReplaceControllerOptions,
): FindReplaceController {
  const store = new FindReplaceStore(options);
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),
    subscribeEvents: (listener) => store.subscribeEvents(listener),
    setPattern: (pattern) => store.setPattern(pattern),
    setOption: (option, on) => store.setOption(option, on),
    searchNow: () => store.searchNow(),
    clearPattern: () => store.clearPattern(),
    stopOrClear: () => store.stopOrClear(),
    stopSearch: () => store.stopSearch(),
    searchAgain: () => store.searchAgain(),
    retryFailedModels: () => store.retryFailedModels(),
    retrySearch: () => store.retrySearch(),
    setReplacementText: (text) => store.setReplacementText(text),
    setRemove: (on) => store.setRemove(on),
    clearReplacement: () => store.clearReplacement(),
    setAllIncluded: (included) => store.setAllIncluded(included),
    setRecordIncluded: (recordKey, included) =>
      store.setRecordIncluded(recordKey, included),
    setMatchIncluded: (matchKey, included) =>
      store.setMatchIncluded(matchKey, included),
    setModelFilter: (modelId) => store.setModelFilter(modelId),
    replace: (token) => store.replace(token),
    stopReplace: () => store.stopReplace(),
    retryFailedRecords: () => store.retryFailedRecords(),
    publish: (token) => store.publish(token),
    stopPublish: () => store.stopPublish(),
    recordLink: (recordKey) => store.recordLink(recordKey),
    dispose: () => store.dispose(),
  };
}
