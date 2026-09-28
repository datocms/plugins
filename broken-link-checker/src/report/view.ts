import { RECORDS_PAGE_SIZE } from '../data/records';
import type {
  CheckResult,
  CheckStatus,
  LinkGroup,
  LinkOccurrence,
  ScanReport,
} from '../types';

export type StatusView = 'attention' | 'all' | CheckStatus;

export type Filters = {
  status: StatusView;
  /** `''` means every model. */
  modelId: string;
  /** `''` means every locale. */
  locale: string;
  query: string;
};

export const DEFAULT_FILTERS: Filters = {
  status: 'attention',
  modelId: '',
  locale: '',
  query: '',
};

export function isDefaultFilters(filters: Filters): boolean {
  return (
    filters.status === DEFAULT_FILTERS.status &&
    filters.modelId === DEFAULT_FILTERS.modelId &&
    filters.locale === DEFAULT_FILTERS.locale &&
    filters.query === DEFAULT_FILTERS.query
  );
}

export type SortKey = 'url' | 'status' | 'usedIn';
export type Sort = { key: SortKey; direction: 'asc' | 'desc' } | null;

/** Header clicks cycle none → ascending → descending → none. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (!sort || sort.key !== key) return { key, direction: 'asc' };
  if (sort.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

/** Severity order: menus, the status sort and the record panel list follow it. */
export const STATUS_RANK: Readonly<Record<CheckStatus, number>> = {
  broken: 0,
  invalid: 1,
  unverified: 2,
  cancelled: 3,
  blocked: 4,
  checking: 5,
  queued: 6,
  reachable: 7,
  skipped: 8,
};

export const STATUS_ORDER: readonly CheckStatus[] = (
  Object.keys(STATUS_RANK) as CheckStatus[]
).sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b]);

export const ATTENTION: ReadonlySet<CheckStatus> = new Set<CheckStatus>([
  'broken',
  'invalid',
  'unverified',
  'cancelled',
]);

export function needsAttention(group: LinkGroup): boolean {
  return ATTENTION.has(group.result.status) || group.stale;
}

/**
 * The statuses whose result message says something the status word doesn't.
 * The others would only repeat it ("Checking this URL.") or the HTTP status,
 * and "Not checked" is explained by the canceled-check callout.
 */
export const EXPLAINED_STATUSES: ReadonlySet<CheckStatus> =
  new Set<CheckStatus>(['unverified', 'invalid', 'skipped', 'blocked']);

/** The proxy refused the plugin's address: then no URL could be checked, whatever each row says. */
export function proxyRefused(groups: readonly LinkGroup[]): boolean {
  return groups.some((group) => group.result.reason === 'proxy-refused');
}

/** The sentence to show under a result: always when the check found a specific reason ("The link's domain doesn't exist."). */
export function resultExplanation(result: CheckResult): string | undefined {
  if (!result.message) return undefined;
  return result.reason || EXPLAINED_STATUSES.has(result.status)
    ? result.message
    : undefined;
}

export type GroupFacts = {
  recordCount: number;
  /** Model names by ID, each as its first occurrence names it. */
  models: ReadonlyMap<string, string>;
  locales: ReadonlySet<string>;
  /** Lowercased occurrence URLs, index-aligned with `occurrences`. */
  lowerUrls: readonly string[];
  fragment: boolean;
};

const NO_MODELS: ReadonlyMap<string, string> = new Map();
const NO_LOCALES: ReadonlySet<string> = new Set();
// Most URLs appear in one model and one locale: groups share those, as facts never change.
const oneModel = new Map<string, ReadonlyMap<string, string>>();
const oneLocale = new Map<string, ReadonlySet<string>>();

function withModel(
  models: ReadonlyMap<string, string>,
  id: string,
  name: string,
): ReadonlyMap<string, string> {
  if (models.size > 0) return new Map(models).set(id, name);
  const key = `${id}\n${name}`;
  let shared = oneModel.get(key);
  if (!shared) {
    shared = new Map([[id, name]]);
    oneModel.set(key, shared);
  }
  return shared;
}

function withLocale(
  locales: ReadonlySet<string>,
  locale: string,
): ReadonlySet<string> {
  if (locales.size > 0) return new Set(locales).add(locale);
  let shared = oneLocale.get(locale);
  if (!shared) {
    shared = new Set([locale]);
    oneLocale.set(locale, shared);
  }
  return shared;
}

/**
 * Collects a group's facts one occurrence at a time, so a group that keeps
 * growing during a scan isn't read again from the start for every report.
 * Facts it has handed out never change: the map, set and list they hold are
 * replaced, not changed, when more occurrences arrive.
 */
export class GroupFactsBuilder {
  private firstRecord?: string;
  /** Only once a second record appears. */
  private records?: Set<string>;
  private lowerUrls: string[] = [];
  private models = NO_MODELS;
  private locales = NO_LOCALES;
  private fragment = false;
  private latest?: GroupFacts;

