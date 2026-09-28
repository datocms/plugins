import type { ApiTypes, Client } from '@datocms/cma-client-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  findReplaceRoot,
  findReplaceSchema,
} from '../replacement/replacementPlanner.fixtures';
import {
  createSelectionDiscoveryController,
  type DiscoveredTarget,
  discoverTargetsInRecord,
  discoverTargetsInRecords,
  fieldDisplayLocale,
  type MatchTraversedFields,
} from './discoverTargets';
import { replayRecordSource } from './discovery';
import {
  createTextMatcher,
  type MatcherWorkerRequest,
  type MatcherWorkerResponse,
  MatcherWorkerSession,
  matchesForTraversedField,
  matchesForTraversedFields,
} from './matcher';
import type {
  DiscoverySpec,
  ExactMatchRef,
  MatcherSpec,
  SchemaField,
  SchemaIndex,
  SchemaModel,
} from './types';

const model: SchemaModel = {
  id: 'article-model',
  name: 'Article',
  apiKey: 'article',
  isBlockModel: false,
  raw: {
    title_field: { id: 'title-field', type: 'field' },
  } as ApiTypes.ItemType,
};

const titleField: SchemaField = {
  id: 'title-field',
  label: 'Title',
  apiKey: 'title',
  fieldType: 'string',
  localized: false,
  position: 1,
  modelId: model.id,
  referencedBlockModelIds: [],
  exactMatchCompatible: true,
  raw: {} as ApiTypes.Field,
};

const flagField: SchemaField = {
  ...titleField,
  id: 'flag-field',
  label: 'Featured',
  apiKey: 'featured',
  fieldType: 'boolean',
  position: 2,
  exactMatchCompatible: false,
};

const summaryField: SchemaField = {
  ...titleField,
  id: 'summary-field',
  label: 'Summary',
  apiKey: 'summary',
  fieldType: 'text',
  position: 3,
};

const schema: SchemaIndex = {
  modelsById: new Map([[model.id, model]]),
  fieldsById: new Map([
    [titleField.id, titleField],
    [flagField.id, flagField],
    [summaryField.id, summaryField],
  ]),
  fieldsByModelId: new Map([[model.id, [titleField, flagField, summaryField]]]),
  rootModelIds: [model.id],
  blockModelIds: [],
  blockModelIdsByParentModelId: new Map(),
  reachableRootModelIdsByBlockModelId: new Map(),
  apiKeyCatalog: [],
  apiKeyCatalogByKey: new Map(),
};

const record = {
  id: 'article-1',
  type: 'item' as const,
  attributes: {
    title: 'Hello brave world',
    featured: true,
    summary: 'A wider world',
  },
  relationships: {
    item_type: { data: { id: model.id, type: 'item_type' as const } },
  },
  meta: {
    status: 'published' as const,
    current_version: 'version-1',
    created_at: '',
    updated_at: '2026-01-01T00:00:00Z',
    published_at: '',
    first_published_at: '',
    publication_scheduled_at: null,
    unpublishing_scheduled_at: null,
    is_valid: true,
    is_current_version_valid: true,
    is_published_version_valid: true,
    stage: null,
    has_children: null,
  },
};

const baseSpec: DiscoverySpec = {
  workflow: 'text',
  granularity: 'field_value',
  rootModelIds: [model.id],
  locales: ['en'],
  publicationStatuses: ['published'],
  matcher: {
    kind: 'literal',
    pattern: 'brave',
    caseSensitive: false,
    wholeWord: false,
  },
};

