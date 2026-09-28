import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import type { RequestPool } from './requestPool';
import type { PublicationStatus } from './types';

export type { PublicationStatus } from './types';

/** Records per request with `nested` (the API maximum). */
export const HYDRATION_PAGE_SIZE = 30;
/** Records per request without `nested` (the API maximum). */
export const FLAT_PAGE_SIZE = 500;
/** Ids per request when records without blocks are read by id (keeps the URL short). */
export const FLAT_IDS_PER_REQUEST = 100;
/** Pages of one model requested ahead of the one being matched. */
export const PAGE_WINDOW = 6;
/** The same for 500-record pages, so a model never buffers more than 1,000 records. */
export const FLAT_PAGE_WINDOW = 2;
/** Models counted together in one request. */
const MODELS_PER_COUNT_REQUEST = 50;
export const CANDIDATE_PAGE_SIZE = 100;

export type DiscoveryModel = {
  id: string;
  apiKey: string;
  name: string;
  /**
   * false: no field of the model can hold blocks, so its records are read
   * 500 at a time without nested payloads (they hold every value the
   * search reads). Missing or true: nested, 30 at a time.
   */
  nested?: boolean;
};

export type RecordQueryScope = {
  publicationStatuses: PublicationStatus[];
  locales: string[];
  recordIds?: string[];
  recordQuery?: string;
};

export type RawNestedItem = RawApiTypes.ItemInNestedResponse;

export type ModelPageProgress = {
  modelId: string;
  recordsFetched: number;
  totalRecords: number | null;
};

