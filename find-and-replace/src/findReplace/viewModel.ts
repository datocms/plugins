/**
 * Discovered targets → the records, fields and matches the page renders.
 *
 * `ResultSet` groups the targets of one search by root record (arrival order)
 * and by field value (document order). The view builders turn entries into
 * contract views with structural sharing: a view object is reused whenever
 * nothing it renders changed, so `React.memo` on identity works.
 */

import type { DiscoveredTarget } from '../selection/discoverTargets';
import { exactMatchIdentity, fieldValueIdentity } from '../selection/identity';
import type { ExactMatchRef } from '../selection/types';
import type {
  FieldView,
  MatchDisplay,
  MatchView,
  RecordPublishStatus,
  RecordRunStatus,
  RecordView,
} from './contract';
import type { InclusionMatch } from './inclusion';
import { recordKeyOf } from './links';

export type MatchEntry = InclusionMatch & {
  modelId: string;
  target: DiscoveredTarget;
  ref: ExactMatchRef;
};

export type FieldEntry = {
  /** fieldValueIdentity (plus the subfield for SEO, whose title and description are listed apart). */
  key: string;
  path: ReadonlyArray<string>;
  locale: string | null;
  changesUrl: boolean;
  matches: MatchEntry[];
};

export type RecordEntry = {
  /** `${modelId}:${recordId}` */
  key: string;
  recordId: string;
  modelId: string;
  modelName: string;
  /** As found by the search (null → "Record #{id}"). */
  title: string | null;
  fields: FieldEntry[];
  matchCount: number;
};

export type ResultSetOptions = {
  /** False when the project has one locale: `FieldView.locale` is then always null. */
  showLocales: boolean;
};

/** The matches of one search, grouped for display. Append-only. */
export class ResultSet {
  /** Arrival order. */
  readonly records: RecordEntry[] = [];
  /** Increments whenever matches are added. */
  revision = 0;
  private readonly recordsByKey = new Map<string, RecordEntry>();
  private readonly fieldsByKey = new Map<string, FieldEntry>();
  private readonly matchesByKey = new Map<string, MatchEntry>();
  private readonly targets: DiscoveredTarget[] = [];
  private readonly matchCountsByModel = new Map<string, number>();
  private readonly recordCountsByModel = new Map<string, number>();

  constructor(private readonly options: ResultSetOptions) {}

  get matchCount(): number {
    return this.matchesByKey.size;
  }

  get recordCount(): number {
    return this.records.length;
  }

  get isEmpty(): boolean {
    return this.records.length === 0;
  }

  record(key: string): RecordEntry | undefined {
    return this.recordsByKey.get(key);
  }

  match(key: string): MatchEntry | undefined {
    return this.matchesByKey.get(key);
  }

  matches(): IterableIterator<MatchEntry> {
    return this.matchesByKey.values();
  }

  /** Every target, in arrival order (seeds for a retry of failed models). */
  allTargets(): ReadonlyArray<DiscoveredTarget> {
    return this.targets;
  }

  modelMatchCount(modelId: string): number {
    return this.matchCountsByModel.get(modelId) ?? 0;
  }

  modelRecordCount(modelId: string): number {
    return this.recordCountsByModel.get(modelId) ?? 0;
  }

  /** How many models have at least one match. */
  get modelsWithMatches(): number {
    return this.matchCountsByModel.size;
  }

  /** Adds targets (duplicates are ignored). Returns how many matches were added. */
  add(targets: ReadonlyArray<DiscoveredTarget>): number {
    let added = 0;
    for (const target of targets) {
      if (this.addTarget(target)) added += 1;
    }
    if (added > 0) this.revision += 1;
    return added;
  }