  add(occurrence: LinkOccurrence): void {
    if (this.latest) {
      this.lowerUrls = this.lowerUrls.slice();
      this.latest = undefined;
    }
    const record = recordKey(occurrence);
    if (this.records) this.records.add(record);
    else if (this.firstRecord === undefined) this.firstRecord = record;
    else if (record !== this.firstRecord)
      this.records = new Set([this.firstRecord, record]);
    if (!this.models.has(occurrence.modelId))
      this.models = withModel(
        this.models,
        occurrence.modelId,
        occurrence.modelName,
      );
    if (occurrence.locale && !this.locales.has(occurrence.locale))
      this.locales = withLocale(this.locales, occurrence.locale);
    this.lowerUrls.push(occurrence.url.toLowerCase());
    if (occurrence.url.includes('#')) this.fragment = true;
  }

  facts(): GroupFacts {
    this.latest ??= {
      recordCount:
        this.records?.size ?? (this.firstRecord === undefined ? 0 : 1),
      models: this.models,
      locales: this.locales,
      lowerUrls: this.lowerUrls,
      fragment: this.fragment,
    };
    return this.latest;
  }
}

// A group's occurrences array is never changed once it is in a report: a group
// that grows gets a new array, so the array identity is the stable cache key.
const factsCache = new WeakMap<readonly LinkOccurrence[], GroupFacts>();

/** Lets a session that already collected the facts of `occurrences` skip reading them again. */
export function cacheGroupFacts(
  occurrences: readonly LinkOccurrence[],
  facts: GroupFacts,
): void {
  factsCache.set(occurrences, facts);
}

export function groupFacts(group: LinkGroup): GroupFacts {
  const cached = factsCache.get(group.occurrences);
  if (cached) return cached;
  const builder = new GroupFactsBuilder();
  for (const occurrence of group.occurrences) builder.add(occurrence);
  const facts = builder.facts();
  factsCache.set(group.occurrences, facts);
  return facts;
}

function recordKey(occurrence: LinkOccurrence): string {
  return (
    occurrence.recordId ??
    `unsaved:${occurrence.modelId}:${occurrence.recordTitle}`
  );
}

export function hasFragment(group: LinkGroup): boolean {
  return groupFacts(group).fragment;
}

function matchesStatus(group: LinkGroup, status: StatusView): boolean {
  if (status === 'attention') return needsAttention(group);
  if (status === 'all') return true;
  return group.result.status === status;
}

/** One occurrence has to match the model, the locale and the query together. */
function matchesOccurrences(group: LinkGroup, filters: Filters): boolean {
  const { modelId, locale } = filters;
  const query = filters.query.toLowerCase();
  const facts = groupFacts(group);
  if (modelId && !facts.models.has(modelId)) return false;
  if (locale && !facts.locales.has(locale)) return false;
  if (!modelId && !locale)
    return !query || facts.lowerUrls.some((url) => url.includes(query));
  return group.occurrences.some(
    (occurrence, index) =>
      (!modelId || occurrence.modelId === modelId) &&
      (!locale || occurrence.locale === locale) &&
      facts.lowerUrls[index].includes(query),
  );
}

export function filterGroups(
  groups: readonly LinkGroup[],
  filters: Filters,
): LinkGroup[] {
  return groups.filter(
    (group) =>
      matchesStatus(group, filters.status) &&
      matchesOccurrences(group, filters),
  );
}

function compareBy(key: SortKey): (a: LinkGroup, b: LinkGroup) => number {
  switch (key) {
    case 'url':
      return (a, b) => a.prepared.url.localeCompare(b.prepared.url);
    case 'status':
      return (a, b) =>
        STATUS_RANK[a.result.status] - STATUS_RANK[b.result.status];
    case 'usedIn':
      return (a, b) => groupFacts(a).recordCount - groupFacts(b).recordCount;
  }
}

/** Stable; `null` keeps discovery order so rows don't jump during a scan. */
export function sortGroups(
  groups: readonly LinkGroup[],
  sort: Sort,
): LinkGroup[] {
  if (!sort) return [...groups];
  const compare = compareBy(sort.key);
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...groups].sort((a, b) => direction * compare(a, b));
}

export type StatusCounts = Record<CheckStatus, number> & {
  attention: number;
  all: number;
};

export function countStatuses(groups: readonly LinkGroup[]): StatusCounts {
  const counts: StatusCounts = {
    queued: 0,
    checking: 0,
    reachable: 0,
    broken: 0,
    unverified: 0,
    invalid: 0,
    skipped: 0,
    cancelled: 0,
    blocked: 0,
    attention: 0,
    all: groups.length,
  };
  for (const group of groups) {
    counts[group.result.status] += 1;
    if (needsAttention(group)) counts.attention += 1;
  }
  return counts;
}

