import {
  type CalloutView,
  DEFAULT_LIMITS,
  type DisabledReason,
  type FailDetail,
  type FailReason,
  type MetaView,
  type NoResultsView,
  type NoteView,
  type PatternProblem,
  type PlanFacts,
  type PublishHoldReason,
  type PublishOffer,
  type PublishSkipReason,
  type PublishTotals,
  type RecordPublishStatus,
  type RecordRunStatus,
  type ReplacementProblem,
  type ReplacementWarning,
  type ReplaceVerb,
  type RunTotals,
  type SkipReason,
  UI_LIMITS,
} from '../contract';

/**
 * Every user-facing string of the page. The controller returns codes and
 * numbers; this module turns them into sentences. Voice: plain, sentence case,
 * whole-string plurals, digits formatted with the user's locale.
 */

/** Strings that never depend on a count. */
export const STRINGS = {
  title: 'Find and Replace',
  loading: 'Loading',
  findLabel: 'Find',
  findPlaceholder: 'Type something to find…',
  findPlaceholderRegex: 'Type a regular expression…',
  findPlaceholderEnter: 'Type, then press Enter…',
  findPlaceholderRegexEnter: 'Pattern, then press Enter…',
  enterKey: 'Enter',
  pressEnter: 'Press Enter to search',
  clearSearch: 'Clear search',
  matchCase: 'Match case',
  matchWholeWord: 'Match whole word',
  useRegex: 'Use regular expression',
  replaceLabel: 'Replace with',
  replacePlaceholder: 'Replace with…',
  replacePlaceholderRegex: 'Replace with… ($1 inserts a group)',
  replacePlaceholderRemove: 'Matches will be removed',
  replaceWithNothing: 'Replace with nothing',
  allModels: 'All models',
  searchAgain: 'Search again',
  inProgress: ', in progress',
  searchProgress: 'Search progress',
  replaceProgress: 'Replacement progress',
  publishProgress: 'Publishing progress',
  publishing: 'Publishing…',
  published: 'Published',
  publishingReason:
    'You cannot do anything else right now as records are being published',
  keepOpen: 'Keep this page open until it finishes',
  stop: 'Stop',
  stopping: 'Stopping…',
  selectAll: 'Select all',
  changesUrl: 'Changes the URL',
  changesUrlTip:
    "Replacing text in a slug changes the record's URL, so slugs are left out unless you select them",
  noChange: 'No change',
  showFewer: 'Show fewer matches',
  loadMore: 'Load more records',
  openRecordNewTab: 'Open record in a new tab',
  openRecord: 'Open record',
  openRecordDisabled:
    'You cannot open records right now as a replacement is in progress',
  updating: 'Updating…',
  replacedWith: ' replaced with ',
  tryAgain: 'Try again',
  idleTitle: 'Find and replace across all records',
  idleLine:
    "Search every text field of every record. You'll review each match, and can leave any out, before anything changes.",
  everyMatchReplaced: 'Every match has been replaced',
  everyMatchRemoved: 'Every match has been removed',
  cancel: 'Cancel',
} as const;

type Counts = {
  fmt: (n: number) => string;
  matches: (n: number) => string;
  records: (n: number) => string;
};

function createCounts(locale: string): Counts {
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(locale);
  } catch {
    format = new Intl.NumberFormat('en');
  }
  const fmt = (n: number) => format.format(n);

  return {
    fmt,
    matches: (n) => (n === 1 ? '1 match' : `${fmt(n)} matches`),
    records: (n) => (n === 1 ? '1 record' : `${fmt(n)} records`),
  };
}

const capitalVerb = (verb: ReplaceVerb) =>
  verb === 'remove' ? 'Remove' : 'Replace';

const pastVerb = (verb: ReplaceVerb) =>
  verb === 'remove' ? 'removed' : 'replaced';

/** "12 of 40 matches" (whole-string plural on the total). */
function ofMatches(c: Counts, part: number, total: number): string {
  return total === 1
    ? `${c.fmt(part)} of 1 match`
    : `${c.fmt(part)} of ${c.fmt(total)} matches`;
}

