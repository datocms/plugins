import type { RawItem, RawItemType } from '../types';
import {
  getFieldValue,
  getPresentationImageField,
  getPresentationTitleField,
  linkedItemIdFromValue,
  type RawField,
} from './fields';
import { formatFieldTitle, isLatLonValue, isRgbaColor } from './formatters';
import {
  buildUploadThumbnail,
  directPresentationImage,
  generateCalendarPreview,
  generateColorPreview,
  generateMapPreview,
  type PresentationImage,
  parseUploadFieldValue,
  type RawUpload,
} from './previews';
import {
  getItemStatus,
  getItemValidity,
  ITEM_STATUS_LABEL,
  type ItemStatus,
  type ItemValidity,
} from './status';

type Entity = { id: string };

export const PRESENTATION_CACHE_LIMITS = {
  items: 500,
  uploads: 250,
  fieldModels: 100,
} as const;

const HYDRATION_BATCH_SIZE = 100;
const HYDRATION_CONCURRENCY = 2;
const PRESENTATION_CONCURRENCY = 25;

type ResolutionOptions = { signal?: AbortSignal };

export type PresentationLoaders = {
  loadItemTypes?: (ids: readonly string[]) => Promise<readonly RawItemType[]>;
  loadFields?: (itemTypeIds: readonly string[]) => Promise<readonly RawField[]>;
  loadItems?: (ids: readonly string[]) => Promise<readonly RawItem[]>;
  loadUploads?: (ids: readonly string[]) => Promise<readonly RawUpload[]>;
};

export type PresentationResolverOptions = PresentationLoaders & {
  itemTypes?: readonly RawItemType[];
  fields?: readonly RawField[];
  items?: readonly RawItem[];
  uploads?: readonly RawUpload[];
  locales: readonly string[];
  preferredLocale?: string;
  timeZone?: string;
  imgixHost?: string;
  googleMapsApiToken?: string;
  maxTitleLength?: number;
};

export type ItemPresentation = {
  title: string;
  image: PresentationImage | null;
  status: ItemStatus | null;
  statusLabel: string | null;
  validity: ItemValidity;
  itemType: RawItemType | null;
};

type Subscribers = {
  signals: Set<AbortSignal>;
  unscoped: boolean;
};

type PendingEntity<T> = Subscribers & {
  promise: Promise<T | null>;
  resolve: (value: T | null) => void;
  reject: (reason: unknown) => void;
};

function createSubscribers(signal?: AbortSignal): Subscribers {
  return {
    signals: new Set(signal ? [signal] : []),
    unscoped: !signal,
  };
}

function addSubscriber(subscribers: Subscribers, signal?: AbortSignal): void {
  if (signal) subscribers.signals.add(signal);
  else subscribers.unscoped = true;
}

function hasActiveSubscribers(subscribers: Subscribers): boolean {
  return (
    subscribers.unscoped ||
    [...subscribers.signals].some((signal) => !signal.aborted)
  );
}

function createLruCache<T>(limit: number) {
  const entries = new Map<string, T>();

  function get(id: string): T | undefined {
    const value = entries.get(id);
    if (value !== undefined) {
      entries.delete(id);
      entries.set(id, value);
    }
    return value;
  }

  function set(id: string, value: T): void {
    entries.delete(id);
    entries.set(id, value);
    if (entries.size > limit) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
  }

  return { get, set };
}

function createLoadScheduler() {
  const queue: (() => Promise<void>)[] = [];
  let active = 0;

  function drain(): void {
    while (active < HYDRATION_CONCURRENCY && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      active += 1;
      void next().finally(() => {
        active -= 1;
        drain();
      });
    }
  }

  return function schedule<T>(load: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await load());
        } catch (error) {
          reject(error);
        }
      });
      drain();
    });
  };
}

type LoadScheduler = ReturnType<typeof createLoadScheduler>;

