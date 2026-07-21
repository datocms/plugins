import type {
  CentraConnection,
  CentraReference,
  CentraReferenceKind,
} from '../types';
import { normalizeConnection, validateConnection } from './parameters';
import { isItemReference } from './references';

export const DATO_CORS_PROXY_URL = 'https://cors-proxy.datocms.com/';
export const CENTRA_MAX_PAGE_SIZE = 100;

const DEFAULT_PAGE_SIZE = 20;
const NORMAL_SEARCH_FIELDS = [
  'NAME',
  'FUZZY_NAME',
  'BRAND_NAME',
  'COLLECTION_NAME',
  'PRODUCT_VARIANT_NAME',
  'FUZZY_PRODUCT_VARIANT_NAME',
  'PRODUCT_NUMBER',
  'GTIN',
  'SHORT_DESCRIPTION',
  'DESCRIPTION',
  'CATEGORY_NAME',
] as const;

const DISPLAY_ITEM_FIELDS = `
  id
  name
  productNumber
  isPrimaryVariant
  available
  hasStock
  productVariant { id name number }
  media {
    id
    altText
    source {
      url
      type
      mediaSize { name maxWidth maxHeight }
    }
  }
  price {
    value
    formattedValue
    currency { code }
  }
  items {
    id
    sku
    GTIN
    name
    productSizeId
    preorder
    stock { available }
  }
`;

const DISPLAY_ITEMS_QUERY = `
  query CentraDisplayItems(
    $where: DisplayItemFilter
    $page: Int!
    $limit: Int!
  ) {
    displayItems(
      where: $where
      page: $page
      limit: $limit
    ) {
      list { ${DISPLAY_ITEM_FIELDS} }
      pagination {
        hasPreviousPage
        hasNextPage
        nextPage
        previousPage
        currentPage
        lastPage
        limit
        total
      }
      userErrors { path message }
    }
  }
`;

const DISPLAY_ITEM_QUERY = `
  query CentraDisplayItem(
    $id: Int!
  ) {
    displayItem(
      id: $id
    ) { ${DISPLAY_ITEM_FIELDS} }
  }
`;

export type CentraProductVariant = {
  id?: number;
  name?: string;
  number?: string;
};

export type CentraStock = {
  available: boolean;
};

export type CentraItem = {
  id: string;
  sku?: string;
  GTIN?: string;
  name?: string;
  productSizeId?: number;
  preorder?: boolean;
  stock?: CentraStock;
};

export type CentraMediaSource = {
  url: string;
  type?: string;
  mediaSize?: {
    name?: string;
    maxWidth?: number;
    maxHeight?: number;
  } | null;
};

export type CentraProductMedia = {
  id: string | number;
  altText?: string;
  source: CentraMediaSource;
};

export type CentraPrice = {
  value: number | string;
  formattedValue: string;
  currency: { code: string };
};

export type CentraDisplayItem = {
  id: number;
  name?: string;
  productNumber?: string;
  isPrimaryVariant?: boolean;
  available?: boolean;
  hasStock?: boolean;
  productVariant?: CentraProductVariant;
  media: CentraProductMedia[];
  price?: CentraPrice | null;
  items: CentraItem[];
};

export type CentraPagination = {
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  nextPage?: number | null;
  previousPage?: number | null;
  currentPage: number;
  lastPage: number;
  limit: number;
  total: number;
};

export type CentraSearchResult = {
  items: CentraDisplayItem[];
  page: number;
  hasMore: boolean;
  nextPage?: number;
  totalCount?: number;
};

export type CentraUserError = {
  path?: string[] | string | null;
  message: string;
};

export type HydratedCentraReference =
  | {
      status: 'resolved';
      reference: CentraReference;
      displayItem: CentraDisplayItem;
      item?: CentraItem;
      primaryDrift: boolean;
    }
  | {
      status: 'unresolved';
      reference: CentraReference;
      reason: 'displayItemNotFound' | 'itemNotFound';
      displayItem?: CentraDisplayItem;
    };

export type CentraClientErrorCode =
  | 'configuration'
  | 'http'
  | 'graphql'
  | 'network'
  | 'invalid-response';