export type BrowseRecordsPage = {
  records: RawNestedItem[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
};

type RawItemPage = {
  data: RawNestedItem[];
  meta: { total_count: number };
};

export type FetchModelRecordsOptions = {
  signal?: AbortSignal;
  onPage?: (progress: ModelPageProgress) => void;
  onRecord?: (record: RawNestedItem) => void | Promise<void>;
  /**
   * Called once per page with its records (after `onRecord`), in order, and
   * awaited before the next page is handed over. Later pages may already be
   * requested meanwhile (at most `PAGE_WINDOW` ahead).
   */
  onRecords?: (records: RawNestedItem[]) => void | Promise<void>;
  collect?: boolean;
  /** The search's request slots and pace. Without it, requests go out at once. */
  pool?: RequestPool;
  /** Offset (in `id_ASC` order) of the first record to read. Default 0. */
  startOffset?: number;
};

export class DiscoveryCancelledError extends Error {
  constructor() {
    super('Discovery was cancelled.');
    this.name = 'DiscoveryCancelledError';
  }
}

export function isDiscoveryCancelled(error: unknown): boolean {
  return (
    error instanceof DiscoveryCancelledError ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

export function throwIfDiscoveryCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DiscoveryCancelledError();
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function statusFields(
  publicationStatuses: PublicationStatus[],
): Record<string, unknown> | undefined {
  const statuses = unique(publicationStatuses);
  return statuses.length > 0 ? { _status: { in: statuses } } : undefined;
}

function queryLocale(scope: RecordQueryScope): string | undefined {
  // Locale affects server-side text and field filters. Omitting it when more than
  // one locale is selected prevents one locale from silently becoming authoritative.
  return scope.locales.length === 1 ? scope.locales[0] : undefined;
}

function compactQuery<T extends Record<string, unknown>>(query: T): T {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined),
  ) as T;
}

export function buildModelItemsQuery(args: {
  model: DiscoveryModel;
  scope: RecordQueryScope;
  offset: number;
  limit: number;
  nested: boolean;
  ids?: string[];
  includeRecordQuery?: boolean;
}): RawApiTypes.ItemInstancesHrefSchema {
  const fields = statusFields(args.scope.publicationStatuses);
  const ids = unique(args.ids ?? []).filter(Boolean);
  const recordQuery = args.scope.recordQuery?.trim();

  const filter = ids.length
    ? compactQuery({
        ids: ids.join(','),
        fields,
      })
    : compactQuery({
        type: args.model.id,
        fields,
        query: args.includeRecordQuery && recordQuery ? recordQuery : undefined,
      });

  return compactQuery({
    nested: args.nested,
    version: 'current',
    filter,
    page: { offset: args.offset, limit: args.limit },
    // The API does not accept order_by together with filter[ids]. Hydrated ID
    // batches are sorted locally against the deterministic candidate order.
    order_by: ids.length ? undefined : 'id_ASC',
    locale:
      args.includeRecordQuery && recordQuery
        ? queryLocale(args.scope)
        : undefined,
  });
}

async function rawList(
  client: Client,
  query: RawApiTypes.ItemInstancesHrefSchema,
): Promise<RawItemPage> {
  // The generic generated overload is stricter than the runtime API when a
  // dynamic schema is being queried. The response shell is stable.
  return (await client.items.rawList(
    query as RawApiTypes.ItemInstancesHrefSchema & { nested: true },
  )) as RawItemPage;
}

/** Through the pool when there is one. */
function send<T>(
  options: { pool?: RequestPool; signal?: AbortSignal },
  request: () => Promise<T>,
): Promise<T> {
  return options.pool ? options.pool.run(request, options.signal) : request();
}

/**
 * A request made ahead of time may settle after the reader stopped waiting
 * for it (cancelled, capped, failed): its rejection is never left unhandled.
 */
function ahead<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

export async function fetchModelCount(
  client: Client,
  model: DiscoveryModel,
  scope: RecordQueryScope,
  signal?: AbortSignal,
  pool?: RequestPool,
): Promise<number> {
  throwIfDiscoveryCancelled(signal);

  const response = await send({ pool, signal }, () =>
    rawList(
      client,
      buildModelItemsQuery({
        model,
        scope,
        offset: 0,
        limit: 1,
        nested: false,
        ids: scope.recordIds,
        includeRecordQuery: Boolean(scope.recordQuery?.trim()),
      }),
    ),
  );

  throwIfDiscoveryCancelled(signal);
  return response.meta.total_count;
}

/** How many records these models hold together (one request per 50 models). */
export async function fetchRecordTotal(
  client: Client,
  modelIds: ReadonlyArray<string>,
): Promise<number> {
  const totals = await Promise.all(
    chunks(unique([...modelIds]), MODELS_PER_COUNT_REQUEST).map(async (ids) => {
      const response = await rawList(client, {
        filter: { type: ids.join(',') },
        page: { offset: 0, limit: 1 },
      });
      return response.meta.total_count;
    }),
  );
  return totals.reduce((sum, total) => sum + total, 0);
}

type BrowseRecordsPageArgs = {
  client: Client;
  model: DiscoveryModel;
  scope: RecordQueryScope;
  page: number;
  pageSize?: number;
  signal?: AbortSignal;
};

/** Whether the search text is also an existing record ID of the model. */
async function isRecordIdOfModel(
  args: BrowseRecordsPageArgs,
  possibleId: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+$/.test(possibleId) || possibleId.length > 64) {
    return false;
  }
  try {
    const exactResponse = await rawList(
      args.client,
      buildModelItemsQuery({
        model: args.model,
        scope: args.scope,
        offset: 0,
        limit: 1,
        nested: false,
        ids: [possibleId],
      }),
    );
    throwIfDiscoveryCancelled(args.signal);
    return exactResponse.data.some(
      (record) => rawItemModelId(record) === args.model.id,
    );
  } catch (error) {
    if (isDiscoveryCancelled(error)) throw error;
    // A title-like token can be invalid as an ID; full-text results remain valid.
    return false;
  }
}