export type ReportDimensions = {
  /** Sorted by name. */
  models: { id: string; name: string }[];
  /** Locale codes, sorted by code. */
  locales: string[];
};

export function reportDimensions(
  groups: readonly LinkGroup[],
): ReportDimensions {
  const models = new Map<string, string>();
  const locales = new Set<string>();
  for (const group of groups) {
    // A URL that grew during a scan comes with its facts; most are found once
    // or twice and are quicker to read directly.
    const facts = factsCache.get(group.occurrences);
    if (facts) {
      for (const [id, name] of facts.models)
        if (!models.has(id)) models.set(id, name);
      for (const locale of facts.locales) locales.add(locale);
      continue;
    }
    for (const occurrence of group.occurrences) {
      if (!models.has(occurrence.modelId))
        models.set(occurrence.modelId, occurrence.modelName);
      if (occurrence.locale) locales.add(occurrence.locale);
    }
  }
  return {
    models: [...models]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    locales: [...locales].sort(),
  };
}

export type ScanProgress = {
  records: number;
  found: number;
  /** URLs that go to the network (neither invalid nor skipped). */
  checkable: number;
  checked: number;
  left: number;
  attention: number;
  /** URLs whose site refused the automated check. */
  blocked: number;
};

export function scanProgress(report: ScanReport): ScanProgress {
  let checkable = 0;
  let checked = 0;
  let attention = 0;
  let blocked = 0;
  for (const group of report.groups) {
    if (needsAttention(group)) attention += 1;
    if (group.result.status === 'blocked') blocked += 1;
    if (group.prepared.status !== 'queued') continue;
    checkable += 1;
    if (group.result.status !== 'queued' && group.result.status !== 'checking')
      checked += 1;
  }
  return {
    records: report.recordsScanned,
    found: report.groups.length,
    checkable,
    checked,
    left: checkable - checked,
    attention,
    blocked,
  };
}

/** Invalid and skipped URLs never go to the network, so they count as settled. */
export function settledUrls({ checked, found, checkable }: ScanProgress) {
  return checked + (found - checkable);
}

/** Records arrive a page per request while every URL takes its own, so a record weighs a page's share of a request. */
const RECORD_WEIGHT = 1 / RECORDS_PAGE_SIZE;

/**
 * How much of a running scan is done, from 0 to 1, in requests: a page of
 * records to read, or a URL found so far to check. While records are still
 * being read, the total needs the record count; without it the progress is
 * unknown (null). URLs found along the way can lower the fraction, so callers
 * that draw it should never let it move backwards.
 */
export function scanFraction(
  progress: ScanProgress,
  discovering: boolean,
  recordTotal?: number,
): number | null {
  if (discovering && recordTotal === undefined) return null;
  const records = discovering
    ? Math.max(recordTotal ?? 0, progress.records)
    : progress.records;
  const total = records * RECORD_WEIGHT + progress.found;
  if (total === 0) return discovering ? 0 : 1;
  const done = progress.records * RECORD_WEIGHT + settledUrls(progress);
  return Math.min(1, done / total);
}

export type RecordUsage = {
  recordId?: string;
  title: string;
  modelName: string;
  occurrences: LinkOccurrence[];
};

const recordsCache = new WeakMap<readonly LinkOccurrence[], RecordUsage[]>();

/** Occurrences grouped by record, in first-seen order. */
export function recordsOf(group: LinkGroup): RecordUsage[] {
  const cached = recordsCache.get(group.occurrences);
  if (cached) return cached;
  const byRecord = new Map<string, RecordUsage>();
  for (const occurrence of group.occurrences) {
    const key = recordKey(occurrence);
    const existing = byRecord.get(key);
    if (existing) existing.occurrences.push(occurrence);
    else
      byRecord.set(key, {
        recordId: occurrence.recordId,
        title: occurrence.recordTitle,
        modelName: occurrence.modelName,
        occurrences: [occurrence],
      });
  }
  const records = [...byRecord.values()];
  recordsCache.set(group.occurrences, records);
  return records;
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

export function pageSlice<T>(
  items: readonly T[],
  page: number,
  perPage: number,
): T[] {
  const current = Math.min(Math.max(1, page), pageCount(items.length, perPage));
  return items.slice((current - 1) * perPage, current * perPage);
}

/** The page numbers to show, centered on the current page when possible. */
export function paginationWindow(
  page: number,
  count: number,
  size: number,
): number[] {
  if (count < 1 || size < 1) return [];
  const start = Math.min(
    Math.max(page - Math.floor(size / 2), 1),
    Math.max(1, count - size + 1),
  );
  const end = Math.min(count, start + size - 1);
  const pages: number[] = [];
  for (let n = start; n <= end; n += 1) pages.push(n);
  return pages;
}
