import type { Client } from '@datocms/cma-client-browser';
import { SchemaRepository } from '@datocms/cma-client';
import { logError } from '@/utils/errorLogger';
import { extractLocalizedValue } from './fieldLoader';

export type RecordTitleInfo = {
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

/** singleton -> presentation_title_field -> title_field -> localized value -> fallback */
export function extractTitleFromRecordData(
  recordId: string,
  recordData: Record<string, unknown>,
  titleFieldConfig: TitleFieldConfig,
  fields: NormalizedField[],
  modelName: string,
  mainLocale: string,
  isSingleton: boolean
): string {
  const fallbackTitle = `Record #${recordId}`;

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
let schemaRepoCache = new WeakMap<Client, SchemaRepository>();

function getSchemaRepository(client: Client): SchemaRepository {
  let repo = schemaRepoCache.get(client);
  if (!repo) {
    repo = new SchemaRepository(client as ConstructorParameters<typeof SchemaRepository>[0]);
    schemaRepoCache.set(client, repo);
  }
  return repo;
}

/** Batch fetch: groups by model, uses caching, 100 records/call, parallel model processing. */
export async function getRecordTitles(
  client: Client,
  records: Array<{ recordId: string; modelId: string }>,
  mainLocale: string
): Promise<Map<string, RecordTitleInfo>> {
  const results = new Map<string, RecordTitleInfo>();

  const uniqueRecords = new Map<string, { recordId: string; modelId: string }>();
  for (const record of records) {
    uniqueRecords.set(record.recordId, record);
  }

  const recordsByModel = new Map<string, string[]>();
  for (const { recordId, modelId } of uniqueRecords.values()) {
    const existing = recordsByModel.get(modelId) ?? [];
    existing.push(recordId);
    recordsByModel.set(modelId, existing);
  }

  const schemaRepo = getSchemaRepository(client);

  const modelPromises = Array.from(recordsByModel.entries()).map(
    async ([modelId, recordIds]) => {
      try {
        const itemType = await schemaRepo.getItemTypeById(modelId);
        const modelName = itemType.name;
        const isSingleton = itemType.singleton ?? false;

        if (isSingleton) {
          for (const recordId of recordIds) {
            results.set(recordId, { title: modelName, modelName, isSingleton });
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

        const BATCH_SIZE = 100;
        for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
          const batchIds = recordIds.slice(i, i + BATCH_SIZE);

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
                  title: `Record #${recordId}`,
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
                isSingleton
              );

              results.set(recordId, { title, modelName, isSingleton });
            }
          } catch (batchError) {
            logError('Failed to batch fetch records:', batchError, { modelId, batchIds });
            for (const recordId of batchIds) {
              results.set(recordId, {
                title: `Record #${recordId}`,
                modelName,
                isSingleton: false,
              });
            }
          }
        }
      } catch (error) {
        logError('Failed to process model for titles:', error, { modelId });
        for (const recordId of recordIds) {
          results.set(recordId, {
            title: `Record #${recordId}`,
            modelName: 'Unknown',
            isSingleton: false,
          });
        }
      }
    }
  );

  await Promise.all(modelPromises);

  return results;
}

/** Clear the SchemaRepository cache. Useful for testing or when schema changes. */
export function clearRecordTitleCaches(): void {
  schemaRepoCache = new WeakMap<Client, SchemaRepository>();
}
