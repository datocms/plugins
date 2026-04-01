import { SchemaRepository } from '@datocms/cma-client';
import type { Client } from '@datocms/cma-client-browser';
import { logError } from '@/utils/errorLogger';
import { extractLocalizedValue } from './fieldLoader';

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

/** singleton -> presentation_title_field -> title_field -> localized value -> fallback */
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

  const localizedValue = extractLocalizedValue(fieldValue, mainLocale);
  if (localizedValue !== fieldValue && localizedValue) {
    return String(localizedValue);
  }

  // Localized object but locale not found
  if (typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
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

// Cache titles to avoid refetching on every poll interval
const titleCache = new Map<string, RecordTitleInfo>();
const TITLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let titleCacheTimestamp = 0;

function getCachedTitle(recordId: string): RecordTitleInfo | undefined {
  // Invalidate cache if expired
  if (Date.now() - titleCacheTimestamp > TITLE_CACHE_TTL_MS) {
    titleCache.clear();
    return undefined;
  }
  return titleCache.get(recordId);
}

function setCachedTitle(recordId: string, info: RecordTitleInfo) {
  if (titleCache.size === 0) {
    titleCacheTimestamp = Date.now();
  }
  titleCache.set(recordId, info);
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
        type: modelId,
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
      setCachedTitle(recordId, info);
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
): Promise<void> {
  try {
    const itemType = await schemaRepo.getItemTypeById(modelId);
    const modelName = itemType.name;
    const isSingleton = itemType.singleton ?? false;

    if (isSingleton) {
      for (const recordId of recordIds) {
        const info = { title: modelName, modelName, isSingleton };
        results.set(recordId, info);
        setCachedTitle(recordId, info);
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

    const batches: string[][] = [];
    for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
      batches.push(recordIds.slice(i, i + BATCH_SIZE));
    }

    await Promise.all(
      batches.map((batchIds) =>
        fetchBatchRecordTitles(
          client,
          modelId,
          batchIds,
          modelName,
          isSingleton,
          titleFieldConfig,
          normalizedFields,
          mainLocale,
          results,
        ),
      ),
    );
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

/** Batch fetch: groups by model, uses caching, 100 records/call, parallel model processing. */
export async function getRecordTitles(
  client: Client,
  records: Array<{ recordId: string; modelId: string }>,
  mainLocale: string,
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
    const cached = getCachedTitle(recordId);
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

  const modelPromises = Array.from(recordsByModel.entries()).map(
    ([modelId, recordIds]) =>
      fetchTitlesForModel(
        client,
        schemaRepo,
        modelId,
        recordIds,
        mainLocale,
        results,
      ),
  );

  await Promise.all(modelPromises);

  return results;
}