/** Shows line breaks and tabs, then cuts to 39 characters + "…" above 40. */
function shortText(text: string): string {
  const shown = text.replace(/\r?\n/g, '↵').replace(/\t/g, '→');
  const chars = Array.from(shown);
  return chars.length > UI_LIMITS.quoteChars
    ? `${chars.slice(0, UI_LIMITS.quoteChars - 1).join('')}…`
    : shown;
}

export function quote(text: string): string {
  return `"${shortText(text)}"`;
}

/** The find pattern as the page quotes it: "Acme", or /Acme(\w+)/ in regex mode. */
function quotePattern(pattern: string, regex: boolean): string {
  return regex ? `/${shortText(pattern)}/` : quote(pattern);
}

export function recordTitle(title: string | null, recordId: string): string {
  return title?.trim() ? title : `Record #${recordId}`;
}

// ── Toolbar meta ────────────────────────────────────────────────────────────

function foundText(
  c: Counts,
  matches: number,
  records: number,
  capped: boolean,
): string {
  return capped
    ? `${c.fmt(matches)}+ matches in ${c.records(records)}`
    : `${c.matches(matches)} in ${c.records(records)}`;
}

function willChangeText(
  c: Counts,
  meta: Extract<MetaView, { kind: 'willChange' }>,
): string {
  const tail = meta.verb === 'remove' ? 'will be removed' : 'will change';
  if (meta.changing === 0) {
    return `No matches ${tail}`;
  }
  return `${ofMatches(c, meta.changing, meta.found)} ${tail}`;
}

function matchesWritten(c: Counts, n: number, verb: ReplaceVerb): string {
  return n === 0
    ? `No matches ${pastVerb(verb)}`
    : `${c.matches(n)} ${pastVerb(verb)}`;
}

function runOutcomeText(
  c: Counts,
  meta: Extract<MetaView, { kind: 'runFinished' }>,
): string {
  const base = matchesWritten(c, meta.replacedMatches, meta.verb);
  const skipped = meta.skippedRecords;
  const failed = meta.failedRecords;
  if (skipped > 0 && failed > 0) {
    return `${base}, ${c.records(skipped)} skipped, ${c.fmt(failed)} failed`;
  }
  if (skipped > 0) {
    return `${base}, ${c.records(skipped)} skipped`;
  }
  if (failed > 0) {
    return `${base}, ${c.records(failed)} failed`;
  }
  return base;
}

function runFinishedText(
  c: Counts,
  meta: Extract<MetaView, { kind: 'runFinished' }>,
): string {
  const outcome = runOutcomeText(c, meta);
  return meta.publishedRecords > 0
    ? `${outcome}, ${c.records(meta.publishedRecords)} published`
    : outcome;
}

function metaText(c: Counts, meta: MetaView): string | null {
  switch (meta.kind) {
    case 'none':
      return null;
    case 'noMatches':
      return 'No matches';
    case 'found':
      return foundText(c, meta.matches, meta.records, meta.capped);
    case 'willChange':
      return willChangeText(c, meta);
    case 'runFinished':
      return runFinishedText(c, meta);
    case 'runStopped':
      return `${ofMatches(c, meta.replacedMatches, meta.plannedMatches)} ${pastVerb(meta.verb)}`;
  }
}

// ── Primary slot ────────────────────────────────────────────────────────────

const DISABLED_REASONS: Record<DisabledReason, (verb: ReplaceVerb) => string> =
  {
    no_matches: (verb) =>
      `You cannot ${verb} anything until the search finds matches`,
    search_running: (verb) =>
      `You cannot ${verb} right now as the search is still running`,
    press_enter: (verb) => `You cannot ${verb} until you press Enter to search`,
    invalid_pattern: (verb) => `You cannot ${verb} as the pattern is not valid`,
    no_replacement: () =>
      'You cannot replace until you type a replacement or turn on Replace with nothing',
    invalid_replacement: () =>
      'You cannot replace until the replacement is fixed',
    nothing_selected: (verb) => `You cannot ${verb} as no matches are selected`,
    nothing_changes: () => 'You cannot replace as nothing would change',
    replacing: (verb) =>
      `You cannot ${verb} right now as a replacement is in progress`,
  };

