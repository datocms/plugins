import { describe, expect, it } from 'vitest';
import {
  findReplaceRoot,
  findReplaceSchema,
  literalMatcher,
} from '../replacement/replacementPlanner.fixtures';
import {
  type DiscoveredTarget,
  discoverTargetsInRecord,
} from '../selection/discoverTargets';
import type { RecordRunStatus } from './contract';
import {
  HIGHLIGHT,
  type MatchState,
  NO_CHANGE,
  NOT_PUBLISHABLE,
  type RecordEntry,
  ResultSet,
  recordMatches,
  recordView,
  reuseArray,
  sameDisplay,
  sortAfterPass,
  UNTOUCHED,
} from './viewModel';

async function discoverAcme(): Promise<DiscoveredTarget[]> {
  return discoverTargetsInRecord({
    record: findReplaceRoot(),
    rootModelId: 'article-model',
    schema: findReplaceSchema(),
    siteId: 'site-1',
    environment: 'main',
    spec: {
      workflow: 'text',
      granularity: 'exact_match',
      rootModelIds: ['article-model'],
      locales: ['en', 'it'],
      publicationStatuses: [],
      fieldTypes: ['string', 'text', 'slug', 'structured_text', 'seo'],
      matcher: literalMatcher('acme'),
    },
  });
}

function onlyRecord(results: ResultSet): RecordEntry {
  const [record] = results.records;
  if (!record) throw new Error('Expected one record');
  return record;
}

describe('ResultSet', () => {
  it('groups the matches of a record by field value, with human paths', async () => {
    const targets = await discoverAcme();
    const results = new ResultSet({ showLocales: true });
    expect(results.add(targets)).toBe(targets.length);

    const record = onlyRecord(results);
    expect(record).toMatchObject({
      key: 'article-model:article-1',
      recordId: 'article-1',
      modelId: 'article-model',
      modelName: 'Article',
      title: 'The Acme headline',
      matchCount: targets.length,
    });
    const paths = record.fields.map((field) => [
      field.path.join(' › '),
      field.locale,
      field.matches.length,
    ]);
    expect(paths).toEqual(
      expect.arrayContaining([
        ['Title', 'en', 2],
        ['Title', 'it', 1],
        ['Slug', null, 1],
        ['SEO › Title', null, 1],
        ['SEO › Description', null, 1],
        ['Content › Quote 1 › Text', null, 1],
        ['Content › Quote 2 › Text', null, 1],
        ['Content › Callout › Label', null, 1],
        ['Content › Section › Heading', null, 1],
        ['Content › Section › Items › Quote › Text', null, 1],
        ['Hero › Quote › Text', null, 1],
      ]),
    );
    // Title and description of one SEO value are listed apart, with their own keys.
    const keys = record.fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      record.fields.find((field) => field.path[0] === 'Slug')?.changesUrl,
    ).toBe(true);
    expect([...recordMatches(record)]).toHaveLength(targets.length);
  });

  it('counts every occurrence, ignores duplicates and tracks counts per model', async () => {
    const targets = await discoverAcme();
    const results = new ResultSet({ showLocales: false });
    results.add(targets);
    const revision = results.revision;
    expect(results.add(targets)).toBe(0);
    expect(results.revision).toBe(revision);

    expect(results.matchCount).toBe(targets.length);
    expect(results.recordCount).toBe(1);
    expect(results.modelMatchCount('article-model')).toBe(targets.length);
    expect(results.modelRecordCount('article-model')).toBe(1);
    expect(results.modelsWithMatches).toBe(1);
    expect(results.allTargets()).toHaveLength(targets.length);
    expect(
      onlyRecord(results).fields.every((field) => field.locale === null),
    ).toBe(true);
  });
});

describe('recordView', () => {
  const baseState = {
    title: 'T',
    selectable: true,
    status: UNTOUCHED,
    publish: NOT_PUBLISHABLE,
  };

  it('reuses every object that did not change', async () => {
    const results = new ResultSet({ showLocales: true });
    results.add(await discoverAcme());
    const record = onlyRecord(results);
    let excluded = '';
    const stateOf = (match: { key: string }): MatchState => ({
      included: match.key !== excluded,
      selectable: true,
      display: match.key === excluded ? HIGHLIGHT : NO_CHANGE,
    });

    const first = recordView(record, baseState, stateOf, undefined);
    expect(first.inclusion).toBe('all');
    expect(recordView(record, baseState, stateOf, first)).toBe(first);

    const target = record.fields[3]?.matches[0];
    excluded = target?.key ?? '';
    const second = recordView(record, baseState, stateOf, first);
    expect(second).not.toBe(first);
    expect(second.inclusion).toBe('some');
    for (const [index, field] of second.fields.entries()) {
      if (index === 3) expect(field).not.toBe(first.fields[index]);
      else expect(field).toBe(first.fields[index]);
    }
    expect(second.fields[3]?.matches[0]?.included).toBe(false);

    const titled = recordView(
      record,
      { ...baseState, title: 'U' },
      stateOf,
      second,
    );
    expect(titled).not.toBe(second);
    expect(titled.fields).toBe(second.fields);
  });
});

describe('helpers', () => {
  it('compares displays by kind and inserted text', () => {
    expect(
      sameDisplay(
        { kind: 'diff', inserted: 'a' },
        { kind: 'diff', inserted: 'a' },
      ),
    ).toBe(true);
    expect(
      sameDisplay(
        { kind: 'diff', inserted: 'a' },
        { kind: 'final', inserted: 'a' },
      ),
    ).toBe(false);
    expect(
      sameDisplay(
        { kind: 'diff', inserted: 'a' },
        { kind: 'diff', inserted: 'b' },
      ),
    ).toBe(false);
    expect(sameDisplay(HIGHLIGHT, { kind: 'highlight' })).toBe(true);
  });

  it('sorts after a pass: failed, skipped, untouched, replaced, each group in order', () => {
    const statuses: Record<string, RecordRunStatus> = {
      a: { kind: 'replaced', replacedMatches: 1 },
      b: { kind: 'failed', reason: 'network', retryable: true, detail: null },
      c: UNTOUCHED,
      d: { kind: 'skipped', reason: 'stale' },
      e: { kind: 'failed', reason: 'unknown', retryable: false, detail: null },
      f: { kind: 'replaced', replacedMatches: 2 },
    };
    const sorted = sortAfterPass(
      Object.keys(statuses),
      (key) => statuses[key] ?? UNTOUCHED,
    );
    expect(sorted).toEqual(['b', 'e', 'd', 'c', 'a', 'f']);
  });

  it('reuses an array with the same items', () => {
    const one = { id: 1 };
    const previous = [one];
    expect(reuseArray(previous, [one])).toBe(previous);
    expect(reuseArray(previous, [{ id: 1 }])).not.toBe(previous);
    expect(reuseArray(undefined, [one])).toEqual([one]);
  });
});
