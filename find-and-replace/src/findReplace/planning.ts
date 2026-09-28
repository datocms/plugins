/**
 * The plan: what a replacement would do to the matches in scope, and the
 * page chrome derived from it (primary, meta, body, notes, callouts, plan
 * facts, token). Pure functions over plain inputs.
 */

import {
  compileReplacementTemplate,
  expandReplacement,
  literalTemplate,
  type ReplacementTemplate,
  type TemplateMatch,
} from '../replacement/replacementTemplate';
import { fingerprintString, stableSerialize } from '../selection/identity';
import { matchText } from '../selection/matcher';
import type { MatcherSpec, SchemaIndex } from '../selection/types';
import type {
  BodyKind,
  CalloutView,
  DisabledReason,
  FailReason,
  FindInput,
  MatchDisplay,
  MetaView,
  NoteView,
  PlanFacts,
  PrimaryView,
  ReplaceInput,
  ReplacementCheck,
  ReplacementProblem,
  ReplacementWarning,
  ReplaceVerb,
  RunPhase,
  SearchPhase,
} from './contract';
import { HIGHLIGHT, NO_CHANGE } from './viewModel';

// ─── Inputs ─────────────────────────────────────────────────────────────────

export function matcherSpecOf(find: FindInput): MatcherSpec {
  return {
    kind: find.regex ? 'regex' : 'literal',
    pattern: find.pattern,
    caseSensitive: find.caseSensitive,
    wholeWord: find.wholeWord,
  };
}

export function sameFind(
  left: FindInput | null,
  right: FindInput | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.pattern === right.pattern &&
    left.caseSensitive === right.caseSensitive &&
    left.wholeWord === right.wholeWord &&
    left.regex === right.regex
  );
}

/** `remove` wins; otherwise any typed text is a replacement; else find only. */
export function replaceVerb(replace: ReplaceInput): ReplaceVerb | null {
  if (replace.remove) return 'remove';
  return replace.text.length > 0 ? 'replace' : null;
}

// ─── Replacement ────────────────────────────────────────────────────────────

export type CompiledReplacement = {
  verb: ReplaceVerb | null;
  /** Null in find mode, and when the replacement can't be used (`problem`). */
  template: ReplacementTemplate | null;
  problem: ReplacementProblem | null;
  /** References to groups the pattern doesn't have (`$3`, `$<x>`), in order. */
  outOfRange: ReadonlyArray<string>;
  /** The text the confirm quotes: '' when removing and in find mode. */
  text: string;
};

/** Compiles the Replace input against the matcher of the results it previews. */
export function compileReplacement(
  replace: ReplaceInput,
  matcher: MatcherSpec,
): CompiledReplacement {
  const verb = replaceVerb(replace);
  if (verb === null) {
    return { verb, template: null, problem: null, outOfRange: [], text: '' };
  }
  if (verb === 'remove') {
    return {
      verb,
      template: literalTemplate(''),
      problem: null,
      outOfRange: [],
      text: '',
    };
  }

  const compilation = compileReplacementTemplate(replace.text, matcher);
  if (!compilation.ok) {
    return {
      verb,
      template: null,
      problem: { code: compilation.code },
      outOfRange: [],
      text: replace.text,
    };
  }
  return {
    verb,
    template: compilation.template,
    problem: null,
    outOfRange: compilation.outOfRange,
    text: replace.text,
  };
}

export type MatchPlan = {
  display: MatchDisplay;
  /** Included and not a no-op: the write would change it. */
  changing: boolean;
  /** The expanded replacement, when the match is included and a template exists. */
  inserted: string | null;
};

const UNPLANNED: MatchPlan = {
  display: HIGHLIGHT,
  changing: false,
  inserted: null,
};

/**
 * How a live (not yet attempted) match renders and whether it changes. The
 * expansion is the same function the write uses.
 */
export function planMatch(
  replacement: CompiledReplacement,
  match: TemplateMatch,
  included: boolean,
): MatchPlan {
  if (!(included && replacement.template)) return UNPLANNED;
  const inserted = expandReplacement(replacement.template, match);
  if (inserted === match.matchedText) {
    return { display: NO_CHANGE, changing: false, inserted };
  }
  return { display: { kind: 'diff', inserted }, changing: true, inserted };
}

/**
 * Literal mode: the replacement text itself matches the find settings, so
 * searching again finds the replaced text (Acme → Acme Inc). The pattern is
 * escaped, so running it here is safe.
 */
