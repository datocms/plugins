/**
 * Test kit for the find and replace controller: a small schema (Article with
 * drafts, Page without, Author), an in-memory fake CMA client (list pages,
 * counts, reads by id, fresh reads, locked updates) and a controller harness.
 * Tests only; nothing in the app imports it.
 */

import type {
  ApiTypes,
  Client,
  RawApiTypes,
} from '@datocms/cma-client-browser';
import { type Mock, vi } from 'vitest';
import type { MatchTraversedField } from '../selection/discoverTargets';
import {
  createTextMatcher,
  type MatcherWorkerRequest,
  type MatcherWorkerResponse,
  MatcherWorkerSession,
  matchesForTraversedField,
} from '../selection/matcher';
import { buildSchemaIndex } from '../selection/schemaIndex';
import type { SchemaIndex } from '../selection/types';
import type {
  FindReplaceController,
  FindReplaceEvent,
  FindReplaceLimits,
  FindReplaceSnapshot,
  MatchView,
  RecordView,
} from './contract';
import { createFindReplaceController } from './createFindReplaceController';

export type RawNestedItem = RawApiTypes.ItemInNestedResponse;
type UnknownRecord = Record<string, unknown>;

// ─── Schema ─────────────────────────────────────────────────────────────────

function itemType(
  id: string,
  name: string,
  draftMode: boolean,
  titleFieldId?: string,
): ApiTypes.ItemType {
  return {
    id,
    type: 'item_type',
    name,
    api_key: id,
    modular_block: false,
    draft_mode_active: draftMode,
    ...(titleFieldId
      ? { title_field: { id: titleFieldId, type: 'field' } }
      : {}),
  } as ApiTypes.ItemType;
}

function field(
  id: string,
  modelId: string,
  label: string,
  apiKey: string,
  fieldType: ApiTypes.Field['field_type'],
  position: number,
  localized = false,
  validators: UnknownRecord = {},
): ApiTypes.Field {
  return {
    id,
    type: 'field',
    label,
    api_key: apiKey,
    field_type: fieldType,
    localized,
    position,
    validators,
    item_type: { id: modelId, type: 'item_type' },
  } as ApiTypes.Field;
}

export type FixtureSchemaOptions = {
  /** Article titles are localized (`{ en, it }`). */
  localizedTitle?: boolean;
};

/**
 * - `article` "Article" (draft/published on): Title, Slug, Body, Sections
 *   (Modular Content, so a search reads it nested, 30 records at a time).
 * - `page` "Page" (no drafts: writes go live): Title, Body.
 * - `author` "Author" (drafts on): Name.
 *
 * Page and Author can't hold blocks: a search reads them 500 at a time.
 */
export function fixtureSchema(options: FixtureSchemaOptions = {}): SchemaIndex {
  const article = itemType('article', 'Article', true, 'article-title');
  const page = itemType('page', 'Page', false, 'page-title');
  const author = itemType('author', 'Author', true, 'author-name');
  const section = {
    ...itemType('section', 'Section', false),
    modular_block: true,
  } as ApiTypes.ItemType;
  return buildSchemaIndex({
    itemTypes: [article, page, author, section],
    fieldsByItemTypeId: new Map([
      [
        article.id,
        [
          field(
            'article-title',
            'article',
            'Title',
            'title',
            'string',
            1,
            options.localizedTitle ?? false,
          ),
          field('article-slug', 'article', 'Slug', 'slug', 'slug', 2),
          field('article-body', 'article', 'Body', 'body', 'text', 3),
          field(
            'article-sections',
            'article',
            'Sections',
            'sections',
            'rich_text',
            4,
            false,
            { rich_text_blocks: { item_types: ['section'] } },
          ),
        ],
      ],
      [
        page.id,
        [
          field('page-title', 'page', 'Title', 'title', 'string', 1),
          field('page-body', 'page', 'Body', 'body', 'text', 2),
        ],
      ],
      [
        author.id,
        [field('author-name', 'author', 'Name', 'name', 'string', 1)],
      ],
      [
        section.id,
        [
          field(
            'section-heading',
            'section',
            'Heading',
            'heading',
            'string',
            1,
          ),
        ],
      ],
    ]),
  });
}