/** Browse page for a text search: candidates by full text, plus an exact ID. */
async function fetchBrowseSearchPage(
  args: BrowseRecordsPageArgs,
  recordQuery: string,
  page: number,
  pageSize: number,
): Promise<BrowseRecordsPage> {
  const candidateIds = new Set(
    await fetchCandidateIds(args.client, args.model, args.scope, {
      signal: args.signal,
    }),
  );
  if (await isRecordIdOfModel(args, recordQuery)) {
    candidateIds.add(recordQuery);
  }

  const orderedIds = [...candidateIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const pageIds = orderedIds.slice((page - 1) * pageSize, page * pageSize);
  const pageShell = {
    page,
    pageSize,
    totalRecords: orderedIds.length,
    totalPages: Math.ceil(orderedIds.length / pageSize),
  };
  if (pageIds.length === 0) return { records: [], ...pageShell };

  const response = await rawList(
    args.client,
    buildModelItemsQuery({
      model: args.model,
      scope: args.scope,
      offset: 0,
      limit: pageSize,
      nested: false,
      ids: pageIds,
    }),
  );
  throwIfDiscoveryCancelled(args.signal);
  const byId = new Map(
    response.data
      .filter((record) => rawItemModelId(record) === args.model.id)
      .map((record) => [record.id, record]),
  );

  return {
    records: pageIds.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    }),
    ...pageShell,
  };
}

/** Lightweight, one-based page for the Browse workflow's record picker. */
export async function fetchBrowseRecordsPage(
  args: BrowseRecordsPageArgs,
): Promise<BrowseRecordsPage> {
  const page = Math.max(1, Math.floor(args.page));
  const pageSize = Math.min(
    CANDIDATE_PAGE_SIZE,
    Math.max(1, Math.floor(args.pageSize ?? 30)),
  );
  throwIfDiscoveryCancelled(args.signal);

  const recordQuery = args.scope.recordQuery?.trim();
  if (recordQuery) {
    return fetchBrowseSearchPage(args, recordQuery, page, pageSize);
  }

  const response = await rawList(
    args.client,
    buildModelItemsQuery({
      model: args.model,
      scope: args.scope,
      offset: (page - 1) * pageSize,
      limit: pageSize,
      nested: false,
      ids: args.scope.recordIds,
    }),
  );
  throwIfDiscoveryCancelled(args.signal);

  return {
    records: response.data,
    page,
    pageSize,
    totalRecords: response.meta.total_count,
    totalPages: Math.ceil(response.meta.total_count / pageSize),
  };
}