export function isSelfMatch(find: FindInput, text: string): boolean {
  if (find.regex || find.pattern.length === 0 || text.length === 0) {
    return false;
  }
  try {
    return matchText(text, matcherSpecOf(find)).length > 0;
  } catch {
    return false;
  }
}

const SLUG_CHARACTERS = /^[a-z0-9_-]*$/;

/** The new slug text has characters a slug field doesn't accept. */
export function violatesSlugFormat(inserted: string): boolean {
  return !SLUG_CHARACTERS.test(inserted);
}

/** Records of this model change the live site at once (no draft/published). */
export function isLiveModel(schema: SchemaIndex, modelId: string): boolean {
  return !schema.modelsById.get(modelId)?.raw.draft_mode_active;
}

export function replacementCheck(args: {
  replacement: CompiledReplacement;
  find: FindInput;
  groupCount: number;
  slugFormatMatches: number;
}): ReplacementCheck {
  const { replacement, find } = args;
  if (replacement.verb !== 'replace') return { problem: null, warnings: [] };

  const warnings: ReplacementWarning[] = [];
  for (const token of new Set(replacement.outOfRange)) {
    warnings.push({
      code: 'group_out_of_range',
      token,
      groupCount: args.groupCount,
    });
  }
  if (isSelfMatch(find, replacement.text))
    warnings.push({ code: 'self_match' });
  if (args.slugFormatMatches > 0) {
    warnings.push({ code: 'slug_format', count: args.slugFormatMatches });
  }
  return { problem: replacement.problem, warnings };
}

// ─── Counts ─────────────────────────────────────────────────────────────────

/** Counts over the records in scope, gathered while their views are built. */
export type PlanTally = {
  foundMatches: number;
  foundRecords: number;
  /** Included matches in records not attempted in the run session. */
  includedMatches: number;
  changingMatches: number;
  changingRecords: number;
  /** Changing records in models without draft/published. */
  liveRecords: number;
  slugMatches: number;
  /** Changing slug matches whose new text isn't a valid slug. */
  slugFormatMatches: number;
  /** The first changing record (the confirm names it when it is the only one). */
  firstChangingRecord: { id: string; title: string | null } | null;
  selectableRecords: number;
  /** Selectable records whose matches are all included / all excluded. */
  selectableAll: number;
  selectableNone: number;
};

export function emptyTally(): PlanTally {
  return {
    foundMatches: 0,
    foundRecords: 0,
    includedMatches: 0,
    changingMatches: 0,
    changingRecords: 0,
    liveRecords: 0,
    slugMatches: 0,
    slugFormatMatches: 0,
    firstChangingRecord: null,
    selectableRecords: 0,
    selectableAll: 0,
    selectableNone: 0,
  };
}

/** "Select all" over every selectable record in scope. */
export function selectAllState(
  tally: PlanTally,
  baseline: boolean,
): 'all' | 'some' | 'none' {
  if (tally.selectableRecords === 0) return baseline ? 'all' : 'none';
  if (tally.selectableAll === tally.selectableRecords) return 'all';
  return tally.selectableNone === tally.selectableRecords ? 'none' : 'some';
}

// ─── Primary ────────────────────────────────────────────────────────────────

export type PrimaryInput = {
  searchPhase: SearchPhase;
  /** Large projects: the Find field holds settings not searched yet. */
  awaitingEnter?: boolean;
  runPhase: RunPhase;
  /** The verb and count the busy primary keeps while a pass runs. */
  busy: { verb: ReplaceVerb; count: number };
  verb: ReplaceVerb | null;
  problem: ReplacementProblem | null;
  tally: Pick<
    PlanTally,
    'foundMatches' | 'includedMatches' | 'changingMatches'
  >;
};

/** The controller adds the publish offer when there is one. */
const SEARCH_AGAIN: PrimaryView = { kind: 'searchAgain', publish: null };

function isSearchActive(phase: SearchPhase): boolean {
  return phase === 'pending' || phase === 'searching';
}

export function disabledReason(input: PrimaryInput): DisabledReason | null {
  const { searchPhase, tally } = input;
  if (isSearchActive(searchPhase)) return 'search_running';
  if (input.awaitingEnter) return 'press_enter';
  if (searchPhase === 'invalid') return 'invalid_pattern';
  if (searchPhase !== 'settled' || tally.foundMatches === 0) {
    return 'no_matches';
  }
  if (input.verb === null) return 'no_replacement';
  if (input.problem) return 'invalid_replacement';
  if (tally.includedMatches === 0) return 'nothing_selected';
  if (tally.changingMatches === 0) return 'nothing_changes';
  return null;
}

