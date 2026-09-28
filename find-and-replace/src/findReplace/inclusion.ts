/**
 * Which matches a replacement would write (SPEC §6.5). Pure: every change
 * returns a new state.
 *
 * Effective inclusion of a match: false when its record is excluded; else its
 * override; else an override carried from the previous search with the same
 * settings (while the field value is unchanged); else false when a run wrote
 * its field value while one of its matches was left out; else false for slug
 * matches and `baseline` for everything else.
 */

/** What inclusion needs to know about one match. */
export type InclusionMatch = {
  /** exactMatchIdentity. */
  key: string;
  /** `key|valueFingerprint`: identifies the match only while its field value is unchanged. */
  carryKey: string;
  /** fieldValueIdentity of its field value (stable when the value changes). */
  fieldKey: string;
  recordKey: string;
  isSlug: boolean;
};

export type InclusionState = {
  /** Default for matches without an override ("Select all"). */
  readonly baseline: boolean;
  /** Match key → included, set by hand. */
  readonly overrides: ReadonlyMap<string, boolean>;
  readonly excludedRecords: ReadonlySet<string>;
  /** Carry key → included, from the previous search with the same settings. */
  readonly carried: ReadonlyMap<string, boolean>;
  /**
   * Field values a run wrote while the user had left one of their matches
   * out. Writing changes the value (so no override can carry by
   * fingerprint), yet what is left in it is what the user left out: its
   * matches start excluded in later searches with the same settings.
   */
  readonly excludedFields: ReadonlySet<string>;
};

export type Tristate = 'all' | 'some' | 'none';

const EMPTY_OVERRIDES: ReadonlyMap<string, boolean> = new Map();
const EMPTY_KEYS: ReadonlySet<string> = new Set();

export function initialInclusion(): InclusionState {
  return {
    baseline: true,
    overrides: EMPTY_OVERRIDES,
    excludedRecords: EMPTY_KEYS,
    carried: EMPTY_OVERRIDES,
    excludedFields: EMPTY_KEYS,
  };
}

/** The inclusion a match has without looking at its record's exclusion. */
function matchDefault(state: InclusionState, match: InclusionMatch): boolean {
  const chosen =
    state.overrides.get(match.key) ?? state.carried.get(match.carryKey);
  if (chosen !== undefined) return chosen;
  if (state.excludedFields.has(match.fieldKey)) return false;
  return match.isSlug ? false : state.baseline;
}

export function isIncluded(
  state: InclusionState,
  match: InclusionMatch,
): boolean {
  return (
    !state.excludedRecords.has(match.recordKey) && matchDefault(state, match)
  );
}

/**
 * The user changed an inclusion by hand: an override (carried ones too), a
 * record exclusion, or "Select all" off. Slug defaults don't count.
 */
export function hasManualSelection(state: InclusionState): boolean {
  return (
    !state.baseline ||
    state.overrides.size > 0 ||
    state.excludedRecords.size > 0 ||
    state.carried.size > 0 ||
    state.excludedFields.size > 0
  );
}

/** Tri-state over a list of inclusions. `empty` is used when there is none. */
export function tristate(
  included: Iterable<boolean>,
  empty: Tristate = 'none',
): Tristate {
  let any = false;
  let all = true;
  let seen = false;
  for (const value of included) {
    seen = true;
    if (value) any = true;
    else all = false;
  }
  if (!seen) return empty;
  if (all) return 'all';
  return any ? 'some' : 'none';
}

/** Match checkbox. In an excluded record, including one match includes only that match. */
export function setMatchIncluded(
  state: InclusionState,
  match: InclusionMatch,
  included: boolean,
  recordMatches: Iterable<InclusionMatch>,
): InclusionState {
  const overrides = new Map(state.overrides);

  if (state.excludedRecords.has(match.recordKey)) {
    if (!included) return state;
    const excludedRecords = new Set(state.excludedRecords);
    excludedRecords.delete(match.recordKey);
    for (const sibling of recordMatches) {
      overrides.set(sibling.key, sibling.key === match.key);
    }
    return { ...state, overrides, excludedRecords };
  }

  // Even a value equal to the default is kept: it records a manual choice.
  overrides.set(match.key, included);
  return { ...state, overrides };
}

/**
 * Record checkbox. True un-excludes the record and includes every one of its
 * matches (slugs included, an explicit choice); false excludes the record.
 */
export function setRecordIncluded(
  state: InclusionState,
  recordKey: string,
  included: boolean,
  recordMatches: Iterable<InclusionMatch>,
): InclusionState {
  const excludedRecords = new Set(state.excludedRecords);
  if (!included) {
    if (excludedRecords.has(recordKey)) return state;
    excludedRecords.add(recordKey);
    return { ...state, excludedRecords };
  }

  excludedRecords.delete(recordKey);
  const overrides = new Map(state.overrides);
  for (const match of recordMatches) overrides.set(match.key, true);
  return { ...state, overrides, excludedRecords };
}

export type SelectAllScope = {
  /** Selectable matches in scope: they all follow the new choice. */
  inScope: Iterable<InclusionMatch>;
  /**
   * Every other match (outside the model filter, or frozen by the run): they
   * keep their current inclusion.
   */
  outOfScope: Iterable<InclusionMatch>;
};

/**
 * "Select all". True: `baseline` true, in-scope overrides and record
 * exclusions cleared, in-scope slug matches included. False: `baseline`
 * false, in-scope overrides and record exclusions cleared. Matches that
 * stream in later follow `baseline`. Matches outside the scope keep what they
 * had (their current default is written down as an override when `baseline`
 * changes under them).
 */
export function setAllIncluded(
  state: InclusionState,
  included: boolean,
  scope: SelectAllScope,
): InclusionState {
  const overrides = new Map<string, boolean>();
  const excludedRecords = new Set(state.excludedRecords);

  for (const match of scope.outOfScope) {
    const current = matchDefault(state, match);
    const followsNewDefault = match.isSlug ? !current : current === included;
    if (!followsNewDefault || state.overrides.has(match.key)) {
      overrides.set(match.key, current);
    }
  }
  for (const match of scope.inScope) {
    excludedRecords.delete(match.recordKey);
    if (included && match.isSlug) overrides.set(match.key, true);
  }

  return {
    baseline: included,
    overrides,
    excludedRecords,
    carried: EMPTY_OVERRIDES,
    excludedFields: EMPTY_KEYS,
  };
}

/**
 * A new search with the same settings: record exclusions and `baseline`
 * carry as they are; overrides carry by `carryKey`, so they come back only
 * for matches whose field value is unchanged. `writtenExclusions`: field
 * values the run session wrote with one of their matches left out; their
 * matches start excluded (see `excludedFields`).
 */
export function carryOver(
  state: InclusionState,
  currentMatches: Iterable<InclusionMatch>,
  writtenExclusions: Iterable<string> = [],
): InclusionState {
  const carried = new Map(state.carried);
  for (const match of currentMatches) {
    const override = state.overrides.get(match.key);
    if (override !== undefined) carried.set(match.carryKey, override);
  }
  const excludedFields = new Set([
    ...state.excludedFields,
    ...writtenExclusions,
  ]);
  return {
    baseline: state.baseline,
    overrides: EMPTY_OVERRIDES,
    excludedRecords: state.excludedRecords,
    carried,
    excludedFields: excludedFields.size > 0 ? excludedFields : EMPTY_KEYS,
  };
}