// ── Row statuses and reasons ────────────────────────────────────────────────

const SKIP_REASONS: Record<SkipReason, string> = {
  stale: 'Changed after the search. Search again to include it.',
  deleted: 'This record no longer exists.',
  unsupported: "This field type can't be replaced yet.",
};

const FAIL_REASONS: Record<Exclude<FailReason, 'validation'>, string> = {
  permission: "Your role can't edit this record.",
  network: "Couldn't save this record. Try again.",
  unknown: "Couldn't save this record.",
};

function validationReason(detail: FailDetail | null): string {
  const field = detail?.fieldLabel;
  if (!detail || !field) {
    return "The new value doesn't pass the field's validations.";
  }
  switch (detail.code) {
    case 'length':
      return `The new value is too long or too short for "${field}".`;
    case 'format':
      return `The new value doesn't have the format "${field}" requires.`;
    case 'unique':
      return `The new value must be unique in "${field}".`;
    case 'required':
      return `"${field}" can't be empty.`;
    case 'other':
      return `The new value doesn't pass the validations of "${field}".`;
  }
}

function statusReason(status: RecordRunStatus): string | null {
  if (status.kind === 'skipped') {
    return SKIP_REASONS[status.reason];
  }
  if (status.kind === 'failed') {
    return status.reason === 'validation'
      ? validationReason(status.detail)
      : FAIL_REASONS[status.reason];
  }
  return null;
}

const PUBLISH_HOLD_REASONS: Record<PublishHoldReason, string> = {
  other_changes: 'Not published, as it already had other unpublished changes.',
  never_published: 'Not published, as it had never been published.',
};

const PUBLISH_SKIP_REASONS: Record<PublishSkipReason, string> = {
  changed: 'Not published, as it was edited after the replacement.',
  deleted: 'This record no longer exists.',
};

const PUBLISH_FAIL_REASONS: Record<
  Exclude<FailReason, 'validation'>,
  string
> = {
  permission: "Couldn't publish, as your role can't publish this record.",
  network: "Couldn't publish this record. Try again.",
  unknown: "Couldn't publish this record.",
};

function publishValidationReason(detail: FailDetail | null): string {
  const field = detail?.fieldLabel;
  if (!field) {
    return "Couldn't publish, as the record doesn't pass its validations.";
  }
  return detail?.code === 'required'
    ? `Couldn't publish, as "${field}" can't be empty.`
    : `Couldn't publish, as "${field}" doesn't pass its validations.`;
}

function publishReason(status: RecordPublishStatus): string | null {
  switch (status.kind) {
    case 'held':
      return PUBLISH_HOLD_REASONS[status.reason];
    case 'skipped':
      return PUBLISH_SKIP_REASONS[status.reason];
    case 'failed':
      return status.reason === 'validation'
        ? publishValidationReason(status.detail)
        : PUBLISH_FAIL_REASONS[status.reason];
    default:
      return null;
  }
}

// ── Lines above the card ────────────────────────────────────────────────────

function patternProblemText(problem: PatternProblem): string {
  switch (problem.code) {
    case 'invalid_regex':
      return problem.cause
        ? `Pattern must be a valid regular expression (${problem.cause})`
        : 'Pattern must be a valid regular expression';
    case 'zero_width':
      return 'Pattern must match at least one character';
    case 'too_slow':
      return 'Pattern takes too long to run, so try a simpler one';
  }
}

function replacementProblemText(problem: ReplacementProblem): string {
  switch (problem.code) {
    case 'context_token':
      return "Replacement can't use $` or $'";
  }
}