export function derivePrimary(input: PrimaryInput): PrimaryView {
  const { runPhase } = input;
  if (runPhase === 'running' || runPhase === 'stopping') {
    return {
      kind: 'replace',
      verb: input.busy.verb,
      count: input.busy.count,
      enabled: false,
      busy: true,
      reason: 'replacing',
    };
  }
  // Text typed but not searched yet: Enter searches it, not "Search again".
  if (
    runPhase === 'finished' &&
    !isSearchActive(input.searchPhase) &&
    !input.awaitingEnter
  ) {
    return SEARCH_AGAIN;
  }

  const verb = input.verb ?? 'replace';
  const reason = disabledReason(input);
  if (reason) {
    return {
      kind: 'replace',
      verb,
      count: 0,
      enabled: false,
      busy: false,
      reason,
    };
  }
  return {
    kind: 'replace',
    verb,
    count: input.tally.changingMatches,
    enabled: true,
  };
}

// ─── Meta ───────────────────────────────────────────────────────────────────

export type RunMetaTotals = {
  replacedMatches: number;
  skippedRecords: number;
  failedRecords: number;
  plannedMatches: number;
  /** Records published after the run. */
  publishedRecords: number;
};

export type MetaInput = {
  /** The phase whose results are shown (`pending` shows the previous search's). */
  shownPhase: SearchPhase;
  capped: boolean;
  runPhase: RunPhase;
  runVerb: ReplaceVerb;
  /** The meta as it was when the running pass started. */
  frozen: MetaView | null;
  runTotals: RunMetaTotals;
  verb: ReplaceVerb | null;
  problem: ReplacementProblem | null;
  tally: Pick<PlanTally, 'foundMatches' | 'foundRecords' | 'changingMatches'>;
};

const NO_META: MetaView = { kind: 'none' };
const NO_MATCHES: MetaView = { kind: 'noMatches' };

function foundMeta(input: MetaInput, capped: boolean): MetaView {
  const { tally, verb } = input;
  if (
    verb !== null &&
    input.problem === null &&
    tally.changingMatches !== tally.foundMatches
  ) {
    return {
      kind: 'willChange',
      changing: tally.changingMatches,
      found: tally.foundMatches,
      verb,
    };
  }
  return {
    kind: 'found',
    matches: tally.foundMatches,
    records: tally.foundRecords,
    capped,
  };
}

function searchMeta(input: MetaInput): MetaView {
  const found = input.tally.foundMatches > 0;
  switch (input.shownPhase) {
    case 'searching':
      return found ? foundMeta(input, false) : NO_META;
    case 'settled':
      return found ? foundMeta(input, input.capped) : NO_MATCHES;
    default:
      return NO_META;
  }
}

export function deriveMeta(input: MetaInput): MetaView {
  const { runPhase, runTotals, runVerb } = input;
  switch (runPhase) {
    case 'running':
    case 'stopping':
      return input.frozen ?? NO_META;
    case 'finished':
      return {
        kind: 'runFinished',
        verb: runVerb,
        replacedMatches: runTotals.replacedMatches,
        skippedRecords: runTotals.skippedRecords,
        failedRecords: runTotals.failedRecords,
        publishedRecords: runTotals.publishedRecords,
      };
    case 'stopped':
      return {
        kind: 'runStopped',
        verb: runVerb,
        replacedMatches: runTotals.replacedMatches,
        plannedMatches: runTotals.plannedMatches,
      };
    case 'none':
      return searchMeta(input);
  }
}

// ─── Body, note, callouts ───────────────────────────────────────────────────

export type BodyInput = {
  phase: SearchPhase;
  /** The phase before `pending` (the body keeps showing it). */
  shownPhase: SearchPhase;
  showProgress: boolean;
  shownRecords: number;
};

/** Before this, a search's pace is too uncertain to tell the time left. */
export const TIME_LEFT_AFTER_MS = 5_000;

/**
 * Seconds a search still needs at its pace so far (whole seconds, rounded
 * up), or null while that can't be told: the total isn't known, nothing was
 * read yet, or it has run for less than `TIME_LEFT_AFTER_MS`.
 */
