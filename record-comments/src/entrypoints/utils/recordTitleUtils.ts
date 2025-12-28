import type { Client } from '@datocms/cma-client-browser';
import { logError } from '@/utils/errorLogger';
import { extractLocalizedValue } from './fieldLoader';

export type RecordTitleInfo = {
  title: string;
  modelName: string;
  isSingleton: boolean;
};

// ============================================================================
// Shared Title Extraction Types and Core Logic
// ============================================================================

/**
 * Normalized title field configuration for the core extraction logic.
 * Both CMA API responses and raw API responses can be normalized to this format.
 */
export type TitleFieldConfig = {
  presentationTitleFieldId: string | null;
  titleFieldId: string | null;
};

/**
 * Normalized field info for title extraction.
 */
export type NormalizedField = {
  id: string;
  apiKey: string;
};

/**
 * Core title extraction logic shared between different API response formats.
 * This is the single source of truth for how titles are resolved from record data.
 *
 * Resolution order:
 * 1. If singleton, returns modelName
 * 2. Tries presentation_title_field, then title_field
 * 3. Handles localization via extractLocalizedValue
 * 4. Falls back to "Record #recordId"
 */
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

  // For singletons, use the model name as the title
  if (isSingleton) {
    return modelName;
  }

  // Get the selected title field ID (presentation takes precedence)
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

  // Handle localized fields using the shared utility
  const localizedValue = extractLocalizedValue(fieldValue, mainLocale);
  if (localizedValue !== fieldValue && localizedValue) {
    return String(localizedValue);
  }

  // If extractLocalizedValue returned the same value, it's not localized
  if (typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
    // It's a localized object but the locale wasn't found
    return fallbackTitle;
  }

  return String(fieldValue);
}

/**
 * Simple LRU (Least Recently Used) cache to prevent unbounded memory growth.
 * When the cache reaches maxSize, the least recently accessed entry is evicted.
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used) by re-inserting
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

const CACHE_MAX_SIZE = 150;

/**
 * LRU caches for item types and fields to avoid repeated fetches.
 * Limited to 150 entries each to prevent unbounded memory growth.
 */
const itemTypeCache = new LRUCache<string, Awaited<ReturnType<Client['itemTypes']['find']>>>(CACHE_MAX_SIZE);
const fieldCache = new LRUCache<string, Awaited<ReturnType<Client['fields']['list']>>>(CACHE_MAX_SIZE);

/**
 * NOTE: A single-record `getRecordTitle` function was intentionally removed.
 *
 * The batch version `getRecordTitles` below should ALWAYS be preferred because:
 * 1. It groups records by model, minimizing API calls (O(models) not O(records))
 * 2. It uses LRU caching for item types and fields
 * 3. It batch-fetches up to 100 records per API call
 * 4. Even for a single record, getRecordTitles([{recordId, modelId}]) is efficient
 *
 * DO NOT add a single-record version back. If you need one record's title,
 * use: `const map = await getRecordTitles(client, [{recordId, modelId}], locale);`
 */

/**
 * Batch fetch record titles for multiple records.
 * Uses batch API calls to minimize network requests (up to 100 records per API call).
 *
 * OPTIMIZATION NOTES:
 * - Groups records by modelId to efficiently fetch item types and fields per model
 * - Uses client.items.list with multiple IDs instead of individual client.items.find calls
 * - Processes models in parallel for better performance
 * - Falls back to Record #id for any records that fail to load
 */
export async function getRecordTitles(
  client: Client,
  records: Array<{ recordId: string; modelId: string }>,
  mainLocale: string
): Promise<Map<string, RecordTitleInfo>> {
  const results = new Map<string, RecordTitleInfo>();

  // Deduplicate by recordId and group by modelId for efficient batch fetching
  const uniqueRecords = new Map<string, { recordId: string; modelId: string }>();
  for (const record of records) {
    uniqueRecords.set(record.recordId, record);
  }

  // Group records by modelId for batch processing
  const recordsByModel = new Map<string, string[]>();
  for (const { recordId, modelId } of uniqueRecords.values()) {
    const existing = recordsByModel.get(modelId) ?? [];
    existing.push(recordId);
    recordsByModel.set(modelId, existing);
  }

  // Process each model's records in parallel
  const modelPromises = Array.from(recordsByModel.entries()).map(
    async ([modelId, recordIds]) => {
      try {
        // Fetch or get cached item type
        let itemType = itemTypeCache.get(modelId);
        if (!itemType) {
          itemType = await client.itemTypes.find(modelId);
          itemTypeCache.set(modelId, itemType);
        }

        const modelName = itemType.name;
        const isSingleton = itemType.singleton ?? false;

        // For singletons, we don't need to fetch the record - just use model name
        if (isSingleton) {
          for (const recordId of recordIds) {
            results.set(recordId, { title: modelName, modelName, isSingleton });
          }
          return;
        }

        // Fetch or get cached fields
        let fields = fieldCache.get(modelId);
        if (!fields) {
          fields = await client.fields.list(modelId);
          fieldCache.set(modelId, fields);
        }

        // Normalize fields and title config for the shared extraction function
        const normalizedFields: NormalizedField[] = fields.map((f) => ({
          id: f.id,
          apiKey: f.api_key,
        }));

        const titleFieldConfig: TitleFieldConfig = {
          presentationTitleFieldId: itemType.presentation_title_field?.id ?? null,
          titleFieldId: itemType.title_field?.id ?? null,
        };

        // Batch fetch records (DatoCMS supports up to 100 per request)
        // Process in batches of 100 to respect API limits
        const BATCH_SIZE = 100;
        for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
          const batchIds = recordIds.slice(i, i + BATCH_SIZE);

          try {
            // Use filter.ids to fetch multiple records in a single API call
            const batchRecords = await client.items.list({
              filter: {
                type: modelId,
                ids: batchIds.join(','),
              },
              page: { limit: BATCH_SIZE },
            });

            // Create a map for quick lookup
            const recordMap = new Map(batchRecords.map((r) => [r.id, r]));

            // Process each record in this batch
            for (const recordId of batchIds) {
              const record = recordMap.get(recordId);

              if (!record) {
                // Record not found (might have been deleted)
                results.set(recordId, {
                  title: `Record #${recordId}`,
                  modelName,
                  isSingleton: false,
                });
                continue;
              }

              // Use shared title extraction logic
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
            // If batch fetch fails, set fallback for all records in batch
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
        // If model processing fails, set fallback for all records of this model
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

/**
 * Clear the LRU caches for item types and fields.
 * Useful for testing or when models change.
 * Note: The caches are LRU-based (max 150 entries each) and will
 * automatically evict least-recently-used entries when full.
 */
export function clearRecordTitleCaches(): void {
  itemTypeCache.clear();
  fieldCache.clear();
}