function replacementWarningText(
  c: Counts,
  warning: ReplacementWarning,
): string {
  switch (warning.code) {
    case 'group_out_of_range':
      if (warning.groupCount === 0) {
        return `Replacement uses ${warning.token}, but the pattern has no groups`;
      }
      return warning.groupCount === 1
        ? `Replacement uses ${warning.token}, but the pattern only has 1 group`
        : `Replacement uses ${warning.token}, but the pattern only has ${c.fmt(warning.groupCount)} groups`;
    case 'self_match':
      return 'Your replacement also matches this search, so a later search can find these matches again';
    case 'slug_format':
      return warning.count === 1
        ? 'Slugs only allow lowercase letters, numbers, hyphens and underscores, so 1 slug change will probably fail'
        : `Slugs only allow lowercase letters, numbers, hyphens and underscores, so ${c.fmt(warning.count)} slug changes will probably fail`;
  }
}

function noteText(c: Counts, note: NoteView): string {
  if (note.kind === 'capped') {
    // Searching again after replacing reads on from where this search stopped.
    return `Showing the ${note.continued ? 'next' : 'first'} ${c.fmt(DEFAULT_LIMITS.maxMatches)} matches. Replace them, then search again for the rest.`;
  }
  return note.total === null
    ? `Search stopped after ${c.records(note.searched)}, so some matches may be missing.`
    : `Search stopped after ${c.fmt(note.searched)} of ${c.records(note.total)}, so some matches may be missing.`;
}

export type CalloutAction = 'retryRecords' | 'retryModels';

export type CalloutCopy = {
  tone: 'danger' | 'warning';
  text: string;
  action: CalloutAction | null;
};

function recordsFailedText(
  c: Counts,
  callout: Extract<CalloutView, { kind: 'recordsFailed' }>,
): string {
  const one = callout.count === 1;
  const n = c.fmt(callout.count);
  switch (callout.singleReason) {
    case 'validation':
      return one
        ? "Couldn't update 1 record, as the new value doesn't pass its field validations."
        : `Couldn't update ${n} records, as the new values don't pass their field validations.`;
    case 'permission':
      return one
        ? "Couldn't update 1 record, as your role can't edit it."
        : `Couldn't update ${n} records, as your role can't edit them.`;
    case 'network':
      return one
        ? "Couldn't update 1 record, as DatoCMS didn't respond."
        : `Couldn't update ${n} records, as DatoCMS didn't respond.`;
    default:
      return one
        ? "Couldn't update 1 record. The reason is under it."
        : `Couldn't update ${n} records. The reason is under each one.`;
  }
}

function recordsSkippedText(
  c: Counts,
  callout: Extract<CalloutView, { kind: 'recordsSkipped' }>,
): string {
  const one = callout.count === 1;
  const n = c.fmt(callout.count);
  if (callout.allStale) {
    return one
      ? '1 record changed after the search and was skipped. Search again to include it.'
      : `${n} records changed after the search and were skipped. Search again to include them.`;
  }
  return one
    ? '1 record was skipped. The reason is under it.'
    : `${n} records were skipped. The reason is under each one.`;
}

function modelsFailedText(
  c: Counts,
  modelNames: ReadonlyArray<string>,
): string {
  const [a, b, third] = modelNames.map((name) => `"${name}"`);
  switch (modelNames.length) {
    case 1:
      return `Couldn't search the ${a} model.`;
    case 2:
      return `Couldn't search the ${a} and ${b} models.`;
    case 3:
      return `Couldn't search the ${a}, ${b} and ${third} models.`;
    default:
      return `Couldn't search ${c.fmt(modelNames.length)} models.`;
  }
}

function calloutCopy(c: Counts, callout: CalloutView): CalloutCopy {
  switch (callout.kind) {
    case 'recordsFailed':
      return {
        tone: 'danger',
        text: recordsFailedText(c, callout),
        action: callout.retryable ? 'retryRecords' : null,
      };
    case 'recordsSkipped':
      return {
        tone: 'warning',
        text: recordsSkippedText(c, callout),
        action: null,
      };
    case 'modelsFailed':
      return callout.retryable
        ? {
            tone: 'warning',
            text: modelsFailedText(c, callout.modelNames),
            action: 'retryModels',
          }
        : {
            tone: 'warning',
            text: `${modelsFailedText(c, callout.modelNames)} Searching again reads ${callout.modelNames.length === 1 ? 'it' : 'them'} once more.`,
            action: null,
          };
  }
}