  private addTarget(target: DiscoveredTarget): boolean {
    const ref = target.target;
    if (ref.kind !== 'exact_match') return false;
    const key = exactMatchIdentity(ref);
    if (this.matchesByKey.has(key)) return false;

    const { fieldValue } = ref;
    const fieldKey = fieldValueIdentity(fieldValue);
    const recordKey = recordKeyOf(
      fieldValue.rootModelId,
      fieldValue.rootRecordId,
    );
    const record = this.recordFor(recordKey, target);
    const field = this.fieldFor(record, fieldKey, ref, target);
    const match: MatchEntry = {
      key,
      carryKey: `${key}|${fieldValue.valueFingerprint}`,
      fieldKey,
      recordKey,
      isSlug: fieldValue.fieldType === 'slug',
      modelId: fieldValue.rootModelId,
      target,
      ref,
    };

    field.matches.push(match);
    record.matchCount += 1;
    this.matchesByKey.set(key, match);
    this.targets.push(target);
    increment(this.matchCountsByModel, match.modelId);
    return true;
  }

  private recordFor(recordKey: string, target: DiscoveredTarget): RecordEntry {
    const existing = this.recordsByKey.get(recordKey);
    if (existing) return existing;

    const { model, record } = target.presentation;
    const entry: RecordEntry = {
      key: recordKey,
      recordId: record.id,
      modelId: model.id,
      modelName: model.name,
      title: record.title,
      fields: [],
      matchCount: 0,
    };
    this.records.push(entry);
    this.recordsByKey.set(recordKey, entry);
    increment(this.recordCountsByModel, model.id);
    return entry;
  }