export class CentraClientError extends Error {
  readonly code: CentraClientErrorCode;
  readonly status?: number;

  constructor(
    code: CentraClientErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'CentraClientError';
    this.code = code;
    this.status = options.status;
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        value: options.cause,
      });
    }
  }
}

export type CentraClientOptions = {
  fetcher?: typeof fetch;
};

export type SearchDisplayItemsOptions = {
  query?: string;
  kind: 'primaryProduct' | 'variant';
  page?: number;
  limit?: number;
  signal?: AbortSignal;
};

export type SearchItemsOptions = {
  query?: string;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
};

export type HydrateReferencesOptions = {
  references: readonly CentraReference[];
  kind: CentraReferenceKind;
  signal?: AbortSignal;
};

type GraphqlVariables = Record<string, unknown>;

type InFlightRequest = {
  promise: Promise<unknown>;
  controller: AbortController;
  consumers: number;
};

type RawDisplayItemList = {
  list?: unknown;
  pagination?: unknown;
  userErrors?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function requiredNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeStock(value: unknown): CentraStock | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const available = optionalBoolean(value.available);
  return available === undefined ? undefined : { available };
}

function normalizeItem(value: unknown): CentraItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) {
    return null;
  }

  return {
    id: value.id,
    sku: optionalString(value.sku),
    GTIN: optionalString(value.GTIN),
    name: optionalString(value.name),
    productSizeId: optionalNumber(value.productSizeId),
    preorder: optionalBoolean(value.preorder),
    stock: normalizeStock(value.stock),
  };
}

function normalizeMedia(value: unknown): CentraProductMedia | null {
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) {
    return null;
  }
  const rawSource = isRecord(value.source) ? value.source : null;
  const rawMediaSize = rawSource && isRecord(rawSource.mediaSize)
    ? rawSource.mediaSize
    : null;
  const source =
    rawSource && typeof rawSource.url === 'string'
      ? {
          url: rawSource.url,
          type: optionalString(rawSource.type),
          mediaSize: rawMediaSize
            ? {
                name: optionalString(rawMediaSize.name),
                maxWidth: optionalNumber(rawMediaSize.maxWidth),
                maxHeight: optionalNumber(rawMediaSize.maxHeight),
              }
            : null,
        }
      : null;

  if (!source) {
    return null;
  }

  return {
    id: value.id,
    altText: optionalString(value.altText),
    source,
  };
}

function normalizePrice(value: unknown): CentraPrice | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const currency = isRecord(value.currency) ? value.currency : null;
  const monetaryValue =
    typeof value.value === 'number' && Number.isFinite(value.value)
      ? value.value
      : typeof value.value === 'string' && value.value.trim().length > 0
        ? value.value
        : undefined;
  if (
    monetaryValue === undefined ||
    typeof value.formattedValue !== 'string' ||
    !currency ||
    typeof currency.code !== 'string'
  ) {
    return undefined;
  }
  return {
    value: monetaryValue,
    formattedValue: value.formattedValue,
    currency: { code: currency.code },
  };
}

function normalizeDisplayItem(value: unknown): CentraDisplayItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = requiredNumber(value.id);
  if (id === null) {
    return null;
  }
  const rawVariant = isRecord(value.productVariant) ? value.productVariant : null;
  const productVariant = rawVariant
    ? {
        id: optionalNumber(rawVariant.id),
        name: optionalString(rawVariant.name),
        number: optionalString(rawVariant.number),
      }
    : undefined;
  const items = Array.isArray(value.items)
    ? value.items.map(normalizeItem).filter((item): item is CentraItem => item !== null)
    : [];
  const media = Array.isArray(value.media)
    ? value.media
        .map(normalizeMedia)
        .filter((item): item is CentraProductMedia => item !== null)
    : [];

  return {
    id,
    name: optionalString(value.name),
    productNumber: optionalString(value.productNumber),
    isPrimaryVariant: optionalBoolean(value.isPrimaryVariant),
    available: optionalBoolean(value.available),
    hasStock: optionalBoolean(value.hasStock),
    productVariant,
    media,
    price: normalizePrice(value.price),
    items,
  };
}