// ── Empty, no results and pane states ──────────────────────────────────────

function narrowingParts(view: NoResultsView): string[] {
  const parts: string[] = [];
  if (view.caseSensitive && view.wholeWord) {
    parts.push('turn off Match case and Match whole word');
  } else if (view.caseSensitive) {
    parts.push('turn off Match case');
  } else if (view.wholeWord) {
    parts.push('turn off Match whole word');
  }
  if (view.regex) {
    parts.push('check the regular expression');
  }
  return parts;
}

/** A model filter is on and other models still have matches. */
function hiddenByFilter(
  view: NoResultsView,
): view is NoResultsView & { filteredModelName: string } {
  return view.filteredModelName !== null && view.otherModelsHaveMatches;
}

/**
 * `No matches for "Acme"` (`/Acme/` in regex mode), scoped to the chosen model
 * when the filter hides matches elsewhere, or the closing proof after "Search
 * again" (`verb`: the run's). A filter that hides matches wins over the proof:
 * the page never claims every match is gone while some remain behind it.
 */
function noResultsTitle(view: NoResultsView, pattern: string): string {
  const what = quotePattern(pattern, view.regex);
  if (hiddenByFilter(view)) {
    return `No matches for ${what} in "${view.filteredModelName}"`;
  }
  if (view.followsRun) {
    return view.runVerb === 'remove'
      ? STRINGS.everyMatchRemoved
      : STRINGS.everyMatchReplaced;
  }
  if (view.continued) return `No more matches for ${what}`;
  return `No matches for ${what}`;
}

function noResultsLine(view: NoResultsView): string {
  if (hiddenByFilter(view)) {
    return 'Choose All models to see the others.';
  }
  if (view.followsRun) {
    return 'Type something else to find.';
  }
  if (view.continued) {
    return "Records you already went through weren't read again. Press Enter to search them all.";
  }
  const parts = narrowingParts(view);
  if (parts.length > 0) {
    return `Consider broadening your search: ${parts.join(', ')}, or try different keywords.`;
  }
  return 'Check the spelling, or try different keywords.';
}

export type PaneStateCase =
  | { kind: 'unavailable'; cause: 'role' | 'no_models' | 'token' }
  | { kind: 'bootFailed'; cause: 'network' | 'unknown' }
  | { kind: 'searchFailed'; cause: 'network' | 'unknown' };

export type PaneStateCopy = {
  icon: 'ban' | 'error';
  title: string;
  line: string;
};

const API_DIDNT_RESPOND = "The Content Management API didn't respond.";

function unavailablePane(cause: 'role' | 'no_models' | 'token'): PaneStateCopy {
  switch (cause) {
    case 'role':
      return {
        icon: 'ban',
        title: 'Permission denied',
        line: 'Your account does not have enough privileges to access this area',
      };
    case 'no_models':
      return {
        icon: 'ban',
        title: 'Permission denied',
        line: "Your role can't edit records in any model this plugin can search.",
      };
    case 'token':
      return {
        icon: 'error',
        title: "Couldn't access your content",
        line: 'This plugin needs access to your API token. Ask a project admin to grant it in the plugin settings.',
      };
  }
}

export function paneStateCopy(pane: PaneStateCase): PaneStateCopy {
  if (pane.kind === 'unavailable') {
    return unavailablePane(pane.cause);
  }
  if (pane.kind === 'bootFailed') {
    return {
      icon: 'error',
      title: "Couldn't load your content",
      line:
        pane.cause === 'network'
          ? API_DIDNT_RESPOND
          : 'Something went wrong while loading your models and fields.',
    };
  }
  return {
    icon: 'error',
    title: "Couldn't search the records",
    line:
      pane.cause === 'network'
        ? API_DIDNT_RESPOND
        : 'Something went wrong while reading your records.',
  };
}

// ── Confirm ─────────────────────────────────────────────────────────────────