// ─── Records ────────────────────────────────────────────────────────────────

export type FixtureRecord = {
  id: string;
  modelId: 'article' | 'page' | 'author';
  attributes: UnknownRecord;
  /** Defaults to `draft`. */
  status?: 'draft' | 'updated' | 'published';
};

export function rawRecord(
  { id, modelId, attributes, status = 'draft' }: FixtureRecord,
  version = `${id}-v1`,
): RawNestedItem {
  return {
    id,
    type: 'item',
    attributes: structuredClone(attributes),
    relationships: {
      item_type: { data: { id: modelId, type: 'item_type' } },
    },
    meta: {
      status,
      current_version: version,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z',
      published_at: null,
      first_published_at: null,
      publication_scheduled_at: null,
      unpublishing_scheduled_at: null,
      is_valid: true,
      is_current_version_valid: true,
      is_published_version_valid: null,
      stage: null,
      has_children: null,
    },
  } as RawNestedItem;
}

/**
 * 7 case-insensitive "acme" matches in 4 records over 2 models:
 * - a1 "Acme launches a widget": title, slug, body ×2 (4)
 * - a2 "Brand guidelines": body (1)
 * - p1 "About us": body (1)
 * - p2 "Legal notice": body (1)
 */
export function acmeRecords(): FixtureRecord[] {
  return [
    {
      id: 'a1',
      modelId: 'article',
      attributes: {
        title: 'Acme launches a widget',
        slug: 'acme-widget',
        body: 'Acme is great. Try acme again',
      },
    },
    {
      id: 'a2',
      modelId: 'article',
      attributes: {
        title: 'Brand guidelines',
        slug: 'brand-guidelines',
        body: 'Use ACME carefully',
      },
    },
    {
      id: 'p1',
      modelId: 'page',
      attributes: { title: 'About us', body: 'We are Acme' },
    },
    {
      id: 'p2',
      modelId: 'page',
      attributes: { title: 'Legal notice', body: 'Acme Corp, legal' },
    },
    { id: 'u1', modelId: 'author', attributes: { name: 'Jane Doe' } },
  ];
}

