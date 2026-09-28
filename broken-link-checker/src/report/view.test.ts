import { describe, expect, it } from 'vitest';
import type {
  CheckStatus,
  LinkGroup,
  LinkOccurrence,
  ScanReport,
} from '../types';
import {
  countStatuses,
  DEFAULT_FILTERS,
  type Filters,
  filterGroups,
  GroupFactsBuilder,
  groupFacts,
  hasFragment,
  isDefaultFilters,
  needsAttention,
  nextSort,
  pageCount,
  pageSlice,
  paginationWindow,
  recordsOf,
  reportDimensions,
  scanFraction,
  scanProgress,
  sortGroups,
} from './view';

function occurrence(
  overrides: Partial<LinkOccurrence> & { url: string },
): LinkOccurrence {
  return {
    id: `${overrides.url}:${overrides.recordId ?? 'record-page'}:${overrides.locale ?? 'en'}`,
    recordId: 'record-page',
    recordTitle: 'page record',
    modelId: 'page',
    modelName: 'page',
    fieldPath: 'body.en',
    fieldLabel: 'Body',
    locale: 'en',
    blockPath: ['Sections', 'Hero'],
    ...overrides,
  };
}

function group(
  status: CheckStatus,
  modelId = 'page',
  locale = 'en',
  extra: Partial<LinkGroup> = {},
): LinkGroup {
  const url = `https://${status}-${modelId}.example/path`;
  return {
    key: url,
    prepared: {
      key: url,
      url,
      status: status === 'skipped' || status === 'invalid' ? status : 'queued',
      message: 'Prepared',
    },
    result: {
      key: url,
      url,
      status,
      message: `Result: ${status}`,
      httpStatus: status === 'broken' ? 404 : undefined,
    },
    occurrences: [
      occurrence({
        url,
        recordId: `record-${modelId}`,
        recordTitle: `${modelId} record`,
        modelId,
        modelName: modelId,
        fieldPath: `body.${locale}`,
        locale,
      }),
    ],
    stale: false,
    ...extra,
  };
}

function filters(overrides: Partial<Filters>): Filters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

const urls = (groups: LinkGroup[]) => groups.map((entry) => entry.key);

describe('attention', () => {
  it('includes stale reachable groups alongside failing statuses', () => {
    const staleReachable = group('reachable', 'page', 'en', { stale: true });
    expect(needsAttention(staleReachable)).toBe(true);
    expect(needsAttention(group('reachable'))).toBe(false);
    expect(needsAttention(group('skipped'))).toBe(false);
    for (const status of [
      'broken',
      'invalid',
      'unverified',
      'cancelled',
    ] as const)
      expect(needsAttention(group(status))).toBe(true);
    expect(
      urls(
        filterGroups(
          [group('reachable'), staleReachable, group('queued')],
          DEFAULT_FILTERS,
        ),
      ),
    ).toEqual([staleReachable.key]);
  });
});

describe('filterGroups', () => {
  const groups = [
    group('broken'),
    group('broken', 'news', 'it'),
    group('reachable'),
    group('skipped'),
  ];

  it('defaults to the attention view', () => {
    expect(urls(filterGroups(groups, DEFAULT_FILTERS))).toEqual([
      groups[0].key,
      groups[1].key,
    ]);
  });

  it('combines status, model, locale and a case-insensitive URL query', () => {
    expect(urls(filterGroups(groups, filters({ modelId: 'news' })))).toEqual([
      groups[1].key,
    ]);
    expect(
      filterGroups(groups, filters({ modelId: 'news', locale: 'en' })),
    ).toEqual([]);
    expect(
      filterGroups(
        groups,
        filters({ modelId: 'news', locale: 'it', query: 'not-present' }),
      ),
    ).toEqual([]);
    expect(
      urls(
        filterGroups(
          groups,
          filters({ modelId: 'news', locale: 'it', query: 'BROKEN-NEWS' }),
        ),
      ),
    ).toEqual([groups[1].key]);
    expect(
      urls(filterGroups(groups, filters({ status: 'reachable' }))),
    ).toEqual([groups[2].key]);
  });

  it('requires a single occurrence to match the model, locale and query together', () => {
    const url = 'https://shared.example/page';
    const shared: LinkGroup = {
      ...group('broken'),
      key: url,
      occurrences: [
        occurrence({ url, modelId: 'page', locale: 'en' }),
        occurrence({
          url: `${url}?from=news`,
          recordId: 'record-news',
          modelId: 'news',
          modelName: 'news',
          locale: 'it',
        }),
      ],
    };
    expect(
      filterGroups([shared], filters({ modelId: 'news', locale: 'en' })),
    ).toEqual([]);
    expect(
      filterGroups([shared], filters({ modelId: 'page', query: 'from=news' })),
    ).toEqual([]);
    expect(
      urls(
        filterGroups(
          [shared],
          filters({ modelId: 'news', query: 'FROM=NEWS' }),
        ),
      ),
    ).toEqual([url]);
    expect(urls(filterGroups([shared], filters({ locale: 'it' })))).toEqual([
      url,
    ]);
  });

  it('shows every status in the all view', () => {
    expect(urls(filterGroups(groups, filters({ status: 'all' })))).toEqual(
      urls(groups),
    );
  });

  it('knows when the filters are the defaults', () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters(filters({ status: 'all' }))).toBe(false);
    expect(isDefaultFilters(filters({ query: 'x' }))).toBe(false);
  });
});