function confirmQuestion(c: Counts, plan: PlanFacts): string {
  const where =
    plan.recordCount === 1 && plan.singleRecord
      ? `"${recordTitle(plan.singleRecord.title, plan.singleRecord.id)}"`
      : c.records(plan.recordCount);
  const what = plan.regex
    ? `matches of ${quotePattern(plan.pattern, true)}`
    : quote(plan.pattern);
  if (plan.verb === 'remove') {
    return `Are you sure you want to remove ${what} from ${where}?`;
  }
  return `Are you sure you want to replace ${what} with ${quote(plan.replacementText)} in ${where}?`;
}

function publishingConsequence(plan: PlanFacts): string {
  const live = plan.liveRecordCount;
  const total = plan.recordCount;
  if (live === 0) {
    return total === 1
      ? 'Changes are saved as a draft and nothing gets published.'
      : 'Changes are saved as drafts and nothing gets published.';
  }
  if (live < total) {
    return 'Records in models without draft/published change on your website right away.';
  }
  return total === 1
    ? 'This record changes on your website right away.'
    : 'These records change on your website right away.';
}

function confirmConsequences(c: Counts, plan: PlanFacts): string[] {
  const sentences: string[] = [];
  if (plan.slugMatchCount === 1) {
    sentences.push("1 slug changes, which changes that record's URL.");
  } else if (plan.slugMatchCount > 1) {
    sentences.push(
      `${c.fmt(plan.slugMatchCount)} slugs change, which changes those records' URLs.`,
    );
  }
  sentences.push(publishingConsequence(plan));
  return sentences;
}

export type ConfirmCopy = {
  title: string;
  content: string;
  choice: string;
};

function confirmCopy(c: Counts, plan: PlanFacts): ConfirmCopy {
  const one = plan.matchCount === 1;
  const lowerVerb = plan.verb;
  return {
    title: one
      ? `${capitalVerb(plan.verb)} this match?`
      : `${capitalVerb(plan.verb)} ${c.fmt(plan.matchCount)} matches?`,
    content: [confirmQuestion(c, plan), ...confirmConsequences(c, plan)].join(
      ' ',
    ),
    choice: one
      ? `Yes, ${lowerVerb} this match`
      : `Yes, ${lowerVerb} ${c.fmt(plan.matchCount)} matches`,
  };
}

function publishConfirmCopy(c: Counts, offer: PublishOffer): ConfirmCopy {
  const one = offer.recordCount === 1;
  const sentences = [
    one
      ? 'Only the replaced text goes live, as this record had no other unpublished changes.'
      : 'Only the replaced text goes live, as these records had no other unpublished changes.',
  ];
  if (offer.heldCount === 1) {
    sentences.push(
      "1 other replaced record stays unpublished, as publishing it would also publish changes that aren't part of this replacement.",
    );
  } else if (offer.heldCount > 1) {
    sentences.push(
      `${c.fmt(offer.heldCount)} other replaced records stay unpublished, as publishing them would also publish changes that aren't part of this replacement.`,
    );
  }
  return {
    title: one
      ? 'Publish this record?'
      : `Publish ${c.fmt(offer.recordCount)} records?`,
    content: sentences.join(' '),
    choice: one
      ? 'Yes, publish this record'
      : `Yes, publish ${c.fmt(offer.recordCount)} records`,
  };
}

// ── Toasts ──────────────────────────────────────────────────────────────────

/** A sentence that opens with the count: "One match replaced", "No matches replaced". */
function leadingMatches(c: Counts, n: number, verb: ReplaceVerb): string {
  if (n === 0) {
    return `No matches ${pastVerb(verb)}`;
  }
  return n === 1
    ? `One match ${pastVerb(verb)}`
    : `${c.fmt(n)} matches ${pastVerb(verb)}`;
}

function toastAllWritten(c: Counts, n: number, verb: ReplaceVerb): string {
  if (n === 0) {
    return `No matches successfully ${pastVerb(verb)}!`;
  }
  return n === 1
    ? `One match successfully ${pastVerb(verb)}!`
    : `${c.fmt(n)} matches successfully ${pastVerb(verb)}!`;
}