function createBatchedEntityCache<T extends Entity>(
  initial: readonly T[],
  loadMany?: (ids: readonly string[]) => Promise<readonly T[]>,
  limit = Number.POSITIVE_INFINITY,
  scheduleLoad: LoadScheduler = createLoadScheduler(),
) {
  const cache = createLruCache<T | null>(limit);
  const pendingIds = new Set<string>();
  const pending = new Map<string, PendingEntity<T>>();
  let scheduled = false;

  function resolvePending(
    id: string,
    request: PendingEntity<T>,
    entity: T | null,
  ): void {
    if (pending.get(id) !== request) return;
    cache.set(id, entity);
    pending.delete(id);
    request.resolve(entity);
  }

  function rejectPending(
    id: string,
    request: PendingEntity<T>,
    error: unknown,
  ): void {
    if (pending.get(id) !== request) return;
    pending.delete(id);
    request.reject(error);
  }

  function activeBatchIds(
    batch: readonly (readonly [string, PendingEntity<T>])[],
  ): string[] {
    const ids: string[] = [];
    for (const [id, request] of batch) {
      if (pending.get(id) !== request) continue;
      if (hasActiveSubscribers(request)) ids.push(id);
      else rejectPending(id, request, cancellationError());
    }
    return ids;
  }

  async function loadBatch(
    batch: readonly (readonly [string, PendingEntity<T>])[],
  ): Promise<void> {
    try {
      const loaded = await scheduleLoad(() => {
        const ids = activeBatchIds(batch);
        return loadMany && ids.length > 0 ? loadMany(ids) : Promise.resolve([]);
      });
      const byId = new Map(loaded.map((entity) => [entity.id, entity]));
      for (const [id, request] of batch) {
        resolvePending(id, request, byId.get(id) ?? null);
      }
    } catch (error) {
      for (const [id, request] of batch) {
        rejectPending(id, request, error);
      }
    }
  }

  function flush(): void {
    scheduled = false;
    const requests: [string, PendingEntity<T>][] = [];
    for (const id of pendingIds) {
      const request = pending.get(id);
      if (request) requests.push([id, request]);
    }
    pendingIds.clear();
    for (
      let index = 0;
      index < requests.length;
      index += HYDRATION_BATCH_SIZE
    ) {
      void loadBatch(requests.slice(index, index + HYDRATION_BATCH_SIZE));
    }
  }

  function get(id: string, signal?: AbortSignal): Promise<T | null> {
    const cached = cache.get(id);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = pending.get(id);
    if (existing) {
      addSubscriber(existing, signal);
      return existing.promise;
    }

    let resolveRequest: PendingEntity<T>['resolve'] = () => undefined;
    let rejectRequest: PendingEntity<T>['reject'] = () => undefined;
    const promise = new Promise<T | null>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    pending.set(id, {
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
      ...createSubscribers(signal),
    });
    pendingIds.add(id);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
    return promise;
  }

  function prime(entities: readonly T[]): void {
    for (const entity of entities) {
      cache.set(entity.id, entity);
      const request = pending.get(entity.id);
      if (request) {
        pending.delete(entity.id);
        pendingIds.delete(entity.id);
        request.resolve(entity);
      }
    }
  }

  prime(initial);
  return { get, prime };
}

function createBatchedFieldsCache(
  initial: readonly RawField[],
  loadMany?: (itemTypeIds: readonly string[]) => Promise<readonly RawField[]>,
  scheduleLoad: LoadScheduler = createLoadScheduler(),
) {
  const cache = createLruCache<readonly RawField[]>(
    loadMany ? PRESENTATION_CACHE_LIMITS.fieldModels : Number.POSITIVE_INFINITY,
  );
  const pending = new Map<
    string,
    Subscribers & { promise: Promise<readonly RawField[]> }
  >();

  function prime(fields: readonly RawField[]): void {
    const grouped = new Map<string, RawField[]>();
    for (const field of fields) {
      const itemTypeId = field.relationships.item_type.data.id;
      const modelFields = grouped.get(itemTypeId) ?? [];
      modelFields.push(field);
      grouped.set(itemTypeId, modelFields);
    }
    for (const [itemTypeId, modelFields] of grouped) {
      cache.set(itemTypeId, modelFields);
    }
  }

  prime(initial);

  async function get(
    itemTypeId: string,
    signal?: AbortSignal,
  ): Promise<readonly RawField[]> {
    const cached = cache.get(itemTypeId);
    if (cached) {
      return cached;
    }

    const existing = pending.get(itemTypeId);
    if (existing) {
      addSubscriber(existing, signal);
      return existing.promise;
    }

    const subscribers = createSubscribers(signal);
    const request = scheduleLoad(async () => {
      if (!hasActiveSubscribers(subscribers)) throw cancellationError();
      const fields = loadMany ? await loadMany([itemTypeId]) : [];
      prime(fields);
      const result = cache.get(itemTypeId) ?? [];
      cache.set(itemTypeId, result);
      return result;
    });

    pending.set(itemTypeId, Object.assign(subscribers, { promise: request }));
    try {
      return await request;
    } finally {
      pending.delete(itemTypeId);
    }
  }

  return { get, prime };
}