describe('discoverTargetsInRecord', () => {
  it('shows the nearest parent language for fields inside localized blocks', () => {
    expect(
      fieldDisplayLocale(null, [
        { locale: 'en' },
        { locale: null },
        { locale: 'it' },
      ]),
    ).toBe('it');
    expect(fieldDisplayLocale('de', [{ locale: 'it' }])).toBe('de');
    expect(fieldDisplayLocale(null, [{ locale: null }])).toBeNull();
  });

  it('returns one field-value target with match evidence', async () => {
    const results = await discoverTargetsInRecord({
      record,
      rootModelId: model.id,
      schema,
      siteId: 'site-1',
      environment: 'main',
      spec: baseSpec,
      matchField: async (fieldValue, matcher) =>
        matchesForTraversedField(fieldValue, matcher),
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      target: { kind: 'field_value', fieldApiKey: 'title' },
      presentation: {
        record: { title: 'Hello brave world', status: 'published' },
        field: { apiKey: 'title', pathSegments: ['Title'] },
        matchCount: 1,
        excerpt: { match: 'brave' },
      },
    });
  });

  it('filters matching fields by their schema field type', async () => {
    const results = await discoverTargetsInRecord({
      record,
      rootModelId: model.id,
      schema,
      siteId: 'site-1',
      environment: 'main',
      spec: {
        ...baseSpec,
        fieldTypes: ['text'],
        matcher: {
          kind: 'literal',
          pattern: 'world',
          caseSensitive: false,
          wholeWord: false,
        },
      },
      matchField: async (fieldValue, matcher) =>
        matchesForTraversedField(fieldValue, matcher),
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      target: { fieldApiKey: 'summary', fieldType: 'text' },
    });
  });

  it('keeps non-text fields selectable in API-key field-value mode', async () => {
    const results = await discoverTargetsInRecord({
      record,
      rootModelId: model.id,
      schema,
      siteId: 'site-1',
      environment: 'main',
      spec: {
        ...baseSpec,
        workflow: 'field_api_key',
        apiKey: 'featured',
        fieldTypes: ['string'],
        matcher: undefined,
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      target: { kind: 'field_value', fieldType: 'boolean' },
      presentation: { valuePreview: 'true' },
    });
  });
});

const acme: MatcherSpec = {
  kind: 'literal',
  pattern: 'acme',
  caseSensitive: false,
  wholeWord: false,
};

const exactSpec: DiscoverySpec = {
  workflow: 'text',
  granularity: 'exact_match',
  rootModelIds: ['article-model'],
  locales: ['en', 'it'],
  publicationStatuses: [],
  fieldTypes: ['string', 'text', 'slug', 'structured_text', 'seo'],
  matcher: acme,
};

function exactTarget(entry: DiscoveredTarget): ExactMatchRef {
  if (entry.target.kind !== 'exact_match') {
    throw new Error('Expected an exact-match target');
  }
  return entry.target;
}

async function discoverRich(
  options: Partial<Parameters<typeof discoverTargetsInRecord>[0]> = {},
): Promise<DiscoveredTarget[]> {
  return discoverTargetsInRecord({
    record: findReplaceRoot(),
    rootModelId: 'article-model',
    schema: findReplaceSchema(),
    siteId: 'site-1',
    environment: 'main',
    spec: exactSpec,
    ...options,
  });
}

class InlineWorker {
  readonly requests: MatcherWorkerRequest[] = [];
  readonly terminate = vi.fn();
  private readonly listeners: Array<
    (event: MessageEvent<MatcherWorkerResponse>) => void
  > = [];

  addEventListener(
    type: string,
    listener: (event: MessageEvent<MatcherWorkerResponse>) => void,
  ): void {
    if (type === 'message') this.listeners.push(listener);
  }

  postMessage(request: MatcherWorkerRequest): void {
    this.requests.push(request);
    const match = createTextMatcher(request.matcher);
    const data = structuredClone({
      id: request.id,
      ok: true as const,
      matches: request.texts.map((text) => match(text)),
    });
    void Promise.resolve().then(() => {
      for (const listener of this.listeners) {
        listener({ data } as MessageEvent<MatcherWorkerResponse>);
      }
    });
  }
}

describe('exact-match discovery', () => {
  it('finds every occurrence with human paths and the presentation title', async () => {
    const results = await discoverRich();
    const byPath = (segments: string[]) =>
      results.filter(
        (entry) =>
          entry.presentation.field.pathSegments.join(' › ') ===
          segments.join(' › '),
      );

    expect(results.length).toBe(19);
    expect(byPath(['Title'])).toHaveLength(3);
    expect(byPath(['Content', 'Quote 2', 'Text'])).toHaveLength(1);
    expect(byPath(['Content', 'Callout', 'Label'])).toHaveLength(1);
    expect(
      byPath(['Content', 'Section', 'Items', 'Quote', 'Text']),
    ).toHaveLength(1);
    expect(byPath(['Body', 'Quote', 'Text'])).toHaveLength(1);
    expect(byPath(['SEO', 'Title'])).toHaveLength(1);
    expect(byPath(['SEO', 'Description'])).toHaveLength(1);
    expect(byPath(['Slug'])).toHaveLength(1);
    expect(results[0]?.presentation.record).toMatchObject({
      id: 'article-1',
      title: 'The Acme headline',
      status: 'published',
      currentVersion: 'version-1',
    });
  });

  it('keeps multi-span Structured Text matches and inherited locales', async () => {
    const results = await discoverRich();
    const multiSpan = results.find(
      (entry) => exactTarget(entry).fragments.length === 2,
    );
    expect(multiSpan).toMatchObject({
      target: { matchedText: 'Acme', occurrenceIndex: 0 },
      presentation: {
        field: { pathSegments: ['Body'], locale: 'en' },
        matchCount: 1,
        excerpt: { before: 'Hello ', match: 'Acme' },
      },
    });
    const inlineBlock = results.find(
      (entry) => exactTarget(entry).fieldValue.ownerRecordId === 'cta-1',
    );
    expect(inlineBlock?.presentation.field).toMatchObject({
      pathSegments: ['Body', 'Call to action', 'Label'],
      locale: 'en',
    });
  });

  it('shares presentation objects per record and per field value', async () => {
    const results = await discoverRich();
    const titles = results.filter(
      (entry) =>
        exactTarget(entry).fieldValue.fieldApiKey === 'title' &&
        exactTarget(entry).fieldValue.locale === 'en',
    );
    expect(titles).toHaveLength(2);
    expect(titles[0]?.presentation.field).toBe(titles[1]?.presentation.field);
    expect(titles[0]?.presentation.record).toBe(
      results[results.length - 1]?.presentation.record,
    );

    const seo = results.filter(
      (entry) => exactTarget(entry).fieldValue.fieldApiKey === 'seo',
    );
    expect(seo[0]?.presentation.field).not.toBe(seo[1]?.presentation.field);
  });

  it('returns a null title when no title candidate has a value', async () => {
    const record = findReplaceRoot();
    const attributes = record.attributes as Record<string, unknown>;
    attributes.headline = '';
    attributes.title = { en: null, it: null };
    attributes.slug = null;
    const results = await discoverRich({ record });
    expect(results[0]?.presentation.record.title).toBeNull();
  });

  it('matches every field value of a record in one batched call', async () => {
    const matchFields = vi.fn<MatchTraversedFields>(
      async (fieldValues, matcher) =>
        matchesForTraversedFields(fieldValues, matcher),
    );
    const batched = await discoverRich({ matchFields });

    expect(matchFields).toHaveBeenCalledOnce();
    const [fieldValues] = matchFields.mock.calls[0] ?? [];
    expect(
      fieldValues?.every(
        (fieldValue) =>
          fieldValue.ref.present && fieldValue.field.exactMatchCompatible,
      ),
    ).toBe(true);

    const perField = await discoverRich({
      matchField: async (fieldValue, matcher) =>
        matchesForTraversedField(fieldValue, matcher),
    });
    const inline = await discoverRich();
    expect(batched.map((entry) => entry.target)).toEqual(
      perField.map((entry) => entry.target),
    );
    expect(inline.map((entry) => entry.target)).toEqual(
      perField.map((entry) => entry.target),
    );
  });

  it('batches several records into one matcher call', async () => {
    const matchFields = vi.fn<MatchTraversedFields>(
      async (fieldValues, matcher) =>
        matchesForTraversedFields(fieldValues, matcher),
    );
    const [first, second] = await discoverTargetsInRecords({
      records: [
        { record: findReplaceRoot('article-1'), rootModelId: 'article-model' },
        { record: findReplaceRoot('article-2'), rootModelId: 'article-model' },
      ],
      schema: findReplaceSchema(),
      siteId: 'site-1',
      environment: 'main',
      spec: exactSpec,
      matchFields,
    });

    expect(matchFields).toHaveBeenCalledOnce();
    expect(first).toHaveLength(19);
    expect(second).toHaveLength(19);
    expect(
      second?.every(
        (entry) => exactTarget(entry).fieldValue.rootRecordId === 'article-2',
      ),
    ).toBe(true);
  });

  it('stops before matching when the scan was cancelled', async () => {
    const abortController = new AbortController();
    abortController.abort();
    const matchFields = vi.fn<MatchTraversedFields>();

    await expect(
      discoverRich({ matchFields, signal: abortController.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(matchFields).not.toHaveBeenCalled();
  });
});

describe('createSelectionDiscoveryController', () => {
  function client(ids: string[]): Client {
    return { items: { rawList: listRecords(ids) } } as unknown as Client;
  }

  function listRecords(ids: string[]) {
    return vi.fn(async (query: Record<string, unknown>) => {
      const page = query.page as { offset?: number; limit?: number };
      const records =
        (page.offset ?? 0) === 0
          ? ids.map((id) => findReplaceRoot(id)).slice(0, page.limit ?? 100)
          : [];
      return { data: records, meta: { total_count: ids.length } };
    });
  }

  function inlineWorkers(): {
    workers: InlineWorker[];
    workerSessionFactory: () => MatcherWorkerSession;
  } {
    const workers: InlineWorker[] = [];
    return {
      workers,
      workerSessionFactory: () => {
        const worker = new InlineWorker();
        workers.push(worker);
        return new MatcherWorkerSession(() => worker as unknown as Worker);
      },
    };
  }

  it('sends one worker request per page through a single run worker', async () => {
    const { workers, workerSessionFactory } = inlineWorkers();
    const controller = createSelectionDiscoveryController({
      client: client(['article-1', 'article-2', 'article-3']),
      schema: findReplaceSchema(),
      siteId: 'site-1',
      environment: 'main',
      workerSessionFactory,
    });

    const snapshot = await controller.run(exactSpec, {
      confirmedLargeRun: true,
    });

    expect(snapshot.targets).toHaveLength(57);
    expect(workers).toHaveLength(1);
    // The three records arrived in one page: one request for all of them.
    expect(workers[0]?.requests).toHaveLength(1);
    expect(workers[0]?.terminate).toHaveBeenCalled();
  });

  it('replays cached records through the worker with the same results and no request', async () => {
    const ids = ['article-1', 'article-2', 'article-3'];
    const network = inlineWorkers();
    const networkRun = await createSelectionDiscoveryController({
      client: client(ids),
      schema: findReplaceSchema(),
      siteId: 'site-1',
      environment: 'main',
      workerSessionFactory: network.workerSessionFactory,
    }).run(exactSpec, { counts: 'background' });

    const rawList = vi.fn();
    const replay = inlineWorkers();
    const replayRun = await createSelectionDiscoveryController({
      client: { items: { rawList } } as unknown as Client,
      schema: findReplaceSchema(),
      siteId: 'site-1',
      environment: 'main',
      workerSessionFactory: replay.workerSessionFactory,
    }).run(exactSpec, {
      counts: 'background',
      recordSource: () =>
        replayRecordSource(ids.map((id) => findReplaceRoot(id))),
    });

    expect(rawList).not.toHaveBeenCalled();
    expect(replay.workers[0]?.requests).toHaveLength(1);
    expect(replayRun.status).toBe('completed');
    expect(replayRun.targets.map((entry) => entry.target)).toEqual(
      networkRun.targets.map((entry) => entry.target),
    );
    expect(replayRun.targets.map((entry) => entry.presentation)).toEqual(
      networkRun.targets.map((entry) => entry.presentation),
    );
  });

  it('uses the per-field test seam instead of a worker when given', async () => {
    const workerSessionFactory = vi.fn();
    const matchField = vi.fn(
      async (
        fieldValue: Parameters<typeof matchesForTraversedField>[0],
        matcher: MatcherSpec,
      ) => matchesForTraversedField(fieldValue, matcher),
    );
    const controller = createSelectionDiscoveryController({
      client: client(['article-1']),
      schema: findReplaceSchema(),
      siteId: 'site-1',
      environment: 'main',
      workerSessionFactory,
      matchField,
    });

    const snapshot = await controller.run(exactSpec, {
      confirmedLargeRun: true,
    });

    expect(snapshot.targets).toHaveLength(19);
    expect(matchField).toHaveBeenCalled();
    expect(workerSessionFactory).not.toHaveBeenCalled();
  });
});
