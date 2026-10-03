import { SchemaRepository } from '@datocms/cma-client';
import type { Client } from '@datocms/cma-client-browser';
import { logError } from '@/utils/errorLogger';

type RecordTitleInfo = {
  title: string;
  modelName: string;
  isSingleton: boolean;
};

export type TitleFieldConfig = {
  presentationTitleFieldId: string | null;
  titleFieldId: string | null;
};

export type NormalizedField = {
  id: string;
  apiKey: string;
};

function getFallbackTitle(recordId: string) {
  return `Record #${recordId}`;
}

/** singleton -> presentation/title field -> preferred/populated locale -> fallback */
export function extractTitleFromRecordData(
  recordId: string,
  recordData: Record<string, unknown>,
  titleFieldConfig: TitleFieldConfig,
  fields: NormalizedField[],
  modelName: string,
  mainLocale: string,
  isSingleton: boolean,
): string {
  const fallbackTitle = getFallbackTitle(recordId);

  if (isSingleton) {
    return modelName;
  }

  const selectedTitleFieldId =
    titleFieldConfig.presentationTitleFieldId ?? titleFieldConfig.titleFieldId;

  if (!selectedTitleFieldId) {
    return fallbackTitle;
  }

  const titleField = fields.find((f) => f.id === selectedTitleFieldId);
  if (!titleField) {
    return fallbackTitle;
  }

  const fieldValue = recordData[titleField.apiKey];

  if (fieldValue === null || fieldValue === undefined) {
    return fallbackTitle;
  }

  if (typeof fieldValue === 'object') {
    if (Array.isArray(fieldValue)) return fallbackTitle;
    const localizedValues = fieldValue as Record<string, unknown>;
    for (const value of [
      localizedValues[mainLocale],
      ...Object.values(localizedValues),
    ]) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return fallbackTitle;
  }

  if (typeof fieldValue === 'string' && fieldValue.trim().length === 0) {
    return fallbackTitle;
  }

  return String(fieldValue);
}

// Type assertion needed due to version mismatch between cma-client-browser and cma-client
const schemaRepoCache = new WeakMap<Client, SchemaRepository>();

function getSchemaRepository(client: Client): SchemaRepository {
  let repo = schemaRepoCache.get(client);
  if (!repo) {
    repo = new SchemaRepository(
      client as ConstructorParameters<typeof SchemaRepository>[0],
    );
    schemaRepoCache.set(client, repo);
  }
  return repo;
}

// A client identifies the API token, project and environment. Do not share titles
// between clients or locales, and keep long-lived sidebar sessions bounded.
const titleCaches = new WeakMap<
  Client,
  Map<string, { info: RecordTitleInfo; expiresAt: number }>
>();
const TITLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TITLE_CACHE_LIMIT = 2000;

function getTitleCache(client: Client) {
  let cache = titleCaches.get(client);
  if (!cache) {
    cache = new Map();
    titleCaches.set(client, cache);
  }
  return cache;
}

function titleCacheKey(recordId: string, modelId: string, locale: string) {
  return JSON.stringify([recordId, modelId, locale]);
}

function getCachedTitle(
  client: Client,
  recordId: string,
  modelId: string,
  locale: string,
): RecordTitleInfo | undefined {
  const cache = getTitleCache(client);
  const key = titleCacheKey(recordId, modelId, locale);
  const cached = cache.get(key);
  if (!cached) return undefined;
  cache.delete(key);
  if (Date.now() >= cached.expiresAt) {
    return undefined;
  }
  cache.set(key, cached);
  return cached.info;
}

