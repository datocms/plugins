import { Shortcut } from 'datocms-react-ui/Actions';
import type { ReactElement } from 'react';
import {
  type CalloutView,
  DEFAULT_LIMITS,
  type DisabledReason,
  type FailDetail,
  type FailReason,
  type FindInput,
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

/** The key that searches, in a text: Enter in Find */
const ENTER = <Shortcut keys={{ key: 'enter' }} />;

/** Strings that never depend on a count. */
export const STRINGS = {
  title: 'Find and replace',
  /** The Toolbar.Help of the title: what the page is for. */
  help: 'Finds text in the records of your models and replaces it. You review every match, and can leave any out, before anything changes.',
  loading: 'Loading the models',
  /** The name of the page's Pane: what it lists. The find form takes it as its search name. */
  paneLabel: 'Records',
  findLabel: 'Find',
  /** Placeholders name the field, never instruct. */
  findPlaceholder: 'Find',
  pressEnter: 'Press Enter to search.',
  /** The meta after the title while Find holds settings not searched yet: the count shown is the earlier search's. */
  awaitingEnter: 'Not searched yet',
  clearSearch: 'Clear search',
  /** The menu of the find options, after Find. */
  options: 'Options',
  matchCase: 'Match case',
  matchWholeWord: 'Match whole word',
  useRegex: 'Use regular expression',
  /** "Use regular expression" in the Options trigger, while it is on. */
  regexOn: 'Regular expression',
  /** Under the options while regular expressions are on. */
  regexTip: 'In Replace with, $1 inserts the first group of the pattern.',
  replaceLabel: 'Replace with',
  replacePlaceholder: 'Replace with',
  replacePlaceholderRemove: 'Matches will be removed',
  replaceWithNothing: 'Replace with nothing',
  allModels: 'All models',
  searchAgain: 'Search again',
  /** The publish offer on a phone-width frame, next to "Search again" (the confirm gives the count). */
  publish: 'Publish',
  publishing: 'Publishing…',
  published: 'Published',
  notPublished: 'Not published',
  publishingReason: 'Wait for the records to be published.',
  keepOpen: 'Keep this page open until it finishes',
  /** The same, as a callout above the results on a phone-width frame, where the progress row has no room for it. */
  keepOpenNotice: 'Keep this page open until it finishes.',
  stop: 'Stop',
  stopping: 'Stopping…',
  stoppingReason: 'It stops after the record in progress.',
  searchDisabledReason:
    "You can't change the search while records are being updated or published.",
  recordColumn: 'Record',
  matchColumn: 'Match',
  modelColumn: 'Model',
  statusColumn: 'Status',
  changesUrl: 'Changes the URL',
  changesUrlTip:
    "Replacing text in a slug changes the record's URL, so slugs are left out unless you select them.",
  noChange: 'No change',
  showFewer: 'Show fewer matches',
  loadMore: 'Load more records',
  openRecordNewTab: 'Open record in a new tab',
  openRecord: 'Open record',
  openRecordDisabled: "You can't open records while they are being updated.",
  updating: 'Updating…',
  replacedWith: ' replaced with ',
  tryAgain: 'Try again',
  /** The retry of the failed records on a phone-width frame, where the count has no room. */
  saveAgain: 'Save again',
  /** What is missing before the first search. */
  idleTitle: 'No search yet',
  idleLine:
    'Matches show here as you type. Nothing changes until you review them and confirm.',
  /** One element: the description of a blank slate lays out each child apart */
  idleLineEnter: (
    <span>
      Matches show here when you press {ENTER}. Nothing changes until you review
      them and confirm.
    </span>
  ),
  showAllModels: 'Show all models',
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

/** A name in a sentence: “Article”. */
function quoteName(name: string): string {
  return `“${name}”`;
}

/** A string the user typed, in a sentence: “Acme”, cut to 40 characters. */
export function quote(text: string): string {
  return quoteName(shortText(text));
}

/** The find pattern as the page quotes it: “Acme”, or /Acme(\w+)/ in regex mode. */
function quotePattern(pattern: string, regex: boolean): string {
  return regex ? `/${shortText(pattern)}/` : quote(pattern);
}

/** The title of a record, or “Record 42” when it has none (the ID keeps it unique). */
export function recordTitle(title: string | null, recordId: string): string {
  return title?.trim() ? title : `Record ${recordId}`;
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

/** Each reason says what to do, as the docs' "Fix the 2 invalid fields first." */
const DISABLED_REASONS: Record<DisabledReason, (verb: ReplaceVerb) => string> =
  {
    no_matches: (verb) => `Find some matches to ${verb} first.`,
    search_running: () => 'Wait for the search to finish.',
    press_enter: () => 'Search first.',
    invalid_pattern: () => 'Fix the text in Find first.',
    no_replacement: () =>
      'Type a replacement first, or pick Replace with nothing in Options.',
    invalid_replacement: () => 'Fix the replacement first.',
    nothing_selected: () => 'Select at least one match first.',
    nothing_changes: () =>
      'Type a different replacement, as this one changes nothing.',
    replacing: () => 'Wait for the replacement to finish.',
  };

// ── Row statuses and reasons ────────────────────────────────────────────────

/** Each row states only its cause: the title bar holds "Search again" and "Save 2 records again". */
const SKIP_REASONS: Record<SkipReason, string> = {
  stale: 'Someone edited it after the search.',
  deleted: 'This record no longer exists.',
  unsupported: "This field type can't be replaced yet.",
};

const FAIL_REASONS: Record<Exclude<FailReason, 'validation'>, string> = {
  permission: "Your role can't edit this record.",
  network: "Couldn't save this record, as DatoCMS didn't respond.",
  unknown: "Couldn't save this record.",
};

function validationReason(detail: FailDetail | null): string {
  const field = detail?.fieldLabel;
  if (!detail || !field) {
    return "The new value doesn't pass the field's validations.";
  }
  const name = quoteName(field);
  switch (detail.code) {
    case 'length':
      return `The new value is too long or too short for ${name}.`;
    case 'format':
      return `The new value doesn't have the format ${name} requires.`;
    case 'unique':
      return `The new value must be unique in ${name}.`;
    case 'required':
      return `${name} can't be empty.`;
    case 'other':
      return `The new value doesn't pass the validations of ${name}.`;
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
  network: "Couldn't publish, as DatoCMS didn't respond.",
  unknown: "Couldn't publish this record.",
};

function publishValidationReason(detail: FailDetail | null): string {
  const field = detail?.fieldLabel;
  if (!field) {
    return "Couldn't publish, as the record doesn't pass its validations.";
  }
  return detail?.code === 'required'
    ? `Couldn't publish, as ${quoteName(field)} can't be empty.`
    : `Couldn't publish, as ${quoteName(field)} doesn't pass its validations.`;
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

// ── Callouts above the results ──────────────────────────────────────────────

function patternProblemText(problem: PatternProblem): string {
  switch (problem.code) {
    case 'invalid_regex':
      return problem.cause
        ? `Fix the regular expression (${problem.cause}), or turn off Use regular expression in Options.`
        : 'Fix the regular expression, or turn off Use regular expression in Options.';
    case 'zero_width':
      return 'Pattern must match at least one character.';
    case 'too_slow':
      return 'Pattern takes too long to run, so try a simpler one.';
  }
}

function replacementProblemText(problem: ReplacementProblem): string {
  switch (problem.code) {
    case 'context_token':
      return "Replacement can't use $` or $'.";
  }
}

function replacementWarningText(
  c: Counts,
  warning: ReplacementWarning,
): string {
  switch (warning.code) {
    case 'group_out_of_range':
      if (warning.groupCount === 0) {
        return `Replacement uses ${warning.token}, but the pattern has no groups.`;
      }
      return warning.groupCount === 1
        ? `Replacement uses ${warning.token}, but the pattern only has 1 group.`
        : `Replacement uses ${warning.token}, but the pattern only has ${c.fmt(warning.groupCount)} groups.`;
    case 'self_match':
      return `${quote(warning.replacement)} still contains ${quote(warning.pattern)}, so searching again will find these matches again.`;
    case 'slug_format':
      return warning.count === 1
        ? 'Slugs only allow lowercase letters, numbers, hyphens and underscores, so 1 slug change will probably fail.'
        : `Slugs only allow lowercase letters, numbers, hyphens and underscores, so ${c.fmt(warning.count)} slug changes will probably fail.`;
  }
}

/** The title of a note: the problem in a few words (each text has two sentences). */
function noteTitle(note: NoteView): string {
  return note.kind === 'capped'
    ? 'More matches to replace'
    : 'Some matches may be missing';
}

function noteText(c: Counts, note: NoteView): string | ReactElement {
  if (note.kind === 'capped') {
    // Searching again after replacing reads on from where this search stopped.
    return `Showing the ${note.continued ? 'next' : 'first'} ${c.fmt(DEFAULT_LIMITS.maxMatches)} matches. Replace them, then search again for the rest.`;
  }
  const searched =
    note.total === null
      ? c.records(note.searched)
      : `${c.fmt(note.searched)} of ${c.records(note.total)}`;
  return (
    <>
      The search stopped after {searched}. Press {ENTER} in Find to search them
      all.
    </>
  );
}

/**
 * The callout of the models that couldn't be searched: a fact about the
 * current results. The failed records and the skipped ones have no callout:
 * the meta counts them, each row says why, and the toast reported the run.
 */
export type CalloutCopy = {
  /** The problem in a few words, when the text has two sentences; else null. */
  title: string | null;
  /** The whole message: the callout holds only this text. */
  text: string | ReactElement;
};

function modelsFailedText(
  c: Counts,
  modelNames: ReadonlyArray<string>,
): string {
  const [a, b, third] = modelNames.map(quoteName);
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

export type ModelsFailedCallout = Extract<
  CalloutView,
  { kind: 'modelsFailed' }
>;

/** Retryable: the title bar has the button that searches them again. Else Enter in Find does. */
function modelsFailedCopy(
  c: Counts,
  callout: ModelsFailedCallout,
): CalloutCopy {
  const text = modelsFailedText(c, callout.modelNames);
  if (callout.retryable) {
    return { title: null, text };
  }
  return {
    title:
      callout.modelNames.length === 1
        ? "A model wasn't searched"
        : "Some models weren't searched",
    text: (
      <>
        {text} Press {ENTER} in Find to search again.
      </>
    ),
  };
}

/**
 * The Options trigger: the options that are on, so a search they narrow, or
 * a disabled Replace with, never looks like a plain one ("Options: Match
 * case", "Options: Replace with nothing", "Options: 2 on").
 */
export function optionsLabel(
  find: Pick<FindInput, 'caseSensitive' | 'wholeWord' | 'regex'>,
  remove: boolean,
): string {
  const on: string[] = [];
  if (find.caseSensitive) {
    on.push(STRINGS.matchCase);
  }
  if (find.wholeWord) {
    on.push(STRINGS.matchWholeWord);
  }
  if (find.regex) {
    on.push(STRINGS.regexOn);
  }
  if (remove) {
    on.push(STRINGS.replaceWithNothing);
  }
  const [only] = on;
  if (on.length > 1) {
    return `${STRINGS.options}: ${on.length} on`;
  }
  return only ? `${STRINGS.options}: ${only}` : STRINGS.options;
}

/** The button of the title bar that searches the failed models again. */
function retryModelsLabel(modelNames: ReadonlyArray<string>): string {
  const [name] = modelNames;
  return modelNames.length === 1 && name
    ? `Search ${quoteName(name)} again`
    : 'Search the failed models again';
}

// ── Empty, no results and pane states ──────────────────────────────────────

/** The options that are on and narrow the search, by their names in Options. */
function narrowingOptions(view: NoResultsView): string[] {
  const names: string[] = [];
  if (view.caseSensitive) {
    names.push(STRINGS.matchCase);
  }
  if (view.wholeWord) {
    names.push(STRINGS.matchWholeWord);
  }
  return names;
}

/** A model filter is on and other models still have matches: "Show all models" leads back to them. */
export function hiddenByFilter(
  view: NoResultsView,
): view is NoResultsView & { filteredModelName: string } {
  return view.filteredModelName !== null && view.otherModelsHaveMatches;
}

/**
 * `No matches for “Acme”` (`/Acme/` in regex mode), scoped to the chosen model
 * when the filter hides matches elsewhere, or the closing proof after "Search
 * again" (`verb`: the run's). A filter that hides matches wins over the proof:
 * the page never claims every match is gone while some remain behind it.
 */
function noResultsTitle(view: NoResultsView, pattern: string): string {
  const what = quotePattern(pattern, view.regex);
  if (hiddenByFilter(view)) {
    return `No matches for ${what} in ${quoteName(view.filteredModelName)}`;
  }
  if (view.followsRun) {
    return view.runVerb === 'remove'
      ? STRINGS.everyMatchRemoved
      : STRINGS.everyMatchReplaced;
  }
  if (view.continued) return `No more matches for ${what}`;
  return `No matches for ${what}`;
}

/**
 * The line under the title, only when something on screen can change the
 * outcome; a plain search with no results has a title alone.
 */
function noResultsLine(view: NoResultsView): string | ReactElement | null {
  if (hiddenByFilter(view)) {
    return 'Other models have matches.';
  }
  // After a run, the title alone says that every match is gone.
  if (view.followsRun) {
    return null;
  }
  if (view.continued) {
    // One element: the description of a blank slate lays out each child apart
    return (
      <span>
        Records you already went through weren't read again. Press {ENTER} to
        search them all.
      </span>
    );
  }
  const options = narrowingOptions(view);
  return options.length > 0
    ? `To find more, turn off ${options.join(' and ')} in Options.`
    : null;
}

export type PaneStateCase =
  | { kind: 'unavailable'; cause: 'role' | 'no_models' | 'token' }
  | { kind: 'bootFailed'; cause: 'network' | 'unknown' }
  | { kind: 'searchFailed'; cause: 'network' | 'unknown' };

export type PaneStateCopy = {
  /** Every case is an error: 'ban' for a permission that is missing, else the exclamation. */
  icon: 'ban' | 'error';
  title: string;
  line: string;
};

/** A failure the user can't see the cause of: what happened, then what to do. */
const API_DIDNT_RESPOND =
  "DatoCMS didn't respond. Check your connection, then try again.";
const TRY_AGAIN_OR_RELOAD =
  'Try again, and reload the page if it keeps failing.';

/** The title says what is missing; the line, what to do. */
function unavailablePane(cause: 'role' | 'no_models' | 'token'): PaneStateCopy {
  switch (cause) {
    case 'role':
      return {
        icon: 'ban',
        title: `Your role can't use ${STRINGS.title}`,
        line: 'Ask a project admin to give your role access in the plugin settings.',
      };
    case 'no_models':
      return {
        icon: 'ban',
        title: 'No models you can edit',
        line: `Ask a project admin to give your role access to one of the models that ${STRINGS.title} searches.`,
      };
    case 'token':
      return {
        icon: 'error',
        title: "Couldn't access your content",
        line: "This plugin needs access to your API token. Ask a project admin to grant it in the plugin's permissions.",
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
          : `Something went wrong while loading your models and fields. ${TRY_AGAIN_OR_RELOAD}`,
    };
  }
  return {
    icon: 'error',
    title: "Couldn't search the records",
    line:
      pane.cause === 'network'
        ? API_DIDNT_RESPOND
        : `Something went wrong while reading your records. ${TRY_AGAIN_OR_RELOAD}`,
  };
}

// ── Confirm ─────────────────────────────────────────────────────────────────

/** What the write does, stated once: the title already asks. */
function confirmStatement(c: Counts, plan: PlanFacts): string {
  const where =
    plan.recordCount === 1 && plan.singleRecord
      ? quoteName(recordTitle(plan.singleRecord.title, plan.singleRecord.id))
      : c.records(plan.recordCount);
  const what = plan.regex
    ? `matches of ${quotePattern(plan.pattern, true)}`
    : quote(plan.pattern);
  if (plan.verb === 'remove') {
    return `This removes ${what} from ${where}.`;
  }
  return `This replaces ${what} with ${quote(plan.replacementText)} in ${where}.`;
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
    return "Some of these records aren't saved as drafts, so they change on your website right away.";
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
    content: [confirmStatement(c, plan), ...confirmConsequences(c, plan)].join(
      ' ',
    ),
    choice: one
      ? `Yes, ${lowerVerb} this match`
      : `Yes, ${lowerVerb} ${c.fmt(plan.matchCount)} matches`,
  };
}

function publishConfirmCopy(c: Counts, offer: PublishOffer): ConfirmCopy {
  const one = offer.recordCount === 1;
  const sentences = ['Only the replaced text goes live.'];
  if (offer.heldCount === 1) {
    sentences.push(
      '1 other record stays unpublished, as it has other unpublished changes.',
    );
  } else if (offer.heldCount > 1) {
    sentences.push(
      `${c.fmt(offer.heldCount)} other records stay unpublished, as they have other unpublished changes.`,
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

/** In the words of the meta after the title: "…, 3 records skipped." Each row says why. */
function toastSkipped(c: Counts, pass: RunTotals, verb: ReplaceVerb): string {
  const lead = leadingMatches(c, pass.replacedMatches, verb);
  return `${lead}, ${c.records(pass.skippedRecords)} skipped.`;
}

/** In the words of the meta after the title: "…, 3 records failed." */
function toastFailed(c: Counts, pass: RunTotals, verb: ReplaceVerb): string {
  const lead = leadingMatches(c, pass.replacedMatches, verb);
  return `${lead}, ${c.records(pass.failedRecords)} failed.`;
}

/** In the words of the meta after the title: "…, 2 records skipped, 1 failed." */
function toastNotUpdated(
  c: Counts,
  pass: RunTotals,
  verb: ReplaceVerb,
): string {
  const lead = leadingMatches(c, pass.replacedMatches, verb);
  return `${lead}, ${c.records(pass.skippedRecords)} skipped, ${c.fmt(pass.failedRecords)} failed.`;
}

function toastPublished(c: Counts, n: number): string {
  return n === 1 ? 'One record published' : `${c.fmt(n)} records published`;
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

/** The count of a model filter option: "12 matches", "96+ matches" while partial. */
function optionCount(
  c: Counts,
  count: number | null,
  partial: boolean,
): string {
  if (count === null) {
    return "Couldn't search";
  }
  if (partial) {
    return `${c.fmt(count)}+ matches`;
  }
  return count === 0 ? 'No matches' : c.matches(count);
}

// ── Where-cells ─────────────────────────────────────────────────────────────

const NBSP = '\u00a0';

/**
 * The name of a locale's language in English, the language of this copy
 * ("en" → "English", "pt-BR" → "Brazilian Portuguese"), or its code in
 * capitals ("XX") when there is no name for it.
 */
function createLanguageNames(): (code: string) => string {
  const names = new Intl.DisplayNames('en', {
    type: 'language',
    fallback: 'none',
  });
  return (code) => {
    try {
      return names.of(code) ?? code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  };
}

/**
 * "SEO › Description · English": every segment, then the language as plain
 * text. No-break spaces keep a wrapped label readable in its narrow column:
 * a line breaks only after "›" (never before it), and the language stays
 * with the last segment ("Heading · English", never a lone "· English").
 */
export function whereLabel(
  path: ReadonlyArray<string>,
  language: string | null,
): string {
  const full = path.join(`${NBSP}› `);
  return language ? `${full}${NBSP}·${NBSP}${language}` : full;
}

/** Every match line's accessible name: "Body, English, match 2" ("Title, English" when the field has one match). */
export function whereName(
  path: ReadonlyArray<string>,
  language: string | null,
  index: number,
  total: number,
): string {
  const parts = [path.join(' › ')];
  if (language) {
    parts.push(language);
  }
  if (total > 1) {
    parts.push(`match ${index + 1}`);
  }
  return parts.join(', ');
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function createCopy(locale: string) {
  const c = createCounts(locale);
  const languageName = createLanguageNames();
  const language = (code: string | null) =>
    code === null ? null : languageName(code);

  return {
    fmt: c.fmt,
    matches: c.matches,
    records: c.records,
    quote,
    recordTitle,
    /**
     * The match count of a record: "3 matches", or "2 of 3 matches" when
     * only some of them are included (`included` is null otherwise). The
     * record checkbox has no mixed state: the words say it.
     */
    recordMatches: (matchCount: number, included: number | null) =>
      included === null
        ? c.matches(matchCount)
        : ofMatches(c, included, matchCount),
    /** The place of a match line: its path, then its locale's language. */
    whereLabel: (path: ReadonlyArray<string>, locale: string | null) =>
      whereLabel(path, language(locale)),
    whereName: (
      path: ReadonlyArray<string>,
      locale: string | null,
      index: number,
      total: number,
    ) => whereName(path, language(locale), index, total),

    meta: (meta: MetaView) => metaText(c, meta),

    primaryLabel: (verb: ReplaceVerb, count: number) =>
      `${capitalVerb(verb)} ${c.matches(count)}`,
    primaryIdleLabel: capitalVerb,
    /** What Cmd/Ctrl + Enter does: the name of the page's replace action. */
    replaceActionName: (verb: ReplaceVerb) =>
      `${capitalVerb(verb)} the matches`,
    publishLabel: (count: number) => `Publish ${c.records(count)}`,
    /** The button of the title bar that tries the failed records that can be tried again: "Save 2 records again". */
    retryRecordsLabel: (count: number) => `Save ${c.records(count)} again`,
    retryModelsLabel,
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
      `${c.fmt(done)} of ${c.records(total)} updated`,
    publishProgress: (done: number, total: number) =>
      `${c.fmt(done)} of ${c.records(total)} published`,

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
    noteTitle,
    modelsFailed: (callout: ModelsFailedCallout) =>
      modelsFailedCopy(c, callout),

    noResultsTitle,
    noResultsLine,
    paneState: paneStateCopy,

    confirm: (plan: PlanFacts) => confirmCopy(c, plan),
    publishConfirm: (offer: PublishOffer) => publishConfirmCopy(c, offer),

    /** In matches, as the meta after the title counts them. */
    toastStopped: (pass: RunTotals, verb: ReplaceVerb) =>
      `Replacement stopped: ${ofMatches(c, pass.replacedMatches, pass.plannedMatches)} ${pastVerb(verb)}.`,
    toastAllWritten: (pass: RunTotals, verb: ReplaceVerb) =>
      leadingMatches(c, pass.replacedMatches, verb),
    toastPermission: (verb: ReplaceVerb) =>
      `Couldn't ${verb} the matches, as your role can't edit these records.`,
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
      "Couldn't publish the records, as your role can't publish them.",

    /** "Model: Article" while a model is chosen, like "Options: Match case". */
    filterTrigger: (selected: { name: string } | null) =>
      selected ? `Model: ${selected.name}` : STRINGS.allModels,
    optionCount: (count: number | null, partial: boolean) =>
      optionCount(c, count, partial),

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
