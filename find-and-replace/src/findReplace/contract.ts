/**
 * Find and replace: the UI ↔ host controller contract.
 *
 * Final location: `src/findReplace/contract.ts` (copy this file verbatim; the
 * relative imports below assume that location). It is the single source of
 * truth for two people working in parallel:
 *
 * - the **host/engine implementer** builds `createFindReplaceController`
 *   (src/findReplace/createFindReplaceController.ts) and the boot in
 *   `FindReplacePage.tsx`, and must satisfy every doc comment here;
 * - the **UI implementer** builds `FindReplaceApp` (src/findReplace/ui/) as a
 *   pure renderer of `FindReplaceSnapshot` plus ctx wiring (confirm, toasts,
 *   links, focus). The UI never computes counts, inclusion, previews or
 *   disabled states itself: everything it shows is in the snapshot.
 *
 * Copy lives in the UI (`src/findReplace/ui/copy.ts`). The controller returns
 * codes and numbers, never user-facing sentences.
 *
 * Conventions
 * - Every array and object in a snapshot is immutable. Objects are
 *   structurally shared: a `RecordView` (and anything inside it) is replaced
 *   only when something it renders changed, so `React.memo` on identity works.
 * - "In scope" means: in the current search results AND inside the model
 *   filter. Records outside the model filter are never shown, counted or
 *   written.
 * - "Changing match" means: effectively included, not a no-op (its expanded
 *   replacement differs from the matched text), in a record that has not been
 *   attempted in the current run session, and in scope.
 */

import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { MatchTraversedField } from '../selection/discoverTargets';
import type { MatcherWorkerSession } from '../selection/matcher';
import type { SchemaIndex } from '../selection/types';

// ─────────────────────────────────────────────────────────────────────────────
// Limits and thresholds
// ─────────────────────────────────────────────────────────────────────────────

/** Controller-owned timing and size limits. Tests override them. */
export type FindReplaceLimits = {
  /** Pause after the last keystroke before a search starts. */
  debounceMs: number;
  /** Patterns shorter than this never auto-search; Enter still searches. */
  minAutoSearchLength: number;
  /** A search must run this long before `search.showProgress` turns true. */
  progressDelayMs: number;
  /** Discovery stops (settles with `capped: true`) at this many matches. */
  maxMatches: number;
  /** Minimum interval between snapshot emits caused by streaming results. */
  emitIntervalMs: number;
  /**
   * Debounce used instead of `debounceMs` when every model in scope has a
   * complete, fresh entry in the record cache (the search re-matches locally).
   */
  cachedDebounceMs: number;
  /** Records kept in the in-memory record cache, across all models. */
  cacheMaxRecords: number;
  /**
   * Approximate size of the records kept in the record cache, across all
   * models, in JSON characters (their parsed form takes somewhat more
   * memory). A model that would go over it is not cached, like one over
   * `cacheMaxRecords`.
   */
  cacheMaxBytes: number;
  /** A cached model older than this is downloaded again by the next search. */
  cacheTtlMs: number;
  /**
   * When the searchable models hold more records than this, a search reads
   * for minutes: typing never starts one, Enter does (see `FindRowView`).
   */
  enterToSearchAbove: number;
};

export const DEFAULT_LIMITS: FindReplaceLimits = {
  debounceMs: 1000,
  minAutoSearchLength: 2,
  progressDelayMs: 300,
  maxMatches: 10_000,
  emitIntervalMs: 250,
  cachedDebounceMs: 150,
  cacheMaxRecords: 10_000,
  cacheMaxBytes: 64 * 1024 * 1024,
  cacheTtlMs: 10 * 60 * 1000,
  enterToSearchAbove: 10_000,
};