async function fetchCandidateIds(
  client: Client,
  model: DiscoveryModel,
  scope: RecordQueryScope,
  options: FetchModelRecordsOptions,
): Promise<string[]> {
  if (scope.recordIds?.length) {
    return unique(scope.recordIds).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  const ids = new Set<string>();
  // Full-text filters accept one locale. Run an authoritative candidate pass
  // per requested locale, then hydrate the de-duplicated roots once.
  const searchScopes =
    scope.recordQuery?.trim() && scope.locales.length > 1
      ? unique(scope.locales).map((locale) => ({ ...scope, locales: [locale] }))
      : [scope];

  for (const searchScope of searchScopes) {
    let offset = 0;
    let total: number | null = null;

    do {
      throwIfDiscoveryCancelled(options.signal);
      // biome-ignore lint/performance/noAwaitInLoops: pages are requested one after another (offset paging).
      const response = await rawList(
        client,
        buildModelItemsQuery({
          model,
          scope: searchScope,
          offset,
          limit: CANDIDATE_PAGE_SIZE,
          nested: false,
          includeRecordQuery: true,
        }),
      );
      throwIfDiscoveryCancelled(options.signal);

      total = response.meta.total_count;
      for (const item of response.data) {
        ids.add(item.id);
      }
      offset += response.data.length;

      if (response.data.length === 0) {
        break;
      }
    } while (total === null || offset < total);
  }

  return [...ids].sort((left, right) => left.localeCompare(right));
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function rawItemModelId(item: RawNestedItem): string | null {
  return item.relationships?.item_type?.data?.id ?? null;
}

/** Hands one page's records to `onRecord` (one by one), then to `onRecords`. */
async function deliverPage(
  records: RawNestedItem[],
  collected: RawNestedItem[],
  options: FetchModelRecordsOptions,
): Promise<void> {
  for (const record of records) {
    throwIfDiscoveryCancelled(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: records are delivered one at a time, in order.
    await options.onRecord?.(record);
    if (options.collect !== false) collected.push(record);
  }
  throwIfDiscoveryCancelled(options.signal);
  await options.onRecords?.(records);
}

/**
 * Requests the id batches of one model (several ahead, through the pool)
 * and hands each batch's records to `handle` in the order of `ids`. Records
 * that no longer exist, or belong to another model, are left out.
 */
async function forEachIdBatch(
  client: Client,
  model: DiscoveryModel,
  scope: RecordQueryScope,
  ids: string[],
  options: FetchModelRecordsOptions,
  handle: (records: RawNestedItem[], received: number) => Promise<void>,
): Promise<void> {
  const nested = model.nested !== false;
  const size = nested ? HYDRATION_PAGE_SIZE : FLAT_IDS_PER_REQUEST;
  const batches = chunks(ids, size);
  const requests: Array<Promise<RawItemPage>> = [];
  const request = (index: number): void => {
    requests.push(
      ahead(
        send(options, () =>
          rawList(
            client,
            buildModelItemsQuery({
              model,
              scope,
              offset: 0,
              limit: size,
              nested,
              ids: batches[index],
            }),
          ),
        ),
      ),
    );
  };

  for (let index = 0; index < batches.length; index += 1) {
    const last = Math.min(batches.length, index + PAGE_WINDOW);
    for (let next = requests.length; next < last; next += 1) request(next);
    throwIfDiscoveryCancelled(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: batches are handed over in order; the next ones are already requested.
    const response = await requests[index];
    throwIfDiscoveryCancelled(options.signal);

    const byId = new Map(
      response.data
        .filter((record) => rawItemModelId(record) === model.id)
        .map((record) => [record.id, record]),
    );
    const records = batches[index].flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    });
    await handle(
      nested
        ? records
        : await withBlocks(client, model, scope, records, options),
      response.data.length,
    );
  }
}

/** Every block reference in a Structured Text value read without `nested` is an id. */
function holdsBlockIds(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsBlockIds);
  if (value === null || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (
    (node.type === 'block' || node.type === 'inlineBlock') &&
    typeof node.item === 'string'
  ) {
    return true;
  }
  return Object.values(node).some(holdsBlockIds);
}

/**
 * A model read without `nested` has no field that can hold blocks, but a
 * Structured Text value can still contain blocks added before they were
 * disallowed. Those records are read again with their blocks, so the search
 * sees the same value the writer will.
 */
async function withBlocks(
  client: Client,
  model: DiscoveryModel,
  scope: RecordQueryScope,
  records: RawNestedItem[],
  options: FetchModelRecordsOptions,
): Promise<RawNestedItem[]> {
  const ids = records
    .filter((record) => holdsBlockIds(record.attributes))
    .map((record) => record.id);
  if (ids.length === 0) return records;

  const reread = new Map<string, RawNestedItem>();
  await forEachIdBatch(
    client,
    { ...model, nested: true },
    scope,
    ids,
    options,
    async (batch) => {
      for (const record of batch) reread.set(record.id, record);
    },
  );
  return records.map((record) => reread.get(record.id) ?? record);
}

async function hydrateCandidateIds(
  client: Client,
  model: DiscoveryModel,
  scope: RecordQueryScope,
  candidateIds: string[],
  options: FetchModelRecordsOptions,
): Promise<RawNestedItem[]> {
  const records: RawNestedItem[] = [];
  let recordsFetched = 0;

  await forEachIdBatch(
    client,
    model,
    scope,
    candidateIds,
    options,
    async (batch, received) => {
      await deliverPage(batch, records, options);
      recordsFetched += received;
      options.onPage?.({
        modelId: model.id,
        recordsFetched,
        totalRecords: candidateIds.length,
      });
    },
  );

  return records;
}

/**
 * Reads every record of one model from `startOffset` on, in `id_ASC` order:
 * 500 per request without `nested` (no field can hold blocks), 30 with it.
 * While a page is matched, up to `PAGE_WINDOW` later pages are already
 * requested; pages are still handed over strictly in order. When the API
 * sends fewer records than asked for before the end, the rest is read one
 * page at a time from where it stopped, so nothing is skipped.
 */
async function fetchModelPages(
  client: Client,
  model: DiscoveryModel,
  scope: RecordQueryScope,
  options: FetchModelRecordsOptions,
): Promise<RawNestedItem[]> {
  const nested = model.nested !== false;
  const limit = nested ? HYDRATION_PAGE_SIZE : FLAT_PAGE_SIZE;
  const requested = new Map<number, Promise<RawItemPage>>();
  const request = (offset: number): Promise<RawItemPage> => {
    const existing = requested.get(offset);
    if (existing) return existing;
    const page = ahead(
      send(options, () =>
        rawList(
          client,
          buildModelItemsQuery({ model, scope, offset, limit, nested }),
        ),
      ),
    );
    requested.set(offset, page);
    return page;
  };

  const records: RawNestedItem[] = [];
  let recordsFetched = 0;
  let offset = Math.max(0, options.startOffset ?? 0);
  let stride = limit;
  let window = nested ? PAGE_WINDOW : FLAT_PAGE_WINDOW;

  for (;;) {
    throwIfDiscoveryCancelled(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: pages are handed over in order; the next ones are already requested.
    const response = await request(offset);
    requested.delete(offset);
    throwIfDiscoveryCancelled(options.signal);

    const total = response.meta.total_count;
    const served = response.data.length;
    const next = offset + served;
    if (served > 0 && served < stride && next < total) {
      // Fewer records than asked for, before the end: go on one page at a
      // time, each asked for once the one before was handed over.
      stride = served;
      window = 0;
      requested.clear();
    }
    for (
      let page = 0;
      page < window && next + page * stride < total;
      page += 1
    ) {
      request(next + page * stride);
    }

    await deliverPage(
      nested
        ? response.data
        : await withBlocks(client, model, scope, response.data, options),
      records,
      options,
    );
    recordsFetched += served;
    options.onPage?.({
      modelId: model.id,
      recordsFetched,
      totalRecords: total,
    });

    if (served === 0 || next >= total) break;
    offset = next;
  }

  return records;
}

/**
 * Fetches roots for one model. Browse filters are authoritative and therefore
 * use a cheap ID pass followed by nested hydration. Content matching never
 * relies on a server text filter: nested traversal remains authoritative.
 */
export async function fetchModelRecords(
  client: Client,
  model: DiscoveryModel,
  scope: RecordQueryScope,
  options: FetchModelRecordsOptions = {},
): Promise<RawNestedItem[]> {
  const hasAuthoritativeCandidateFilter =
    Boolean(scope.recordIds?.length) || Boolean(scope.recordQuery?.trim());

  if (!hasAuthoritativeCandidateFilter) {
    return fetchModelPages(client, model, scope, options);
  }

  const candidateIds = await fetchCandidateIds(client, model, scope, options);
  return hydrateCandidateIds(client, model, scope, candidateIds, options);
}

/**
 * Re-reads specific records of one model by ID (current version, nested
 * unless the model has no block fields), in the order given. Records that
 * no longer exist, or that belong to another model, are simply missing from
 * the result.
 */
export async function fetchRecordsByIds(
  client: Client,
  model: DiscoveryModel,
  ids: ReadonlyArray<string>,
  options: Pick<
    FetchModelRecordsOptions,
    'signal' | 'pool' | 'onRecords' | 'collect'
  > = {},
): Promise<RawNestedItem[]> {
  const uniqueIds = unique(ids.filter(Boolean));
  if (uniqueIds.length === 0) return [];
  return hydrateCandidateIds(
    client,
    model,
    { publicationStatuses: [], locales: [] },
    uniqueIds,
    {
      signal: options.signal,
      pool: options.pool,
      onRecords: options.onRecords,
      collect: options.collect,
    },
  );
}