function normalizePagination(value: unknown): CentraPagination | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const currentPage = optionalNumber(value.currentPage);
  const lastPage = optionalNumber(value.lastPage);
  const limit = optionalNumber(value.limit);
  const total = optionalNumber(value.total);
  const hasPreviousPage = optionalBoolean(value.hasPreviousPage);
  const hasNextPage = optionalBoolean(value.hasNextPage);
  if (
    currentPage === undefined ||
    lastPage === undefined ||
    limit === undefined ||
    total === undefined ||
    hasPreviousPage === undefined ||
    hasNextPage === undefined
  ) {
    return undefined;
  }
  return {
    currentPage,
    lastPage,
    limit,
    total,
    hasPreviousPage,
    hasNextPage,
    nextPage: value.nextPage === null ? null : optionalNumber(value.nextPage),
    previousPage:
      value.previousPage === null ? null : optionalNumber(value.previousPage),
  };
}

function normalizeUserErrors(value: unknown): CentraUserError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const errors: CentraUserError[] = [];
  for (const rawError of value) {
    if (isRecord(rawError) && typeof rawError.message === 'string') {
      const path =
        typeof rawError.path === 'string' ||
        rawError.path === null ||
        (Array.isArray(rawError.path) &&
          rawError.path.every((part) => typeof part === 'string'))
          ? rawError.path
          : undefined;
      errors.push({ message: rawError.message, path });
    }
  }
  return errors;
}

function normalizedPage(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
}

function normalizedLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(value, CENTRA_MAX_PAGE_SIZE);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function redactCredentials(text: string, token = ''): string {
  let redacted = text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  if (token.length > 0) {
    redacted = redacted.split(token).join('[REDACTED]');
  }
  return redacted;
}

function safeErrorMessage(error: unknown, token: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactCredentials(message, token);
}