function itemTypeId(item: RawItem): string {
  return item.relationships.item_type.data.id;
}

function cancellationError(): DOMException {
  return new DOMException('Presentation resolution cancelled', 'AbortError');
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError();
}

async function fallbackOnError<T>(
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export function createPresentationResolver(
  options: PresentationResolverOptions,
) {
  const scheduleLoad = createLoadScheduler();
  const itemTypes = createBatchedEntityCache(
    options.itemTypes ?? [],
    options.loadItemTypes,
    Number.POSITIVE_INFINITY,
    scheduleLoad,
  );
  const fields = createBatchedFieldsCache(
    options.fields ?? [],
    options.loadFields,
    scheduleLoad,
  );
  const items = createBatchedEntityCache(
    options.items ?? [],
    options.loadItems,
    PRESENTATION_CACHE_LIMITS.items,
    scheduleLoad,
  );
  const uploads = createBatchedEntityCache(
    options.uploads ?? [],
    options.loadUploads,
    PRESENTATION_CACHE_LIMITS.uploads,
    scheduleLoad,
  );

  async function resolveTitle(
    item: RawItem,
    depth: number,
    seen: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<string | null> {
    assertActive(signal);
    const modelId = itemTypeId(item);
    const [itemType, modelFields] = await Promise.all([
      itemTypes.get(modelId, signal),
      fields.get(modelId, signal),
    ]);
    assertActive(signal);
    if (!itemType) {
      return null;
    }

    const field = getPresentationTitleField(itemType, modelFields);
    if (!field) {
      return null;
    }

    const value = getFieldValue(
      item,
      field,
      options.locales,
      options.preferredLocale,
    );

    if (
      field.attributes.field_type === 'link' ||
      field.attributes.field_type === 'single_block'
    ) {
      const linkedId = linkedItemIdFromValue(value);
      if (!linkedId || depth >= 3 || seen.has(linkedId)) {
        return null;
      }

      const linkedItem = await items.get(linkedId, signal);
      assertActive(signal);
      return linkedItem
        ? resolveTitle(
            linkedItem,
            depth + 1,
            new Set([...seen, linkedId]),
            signal,
          )
        : null;
    }

    return formatFieldTitle(value, field, {
      maxLength: options.maxTitleLength,
      locales: options.locales,
      timeZone: options.timeZone,
    });
  }

  async function resolveLinkedImage(
    value: unknown,
    depth: number,
    seen: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<PresentationImage | null> {
    const linkedId = linkedItemIdFromValue(value);
    if (!linkedId || depth >= 3 || seen.has(linkedId)) {
      return null;
    }

    const linkedItem = await items.get(linkedId, signal);
    assertActive(signal);
    return linkedItem
      ? resolveImage(
          linkedItem,
          depth + 1,
          new Set([...seen, linkedId]),
          signal,
        )
      : null;
  }

  function colorImage(value: unknown): PresentationImage | null {
    return isRgbaColor(value)
      ? directPresentationImage(generateColorPreview(value))
      : null;
  }

  function calendarImage(
    value: unknown,
    dateOnly: boolean,
  ): PresentationImage | null {
    if (typeof value !== 'string') return null;
    const url = generateCalendarPreview(value, {
      dateOnly,
      locale: options.locales[0],
      timeZone: options.timeZone,
    });
    return url ? directPresentationImage(url) : null;
  }

  function mapImage(value: unknown): PresentationImage | null {
    if (!isLatLonValue(value)) return null;
    const url = generateMapPreview(value, options.googleMapsApiToken);
    return url ? directPresentationImage(url) : null;
  }

  const generatedImageBuilders: Partial<
    Record<
      RawField['attributes']['field_type'],
      (value: unknown) => PresentationImage | null
    >
  > = {
    color: colorImage,
    date: (value) => calendarImage(value, true),
    date_time: (value) => calendarImage(value, false),
    lat_lon: mapImage,
  };

  function generatedImage(
    fieldType: RawField['attributes']['field_type'],
    value: unknown,
  ): PresentationImage | null | undefined {
    return generatedImageBuilders[fieldType]?.(value);
  }

  async function resolveUploadImage(
    value: unknown,
    signal?: AbortSignal,
  ): Promise<PresentationImage | null> {
    const uploadValue = parseUploadFieldValue(value);
    if (!uploadValue) return null;
    if (uploadValue.thumbnailUrl) {
      return directPresentationImage(uploadValue.thumbnailUrl);
    }
    if (!uploadValue.uploadId) return null;

    const upload = await uploads.get(uploadValue.uploadId, signal);
    assertActive(signal);
    return upload
      ? buildUploadThumbnail(upload, {
          locales: options.locales,
          preferredLocale: options.preferredLocale,
          imgixHost: options.imgixHost,
          focalPoint: uploadValue.focalPoint,
          posterTime: uploadValue.posterTime,
        })
      : null;
  }

  async function resolveImage(
    item: RawItem,
    depth: number,
    seen: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<PresentationImage | null> {
    assertActive(signal);
    const modelId = itemTypeId(item);
    const [itemType, modelFields] = await Promise.all([
      itemTypes.get(modelId, signal),
      fields.get(modelId, signal),
    ]);
    assertActive(signal);
    if (!itemType) {
      return null;
    }

    const field = getPresentationImageField(itemType, modelFields);
    if (!field) {
      return null;
    }

    const value = getFieldValue(
      item,
      field,
      options.locales,
      options.preferredLocale,
    );
    const fieldType = field.attributes.field_type;

    if (fieldType === 'link' || fieldType === 'single_block') {
      return resolveLinkedImage(value, depth, seen, signal);
    }

    const generated = generatedImage(fieldType, value);
    return generated === undefined
      ? resolveUploadImage(value, signal)
      : generated;
  }

  async function resolve(
    item: RawItem,
    { signal }: ResolutionOptions = {},
  ): Promise<ItemPresentation> {
    assertActive(signal);
    const modelId = itemTypeId(item);
    const itemType = await fallbackOnError(
      itemTypes.get(modelId, signal),
      null,
    );
    assertActive(signal);
    const [title, image] = await Promise.all([
      fallbackOnError(resolveTitle(item, 0, new Set([item.id]), signal), null),
      fallbackOnError(resolveImage(item, 0, new Set([item.id]), signal), null),
    ]);
    assertActive(signal);
    const status = itemType?.attributes.draft_mode_active
      ? getItemStatus(item)
      : null;

    return {
      title: title || `Record #${item.id}`,
      image,
      status,
      statusLabel: status ? ITEM_STATUS_LABEL[status] : null,
      validity: getItemValidity(
        item,
        itemType?.attributes.draft_mode_active ?? false,
      ),
      itemType,
    };
  }

  async function resolveMany(
    records: readonly RawItem[],
    { signal }: ResolutionOptions = {},
  ): Promise<ItemPresentation[]> {
    const result: ItemPresentation[] = new Array(records.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (nextIndex < records.length) {
        assertActive(signal);
        const index = nextIndex;
        nextIndex += 1;
        // biome-ignore lint/performance/noAwaitInLoops: Each worker is intentionally sequential to bound hydration and queued work.
        result[index] = await resolve(records[index], { signal });
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(PRESENTATION_CONCURRENCY, records.length) },
        worker,
      ),
    );
    assertActive(signal);
    return result;
  }

  return {
    resolve,
    resolveMany,
    primeItemTypes: itemTypes.prime,
    primeFields: fields.prime,
    primeItems: items.prime,
    primeUploads: uploads.prime,
  };
}

export type PresentationResolver = ReturnType<
  typeof createPresentationResolver
>;