function toastSkipped(c: Counts, pass: RunTotals, verb: ReplaceVerb): string {
  const lead = leadingMatches(c, pass.replacedMatches, verb);
  const skipped = pass.skippedRecords;
  if (pass.staleSkippedRecords !== skipped) {
    return `${lead}, ${c.records(skipped)} skipped.`;
  }
  return skipped === 1
    ? `${lead}, 1 record skipped as it changed after the search.`
    : `${lead}, ${c.fmt(skipped)} records skipped as they changed after the search.`;
}

function toastFailed(c: Counts, pass: RunTotals, verb: ReplaceVerb): string {
  const lead = leadingMatches(c, pass.replacedMatches, verb);
  return pass.failedRecords === 1
    ? `${lead}, 1 record couldn't be updated.`
    : `${lead}, ${c.fmt(pass.failedRecords)} records couldn't be updated.`;
}

function toastNotUpdated(
  c: Counts,
  pass: RunTotals,
  verb: ReplaceVerb,
): string {
  const lead = leadingMatches(c, pass.replacedMatches, verb);
  return `${lead}, ${c.records(pass.skippedRecords + pass.failedRecords)} weren't updated.`;
}

function toastPublished(c: Counts, n: number): string {
  return n === 1
    ? 'One record successfully published!'
    : `${c.fmt(n)} records successfully published!`;
}

function toastPublishPartial(c: Counts, pass: PublishTotals): string {
  const lead =
    pass.published === 0
      ? 'No records published'
      : pass.published === 1
        ? 'One record published'
        : `${c.fmt(pass.published)} records published`;
  return `${lead}, ${c.records(pass.skipped + pass.failed)} couldn't be published.`;
}

// ── Model filter ────────────────────────────────────────────────────────────

function optionCount(c: Counts, count: number | null, partial: boolean) {
  if (count === null) {
    return '—';
  }
  return partial ? `${c.fmt(count)}+` : c.fmt(count);
}

function optionCountSuffix(c: Counts, count: number | null): string {
  if (count === null) {
    return ", couldn't be searched";
  }
  return count === 0 ? ', no matches' : `, ${c.matches(count)}`;
}

// ── Where-cells ─────────────────────────────────────────────────────────────

const NBSP = '\u00a0';

/**
 * "SEO › Description · en": every segment, then the locale as plain text.
 * No-break spaces keep a wrapped label readable in its narrow column: a line
 * breaks only after "›" (never before it), and the locale stays with the
 * last segment ("Heading · en", never a lone "· en").
 */
export function whereLabel(
  path: ReadonlyArray<string>,
  locale: string | null,
): string {
  const full = path.join(`${NBSP}› `);
  return locale ? `${full}${NBSP}·${NBSP}${locale}` : full;
}