describe('sorting', () => {
  it('cycles none, ascending, descending, none', () => {
    const asc = nextSort(null, 'status');
    expect(asc).toEqual({ key: 'status', direction: 'asc' });
    const desc = nextSort(asc, 'status');
    expect(desc).toEqual({ key: 'status', direction: 'desc' });
    expect(nextSort(desc, 'status')).toBeNull();
    expect(nextSort(desc, 'url')).toEqual({ key: 'url', direction: 'asc' });
  });

  it('sorts statuses by severity and keeps discovery order without a sort', () => {
    const groups = [
      group('reachable'),
      group('cancelled'),
      group('broken'),
      group('unverified'),
      group('invalid'),
      group('skipped'),
      group('queued'),
      group('checking'),
    ];
    expect(sortGroups(groups, null)).toEqual(groups);
    const statuses = (entries: LinkGroup[]) =>
      entries.map((entry) => entry.result.status);
    expect(
      statuses(sortGroups(groups, { key: 'status', direction: 'asc' })),
    ).toEqual([
      'broken',
      'invalid',
      'unverified',
      'cancelled',
      'checking',
      'queued',
      'reachable',
      'skipped',
    ]);
    expect(
      statuses(sortGroups(groups, { key: 'status', direction: 'desc' }))[0],
    ).toBe('skipped');
  });

  it('sorts "Used in" by unique records, stably', () => {
    const single = group('broken', 'page');
    const twoOccurrencesOneRecord: LinkGroup = {
      ...group('broken', 'news'),
      occurrences: [
        occurrence({ url: 'https://a.example', recordId: 'r1' }),
        occurrence({ url: 'https://a.example', recordId: 'r1', locale: 'it' }),
      ],
    };
    const twoRecords: LinkGroup = {
      ...group('unverified'),
      occurrences: [
        occurrence({ url: 'https://b.example', recordId: 'r1' }),
        occurrence({ url: 'https://b.example', recordId: 'r2' }),
      ],
    };
    const input = [twoRecords, single, twoOccurrencesOneRecord];
    expect(
      urls(sortGroups(input, { key: 'usedIn', direction: 'asc' })),
    ).toEqual([single.key, twoOccurrencesOneRecord.key, twoRecords.key]);
    expect(
      urls(sortGroups(input, { key: 'usedIn', direction: 'desc' })),
    ).toEqual([twoRecords.key, single.key, twoOccurrencesOneRecord.key]);
  });

  it('sorts URLs alphabetically', () => {
    const groups = [group('reachable'), group('broken'), group('invalid')];
    expect(urls(sortGroups(groups, { key: 'url', direction: 'asc' }))).toEqual([
      groups[1].key,
      groups[2].key,
      groups[0].key,
    ]);
  });
});

describe('counts and dimensions', () => {
  it('counts each status, the attention view and the total', () => {
    const counts = countStatuses([
      group('broken'),
      group('broken', 'news'),
      group('reachable', 'page', 'en', { stale: true }),
      group('skipped'),
    ]);
    expect(counts.broken).toBe(2);
    expect(counts.reachable).toBe(1);
    expect(counts.skipped).toBe(1);
    expect(counts.invalid).toBe(0);
    expect(counts.attention).toBe(3);
    expect(counts.all).toBe(4);
  });

  it('lists models by name and locales by code', () => {
    const dimensions = reportDimensions([
      group('broken', 'news', 'it'),
      {
        ...group('reachable', 'article', 'en'),
        occurrences: [
          occurrence({
            url: 'https://c.example',
            modelId: 'article',
            modelName: 'Article',
            locale: 'en',
          }),
          occurrence({
            url: 'https://c.example',
            modelId: 'blog',
            modelName: 'Blog post',
            locale: undefined,
          }),
        ],
      },
    ]);
    expect(dimensions.models).toEqual([
      { id: 'article', name: 'Article' },
      { id: 'blog', name: 'Blog post' },
      { id: 'news', name: 'news' },
    ]);
    expect(dimensions.locales).toEqual(['en', 'it']);
  });
});

describe('scanProgress', () => {
  it('counts only network checks as checkable and derives what is left', () => {
    const report: ScanReport = {
      state: 'running',
      startedAt: '2026-09-23T12:00:00Z',
      recordsScanned: 12,
      discovering: false,
      warnings: [],
      scope: 'All models',
      groups: [
        group('broken'),
        group('reachable'),
        group('queued'),
        group('checking'),
        group('invalid'),
        group('skipped'),
        group('blocked'),
      ],
    };
    expect(scanProgress(report)).toEqual({
      records: 12,
      found: 7,
      checkable: 5,
      checked: 3,
      left: 2,
      attention: 2,
      blocked: 1,
    });
  });
});