  private fieldFor(
    record: RecordEntry,
    identity: string,
    ref: ExactMatchRef,
    target: DiscoveredTarget,
  ): FieldEntry {
    const { field } = target.presentation;
    const key =
      ref.fieldValue.fieldType === 'seo'
        ? `${identity}|${field.pathSegments[field.pathSegments.length - 1] ?? ''}`
        : identity;
    const existing = this.fieldsByKey.get(key);
    if (existing) return existing;

    const entry: FieldEntry = {
      key,
      path: field.pathSegments,
      locale: this.options.showLocales ? field.locale : null,
      changesUrl: ref.fieldValue.fieldType === 'slug',
      matches: [],
    };
    record.fields.push(entry);
    this.fieldsByKey.set(key, entry);
    return entry;
  }
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Every match of a record, in field order, then document order. */
export function* recordMatches(record: RecordEntry): Generator<MatchEntry> {
  for (const field of record.fields) {
    yield* field.matches;
  }
}

// ─── Views ──────────────────────────────────────────────────────────────────

/** How one match renders right now. */
export type MatchState = {
  included: boolean;
  selectable: boolean;
  display: MatchDisplay;
};

/** How one record renders right now (besides its matches). */
export type RecordState = {
  title: string | null;
  selectable: boolean;
  status: RecordRunStatus;
  publish: RecordPublishStatus;
};

export const HIGHLIGHT: MatchDisplay = { kind: 'highlight' };
export const NO_CHANGE: MatchDisplay = { kind: 'noChange' };
export const UNTOUCHED: RecordRunStatus = { kind: 'untouched' };
export const NOT_PUBLISHABLE: RecordPublishStatus = { kind: 'none' };

export function sameDisplay(left: MatchDisplay, right: MatchDisplay): boolean {
  if (left === right) return true;
  if (left.kind === 'diff' && right.kind === 'diff') {
    return left.inserted === right.inserted;
  }
  if (left.kind === 'final' && right.kind === 'final') {
    return left.inserted === right.inserted;
  }
  return left.kind === right.kind;
}

export function matchView(
  entry: MatchEntry,
  state: MatchState,
  previous: MatchView | undefined,
): MatchView {
  if (
    previous &&
    previous.key === entry.key &&
    previous.included === state.included &&
    previous.selectable === state.selectable &&
    sameDisplay(previous.display, state.display)
  ) {
    return previous;
  }

  const { context } = entry.ref;
  return {
    key: entry.key,
    before: context.before,
    beforeTruncated: context.beforeTruncated,
    text: entry.ref.matchedText,
    after: context.after,
    afterTruncated: context.afterTruncated,
    included: state.included,
    selectable: state.selectable,
    display: state.display,
  };
}

type InclusionTally = { included: number };

function fieldView(
  entry: FieldEntry,
  stateOf: (match: MatchEntry) => MatchState,
  previous: FieldView | undefined,
  tally: InclusionTally,
): FieldView {
  let unchanged =
    previous !== undefined && previous.matches.length === entry.matches.length;
  const matches = entry.matches.map((match, index) => {
    const state = stateOf(match);
    if (state.included) tally.included += 1;
    const earlier = previous?.matches[index];
    const view = matchView(match, state, earlier);
    if (view !== earlier) unchanged = false;
    return view;
  });

  if (unchanged && previous) return previous;
  return {
    key: entry.key,
    path: entry.path,
    locale: entry.locale,
    changesUrl: entry.changesUrl,
    matches,
  };
}

function inclusionOf(included: number, total: number): RecordView['inclusion'] {
  if (included === 0) return 'none';
  return included === total ? 'all' : 'some';
}

function sameRecordState(
  previous: RecordView,
  entry: RecordEntry,
  state: RecordState,
  inclusion: RecordView['inclusion'],
): boolean {
  return (
    previous.title === state.title &&
    previous.selectable === state.selectable &&
    previous.status === state.status &&
    previous.publish === state.publish &&
    previous.inclusion === inclusion &&
    previous.matchCount === entry.matchCount
  );
}

/**
 * The view of one record. Returns `previous` itself when nothing it renders
 * changed; otherwise a new object that still reuses every unchanged field and
 * match view.
 */
export function recordView(
  entry: RecordEntry,
  state: RecordState,
  stateOf: (match: MatchEntry) => MatchState,
  previous: RecordView | undefined,
): RecordView {
  const tally: InclusionTally = { included: 0 };
  let unchanged =
    previous !== undefined && previous.fields.length === entry.fields.length;
  const fields = entry.fields.map((field, index) => {
    const earlier = previous?.fields[index];
    const view = fieldView(
      field,
      stateOf,
      earlier?.key === field.key ? earlier : undefined,
      tally,
    );
    if (view !== earlier) unchanged = false;
    return view;
  });
  const inclusion = inclusionOf(tally.included, entry.matchCount);

  if (
    unchanged &&
    previous &&
    sameRecordState(previous, entry, state, inclusion)
  ) {
    return previous;
  }
  return {
    key: entry.key,
    recordId: entry.recordId,
    modelId: entry.modelId,
    modelName: entry.modelName,
    title: state.title,
    matchCount: entry.matchCount,
    inclusion,
    selectable: state.selectable,
    status: state.status,
    publish: state.publish,
    fields: previous && unchanged ? previous.fields : fields,
  };
}

/** `next` itself, or `previous` when both hold the same items in the same order. */
export function reuseArray<T>(
  previous: ReadonlyArray<T> | undefined,
  next: ReadonlyArray<T>,
): ReadonlyArray<T> {
  if (!previous || previous.length !== next.length) return next;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index]) return next;
  }
  return previous;
}

const PASS_ORDER: Readonly<Record<RecordRunStatus['kind'], number>> = {
  failed: 0,
  skipped: 1,
  untouched: 2,
  writing: 2,
  replaced: 3,
};

/**
 * The order after a run pass: failed, skipped, untouched, replaced. Stable,
 * so each group keeps its order.
 */
export function sortAfterPass<T>(
  records: ReadonlyArray<T>,
  statusOf: (record: T) => RecordRunStatus,
): T[] {
  return [...records].sort(
    (left, right) =>
      PASS_ORDER[statusOf(left).kind] - PASS_ORDER[statusOf(right).kind],
  );
}