/** Every match line's accessible name: "Body, en, match 2" ("Title, en" when the field has one match). */
export function whereName(
  path: ReadonlyArray<string>,
  locale: string | null,
  index: number,
  total: number,
): string {
  const parts = [path.join(' › ')];
  if (locale) {
    parts.push(locale);
  }
  if (total > 1) {
    parts.push(`match ${index + 1}`);
  }
  return parts.join(', ');
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function createCopy(locale: string) {
  const c = createCounts(locale);

  return {
    fmt: c.fmt,
    matches: c.matches,
    records: c.records,
    quote,
    recordTitle,
    whereLabel,
    whereName,

    meta: (meta: MetaView) => metaText(c, meta),
    found: (matches: number, records: number, capped: boolean) =>
      foundText(c, matches, records, capped),

    primaryLabel: (verb: ReplaceVerb, count: number) =>
      `${capitalVerb(verb)} ${c.matches(count)}`,
    primaryIdleLabel: capitalVerb,
    publishLabel: (count: number) => `Publish ${c.records(count)}`,
    disabledReason: (reason: DisabledReason, verb: ReplaceVerb) =>
      DISABLED_REASONS[reason](verb),

    searchProgress: (searched: number, total: number | null) => {
      if (total !== null) {
        return `${c.fmt(searched)} of ${c.records(total)} searched`;
      }
      return searched === 0 ? 'Searching…' : `${c.records(searched)} searched`;
    },
    /** The time a search still needs, rounded: minutes, or under a minute. */
    timeLeft: (seconds: number) => {
      if (seconds < 60) return 'Less than a minute left';
      const minutes = Math.round(seconds / 60);
      return minutes <= 1
        ? 'About a minute left'
        : `About ${c.fmt(minutes)} minutes left`;
    },
    replaceProgress: (done: number, total: number) =>
      `${c.fmt(done)} of ${c.records(total)} processed`,
    publishProgress: (done: number, total: number) =>
      `${c.fmt(done)} of ${c.records(total)} published`,

    /** "Article · 3 matches", after the record title. */
    recordMeta: (modelName: string, count: number) =>
      `${modelName} · ${c.matches(count)}`,
    recordCheckbox: (title: string) => `Select "${title}"`,
    /** "Select this match in Title (en)"; "Select match 2 in Body (en)" when the field has 2+ matches. */
    matchCheckbox: (
      path: string,
      locale: string | null,
      index = 0,
      total = 1,
    ) => {
      const which = total > 1 ? `match ${c.fmt(index + 1)}` : 'this match';
      return locale
        ? `Select ${which} in ${path} (${locale})`
        : `Select ${which} in ${path}`;
    },
    showMore: (count: number) =>
      count === 1 ? 'Show 1 more match' : `Show ${c.fmt(count)} more matches`,
    statusWord: (kind: 'replaced' | 'skipped' | 'failed') =>
      ({ replaced: 'Replaced', skipped: 'Skipped', failed: 'Failed' })[kind],
    statusReason,
    publishReason,

    patternProblem: patternProblemText,
    replacementProblem: replacementProblemText,
    replacementWarning: (warning: ReplacementWarning) =>
      replacementWarningText(c, warning),
    note: (note: NoteView) => noteText(c, note),
    callout: (callout: CalloutView) => calloutCopy(c, callout),

    noResultsTitle,
    noResultsLine,
    paneState: paneStateCopy,

    confirm: (plan: PlanFacts) => confirmCopy(c, plan),
    publishConfirm: (offer: PublishOffer) => publishConfirmCopy(c, offer),

    toastStopped: (pass: RunTotals) =>
      `Replacement stopped: ${c.fmt(pass.replacedRecords)} of ${c.records(pass.plannedRecords)} updated.`,
    toastAllWritten: (pass: RunTotals, verb: ReplaceVerb) =>
      toastAllWritten(c, pass.replacedMatches, verb),
    toastPermission: (verb: ReplaceVerb) =>
      `Couldn't ${verb} the matches, as your role can't edit these records!`,
    toastSkipped: (pass: RunTotals, verb: ReplaceVerb) =>
      toastSkipped(c, pass, verb),
    toastFailed: (pass: RunTotals, verb: ReplaceVerb) =>
      toastFailed(c, pass, verb),
    toastNotUpdated: (pass: RunTotals, verb: ReplaceVerb) =>
      toastNotUpdated(c, pass, verb),
    toastPublished: (pass: PublishTotals) => toastPublished(c, pass.published),
    toastPublishStopped: (pass: PublishTotals) =>
      `Publishing stopped: ${c.fmt(pass.published)} of ${c.records(pass.planned)} published.`,
    toastPublishPartial: (pass: PublishTotals) => toastPublishPartial(c, pass),
    toastPublishPermission: () =>
      "Couldn't publish the records, as your role can't publish them!",

    filterTrigger: (selected: { name: string } | null) =>
      selected ? selected.name : STRINGS.allModels,
    optionCount: (count: number | null, partial: boolean) =>
      optionCount(c, count, partial),
    optionCountSuffix: (count: number | null) => optionCountSuffix(c, count),

    announceSettled: (event: {
      matches: number;
      records: number;
      capped: boolean;
      stopped: boolean;
    }) => {
      const meta =
        event.matches === 0
          ? 'No matches'
          : foundText(c, event.matches, event.records, event.capped);
      return event.stopped ? `Search stopped. ${meta}` : meta;
    },
  };
}

export type Copy = ReturnType<typeof createCopy>;
