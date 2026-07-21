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

type Waiter<T> = {
  resolve: (value: T | null) => void;
  reject: (reason: unknown) => void;
};

function createBatchedEntityCache<T extends Entity>(
  initial: readonly T[],
  loadMany?: (ids: readonly string[]) => Promise<readonly T[]>,
) {
  const cache = new Map<string, T | null>(
    initial.map((entity) => [entity.id, entity]),
  );
  const pendingIds = new Set<string>();
  const waiters = new Map<string, Waiter<T>[]>();
  let scheduled = false;

  function resolveWaiters(id: string, entity: T | null): void {
    cache.set(id, entity);
    const entityWaiters = waiters.get(id) ?? [];
    waiters.delete(id);
    for (const waiter of entityWaiters) {
      waiter.resolve(entity);
    }
  }

  function rejectWaiters(ids: readonly string[], error: unknown): void {
    for (const id of ids) {
      const entityWaiters = waiters.get(id) ?? [];
      waiters.delete(id);
      for (const waiter of entityWaiters) {
        waiter.reject(error);
      }
    }
  }

  async function flush(): Promise<void> {
    scheduled = false;
    const ids = [...pendingIds];
    pendingIds.clear();

    try {
      const loaded = loadMany ? await loadMany(ids) : [];
      const byId = new Map(loaded.map((entity) => [entity.id, entity]));

      for (const id of ids) {
        resolveWaiters(id, byId.get(id) ?? null);
      }
    } catch (error) {
      rejectWaiters(ids, error);
    }
  }

  function get(id: string): Promise<T | null> {
    if (cache.has(id)) {
      return Promise.resolve(cache.get(id) ?? null);
    }

    return new Promise<T | null>((resolve, reject) => {
      waiters.set(id, [...(waiters.get(id) ?? []), { resolve, reject }]);
      pendingIds.add(id);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          void flush();
        });
      }
    });
  }

  function prime(entities: readonly T[]): void {
    for (const entity of entities) {
      cache.set(entity.id, entity);
    }
  }

  return { get, prime };
}

function createBatchedFieldsCache(
  initial: readonly RawField[],
  loadMany?: (itemTypeIds: readonly string[]) => Promise<readonly RawField[]>,
) {
  const cache = new Map<string, readonly RawField[]>();
  const pending = new Map<string, Promise<readonly RawField[]>>();

  function prime(fields: readonly RawField[]): void {
    const grouped = new Map<string, RawField[]>();
    for (const field of fields) {
      const itemTypeId = field.relationships.item_type.data.id;
      grouped.set(itemTypeId, [...(grouped.get(itemTypeId) ?? []), field]);
    }
    for (const [itemTypeId, modelFields] of grouped) {
      cache.set(itemTypeId, modelFields);
    }
  }

  prime(initial);

  async function get(itemTypeId: string): Promise<readonly RawField[]> {
    const cached = cache.get(itemTypeId);
    if (cached) {
      return cached;
    }

    const existing = pending.get(itemTypeId);
    if (existing) {
      return existing;
    }

    const request = (async () => {
      const fields = loadMany ? await loadMany([itemTypeId]) : [];
      prime(fields);
      const result = cache.get(itemTypeId) ?? [];
      cache.set(itemTypeId, result);
      return result;
    })();

    pending.set(itemTypeId, request);
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
  const itemTypes = createBatchedEntityCache(
    options.itemTypes ?? [],
    options.loadItemTypes,
  );
  const fields = createBatchedFieldsCache(
    options.fields ?? [],
    options.loadFields,
  );
  const items = createBatchedEntityCache(
    options.items ?? [],
    options.loadItems,
  );
  const uploads = createBatchedEntityCache(
    options.uploads ?? [],
    options.loadUploads,
  );

  async function resolveTitle(
    item: RawItem,
    depth: number,
    seen: ReadonlySet<string>,
  ): Promise<string | null> {
    const modelId = itemTypeId(item);
    const [itemType, modelFields] = await Promise.all([
      itemTypes.get(modelId),
      fields.get(modelId),
    ]);
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

      const linkedItem = await items.get(linkedId);
      return linkedItem
        ? resolveTitle(linkedItem, depth + 1, new Set([...seen, linkedId]))
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
  ): Promise<PresentationImage | null> {
    const linkedId = linkedItemIdFromValue(value);
    if (!linkedId || depth >= 3 || seen.has(linkedId)) {
      return null;
    }

    const linkedItem = await items.get(linkedId);
    return linkedItem
      ? resolveImage(linkedItem, depth + 1, new Set([...seen, linkedId]))
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
  ): Promise<PresentationImage | null> {
    const uploadValue = parseUploadFieldValue(value);
    if (!uploadValue) return null;
    if (uploadValue.thumbnailUrl) {
      return directPresentationImage(uploadValue.thumbnailUrl);
    }
    if (!uploadValue.uploadId) return null;

    const upload = await uploads.get(uploadValue.uploadId);
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
  ): Promise<PresentationImage | null> {
    const modelId = itemTypeId(item);
    const [itemType, modelFields] = await Promise.all([
      itemTypes.get(modelId),
      fields.get(modelId),
    ]);
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
      return resolveLinkedImage(value, depth, seen);
    }

    const generated = generatedImage(fieldType, value);
    return generated === undefined ? resolveUploadImage(value) : generated;
  }

  async function resolve(item: RawItem): Promise<ItemPresentation> {
    const modelId = itemTypeId(item);
    const itemType = await fallbackOnError(itemTypes.get(modelId), null);
    const [title, image] = await Promise.all([
      fallbackOnError(resolveTitle(item, 0, new Set([item.id])), null),
      fallbackOnError(resolveImage(item, 0, new Set([item.id])), null),
    ]);
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
  ): Promise<ItemPresentation[]> {
    return Promise.all(records.map(resolve));
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
