import { describe, expect, it, vi } from 'vitest';
import {
  type DiscoveredTarget,
  discoverTargetsInRecord,
} from '../selection/discoverTargets';
import { matchesForTraversedField } from '../selection/matcher';
import type { TraversedFieldValue } from '../selection/types';
import { compileRootUpdateAttributes } from './payloadCompiler';
import {
  cloneRoot,
  discoverReplacementTargets,
  findReplaceRoot,
  findReplaceSchema,
  literalMatcher,
  regexMatcher,
  replacementRoot,
  replacementSchema,
} from './replacementPlanner.fixtures';
import {
  prepareRootChanges,
  type RootReplacementError,
} from './replacementPlanning';
import {
  compileReplacementTemplate,
  literalTemplate,
  type ReplacementTemplate,
} from './replacementTemplate';

const winterOffer = literalTemplate('Winter offer');

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Missing fixture ${what}`);
  return value;
}

function compiledTemplate(
  text: string,
  matcher: Parameters<typeof compileReplacementTemplate>[1],
): ReplacementTemplate {
  const compilation = compileReplacementTemplate(text, matcher);
  if (!compilation.ok) throw new Error('Expected the template to compile');
  return compilation.template;
}

function freshValue(
  changes: Awaited<ReturnType<typeof prepareRootChanges>>,
  apiKey: string,
): unknown {
  return changes.changedValues.find(
    ({ fieldValue }) => fieldValue.ref.fieldApiKey === apiKey,
  )?.value;
}

describe('prepareRootChanges', () => {
  it('uses the matcher retained by each accumulated search result', async () => {
    const root = replacementRoot();
    const schema = replacementSchema();
    const summerTargets = await discoverReplacementTargets({
      record: root,
      schema,
      matcher: literalMatcher('summer sale'),
    });
    const promoTargets = await discoverReplacementTargets({
      record: root,
      schema,
      matcher: literalMatcher('promo'),
    });
    const selected = [
      required(
        summerTargets.find(
          ({ target }) =>
            target.kind === 'field_value' && target.fieldApiKey === 'title',
        ),
        'title target',
      ),
      required(
        promoTargets.find(
          ({ target }) =>
            target.kind === 'field_value' && target.fieldApiKey === 'summary',
        ),
        'summary target',
      ),
    ];

    const prepared = await prepareRootChanges({
      root: cloneRoot(root),
      entries: selected,
      schema,
      siteId: 'site-1',
      environment: 'main',
      locales: ['en'],
      replacement: winterOffer,
      matchField: async (fieldValue, matcher) =>
        matchesForTraversedField(fieldValue, matcher),
    });

    expect(freshValue(prepared, 'title')).toBe('Winter offer and Winter offer');
    expect(freshValue(prepared, 'summary')).toBe('Winter offer week');
    expect(prepared.replacementCount).toBe(3);
  });

  it('uses stored exact fragments and does not rerun the matcher', async () => {
    const root = replacementRoot();
    const schema = replacementSchema();
    const exactTargets = await discoverReplacementTargets({
      record: root,
      schema,
      matcher: literalMatcher('summer sale'),
      granularity: 'exact_match',
    });
    const firstTitleMatch = exactTargets.find(
      ({ target }) =>
        target.kind === 'exact_match' &&
        target.fieldValue.fieldApiKey === 'title' &&
        target.occurrenceIndex === 0,
    );
    expect(firstTitleMatch).toBeDefined();
    const matchField = vi.fn(async (fieldValue: TraversedFieldValue) =>
      matchesForTraversedField(fieldValue, literalMatcher('summer sale')),
    );

    const prepared = await prepareRootChanges({
      root: cloneRoot(root),
      entries: [required(firstTitleMatch, 'title match')],
      schema,
      siteId: 'site-1',
      environment: 'main',
      locales: ['en'],
      replacement: winterOffer,
      matchField,
    });

    expect(freshValue(prepared, 'title')).toBe('Winter offer and summer sale');
    expect(prepared.replacementCount).toBe(1);
    expect(matchField).not.toHaveBeenCalled();
  });

  it('uses a literal fallback matcher for the choose-a-field workflow', async () => {
    const root = replacementRoot();
    const schema = replacementSchema();
    const fieldTargets = await discoverReplacementTargets({
      record: root,
      schema,
      workflow: 'field_api_key',
      apiKey: 'copy',
    });

    const prepared = await prepareRootChanges({
      root: cloneRoot(root),
      entries: fieldTargets,
      schema,
      siteId: 'site-1',
      environment: 'main',
      locales: ['en'],
      replacement: winterOffer,
      fallbackMatcher: literalMatcher('summer sale'),
      matchField: async (fieldValue, matcher) =>
        matchesForTraversedField(fieldValue, matcher),
    });

    expect(freshValue(prepared, 'copy')).toBe('Winter offer in a nested block');
    expect(prepared.changes[0]?.preview).toMatchObject({
      matchedText: 'Summer sale',
      replacementText: 'Winter offer',
      afterContext: ' in a nested block',
    });
    expect(
      prepared.changedValues[0]?.fieldValue.ref.blockAncestry.map(
        ({ blockId }) => blockId,
      ),
    ).toEqual(['content-1']);
  });

  it('expands a selected container through Structured Text and its inline blocks', async () => {
    const root = replacementRoot();
    const schema = replacementSchema();
    const containerTargets = await discoverReplacementTargets({
      record: root,
      schema,
      workflow: 'field_api_key',
      apiKey: 'content',
    });

    const prepared = await prepareRootChanges({
      root: cloneRoot(root),
      entries: containerTargets,
      schema,
      siteId: 'site-1',
      environment: 'main',
      locales: ['en'],
      replacement: winterOffer,
      fallbackMatcher: literalMatcher('summer sale'),
      matchField: async (fieldValue, matcher) =>
        matchesForTraversedField(fieldValue, matcher),
    });

    expect(
      prepared.changedValues.map(
        ({ fieldValue }) => fieldValue.ref.fieldApiKey,
      ),
    ).toEqual(expect.arrayContaining(['copy', 'body', 'label']));
    expect(freshValue(prepared, 'copy')).toBe('Winter offer in a nested block');
    expect(freshValue(prepared, 'label')).toBe('Winter offer inline');
    expect(freshValue(prepared, 'body')).toMatchObject({
      document: {
        children: [
          {
            children: [
              { value: 'Winter offer' },
              { marks: ['strong'], value: ' in prose' },
            ],
          },
          { type: 'inlineBlock' },
        ],
      },
    });
    expect(
      prepared.changes.find((change) => change.fieldLabel === 'Body')?.preview,
    ).toMatchObject({
      matchedText: 'Summer sale',
      replacementText: 'Winter offer',
      afterContext: ' in prose',
    });
    expect(prepared.replacementCount).toBe(3);
  });

  it('prepares SEO text without dropping non-text SEO properties', async () => {
    const root = replacementRoot();
    const schema = replacementSchema();
    const targets = await discoverReplacementTargets({
      record: root,
      schema,
      matcher: literalMatcher('summer sale'),
    });
    const seoTarget = targets.find(
      ({ target }) =>
        target.kind === 'field_value' && target.fieldApiKey === 'seo',
    );
    expect(seoTarget).toBeDefined();

    const prepared = await prepareRootChanges({
      root: cloneRoot(root),
      entries: [required(seoTarget, 'SEO target')],
      schema,
      siteId: 'site-1',
      environment: 'main',
      locales: ['en'],
      replacement: winterOffer,
      matchField: async (fieldValue, matcher) =>
        matchesForTraversedField(fieldValue, matcher),
    });

    expect(freshValue(prepared, 'seo')).toEqual({
      title: 'Winter offer',
      description: 'Winter offer details',
      image: 'upload-1',
      no_index: false,
    });
  });

  it('rejects a root whose current version changed after selection', async () => {
    const selectedRoot = replacementRoot('article-1', 'version-1');
    const targets = await discoverReplacementTargets({
      record: selectedRoot,
      matcher: literalMatcher('summer sale'),
    });
    const selected = targets.filter(
      ({ target }) =>
        target.kind === 'field_value' && target.fieldApiKey === 'title',
    );

    await expect(
      prepareRootChanges({
        root: replacementRoot('article-1', 'version-2'),
        entries: selected,
        schema: replacementSchema(),
        siteId: 'site-1',
        environment: 'main',
        locales: ['en'],
        replacement: winterOffer,
        matchField: async (fieldValue, matcher) =>
          matchesForTraversedField(fieldValue, matcher),
      }),
    ).rejects.toMatchObject({
      kind: 'stale',
    } satisfies Partial<RootReplacementError>);
  });

  it('accepts other edits to the record when the root version check is relaxed', async () => {
    const searched = replacementRoot('article-1', 'version-1');
    const selected = (
      await discoverReplacementTargets({
        record: searched,
        matcher: literalMatcher('summer sale'),
        granularity: 'exact_match',
      })
    ).filter(
      ({ target }) =>
        target.kind === 'exact_match' &&
        target.fieldValue.fieldApiKey === 'title',
    );
    const fresh = replacementRoot('article-1', 'version-2');
    fresh.attributes.summary = 'Edited by someone else';
    const prepare = (root: typeof fresh) =>
      prepareRootChanges({
        root,
        entries: selected,
        schema: replacementSchema(),
        siteId: 'site-1',
        environment: 'main',
        locales: ['en'],
        replacement: winterOffer,
        strictRootVersion: false,
        matchField: vi.fn(),
      });

    const prepared = await prepare(fresh);
    expect(prepared.currentVersion).toBe('version-2');
    expect(freshValue(prepared, 'title')).toBe('Winter offer and Winter offer');
    expect(freshValue(prepared, 'summary')).toBeUndefined();

    const titleEdited = replacementRoot('article-1', 'version-2');
    titleEdited.attributes.title = 'Summer sale and summer sale!';
    await expect(prepare(titleEdited)).rejects.toMatchObject({
      kind: 'stale',
    } satisfies Partial<RootReplacementError>);
  });

  it('rejects a selected value whose fingerprint no longer matches', async () => {
    const root = replacementRoot();
    const targets = await discoverReplacementTargets({
      record: root,
      matcher: literalMatcher('summer sale'),
    });
    const selected = targets.filter(
      ({ target }) =>
        target.kind === 'field_value' && target.fieldApiKey === 'title',
    );
    const changedRoot = cloneRoot(root);
    changedRoot.attributes.title = 'Someone edited this title';

    await expect(
      prepareRootChanges({
        root: changedRoot,
        entries: selected,
        schema: replacementSchema(),
        siteId: 'site-1',
        environment: 'main',
        locales: ['en'],
        replacement: winterOffer,
        matchField: async (fieldValue, matcher) =>
          matchesForTraversedField(fieldValue, matcher),
      }),
    ).rejects.toMatchObject({
      kind: 'stale',
    } satisfies Partial<RootReplacementError>);
  });

  it('stops before matching when preparation is aborted', async () => {
    const root = replacementRoot();
    const targets = await discoverReplacementTargets({
      record: root,
      matcher: literalMatcher('summer sale'),
    });
    const selected = targets.filter(
      ({ target }) =>
        target.kind === 'field_value' && target.fieldApiKey === 'title',
    );
    const abortController = new AbortController();
    abortController.abort();
    const matchField = vi.fn();

    await expect(
      prepareRootChanges({
        root: cloneRoot(root),
        entries: selected,
        schema: replacementSchema(),
        siteId: 'site-1',
        environment: 'main',
        locales: ['en'],
        replacement: winterOffer,
        matchField,
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(matchField).not.toHaveBeenCalled();
  });

  it('produces the same payload for a compiled literal template as for plain text', async () => {
    const root = replacementRoot();
    const schema = replacementSchema();
    const exactTargets = await discoverReplacementTargets({
      record: root,
      schema,
      matcher: literalMatcher('summer sale'),
      granularity: 'exact_match',
    });
    const prepare = (replacement: ReplacementTemplate) =>
      prepareRootChanges({
        root: cloneRoot(root),
        entries: exactTargets,
        schema,
        siteId: 'site-1',
        environment: 'main',
        locales: ['en'],
        replacement,
        matchField: async (fieldValue, matcher) =>
          matchesForTraversedField(fieldValue, matcher),
      });

    const fromCompiled = await prepare(
      compiledTemplate('Winter $1 offer', literalMatcher('summer sale')),
    );
    const fromLiteral = await prepare(literalTemplate('Winter $1 offer'));
    const payload = compileRootUpdateAttributes({
      root: cloneRoot(root),
      schema,
      changedValues: fromCompiled.changedValues,
    });

    expect(fromCompiled.changedValues).toEqual(fromLiteral.changedValues);
    expect(payload).toMatchObject({
      title: 'Winter $1 offer and Winter $1 offer',
      seo: {
        title: 'Winter $1 offer',
        description: 'Winter $1 offer details',
        image: 'upload-1',
      },
    });
    expect(fromCompiled.replacementCount).toBe(exactTargets.length);
  });
});

describe('prepareRootChanges with regex templates', () => {
  async function discoverExact(
    matcher: ReturnType<typeof regexMatcher>,
  ): Promise<DiscoveredTarget[]> {
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
        matcher,
      },
    });
  }

  async function prepareAndCompile(
    entries: ReadonlyArray<DiscoveredTarget>,
    replacement: ReplacementTemplate,
  ) {
    const schema = findReplaceSchema();
    const root = cloneRoot(findReplaceRoot());
    const prepared = await prepareRootChanges({
      root,
      entries,
      schema,
      siteId: 'site-1',
      environment: 'main',
      locales: ['en', 'it'],
      replacement,
      matchField: vi.fn(),
    });
    return {
      prepared,
      payload: compileRootUpdateAttributes({
        root,
        schema,
        changedValues: prepared.changedValues,
      }),
    };
  }

  it('replaces only the case-sensitive regex matches, end to end', async () => {
    const matcher = regexMatcher('Acme(\\w*)', true);
    const entries = await discoverExact(matcher);
    const { prepared, payload } = await prepareAndCompile(
      entries,
      compiledTemplate('Globex$1', matcher),
    );

    expect(prepared.replacementCount).toBe(entries.length);
    expect(payload).toMatchObject({
      title: { en: 'Globex Widget by ACME', it: 'Widget Globex' },
      headline: 'The Globex headline',
      seo: { title: 'Globex', description: 'Buy Globex today' },
      body: {
        it: {
          document: {
            children: [{ children: [{ value: 'Ciao Globex' }] }],
          },
        },
      },
    });
    expect(payload).not.toHaveProperty('slug');

    const body = payload.body as {
      en: { document: { children: Array<{ children?: unknown[] }> } };
    };
    const [first, quote, last] = body.en.document.children;
    expect(first?.children).toEqual([
      { type: 'span', value: 'Hello Globex' },
      { type: 'span', marks: ['strong'], value: ' world, acme again' },
    ]);
    expect(quote).toMatchObject({
      type: 'block',
      item: { id: 'q-body', attributes: { text: 'Quote about Globex' } },
    });
    expect(last?.children?.[2]).toEqual({
      type: 'span',
      value: ' Globex after',
    });
  });

  it('expands captures from the stored matches without matching again', async () => {
    const matcher = regexMatcher('(?<name>Acme) (\\w+)', true);
    const entries = (await discoverExact(matcher)).filter(
      (entry) =>
        entry.target.kind === 'exact_match' &&
        entry.target.fieldValue.fieldApiKey === 'title',
    );
    expect(entries).toHaveLength(1);

    const { payload } = await prepareAndCompile(
      entries,
      compiledTemplate('$2 by $<name>', matcher),
    );

    expect(payload).toEqual({
      title: { en: 'Widget by Acme by ACME', it: 'Widget Acme' },
    });
  });
});