function setCachedTitle(
  client: Client,
  recordId: string,
  modelId: string,
  locale: string,
  info: RecordTitleInfo,
) {
  const cache = getTitleCache(client);
  const key = titleCacheKey(recordId, modelId, locale);
  cache.delete(key);
  cache.set(key, { info, expiresAt: Date.now() + TITLE_CACHE_TTL_MS });
  while (cache.size > TITLE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

const BATCH_SIZE = 100;

async function fetchBatchRecordTitles(
  client: Client,
  modelId: string,
  batchIds: string[],
  modelName: string,
  isSingleton: boolean,
  titleFieldConfig: TitleFieldConfig,
  normalizedFields: NormalizedField[],
  mainLocale: string,
  results: Map<string, RecordTitleInfo>,
): Promise<void> {
  try {
    const batchRecords = await client.items.list({
      filter: {
        ids: batchIds.join(','),
      },
      page: { limit: BATCH_SIZE },
    });

    const recordMap = new Map(batchRecords.map((r) => [r.id, r]));

    for (const recordId of batchIds) {
      const record = recordMap.get(recordId);

      if (!record) {
        results.set(recordId, {
          title: getFallbackTitle(recordId),
          modelName,
          isSingleton: false,
        });
        continue;
      }

      const title = extractTitleFromRecordData(
        recordId,
        record as Record<string, unknown>,
        titleFieldConfig,
        normalizedFields,
        modelName,
        mainLocale,
        isSingleton,
      );

      const info = { title, modelName, isSingleton };
      results.set(recordId, info);
      setCachedTitle(client, recordId, modelId, mainLocale, info);
    }
  } catch (batchError) {
    logError('Failed to batch fetch records:', batchError, {
      modelId,
      batchIds,
    });
    for (const recordId of batchIds) {
      results.set(recordId, {
        title: getFallbackTitle(recordId),
        modelName,
        isSingleton: false,
      });
    }
  }
}

async function fetchTitlesForModel(
  client: Client,
  schemaRepo: SchemaRepository,
  modelId: string,
  recordIds: string[],
  mainLocale: string,
  results: Map<string, RecordTitleInfo>,
  shouldContinue: () => boolean,
): Promise<void> {
  try {
    if (!shouldContinue()) return;
    const itemType = await schemaRepo.getItemTypeById(modelId);
    const modelName = itemType.name;
    const isSingleton = itemType.singleton ?? false;

    if (isSingleton) {
      for (const recordId of recordIds) {
        const info = { title: modelName, modelName, isSingleton };
        results.set(recordId, info);
        setCachedTitle(client, recordId, modelId, mainLocale, info);
      }
      return;
    }

    const fields = await schemaRepo.getItemTypeFields(itemType);
    const normalizedFields: NormalizedField[] = fields.map((f) => ({
      id: f.id,
      apiKey: f.api_key,
    }));

    const titleFieldConfig: TitleFieldConfig = {
      presentationTitleFieldId: itemType.presentation_title_field?.id ?? null,
      titleFieldId: itemType.title_field?.id ?? null,
    };

    for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
      if (!shouldContinue()) return;
      // biome-ignore lint/performance/noAwaitInLoops: Sequential batches bound the requests made by each model worker.
      await fetchBatchRecordTitles(
        client,
        modelId,
        recordIds.slice(i, i + BATCH_SIZE),
        modelName,
        isSingleton,
        titleFieldConfig,
        normalizedFields,
        mainLocale,
        results,
      );
    }
  } catch (error) {
    logError('Failed to process model for titles:', error, { modelId });
    for (const recordId of recordIds) {
      results.set(recordId, {
        title: getFallbackTitle(recordId),
        modelName: 'Unknown',
        isSingleton: false,
      });
    }
  }
}

/** Resolves referenced IDs only, with bounded batches and model concurrency. */
export async function getRecordTitles(
  client: Client,
  records: Array<{ recordId: string; modelId: string }>,
  mainLocale: string,
  shouldContinue: () => boolean = () => true,
): Promise<Map<string, RecordTitleInfo>> {
  const results = new Map<string, RecordTitleInfo>();

  const uniqueRecords = new Map<
    string,
    { recordId: string; modelId: string }
  >();
  for (const record of records) {
    uniqueRecords.set(record.recordId, record);
  }

  // Check cache first - only fetch records we don't have cached
  const uncachedRecords: Array<{ recordId: string; modelId: string }> = [];
  for (const { recordId, modelId } of uniqueRecords.values()) {
    const cached = getCachedTitle(client, recordId, modelId, mainLocale);
    if (cached) {
      results.set(recordId, cached);
    } else {
      uncachedRecords.push({ recordId, modelId });
    }
  }

  // If everything is cached, return early
  if (uncachedRecords.length === 0) {
    return results;
  }

  const recordsByModel = new Map<string, string[]>();
  for (const { recordId, modelId } of uncachedRecords) {
    const existing = recordsByModel.get(modelId) ?? [];
    existing.push(recordId);
    recordsByModel.set(modelId, existing);
  }

  const schemaRepo = getSchemaRepository(client);

  const models = recordsByModel.entries();
  const resolveModels = async () => {
    while (shouldContinue()) {
      const next = models.next();
      if (next.done) return;
      const [modelId, recordIds] = next.value;
      // biome-ignore lint/performance/noAwaitInLoops: Each of four workers processes one model at a time.
      await fetchTitlesForModel(
        client,
        schemaRepo,
        modelId,
        recordIds,
        mainLocale,
        results,
        shouldContinue,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(4, recordsByModel.size) }, resolveModels),
  );

  return results;
}