export function estimateSecondsLeft(
  progress: { searched: number; total: number | null },
  elapsedMs: number,
): number | null {
  const { searched, total } = progress;
  if (
    total === null ||
    searched <= 0 ||
    searched >= total ||
    elapsedMs < TIME_LEFT_AFTER_MS
  ) {
    return null;
  }
  return Math.ceil(((total - searched) * elapsedMs) / searched / 1000);
}

export function deriveBody(input: BodyInput): BodyKind {
  const pending = input.phase === 'pending';
  const hasRecords = input.shownRecords > 0;
  switch (input.shownPhase) {
    case 'idle':
      return 'idle';
    case 'searching':
      if (hasRecords) return 'results';
      return !pending && input.showProgress ? 'spinner' : 'blank';
    case 'settled':
      return hasRecords ? 'results' : 'noResults';
    case 'invalid':
      // Its form line belongs to the old pattern: blank until the next start.
      return pending ? 'blank' : 'invalid';
    case 'failed':
      return pending ? 'blank' : 'searchFailed';
    case 'pending':
      return 'blank';
  }
}

export function deriveNote(args: {
  shownPhase: SearchPhase;
  capped: boolean;
  /** The results read on from where a capped search stopped. */
  continued?: boolean;
  stopped: boolean;
  progress: { searched: number; total: number | null };
  selfMatch: boolean;
}): NoteView | null {
  if (args.shownPhase !== 'settled') return null;
  if (args.capped) {
    return {
      kind: 'capped',
      selfMatch: args.selfMatch,
      continued: args.continued ?? false,
    };
  }
  if (args.stopped) {
    return {
      kind: 'searchStopped',
      searched: args.progress.searched,
      total: args.progress.total,
    };
  }
  return null;
}

/** Failed and skipped records (in scope) after a pass. */
export type RecordOutcomeSummary = {
  failed: number;
  retryableFailed: number;
  failReasons: ReadonlySet<FailReason>;
  skipped: number;
  staleSkipped: number;
};

export function deriveCallouts(args: {
  showRecordOutcomes: boolean;
  outcomes: RecordOutcomeSummary;
  failedModelNames: ReadonlyArray<string>;
  /** "Try again" can merge the failed models (see `SearchSession.canRetryModels`). */
  modelsRetryable?: boolean;
}): CalloutView[] {
  const callouts: CalloutView[] = [];
  const { outcomes } = args;
  if (args.showRecordOutcomes && outcomes.failed > 0) {
    const [onlyReason] = outcomes.failReasons;
    callouts.push({
      kind: 'recordsFailed',
      count: outcomes.failed,
      retryable: outcomes.retryableFailed > 0,
      singleReason:
        outcomes.failReasons.size === 1 && onlyReason ? onlyReason : null,
    });
  }
  if (args.showRecordOutcomes && outcomes.skipped > 0) {
    callouts.push({
      kind: 'recordsSkipped',
      count: outcomes.skipped,
      allStale: outcomes.staleSkipped === outcomes.skipped,
    });
  }
  if (args.failedModelNames.length > 0) {
    callouts.push({
      kind: 'modelsFailed',
      modelNames: args.failedModelNames,
      retryable: args.modelsRetryable ?? true,
    });
  }
  return callouts;
}

// ─── Plan facts ─────────────────────────────────────────────────────────────

/**
 * Identifies everything a plan depends on. Two equal tokens mean the same
 * write; any change to the results, the inputs, the filter, an inclusion or
 * the run session gives a new one.
 */
export function planToken(parts: {
  resultsId: number;
  resultsRevision: number;
  find: FindInput;
  replace: ReplaceInput;
  modelFilter: string | null;
  inclusionRevision: number;
  runRevision: number;
}): string {
  return fingerprintString(
    stableSerialize([
      parts.resultsId,
      parts.resultsRevision,
      parts.find,
      parts.replace,
      parts.modelFilter,
      parts.inclusionRevision,
      parts.runRevision,
    ]),
  );
}

export function planFacts(args: {
  token: string;
  verb: ReplaceVerb;
  tally: PlanTally;
  find: FindInput;
  replacementText: string;
}): PlanFacts {
  const { tally } = args;
  return {
    token: args.token,
    verb: args.verb,
    matchCount: tally.changingMatches,
    recordCount: tally.changingRecords,
    singleRecord:
      tally.changingRecords === 1 ? tally.firstChangingRecord : null,
    liveRecordCount: tally.liveRecords,
    slugMatchCount: tally.slugMatches,
    pattern: args.find.pattern,
    regex: args.find.regex,
    replacementText: args.verb === 'remove' ? '' : args.replacementText,
  };
}