/** UI-owned rendering thresholds (listed here so both sides agree). */
export const UI_LIMITS = {
  /** Records rendered per chunk; "Load more records" renders the next chunk. */
  recordsPerChunk: 50,
  /** Matches shown per record before "Show N more matches". */
  matchesAtRest: 3,
  /** Matches revealed per "Show N more matches" click. */
  matchesPerExpand: 20,
  /** Matched/removed text longer than this is shown as first 40 + " … " + last 30. */
  longMatchChars: 80,
  /** Quoted strings in the confirm are cut to 39 characters + "…" above this. */
  quoteChars: 40,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Inputs (the find row is fully controlled by these)
// ─────────────────────────────────────────────────────────────────────────────

export type FindOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type FindOption = keyof FindOptions;

/** What the user typed in Find, plus the three toggles. Never trimmed. */
export type FindInput = FindOptions & {
  pattern: string;
};

/** What the user typed in "Replace with…", plus the "Replace with nothing" toggle. */
export type ReplaceInput = {
  /** Kept while `remove` is on, so turning it off restores it. Never trimmed. */
  text: string;
  remove: boolean;
};

/** Present when `remove` is on or `text` is non-empty. `null` means "find only". */
export type ReplaceVerb = 'replace' | 'remove';

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - `idle`: the pattern is empty, or shorter than `minAutoSearchLength` and
 *   Enter hasn't been pressed. `records` is empty.
 * - `pending`: a new search is on its way and nothing of it is shown yet: it
 *   is scheduled (the pattern or an option changed), or it already runs but
 *   hasn't ended or run for `progressDelayMs`. Any earlier search was
 *   cancelled at once (it stops fetching). The previous results stay in
 *   `records` (same `resultsId`, same meta and callouts) until the new
 *   search replaces them; a search over cached records usually ends before
 *   the delay, so it goes straight to `settled` with no frame in between.
 * - `searching`: a search is running and shown (after `progressDelayMs`);
 *   `records` fills in, append-only.
 * - `settled`: the search finished, was stopped (`stopped`), was capped
 *   (`capped`) or finished with some models failed (`failedModels`).
 * - `invalid`: the pattern can't run (`patternProblem`). `records` is empty.
 * - `failed`: every model failed (`failure`). `records` is empty.
 */
export type SearchPhase =
  | 'idle'
  | 'pending'
  | 'searching'
  | 'settled'
  | 'invalid'
  | 'failed';

export type PatternProblem =
  /** `cause` is the parser's short reason ("unterminated group"), lowercased, or null when longer than 40 characters. */
  | { code: 'invalid_regex'; cause: string | null }
  /** The regex can match an empty string. */
  | { code: 'zero_width' }
  /** The matcher worker timed out (10 s). The whole search ends with this single problem. */
  | { code: 'too_slow' };

export type SearchState = {
  phase: SearchPhase;
  /**
   * Identity of the result set in `records`. Increments when a new search
   * starts (results cleared). The UI resets chunking, "Show more" state and
   * scrolls the body to the top when it changes.
   */
  resultsId: number;
  /**
   * True once a search has been running for `progressDelayMs`; false again
   * when it settles. The UI mounts the progress row (and the 80px body
   * spinner when there are no results yet) only while this is true.
   */
  showProgress: boolean;
  /** `total` is null until the background per-model counts have all resolved. */
  progress: { searched: number; total: number | null };
  /** Settled because `maxMatches` was reached. */
  capped: boolean;
  /** Settled because the user pressed Stop (or Esc in Find). */
  stopped: boolean;
  /**
   * Models whose scan failed; results from their records read before the
   * failure are kept. A stopped search keeps the ones that had already
   * failed; a retry of them keeps the ones that failed again.
   */
  failedModels: ReadonlyArray<{ id: string; name: string }>;
  /** Non-null only in phase `invalid`. */
  patternProblem: PatternProblem | null;
  /** Non-null only in phase `failed`. */
  failure: { cause: 'network' | 'unknown' } | null;
  /**
   * True when the current search repeats the find settings of the last
   * finished run session ("Search again"). With zero matches the UI shows
   * "Every match has been replaced."
   */
  followsRun: boolean;
  /**
   * The results read on from where the previous, capped search stopped
   * ("Search again" after its matches were replaced).
   */
  continued: boolean;
  /**
   * While searching: the seconds it still needs at its pace so far, or null
   * while that isn't known (total unknown, or it just started).
   */
  secondsLeft: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Replacement validation (local, synchronous, recomputed on every change)
// ─────────────────────────────────────────────────────────────────────────────

export type ReplacementProblem =
  /** Regex mode only: the template uses $` or $' (they need text we don't keep). Blocks replacing. */
  { code: 'context_token' };

export type ReplacementWarning =
  /** Regex mode: `$3` (or `$<name>`) refers to a group the pattern doesn't have; it is inserted literally. */
  | { code: 'group_out_of_range'; token: string; groupCount: number }
  /** Literal mode only: the replacement text itself matches the find settings (Acme → Acme Inc). */
  | { code: 'self_match' }
  /** Included slug matches whose new text has characters outside [a-z0-9_-]; they will probably fail validation. */
  | { code: 'slug_format'; count: number };

export type ReplacementCheck = {
  problem: ReplacementProblem | null;
  /** Rendered as separate lines, in this order. Empty when there is no replacement intent. */
  warnings: ReadonlyArray<ReplacementWarning>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Results view model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How one match line renders.
 * - `highlight`: `<mark>` on the matched text. Find mode, excluded matches,
 *   and matches in attempted records that were not part of the write.
 * - `diff`: `<del>matched</del><ins>inserted</ins>` (just `<del>` when
 *   `inserted` is ''). Included changing matches in plan mode, and the
 *   attempted change on skipped/failed records (nothing was written).
 * - `noChange`: `<mark>` plus a "No change" row tag. Included, but the
 *   expanded replacement equals the matched text. Never counted, never written.
 * - `final`: `<ins>inserted</ins>` only. The text this run wrote (replaced records).
 */
export type MatchDisplay =
  | { kind: 'highlight' }
  | { kind: 'diff'; inserted: string }
  | { kind: 'noChange' }
  | { kind: 'final'; inserted: string };

export type MatchView = {
  /** exactMatchIdentity. Stable across re-renders of the same result set. */
  key: string;
  /** Context before the match, up to 48 UTF-16 units, raw (the UI collapses whitespace). */
  before: string;
  beforeTruncated: boolean;
  /** The matched text, raw (the UI shows ↵ and → markers inside it). */
  text: string;
  after: string;
  afterTruncated: boolean;
  /** Effective inclusion. Only rendered when `selection.ui !== 'hidden'`. */
  included: boolean;
  /**
   * A per-match checkbox exists: the record has 2+ matches, the selection is
   * visible, and the record hasn't been attempted in this run session.
   */
  selectable: boolean;
  display: MatchDisplay;
};

export type FieldView = {
  /** fieldValueIdentity. */
  key: string;
  /**
   * Human path, schema labels only (never API keys), outermost first:
   * ['Title'], ['Content', 'Quote 2', 'Text'], ['SEO', 'Description'].
   * A block gets an ordinal only when its parent field holds 2+ blocks of that
   * block model. The UI collapses paths longer than 3 segments.
   */
  path: ReadonlyArray<string>;
  /** Locale code for the chip; null when the project has one locale or the value isn't localized (inherited from the nearest localized ancestor). */
  locale: string | null;
  /** Slug field: the UI shows the "Changes the URL" tag when the selection is visible. */
  changesUrl: boolean;
  /** Document order. */
  matches: ReadonlyArray<MatchView>;
};

export type SkipReason =
  /** Version or value changed since the search (fresh read, or STALE_ITEM_VERSION on update that didn't land). */
  | 'stale'
  /** The record was deleted since the search (404 on the fresh read). */
  | 'deleted'
  /** A field in the plan can't be replaced by this engine. */
  | 'unsupported';

export type FailReason =
  /** 422: the new value fails a field validation. */
  | 'validation'
  /** 401/403: the role can't update this record. */
  | 'permission'
  /** Timeout, network error, 429 or 5xx after the client's own retries. Retryable. */
  | 'network'
  | 'unknown';

/** Validation details when the server gives them. `fieldLabel` comes from the schema by field id. */
export type FailDetail = {
  fieldLabel: string | null;
  code: 'length' | 'format' | 'unique' | 'required' | 'other';
};

export type RecordRunStatus =
  | { kind: 'untouched' }
  | { kind: 'writing' }
  | { kind: 'replaced'; replacedMatches: number }
  | { kind: 'skipped'; reason: SkipReason }
  | {
      kind: 'failed';
      reason: FailReason;
      retryable: boolean;
      detail: FailDetail | null;
    };

export type RecordView = {
  /** `${modelId}:${recordId}` */
  key: string;
  recordId: string;
  modelId: string;
  modelName: string;
  /**
   * presentation_title_field → title_field → heuristics, in the first site
   * locale with a value; refreshed from the server after a successful write.
   * null → the UI shows "Record #{recordId}".
   */
  title: string | null;
  /** Every match found in this record (independent of inclusion). */
  matchCount: number;
  /** Tri-state for the record checkbox, over all its matches (including ones behind "Show more"). */
  inclusion: 'all' | 'some' | 'none';
  /** The record checkbox exists (selection visible and record not attempted in this run session). */
  selectable: boolean;
  status: RecordRunStatus;
  /** Publishing after the run (always `none` until a run finished). */
  publish: RecordPublishStatus;
  /** Document order; fields with at least one match only. */
  fields: ReadonlyArray<FieldView>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Run (the write)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - `none`: no run in this session (or a new search started since).
 * - `running` / `stopping`: records are being written one at a time.
 * - `stopped`: the user stopped; untouched records are live again (resume).
 * - `finished`: every planned record was attempted. The list is a report.
 */
export type RunPhase = 'none' | 'running' | 'stopping' | 'stopped' | 'finished';

/**
 * Record and match counts over a set of passes. `RunState.totals` is cumulative
 * over the run session (the first pass plus any "Try again" passes);
 * `runEnded.pass` covers only the pass that just ended.
 */
export type RunTotals = {
  /** Matches written. */
  replacedMatches: number;
  replacedRecords: number;
  skippedRecords: number;
  /** Of `skippedRecords`, those skipped as 'stale' (the callout and toast wording depends on "all stale"). */
  staleSkippedRecords: number;
  failedRecords: number;
  retryableFailedRecords: number;
  /** Planned but never attempted (after Stop). */
  notAttemptedRecords: number;
  /** Planned records and matches for the session so far. */
  plannedRecords: number;
  plannedMatches: number;
};

export type RunState = {
  phase: RunPhase;
  /** The verb the run session uses (frozen at start). */
  verb: ReplaceVerb;
  /** Current pass only. `done` counts attempted records (any outcome), `updated` successful writes. */
  progress: { done: number; total: number; updated: number };
  /** Non-null in `stopped` and `finished`. */
  totals: RunTotals | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Publish (after a finished run)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a replaced record isn't offered for publishing: publishing it would put
 * more than the replacement live.
 * - `other_changes`: it already had unpublished changes before the run.
 * - `never_published`: it was a draft that was never published.
 */
export type PublishHoldReason = 'other_changes' | 'never_published';

export type PublishSkipReason =
  /** Edited after the replacement, so publishing would put that edit live too. */
  | 'changed'
  /** Deleted after the replacement. */
  | 'deleted';

/**
 * Publishing, per record of the report.
 * - `none`: nothing to publish or to say (not replaced, a model without
 *   draft/published, or the role can't publish its model).
 * - `ready`: offered by "Publish N records" and not published yet (nothing is
 *   drawn for it).
 * - `held`: replaced but not offered (see `PublishHoldReason`). Reported only
 *   once a publish pass has run in the session; `none` before.
 * - `publishing`: in flight.
 * - `published` / `skipped` / `failed`: the outcome of its publish. A
 *   retryable failure is offered again.
 */
export type RecordPublishStatus =
  | { kind: 'none' }
  | { kind: 'ready' }
  | { kind: 'held'; reason: PublishHoldReason }
  | { kind: 'publishing' }
  | { kind: 'published' }
  | { kind: 'skipped'; reason: PublishSkipReason }
  | {
      kind: 'failed';
      reason: FailReason;
      retryable: boolean;
      detail: FailDetail | null;
    };

/**
 * - `none`: no publish pass in this run session.
 * - `running` / `stopping`: records are being published one at a time.
 * - `done`: a publish pass ended (finished or stopped).
 */
export type PublishPhase = 'none' | 'running' | 'stopping' | 'done';

export type PublishState = {
  phase: PublishPhase;
  /** Current pass only. `done` counts attempted records (any outcome). */
  progress: { done: number; total: number; published: number };
};

/** Counts over one publish pass (the toast). */
export type PublishTotals = {
  published: number;
  skipped: number;
  failed: number;
  retryableFailed: number;
  /** Offered but not attempted (after Stop). */
  notAttempted: number;
  /** Records the pass set out to publish. */
  planned: number;
};

/** "Publish N records" next to "Search again". Facts for its confirm. */
export type PublishOffer = {
  /** Pass back to `publish()`. */
  token: string;
  /** Records it publishes (`ready`, plus retryable failures). */
  recordCount: number;
  /** Replaced records it leaves out (`held`), for the confirm. */
  heldCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Page chrome
// ─────────────────────────────────────────────────────────────────────────────

export type DisabledReason =
  /** Idle, no matches, or the search failed. */
  | 'no_matches'
  /** Pending or searching. */
  | 'search_running'
  /** Large projects: the Find field holds text or settings not searched yet. */
  | 'press_enter'
  | 'invalid_pattern'
  /** Results exist but the Replace field is empty and "Replace with nothing" is off. */
  | 'no_replacement'
  | 'invalid_replacement'
  /** Every in-scope match is excluded. */
  | 'nothing_selected'
  /** Every included match is a no-op. */
  | 'nothing_changes'
  /** A run is running or stopping. */
  | 'replacing';

/**
 * The one slot at the far right of the title toolbar.
 * - `replace` enabled → solid primary "Replace {count} matches" / "Remove …".
 * - `replace` disabled, `busy: false` → solid primary, disabled, label
 *   "Replace"/"Remove" without a count, reason tooltip.
 * - `replace` disabled, `busy: true` → the label it had ("Replace 6 matches")
 *   plus a 20px spinner, reason 'replacing'.
 * - `searchAgain` → a soft `s` button "Search again" (run finished; until the
 *   next search). With `publish`, a solid primary "Publish N records" follows
 *   it (the only solid primary then).
 * - `publishing` → the busy, disabled "Publish N records" with a 20px spinner
 *   while a publish pass runs (nothing else in the slot).
 */
export type PrimaryView =
  | { kind: 'replace'; verb: ReplaceVerb; count: number; enabled: true }
  | {
      kind: 'replace';
      verb: ReplaceVerb;
      count: number;
      enabled: false;
      busy: boolean;
      reason: DisabledReason;
    }
  | { kind: 'searchAgain'; publish: PublishOffer | null }
  | { kind: 'publishing'; count: number };

/** Toolbar meta (and the <600px summary line). Frozen at run start while running. */
export type MetaView =
  | { kind: 'none' }
  | { kind: 'noMatches' }
  /** "124 matches in 38 records" ("10,000+ matches…" when capped). */
  | { kind: 'found'; matches: number; records: number; capped: boolean }
  /** Plan mode when not every in-scope match changes: "118 of 124 matches will change" / "…will be removed". */
  | { kind: 'willChange'; changing: number; found: number; verb: ReplaceVerb }
  /** "121 matches replaced" / ", 3 records skipped" / ", 2 records failed" / both; then ", 9 records published". */
  | {
      kind: 'runFinished';
      verb: ReplaceVerb;
      replacedMatches: number;
      skippedRecords: number;
      failedRecords: number;
      publishedRecords: number;
    }
  /** "48 of 121 matches replaced". */
  | {
      kind: 'runStopped';
      verb: ReplaceVerb;
      replacedMatches: number;
      plannedMatches: number;
    };

/**
 * What the body shows (one of). Notes, callouts and form lines stack above
 * `results`. While `search.phase` is `pending`, the body keeps what it showed
 * for the previous search (`results`, `noResults`, …) or `idle` when there was
 * none (`blank` after an invalid pattern or a failed search).
 */
export type BodyKind =
  | 'idle'
  /** Nothing to keep on screen and no progress to show yet: render nothing (avoids a flash). */
  | 'blank'
  /** Searching, no results yet, progress shown: the 80px centered spinner. */
  | 'spinner'
  | 'results'
  | 'noResults'
  /** Only the pattern form line. */
  | 'invalid'
  /** Pane state "Couldn't search the records" + "Try again" (`retrySearch`). */
  | 'searchFailed';

export type NoteView =
  /** `continued`: "Showing the next …" (the search read on from an earlier one). */
  | { kind: 'capped'; selfMatch: boolean; continued: boolean }
  | { kind: 'searchStopped'; searched: number; total: number | null };

/**
 * Above the card, in this order: recordsFailed (danger), recordsSkipped
 * (warning), modelsFailed (warning). While a pass runs they stay as they were
 * when it started (their actions wait for it to end).
 */
export type CalloutView =
  /** `retryable`: at least one failure is retryable (show "Try again"). `singleReason`: every failed record has this reason, else null. */
  | {
      kind: 'recordsFailed';
      count: number;
      retryable: boolean;
      singleReason: FailReason | null;
    }
  | { kind: 'recordsSkipped'; count: number; allStale: boolean }
  /**
   * `retryable` false (the results are capped, or read on from an earlier
   * search): no "Try again"; searching again reads those models.
   */
  | {
      kind: 'modelsFailed';
      modelNames: ReadonlyArray<string>;
      retryable: boolean;
    };

export type NoResultsView = {
  /** "Every match has been replaced." */
  followsRun: boolean;
  /**
   * The search read on from where an earlier one stopped and found nothing
   * more: "No more matches" (it didn't look at the records dealt with).
   */
  continued: boolean;
  /**
   * The verb of the last finished run session ("Every match has been
   * removed" after a remove run). Only meaningful when `followsRun`.
   */
  runVerb: ReplaceVerb;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Set when a model filter is on and hides matches in other models. */
  filteredModelName: string | null;
  otherModelsHaveMatches: boolean;
};

export type FindRowView = {
  /** False while booting and while a run or a publish pass is running/stopping (every control disabled, nothing hidden). */
  enabled: boolean;
  /** ✕ Clear search: pattern non-empty. */
  showClear: boolean;
  /** Eraser toggle: results exist or `remove` is on. Sticky while a new search is pending/searching. */
  showEraser: boolean;
  /**
   * Large projects (above `limits.enterToSearchAbove` records): typing never
   * starts a search, Enter does. The placeholder says so.
   */
  enterToSearch: boolean;
  /** `enterToSearch`, and the field holds settings not searched yet: show the Enter hint. */
  awaitingEnter: boolean;
};

export type ModelFilterView = {
  /**
   * A model is chosen, or the last settled search had matches in 2+ models.
   * Re-evaluated only when a search settles or the pattern empties (no flicker).
   */
  visible: boolean;
  enabled: boolean;
  /** null = "All models". */
  selected: { id: string; name: string } | null;
  /** Every searched model, alphabetical. `matchCount` null = the model couldn't be searched ("—"). */
  options: ReadonlyArray<{
    id: string;
    name: string;
    matchCount: number | null;
  }>;
  allMatchCount: number;
  /** The last search was capped or stopped, so counts are lower bounds: the UI appends "+" ("96+"). */
  partial: boolean;
};

export type SelectionView = {
  /**
   * - `hidden`: find mode (no replacement intent) or the run `finished`: no
   *   strip, no checkboxes, no "Select all". A "Try again" pass over a
   *   finished run keeps it hidden (the report updates in place).
   * - `enabled`: plan mode, and the run is `none` or `stopped`.
   * - `disabled`: plan mode while running/stopping (drawn, not interactive).
   */
  ui: 'hidden' | 'enabled' | 'disabled';
  /**
   * "Select all" tri-state over every selectable in-scope record, loaded or
   * not. While a pass runs it stays as it was when the pass started.
   */
  all: 'all' | 'some' | 'none';
};

/** Facts for the confirm. Non-null exactly when `primary` is `replace` and enabled. */
export type PlanFacts = {
  /** Pass back to `replace()`. Changes whenever anything that affects the plan changes. */
  token: string;
  verb: ReplaceVerb;
  matchCount: number;
  recordCount: number;
  /** When `recordCount === 1`: that record's title (null → "Record #{id}") and id. */
  singleRecord: { id: string; title: string | null } | null;
  /** Records in models with `draft_mode_active: false` (the write goes live). */
  liveRecordCount: number;
  /** Changing matches in slug fields. */
  slugMatchCount: number;
  /** For quoting "Acme" (or /Acme(\w+)/ in regex mode). */
  pattern: string;
  regex: boolean;
  /** '' when verb is 'remove'. */
  replacementText: string;
};

export type RecordLink =
  /** `https://{internal_domain}{/environments/x}/editor/item_types/{model}/items/{record}/edit`: open in a new tab. */
  | { kind: 'href'; href: string }
  /** `internal_domain` unknown: same path for `ctx.navigateTo` (leaves the page; the UI disables it while running). */
  | { kind: 'path'; path: string };

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────────────────────────────────

export type FindReplaceSnapshot = {
  /** Increments on every emit. */
  version: number;

  find: FindInput;
  replace: ReplaceInput;
  /** null in find mode (Replace empty and remove off). */
  verb: ReplaceVerb | null;

  findRow: FindRowView;
  search: SearchState;
  replacementCheck: ReplacementCheck;
  modelFilter: ModelFilterView;

  primary: PrimaryView;
  meta: MetaView;

  body: BodyKind;
  note: NoteView | null;
  callouts: ReadonlyArray<CalloutView>;
  /** Non-null exactly when `body === 'noResults'`. */
  noResults: NoResultsView | null;

  selection: SelectionView;
  /**
   * In scope, in display order:
   * - searching/settled: arrival order (models alphabetically, 2 scanned at a time), append-only;
   * - after a run pass ends: re-sorted once — failed, skipped, untouched, replaced;
   * - `finished`: only records attempted in the session remain (also while a
   *   "Try again" pass runs over it).
   */
  records: ReadonlyArray<RecordView>;

  run: RunState;
  plan: PlanFacts | null;
  publish: PublishState;

  /**
   * The user changed an inclusion by hand in the current results ("Select
   * all", a record or a match checkbox). Slug defaults don't count. Esc in
   * Find won't clear the query while this is true.
   */
  hasManualSelection: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Events (one-shot; the UI turns them into toasts and live-region text)
// ─────────────────────────────────────────────────────────────────────────────

export type FindReplaceEvent =
  /** A search settled (also after Stop). Announce the meta. */
  | {
      type: 'searchSettled';
      matches: number;
      records: number;
      capped: boolean;
      stopped: boolean;
    }
  /** The pattern turned invalid. Announce the validation line. */
  | { type: 'patternInvalid'; problem: PatternProblem }
  /** A pass started. The UI moves focus to "Stop". */
  | { type: 'runStarted' }
  /**
   * A pass ended (finished or stopped). The UI scrolls the body to the top,
   * moves focus ("Search again" when finished, the primary when stopped),
   * announces the meta, and fires exactly one toast from `pass`.
   */
  | {
      type: 'runEnded';
      stopped: boolean;
      verb: ReplaceVerb;
      /** This pass only (the toast). */
      pass: RunTotals;
      /** Set when nothing was written and every failure had this one cause. */
      allFailedCause: 'permission' | null;
    }
  /** A publish pass started. The UI moves focus to "Stop". */
  | { type: 'publishStarted' }
  /**
   * A publish pass ended (finished or stopped). The UI moves focus to the
   * slot, announces the meta, and fires exactly one toast from `pass`.
   */
  | {
      type: 'publishEnded';
      stopped: boolean;
      pass: PublishTotals;
      /** Set when nothing was published and every failure had this one cause. */
      allFailedCause: 'permission' | null;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────

export type FindReplaceController = {
  /** For `useSyncExternalStore`. Returns the same object until the next emit. */
  getSnapshot(): FindReplaceSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeEvents(listener: (event: FindReplaceEvent) => void): () => void;

  // ── Find ──────────────────────────────────────────────────────────────────
  /**
   * Controlled Find input. Emits synchronously. Cancels a pending timer and any
   * running search at once. '' → idle (results cleared). Shorter than
   * `minAutoSearchLength` → idle (results cleared; Enter searches). Otherwise →
   * `pending`, previous results kept, search after `debounceMs`.
   * With `findRow.enterToSearch` a non-empty pattern starts, stops and clears
   * nothing: Enter searches it (`findRow.awaitingEnter` until then).
   */
  setPattern(pattern: string): void;
  /**
   * Toggle an option. With a pattern of `minAutoSearchLength`+ characters the
   * search restarts immediately (no debounce); with a shorter non-empty
   * pattern the results are cleared (idle) until Enter.
   * With `findRow.enterToSearch` it restarts only the search running or shown
   * for the same pattern; otherwise Enter searches.
   */
  setOption(option: FindOption, on: boolean): void;
  /**
   * Enter in Find: validate and search now, any length. On unchanged settings
   * it searches again (like `searchAgain`). No-op when empty.
   */
  searchNow(): void;
  /** ✕ Clear search: pattern '' → idle. Toggles keep their state. Always clears (it's a deliberate click). */
  clearPattern(): void;
  /**
   * Esc in Find. Searching → stops the search ('stopped'). Otherwise, if the
   * pattern is non-empty and `hasManualSelection` is false → clears it
   * ('cleared'). Otherwise does nothing ('kept').
   */
  stopOrClear(): 'stopped' | 'cleared' | 'kept';
  /**
   * "Stop" in the progress row while searching. Keeps what was found
   * (settled, `stopped: true`) and the models that had already failed.
   */
  stopSearch(): void;
  /**
   * Re-run the current find settings with fresh data (the toolbar "Search
   * again", the skipped toast CTA). After a finished run on results that
   * stopped at `maxMatches`, it reads on from where they stopped instead,
   * re-reading first the records they showed that weren't replaced (failed,
   * skipped, never written, or out of the model filter); records replaced,
   * or left out entirely, aren't read again. Ends the run session. Carries the user's
   * exclusions and explicit inclusions to matches whose field value is
   * unchanged (key: exactMatchIdentity + valueFingerprint) and record
   * exclusions by record key. In a field value the run wrote while one of its
   * matches was left out, every match starts excluded (what is left there is
   * what was left out). Keeps the model filter.
   */
  searchAgain(): void;
  /**
   * "Try again" in the models-failed callout: re-scan only
   * `search.failedModels`, merging (dedup by identity). The results, the
   * inclusions and a run session always stay (same `resultsId`), whatever
   * happens; the models that fail again (or aren't scanned completely) are
   * listed again.
   */
  retryFailedModels(): void;
  /** "Try again" in the search-failed pane state: same as `searchNow()`. */
  retrySearch(): void;

  // ── Replacement ───────────────────────────────────────────────────────────
  /** Controlled Replace input. Emits synchronously; recomputes previews, no-ops, counts and warnings. Never starts a search. */
  setReplacementText(text: string): void;
  /** Eraser toggle ("Replace with nothing"). Keeps `replace.text`. */
  setRemove(on: boolean): void;
  /** Esc in Replace: text '' (remove unchanged). */
  clearReplacement(): void;

  // ── Selection (default: everything included except slug matches) ─────────
  /** "Select all": true includes every selectable in-scope match, slugs included (explicit); false excludes all and makes matches that stream in later start excluded. */
  setAllIncluded(included: boolean): void;
  /** Record checkbox: true includes all its matches (slugs included), false excludes the record. */
  setRecordIncluded(recordKey: string, included: boolean): void;
  setMatchIncluded(matchKey: string, included: boolean): void;

  // ── Model filter (a view over results: never re-scans) ────────────────────
  setModelFilter(modelId: string | null): void;

  // ── Run ───────────────────────────────────────────────────────────────────
  /**
   * Called after the host confirm resolves true. Returns false (and does
   * nothing) if `token` no longer equals `plan.token`. Otherwise freezes the
   * plan (verb, template, records in display order with their changing
   * matches) and starts a pass: for each record, one at a time, fresh read →
   * version and fingerprint checks → compile → update with
   * `meta.current_version` from the fresh read. Never publishes. Registers a
   * `beforeunload` guard for the duration.
   */
  replace(token: string): boolean;
  /** "Stop" while running: the record in flight completes and is reported, then the pass ends as `stopped`. */
  stopReplace(): void;
  /**
   * "Try again" (failed callout / toast CTA): re-run only retryable failed
   * records with the session's frozen replacement. A record whose earlier
   * update had in fact landed (the answer was lost) is reported replaced
   * without writing it again.
   */
  retryFailedRecords(): void;

  // ── Publish ───────────────────────────────────────────────────────────────
  /**
   * Called after the host confirm resolves true. Returns false (and does
   * nothing) unless the slot offers publishing with this `token`. Otherwise
   * publishes the offered records one at a time, in display order: each is
   * read first and left unpublished if it changed since the replacement
   * wrote it. Registers a `beforeunload` guard for the duration.
   */
  publish(token: string): boolean;
  /** "Stop" while publishing: the record in flight completes, then the pass ends. */
  stopPublish(): void;

  // ── Links ─────────────────────────────────────────────────────────────────
  recordLink(recordKey: string): RecordLink;

  /** Cancel timers, the search and the worker; a running pass stops after its in-flight record; remove the beforeunload guard. */
  dispose(): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory (host side) and boot (host → UI)
// ─────────────────────────────────────────────────────────────────────────────

export type CreateFindReplaceControllerOptions = {
  client: Client;
  /** Built from the permitted root models (read AND update, plugin allowlist). */
  schema: SchemaIndex;
  siteId: string;
  environment: string;
  /** Site locales, in site order. */
  locales: ReadonlyArray<string>;
  links: {
    internalDomain: string | null;
    isEnvironmentPrimary: boolean;
  };
  limits?: Partial<FindReplaceLimits>;
  /** Test seam: bypass the worker (tests run `matchesForTraversedField` inline). */
  matchField?: MatchTraversedField;
  workerSessionFactory?: () => MatcherWorkerSession;
  /** Test seam for fake timers. Defaults to globalThis. */
  timers?: {
    setTimeout: (callback: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
  /** Clock for the time left and request pacing. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Records the searchable models hold together, counted at boot; null when
   * unknown. Above `limits.enterToSearchAbove`, searches start on Enter.
   */
  recordCount?: number | null;
  /**
   * Whether the role may publish records of this model. Defaults to never:
   * without it the page doesn't offer publishing.
   */
  canPublishModel?: (modelId: string) => boolean;
  /** Where the beforeunload guard is registered. Defaults to `window`; null disables it (tests). */
  unloadTarget?: Pick<
    Window,
    'addEventListener' | 'removeEventListener'
  > | null;
};

export type CreateFindReplaceController = (
  options: CreateFindReplaceControllerOptions,
) => FindReplaceController;

/** Computed by `FindReplacePage` (host), rendered by `FindReplaceApp` (UI). */
export type BootView =
  | { status: 'booting' }
  /**
   * - `role`: the role isn't in the plugin's role allowlist.
   * - `no_models`: no model the role can read AND update (within the model allowlist).
   * - `token`: the `currentUserAccessToken` permission wasn't granted.
   */
  | { status: 'unavailable'; cause: 'role' | 'no_models' | 'token' }
  | { status: 'failed'; cause: 'network' | 'unknown'; retry: () => void }
  | { status: 'ready'; controller: FindReplaceController };

export type FindReplaceAppProps = {
  ctx: RenderPageCtx;
  boot: BootView;
};