/** `count` Articles whose body says "Acme" `perRecord` times. */
export function manyRecords(count: number, perRecord = 1): FixtureRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${String(index + 1).padStart(4, '0')}`,
    modelId: 'article' as const,
    attributes: {
      title: `Note ${index + 1}`,
      slug: `note-${index + 1}`,
      body: Array.from({ length: perRecord }, () => 'Acme').join(' and '),
    },
  }));
}

// ─── Fake CMA ───────────────────────────────────────────────────────────────

export type ListQuery = {
  filter: { type?: string; ids?: string };
  page: { offset: number; limit: number };
  nested?: boolean;
};

export type FakeCma = {
  client: Client;
  rawList: Mock;
  rawFind: Mock;
  update: Mock;
  /** `items.find` (simple item, current version). */
  find: Mock;
  publish: Mock;
  /** The current records, by id. */
  records: Map<string, RawNestedItem>;
  /** Pages of a model (the scan): not counts, not reads by id. */
  pageCalls(modelId?: string): ListQuery[];
  /** Count requests (`page[limit]=1`). */
  countCalls(): ListQuery[];
  /** Reads by id (`filter[ids]`). */
  idCalls(): ListQuery[];
  /** Every page request of this model fails with `error` (counts don't). */
  failModel(modelId: string, error: unknown): void;
  /** Awaited before a page is answered (to hold a scan in place). */
  gatePages(
    gate: ((query: ListQuery) => Promise<void> | undefined) | null,
  ): void;
  /** The next updates of a record fail: one entry per attempt (null lets it through). */
  failUpdates(recordId: string, errors: ReadonlyArray<unknown>): void;
  /** The next publishes of a record fail: one entry per attempt (null lets it through). */
  failPublishes(recordId: string, errors: ReadonlyArray<unknown>): void;
  /** Someone else edits a record (new version). */
  edit(recordId: string, attributes: UnknownRecord): void;
  remove(recordId: string): void;
};

function modelOf(record: RawNestedItem): string {
  return record.relationships.item_type.data.id;
}

/** A count asks for one record of the models, without ids. */
function isCount(query: ListQuery): boolean {
  return !query.filter.ids && query.page.limit === 1;
}

/** Article and Author have draft/published; Page doesn't (fixtureSchema). */
function hasDrafts(record: RawNestedItem): boolean {
  return modelOf(record) !== 'page';
}

function bumpVersion(record: RawNestedItem): void {
  const current = record.meta.current_version;
  const match = /-v(\d+)$/.exec(current);
  const next = match ? Number(match[1]) + 1 : 2;
  record.meta.current_version = `${record.id}-v${next}`;
}

/** An error shaped like the CMA client's `ApiError`. */
export function httpError(
  status: number,
  entities: ReadonlyArray<{
    code: string;
    details?: UnknownRecord;
    transient?: boolean;
  }> = [],
): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: {
      status,
      headers: {},
      body: {
        data: entities.map((entity, index) => ({
          id: `error-${index}`,
          type: 'api_error',
          attributes: {
            code: entity.code,
            details: entity.details ?? {},
            ...(entity.transient ? { transient: true } : {}),
          },
        })),
      },
    },
  });
}

export function staleVersionError(): Error {
  return httpError(422, [{ code: 'STALE_ITEM_VERSION' }]);
}

/** The simple (not JSON:API) item `items.update` returns. */
function simpleItem(record: RawNestedItem): UnknownRecord {
  return {
    id: record.id,
    type: 'item',
    ...structuredClone(record.attributes),
    item_type: { id: modelOf(record), type: 'item_type' },
    meta: structuredClone(record.meta),
  };
}

export function createFakeCma(records: ReadonlyArray<FixtureRecord>): FakeCma {
  const store = new Map(
    records.map((record) => [record.id, rawRecord(record)]),
  );
  const modelFailures = new Map<string, unknown>();
  const updateFailures = new Map<string, unknown[]>();
  const publishFailures = new Map<string, unknown[]>();
  let gate: ((query: ListQuery) => Promise<void> | undefined) | null = null;

  const rawList = vi.fn(async (raw: UnknownRecord) => {
    const query = raw as unknown as ListQuery;
    if (query.filter.ids) {
      const data = query.filter.ids.split(',').flatMap((id) => {
        const record = store.get(id);
        return record ? [structuredClone(record)] : [];
      });
      return { data, meta: { total_count: data.length } };
    }

    const types = (query.filter.type ?? '').split(',').filter(Boolean);
    const all = [...store.values()]
      .filter((record) => types.includes(modelOf(record)))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (isCount(query)) {
      return { data: [], meta: { total_count: all.length } };
    }
    // The API's page limits: a regression to bigger pages fails loudly here.
    if (query.page.limit > (query.nested ? 30 : 500)) {
      throw httpError(422, [{ code: 'INVALID_FIELD' }]);
    }

    for (const modelId of types) {
      const failure = modelFailures.get(modelId);
      if (failure !== undefined) throw failure;
    }
    await gate?.(query);
    return {
      data: all
        .slice(query.page.offset, query.page.offset + query.page.limit)
        .map((record) => structuredClone(record)),
      meta: { total_count: all.length },
    };
  });

  const rawFind = vi.fn(async (id: string) => {
    const record = store.get(id);
    if (!record) throw httpError(404, [{ code: 'NOT_FOUND' }]);
    return { data: structuredClone(record) };
  });

  const update = vi.fn(async (id: string, body: UnknownRecord) => {
    const failure = updateFailures.get(id)?.shift();
    if (failure) throw failure;
    const record = store.get(id);
    if (!record) throw httpError(404, [{ code: 'NOT_FOUND' }]);
    const meta = body.meta as { current_version?: string } | undefined;
    if (meta?.current_version !== record.meta.current_version) {
      throw staleVersionError();
    }
    for (const [key, value] of Object.entries(body)) {
      if (key !== 'meta') {
        (record.attributes as UnknownRecord)[key] = structuredClone(value);
      }
    }
    bumpVersion(record);
    if (hasDrafts(record) && record.meta.status === 'published') {
      record.meta.status = 'updated';
    }
    return simpleItem(record);
  });

  const find = vi.fn(async (id: string) => {
    const record = store.get(id);
    if (!record) throw httpError(404, [{ code: 'NOT_FOUND' }]);
    return simpleItem(record);
  });

  const publish = vi.fn(async (id: string) => {
    const failure = publishFailures.get(id)?.shift();
    if (failure) throw failure;
    const record = store.get(id);
    if (!record) throw httpError(404, [{ code: 'NOT_FOUND' }]);
    record.meta.status = 'published';
    return simpleItem(record);
  });

  const listQueries = (): ListQuery[] =>
    rawList.mock.calls.map(([query]) => query as unknown as ListQuery);

  return {
    client: {
      items: { rawList, rawFind, update, find, publish },
    } as unknown as Client,
    rawList,
    rawFind,
    update,
    find,
    publish,
    records: store,
    pageCalls: (modelId) =>
      listQueries().filter(
        (query) =>
          !isCount(query) &&
          !query.filter.ids &&
          (modelId === undefined || query.filter.type === modelId),
      ),
    countCalls: () => listQueries().filter(isCount),
    idCalls: () => listQueries().filter((query) => Boolean(query.filter.ids)),
    failModel: (modelId, error) => {
      modelFailures.set(modelId, error);
    },
    gatePages: (next) => {
      gate = next;
    },
    failUpdates: (recordId, errors) => {
      updateFailures.set(recordId, [...errors]);
    },
    failPublishes: (recordId, errors) => {
      publishFailures.set(recordId, [...errors]);
    },
    edit: (recordId, attributes) => {
      const record = store.get(recordId);
      if (!record) return;
      Object.assign(record.attributes as UnknownRecord, attributes);
      bumpVersion(record);
    },
    remove: (recordId) => {
      store.delete(recordId);
    },
  };
}

// ─── Controller harness ─────────────────────────────────────────────────────

/** Inline matching (jsdom has no Worker). */
export const inlineMatchField: MatchTraversedField = async (
  fieldValue,
  matcher,
) => matchesForTraversedField(fieldValue, matcher);

/**
 * The matcher worker, in-process: like the real one it answers one request
 * at a time, in arrival order, each after `durationOf(request)` ms (fake
 * timers). Responses go through `structuredClone`, like `postMessage`.
 */
export class FakeMatcherWorker {
  readonly requests: MatcherWorkerRequest[] = [];
  terminated = false;
  private readonly listeners: Array<
    (event: MessageEvent<MatcherWorkerResponse>) => void
  > = [];
  private busyUntil = 0;

  constructor(
    private readonly durationOf: (
      request: MatcherWorkerRequest,
    ) => number = () => 0,
  ) {}

  addEventListener(
    type: string,
    listener: (event: MessageEvent<MatcherWorkerResponse>) => void,
  ): void {
    if (type === 'message') this.listeners.push(listener);
  }

  postMessage(request: MatcherWorkerRequest): void {
    const cloned = structuredClone(request);
    this.requests.push(cloned);
    const now = Date.now();
    const done = Math.max(now, this.busyUntil) + this.durationOf(cloned);
    this.busyUntil = done;
    setTimeout(() => {
      if (this.terminated) return;
      const match = createTextMatcher(cloned.matcher);
      const response: MatcherWorkerResponse = {
        id: cloned.id,
        ok: true,
        matches: cloned.texts.map((text) => match(text)),
      };
      const event = {
        data: structuredClone(response),
      } as MessageEvent<MatcherWorkerResponse>;
      for (const listener of this.listeners) listener(event);
    }, done - now);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Worker sessions over `FakeMatcherWorker`s, one per discovery run. */
export function fakeWorkerSessions(
  durationOf?: (request: MatcherWorkerRequest) => number,
): { factory: () => MatcherWorkerSession; workers: FakeMatcherWorker[] } {
  const workers: FakeMatcherWorker[] = [];
  return {
    workers,
    factory: () => {
      const worker = new FakeMatcherWorker(durationOf);
      workers.push(worker);
      return new MatcherWorkerSession(() => worker as unknown as Worker);
    },
  };
}

export type Harness = {
  controller: FindReplaceController;
  cma: FakeCma;
  schema: SchemaIndex;
  events: FindReplaceEvent[];
  /** Snapshot versions seen by a subscriber, with the fake time of each emit. */
  emits: Array<{ version: number; at: number }>;
  unload: { addEventListener: Mock; removeEventListener: Mock };
  snapshot(): FindReplaceSnapshot;
};

export type HarnessOptions = {
  records?: ReadonlyArray<FixtureRecord>;
  cma?: FakeCma;
  limits?: Partial<FindReplaceLimits>;
  locales?: ReadonlyArray<string>;
  localizedTitle?: boolean;
  links?: { internalDomain: string | null; isEnvironmentPrimary: boolean };
  environment?: string;
  matchField?: MatchTraversedField;
  /** The production path: matching through worker sessions (no `matchField`). */
  workerSessionFactory?: () => MatcherWorkerSession;
  canPublishModel?: (modelId: string) => boolean;
  /** Records counted at boot (above `limits.enterToSearchAbove`: Enter searches). */
  recordCount?: number | null;
};

export function setupController(options: HarnessOptions = {}): Harness {
  const cma = options.cma ?? createFakeCma(options.records ?? acmeRecords());
  const schema = fixtureSchema({ localizedTitle: options.localizedTitle });
  const unload = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const controller = createFindReplaceController({
    client: cma.client,
    schema,
    siteId: 'site-1',
    environment: options.environment ?? 'main',
    locales: options.locales ?? ['en'],
    links: options.links ?? {
      internalDomain: 'acme.admin.datocms.com',
      isEnvironmentPrimary: true,
    },
    limits: options.limits,
    ...(options.workerSessionFactory
      ? { workerSessionFactory: options.workerSessionFactory }
      : { matchField: options.matchField ?? inlineMatchField }),
    canPublishModel: options.canPublishModel,
    recordCount: options.recordCount,
    unloadTarget: unload,
  });
  const events: FindReplaceEvent[] = [];
  const emits: Harness['emits'] = [];
  controller.subscribeEvents((event) => events.push(event));
  controller.subscribe(() =>
    emits.push({ version: controller.getSnapshot().version, at: Date.now() }),
  );
  return {
    controller,
    cma,
    schema,
    events,
    emits,
    unload,
    snapshot: () => controller.getSnapshot(),
  };
}

/** Lets every timer and promise run (debounce, scan, streaming, writes). */
export async function settle(): Promise<void> {
  await vi.runAllTimersAsync();
}

/** Types the pattern, presses Enter and waits for the search to settle. */
export async function searchFor(
  harness: Harness,
  pattern: string,
): Promise<FindReplaceSnapshot> {
  harness.controller.setPattern(pattern);
  harness.controller.searchNow();
  await settle();
  return harness.snapshot();
}

/** Accepts the confirm: `replace(plan.token)`, then waits for the pass to end. */
export async function replaceAll(harness: Harness): Promise<boolean> {
  const { plan } = harness.snapshot();
  if (!plan) throw new Error('Expected an enabled primary with a plan');
  const started = harness.controller.replace(plan.token);
  await settle();
  return started;
}

export function recordByKey(
  snapshot: FindReplaceSnapshot,
  key: string,
): RecordView {
  const record = snapshot.records.find((candidate) => candidate.key === key);
  if (!record) throw new Error(`No record ${key} in the snapshot`);
  return record;
}

export function matchesOf(record: RecordView): MatchView[] {
  return record.fields.flatMap((fieldView) => [...fieldView.matches]);
}

export function allMatches(snapshot: FindReplaceSnapshot): MatchView[] {
  return snapshot.records.flatMap(matchesOf);
}

export function eventsOf<T extends FindReplaceEvent['type']>(
  harness: Harness,
  type: T,
): Array<Extract<FindReplaceEvent, { type: T }>> {
  return harness.events.filter(
    (event): event is Extract<FindReplaceEvent, { type: T }> =>
      event.type === type,
  );
}