function responseSnippet(text: string, token: string): string {
  const compact = redactCredentials(text, token).replace(/\s+/g, ' ').trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}…` : compact;
}

export function toDatoCorsProxyUrl(endpoint: string): string {
  return `${DATO_CORS_PROXY_URL}?url=${encodeURIComponent(endpoint)}`;
}

function mergeUniqueDisplayItems(
  lists: readonly CentraDisplayItem[][],
): CentraDisplayItem[] {
  const seen = new Set<number>();
  const result: CentraDisplayItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
  }
  return result;
}

function isExactItemMatch(displayItem: CentraDisplayItem, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return false;
  }
  return displayItem.items.some(
    (item) =>
      item.sku?.toLocaleLowerCase() === normalizedQuery ||
      item.GTIN?.toLocaleLowerCase() === normalizedQuery,
  );
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export class CentraClient {
  readonly connection: CentraConnection;

  private readonly fetcher: typeof fetch;
  private readonly inFlight = new Map<string, InFlightRequest>();

  constructor(connection: CentraConnection, options: CentraClientOptions = {}) {
    this.connection = normalizeConnection(connection);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async searchDisplayItems(
    options: SearchDisplayItemsOptions,
  ): Promise<CentraSearchResult> {
    return this.queryDisplayItems({
      query: options.query,
      onlyPrimaryVariant: options.kind === 'primaryProduct',
      page: options.page,
      limit: options.limit,
      signal: options.signal,
    });
  }

  async searchItems(options: SearchItemsOptions): Promise<CentraSearchResult> {
    const query = options.query?.trim() ?? '';
    const normalSearch = this.queryDisplayItems({
      query,
      searchInFields: query.length > 0 ? [...NORMAL_SEARCH_FIELDS] : undefined,
      onlyPrimaryVariant: false,
      page: options.page,
      limit: options.limit,
      signal: options.signal,
    });
    if (query.length === 0) {
      return normalSearch;
    }

    const sizeSearch = this.queryDisplayItems({
      query,
      searchInFields: ['SIZE_NUMBER'],
      onlyPrimaryVariant: false,
      page: options.page,
      limit: options.limit,
      signal: options.signal,
    });
    const [normalResult, sizeResult] = await Promise.all([
      normalSearch,
      sizeSearch,
    ]);
    const merged = mergeUniqueDisplayItems([
      normalResult.items,
      sizeResult.items,
    ]);
    const ranked = merged
      .map((item, index) => ({ item, index, exact: isExactItemMatch(item, query) }))
      .sort((left, right) => Number(right.exact) - Number(left.exact) || left.index - right.index)
      .map(({ item }) => item);
    const nextPage = normalResult.nextPage ?? sizeResult.nextPage;

    return {
      items: ranked,
      page: normalResult.page,
      hasMore: normalResult.hasMore || sizeResult.hasMore,
      nextPage,
      // Both searches can return the same parent, so an exact merged total is
      // not available without scanning all pages.
      totalCount: undefined,
    };
  }

  async getDisplayItem(options: {
    id: number;
    signal?: AbortSignal;
  }): Promise<CentraDisplayItem | null> {
    const data = await this.request<unknown>(
      DISPLAY_ITEM_QUERY,
      {
        id: options.id,
      },
      options.signal,
    );
    if (!isRecord(data)) {
      throw new CentraClientError(
        'invalid-response',
        'Centra returned an invalid display item response.',
      );
    }
    return data.displayItem === null
      ? null
      : normalizeDisplayItem(data.displayItem);
  }

  async hydrateReferences(
    options: HydrateReferencesOptions,
  ): Promise<HydratedCentraReference[]> {
    if (options.references.length === 0) {
      return [];
    }
    const ids = [...new Set(options.references.map(({ displayItemId }) => displayItemId))];
    const batches = chunk(ids, CENTRA_MAX_PAGE_SIZE);
    const results = await Promise.all(
      batches.map((batch) =>
        this.queryDisplayItems({
          ids: batch,
          onlyPrimaryVariant: false,
          page: 1,
          limit: batch.length,
          signal: options.signal,
        }),
      ),
    );
    const byId = new Map(
      results.flatMap((result) => result.items).map((item) => [item.id, item]),
    );

    // Some Centra storefronts do not return non-primary DisplayItems when the
    // collection query is filtered by ID, even though the same DisplayItem is
    // available through the singular query. Keep the batched fast path, then
    // resolve only the missing IDs individually so exact variants and items
    // remain stable after a record reload.
    const missingIds = ids.filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      const missingItems = await Promise.all(
        missingIds.map((id) =>
          this.getDisplayItem({ id, signal: options.signal }),
        ),
      );
      for (const item of missingItems) {
        if (item) {
          byId.set(item.id, item);
        }
      }
    }

    return options.references.map((reference): HydratedCentraReference => {
      const displayItem = byId.get(reference.displayItemId);
      if (!displayItem) {
        return {
          status: 'unresolved',
          reference,
          reason: 'displayItemNotFound',
        };
      }
      if (options.kind === 'item') {
        if (!isItemReference(reference)) {
          return {
            status: 'unresolved',
            reference,
            reason: 'itemNotFound',
            displayItem,
          };
        }
        const item = displayItem.items.find(({ id }) => id === reference.itemId);
        return item
          ? {
              status: 'resolved',
              reference,
              displayItem,
              item,
              primaryDrift: false,
            }
          : {
              status: 'unresolved',
              reference,
              reason: 'itemNotFound',
              displayItem,
            };
      }
      return {
        status: 'resolved',
        reference,
        displayItem,
        primaryDrift:
          options.kind === 'primaryProduct' &&
          displayItem.isPrimaryVariant === false,
      };
    });
  }

  private async queryDisplayItems(options: {
    query?: string;
    ids?: number[];
    searchInFields?: string[];
    onlyPrimaryVariant: boolean;
    page?: number;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<CentraSearchResult> {
    const page = normalizedPage(options.page);
    const limit = normalizedLimit(options.limit);
    const query = options.query?.trim();
    const where: Record<string, unknown> = {
      onlyPrimaryVariant: options.onlyPrimaryVariant,
    };
    if (query) {
      where.search = query;
    }
    if (options.ids && options.ids.length > 0) {
      where.id = options.ids;
    }
    if (options.searchInFields && options.searchInFields.length > 0) {
      where.searchInFields = options.searchInFields;
    }

    const data = await this.request<unknown>(
      DISPLAY_ITEMS_QUERY,
      {
        where,
        page,
        limit,
      },
      options.signal,
    );
    if (!isRecord(data) || !isRecord(data.displayItems)) {
      throw new CentraClientError(
        'invalid-response',
        'Centra returned an invalid product search response.',
      );
    }
    const rawList = data.displayItems as RawDisplayItemList;
    const userErrors = normalizeUserErrors(rawList.userErrors);
    if (userErrors.length > 0) {
      throw new CentraClientError(
        'graphql',
        redactCredentials(
          userErrors.map(({ message }) => message).join('; '),
          this.connection.token,
        ),
      );
    }
    const list = rawList.list === null ? [] : rawList.list;
    if (!Array.isArray(list)) {
      throw new CentraClientError(
        'invalid-response',
        'Centra returned an invalid product list.',
      );
    }
    const items = list
      .map(normalizeDisplayItem)
      .filter((item): item is CentraDisplayItem => item !== null);
    const pagination = normalizePagination(rawList.pagination);
    const hasMore = pagination?.hasNextPage ?? items.length === limit;
    const nextPage = pagination?.nextPage ?? (hasMore ? page + 1 : undefined);

    return {
      items,
      page: pagination?.currentPage ?? page,
      hasMore,
      nextPage: nextPage ?? undefined,
      totalCount: pagination?.total,
    };
  }

  private request<T>(
    query: string,
    variables: GraphqlVariables,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    const validation = validateConnection(this.connection);
    if (!validation.valid) {
      throw new CentraClientError(
        'configuration',
        Object.values(validation.errors).join(' '),
      );
    }

    const key = `${query}\n${stableSerialize(variables)}`;
    let entry = this.inFlight.get(key);
    if (entry?.controller.signal.aborted) {
      this.inFlight.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const controller = new AbortController();
      const promise = this.executeRequest<T>(query, variables, controller.signal);
      entry = { promise, controller, consumers: 0 };
      this.inFlight.set(key, entry);
      void promise
        .finally(() => {
          if (this.inFlight.get(key) === entry) {
            this.inFlight.delete(key);
          }
        })
        .catch(() => undefined);
    }

    return this.subscribeToRequest<T>(entry, signal);
  }

  private subscribeToRequest<T>(
    entry: InFlightRequest,
    signal?: AbortSignal,
  ): Promise<T> {
    entry.consumers += 1;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const release = (aborted: boolean) => {
        if (finished) {
          return false;
        }
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        entry.consumers -= 1;
        if (aborted && entry.consumers === 0) {
          entry.controller.abort();
        }
        return true;
      };
      const onAbort = () => {
        if (release(true)) {
          reject(createAbortError());
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      entry.promise.then(
        (value) => {
          if (release(false)) {
            resolve(value as T);
          }
        },
        (error: unknown) => {
          if (release(false)) {
            reject(error);
          }
        },
      );
    });
  }

  private async executeRequest<T>(
    query: string,
    variables: GraphqlVariables,
    signal: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(
        toDatoCorsProxyUrl(this.connection.endpoint),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.connection.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, variables }),
          signal,
        },
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new CentraClientError(
        'network',
        `Could not reach Centra: ${safeErrorMessage(error, this.connection.token)}`,
        { cause: error },
      );
    }

    const text = await response.text();
    if (!response.ok) {
      const detail = responseSnippet(text, this.connection.token);
      throw new CentraClientError(
        'http',
        `Centra returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`,
        { status: response.status },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new CentraClientError(
        'invalid-response',
        'Centra returned a response that was not valid JSON.',
        { cause: error },
      );
    }
    if (!isRecord(body)) {
      throw new CentraClientError(
        'invalid-response',
        'Centra returned an invalid GraphQL response.',
      );
    }
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      const messages = body.errors.map((error) =>
        isRecord(error) && typeof error.message === 'string'
          ? error.message
          : 'Unknown GraphQL error',
      );
      throw new CentraClientError(
        'graphql',
        redactCredentials(messages.join('; '), this.connection.token),
      );
    }
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is unavailable with the ES2020 target.
    if (!Object.prototype.hasOwnProperty.call(body, 'data')) {
      throw new CentraClientError(
        'invalid-response',
        'Centra returned a GraphQL response without data.',
      );
    }

    return body.data as T;
  }
}