describe('record usage', () => {
  it('groups occurrences by record in first-seen order', () => {
    const url = 'https://d.example';
    const entry: LinkGroup = {
      ...group('broken'),
      occurrences: [
        occurrence({ url, recordId: 'r2', recordTitle: 'Second' }),
        occurrence({ url, recordId: 'r1', recordTitle: 'First' }),
        occurrence({
          url,
          recordId: 'r2',
          recordTitle: 'Second',
          locale: 'it',
        }),
      ],
    };
    const records = recordsOf(entry);
    expect(records.map((record) => record.recordId)).toEqual(['r2', 'r1']);
    expect(records[0].title).toBe('Second');
    expect(records[0].occurrences).toHaveLength(2);
    expect(records[1].occurrences).toHaveLength(1);
    expect(groupFacts(entry).recordCount).toBe(2);
  });

  it('reuses cached facts when a flush re-spreads the group', () => {
    const entry = group('broken');
    const facts = groupFacts(entry);
    const records = recordsOf(entry);
    const respread = { ...entry, stale: true };
    expect(groupFacts(respread)).toBe(facts);
    expect(recordsOf(respread)).toBe(records);
    const grown = {
      ...entry,
      occurrences: [
        ...entry.occurrences,
        occurrence({ url: `${entry.key}#top`, recordId: 'other' }),
      ],
    };
    expect(groupFacts(grown)).not.toBe(facts);
    expect(groupFacts(grown).recordCount).toBe(2);
    expect(hasFragment(entry)).toBe(false);
    expect(hasFragment(grown)).toBe(true);
  });

  it('collects facts one occurrence at a time without changing facts already handed out', () => {
    const url = 'https://e.example/';
    const builder = new GroupFactsBuilder();
    builder.add(occurrence({ url, recordId: 'r1' }));
    const first = builder.facts();
    expect(builder.facts()).toBe(first);
    builder.add(
      occurrence({
        url: `${url}#Top`,
        recordId: 'r2',
        modelId: 'news',
        modelName: 'News',
        locale: 'it',
      }),
    );
    builder.add(
      occurrence({
        url,
        recordId: 'r2',
        modelId: 'news',
        modelName: 'Renamed',
      }),
    );
    expect(first).toEqual({
      recordCount: 1,
      models: new Map([['page', 'page']]),
      locales: new Set(['en']),
      lowerUrls: [url],
      fragment: false,
    });
    expect(builder.facts()).toEqual({
      recordCount: 2,
      models: new Map([
        ['page', 'page'],
        ['news', 'News'],
      ]),
      locales: new Set(['en', 'it']),
      lowerUrls: [url, `${url}#top`, url],
      fragment: true,
    });
  });
});

describe('pagination', () => {
  it('counts at least one page and slices within range', () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    const items = Array.from({ length: 60 }, (_, index) => index + 1);
    expect(pageSlice(items, 2, 50)).toEqual(items.slice(50));
    expect(pageSlice(items, 5, 50)).toEqual(items.slice(50));
  });

  it('centers the page window and clamps it at both edges', () => {
    expect(paginationWindow(1, 20, 10)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(paginationWindow(10, 20, 10)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(paginationWindow(20, 20, 10)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(paginationWindow(2, 3, 10)).toEqual([1, 2, 3]);
    expect(paginationWindow(1, 1, 3)).toEqual([1]);
    expect(paginationWindow(5, 9, 3)).toEqual([4, 5, 6]);
    expect(paginationWindow(9, 9, 3)).toEqual([7, 8, 9]);
  });
});

describe('scanFraction', () => {
  const progress = (
    records: number,
    found: number,
    checkable: number,
    checked: number,
  ) => ({
    records,
    found,
    checkable,
    checked,
    left: checkable - checked,
    attention: 0,
    blocked: 0,
  });

  it('is unknown while records are read without a record count', () => {
    expect(scanFraction(progress(14, 0, 0, 0), true)).toBeNull();
  });

  it('weighs a page of records to read like one URL to check', () => {
    // 60 of 120 records read (2 of 4 pages), 20 URLs found, 10 checked: 12 of 24.
    expect(scanFraction(progress(60, 20, 20, 10), true, 120)).toBe(0.5);
  });

  it('counts invalid and skipped URLs as done', () => {
    // A page of records, 10 URLs of which 4 go to the network and 1 is checked: 8 of 11.
    expect(scanFraction(progress(30, 10, 4, 1), false)).toBeCloseTo(8 / 11);
  });

  it('uses the records actually read once reading ends', () => {
    // A model that failed leaves records unread: the scan can still finish at 100%.
    expect(scanFraction(progress(80, 5, 5, 5), false, 120)).toBe(1);
    expect(scanFraction(progress(0, 0, 0, 0), false)).toBe(1);
  });
});
