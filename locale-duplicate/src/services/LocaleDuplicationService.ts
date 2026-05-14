/**
 * Service for handling locale duplication logic
 */

import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { Item, ItemType, LocalizedField } from '../types';
import { formatErrorMessage } from '../utils/errorMessages';
import { removeBlockItemIdsMutable } from '../utils/fieldUtils';

/**
 * Progress callback type for duplication operations
 */
export type ProgressCallback = (update: {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
  progress?: number;
  recordId?: string;
  modelId?: string;
  modelName?: string;
}) => void;

/**
 * Configuration for duplication operation
 */
export interface DuplicationConfig {
  sourceLocale: string;
  targetLocale: string;
  selectedModelIds?: string[];
  useDraftRecords?: boolean;
  publishAfterDuplication?: boolean;
  abortSignal?: { current: boolean };
}

/**
 * Result of a duplication operation
 */
export interface DuplicationResult {
  totalRecordsProcessed: number;
  successfulRecords: number;
  failedRecords: number;
  publishedRecords: number;
}

/**
 * Service class for handling locale duplication
 */
export class LocaleDuplicationService {
  private client: Client;
  private recordsToPublish: Array<{ type: 'item'; id: string }> = [];
  private totalRecordsProcessed = 0;

  constructor(apiToken: string, environment?: string, baseUrl?: string) {
    this.client = buildClient({
      apiToken,
      environment,
      baseUrl,
    });
  }

  /**
   * Duplicate content from one locale to another
   */
  async duplicateContent(
    config: DuplicationConfig,
    onProgress: ProgressCallback,
  ): Promise<DuplicationResult> {
    const {
      sourceLocale,
      targetLocale,
      selectedModelIds,
      useDraftRecords = true,
      publishAfterDuplication = false,
      abortSignal,
    } = config;

    // Reset counters
    this.recordsToPublish = [];
    this.totalRecordsProcessed = 0;
    let successfulRecords = 0;
    let failedRecords = 0;

    try {
      // Step 1: Retrieve and filter content models
      const allModels = await this.client.itemTypes.list();
      let models = allModels.filter((model) => !model.modular_block);

      // Filter by selected model IDs if provided
      if (selectedModelIds && selectedModelIds.length > 0) {
        models = models.filter((model) => selectedModelIds.includes(model.id));
      }

      // Progress tracking for models
      const totalModels = models.length;

      // Step 2: Process each model sequentially (required for progress tracking and abort)
      const modelResults = await models.reduce(
        async (
          promiseChain,
          model,
          i,
        ): Promise<{ successful: number; failed: number }[]> => {
          const accumulatedResults = await promiseChain;

          if (abortSignal?.current) {
            onProgress({
              message: 'Process aborted by user',
              type: 'error',
              timestamp: Date.now(),
              progress: Math.round(((i + 1) / totalModels) * 90),
            });
            return accumulatedResults;
          }

          const result = await this.processModel(
            model,
            sourceLocale,
            targetLocale,
            useDraftRecords,
            publishAfterDuplication,
            onProgress,
            abortSignal,
            i,
            totalModels,
          );

          return [...accumulatedResults, result];
        },
        Promise.resolve([] as { successful: number; failed: number }[]),
      );

      for (const result of modelResults) {
        successfulRecords += result.successful;
        failedRecords += result.failed;
      }

      // Step 3: Bulk publish if enabled
      let publishedRecords = 0;
      if (publishAfterDuplication && this.recordsToPublish.length > 0) {
        publishedRecords = await this.publishRecords(onProgress);
      }

      // Final progress
      onProgress({
        message: 'Migration completed successfully!',
        type: 'success',
        timestamp: Date.now(),
        progress: 100,
      });

      return {
        totalRecordsProcessed: this.totalRecordsProcessed,
        successfulRecords,
        failedRecords,
        publishedRecords,
      };
    } catch (error) {
      onProgress({
        message: formatErrorMessage('API_REQUEST_FAILED', {
          errorDetails: error instanceof Error ? error.message : String(error),
        }),
        type: 'error',
        timestamp: Date.now(),
        progress: 100,
      });

      throw error;
    }
  }

  /**
   * Process a single model - collects all records then processes them sequentially
   */
  private async processModel(
    model: ItemType,
    sourceLocale: string,
    targetLocale: string,
    useDraftRecords: boolean,
    publishAfterDuplication: boolean,
    onProgress: ProgressCallback,
    abortSignal?: { current: boolean },
    modelIndex?: number,
    totalModels?: number,
  ): Promise<{ successful: number; failed: number }> {
    const modelStartProgress = this.calculateStartProgress(
      modelIndex,
      totalModels,
    );
    const modelEndProgress = this.calculateEndProgress(modelIndex, totalModels);

    onProgress({
      message: `Processing model: ${model.name}`,
      type: 'info',
      timestamp: Date.now(),
      progress: modelStartProgress,
      modelId: model.id,
      modelName: model.name,
    });

    try {
      // Collect all records for the current model
      const recordsToProcess = await this.collectRecordsForModel(
        model,
        useDraftRecords,
      );

      return await this.processRecordsSequentially(
        recordsToProcess,
        model,
        sourceLocale,
        targetLocale,
        publishAfterDuplication,
        onProgress,
        abortSignal,
        modelStartProgress,
        modelEndProgress,
      );
    } catch (modelError) {
      const errorMessage = formatErrorMessage('MODEL_PROCESSING_FAILED', {
        modelName: model.name,
        errorDetails:
          modelError instanceof Error ? modelError.message : String(modelError),
      });

      onProgress({
        message: errorMessage,
        type: 'error',
        timestamp: Date.now(),
        modelId: model.id,
        modelName: model.name,
        progress: modelStartProgress,
      });
    }

    return { successful: 0, failed: 0 };
  }

  /**
   * Calculates the start progress percentage for a model
   */
  private calculateStartProgress(
    modelIndex?: number,
    totalModels?: number,
  ): number {
    if (modelIndex !== undefined && totalModels) {
      return Math.round((modelIndex / totalModels) * 90);
    }
    return 0;
  }

  /**
   * Calculates the end progress percentage for a model
   */
  private calculateEndProgress(
    modelIndex?: number,
    totalModels?: number,
  ): number {
    if (modelIndex !== undefined && totalModels) {
      return Math.round(((modelIndex + 1) / totalModels) * 90);
    }
    return 90;
  }

  /**
   * Collects all records for a given model using the paged iterator
   */
  private async collectRecordsForModel(
    model: ItemType,
    useDraftRecords: boolean,
  ): Promise<Item[]> {
    const records: Item[] = [];
    for await (const record of this.client.items.listPagedIterator({
      filter: {
        type: model.api_key,
      },
      nested: true,
      version: useDraftRecords ? 'current' : 'published',
    })) {
      records.push(record);
    }
    return records;
  }

  /**
   * Processes records sequentially with abort signal support and progress tracking
   */
  private async processRecordsSequentially(
    recordsToProcess: Item[],
    model: ItemType,
    sourceLocale: string,
    targetLocale: string,
    publishAfterDuplication: boolean,
    onProgress: ProgressCallback,
    abortSignal: { current: boolean } | undefined,
    modelStartProgress: number,
    modelEndProgress: number,
  ): Promise<{ successful: number; failed: number }> {
    return recordsToProcess.reduce(
      async (
        promiseChain,
        record,
        j,
      ): Promise<{ successful: number; failed: number }> => {
        const accumulated = await promiseChain;

        if (abortSignal?.current) {
          const abortProgress =
            modelStartProgress +
            Math.round(
              (j / recordsToProcess.length) *
                (modelEndProgress - modelStartProgress),
            );
          onProgress({
            message: 'Process aborted by user',
            type: 'error',
            timestamp: Date.now(),
            progress: abortProgress,
          });
          return accumulated;
        }

        const recordProgress =
          modelStartProgress +
          Math.round(
            ((j + 1) / recordsToProcess.length) *
              (modelEndProgress - modelStartProgress),
          );

        const recordResult = await this.processRecord(
          record,
          model,
          sourceLocale,
          targetLocale,
          publishAfterDuplication,
          onProgress,
          recordProgress,
        );

        this.totalRecordsProcessed++;

        return {
          successful: accumulated.successful + (recordResult.success ? 1 : 0),
          failed: accumulated.failed + (recordResult.success ? 0 : 1),
        };
      },
      Promise.resolve({ successful: 0, failed: 0 }),
    );
  }

  /**
   * Process a single record
   */
  private async processRecord(
    record: Item,
    model: ItemType,
    sourceLocale: string,
    targetLocale: string,
    publishAfterDuplication: boolean,
    onProgress: ProgressCallback,
    progress: number,
  ): Promise<{ success: boolean }> {
    try {
      const updates = this.buildLocaleUpdates(
        record,
        sourceLocale,
        targetLocale,
      );

      if (Object.keys(updates).length === 0) {
        return { success: true };
      }

      await this.client.items.update(record.id, updates);

      if (publishAfterDuplication) {
        this.recordsToPublish.push({ type: 'item', id: record.id });
      }

      onProgress({
        message: `Updated record ${record.id} in ${model.name}`,
        type: 'success',
        timestamp: Date.now(),
        recordId: record.id,
        modelId: model.id,
        modelName: model.name,
        progress,
      });

      return { success: true };
    } catch (_updateError) {
      const errorMessage = formatErrorMessage('RECORD_UPDATE_FAILED', {
        recordId: record.id,
        modelName: model.name,
        sourceLocale,
        targetLocale,
        errorDetails:
          'Check if the original record is currently invalid and fix validation errors',
      });

      onProgress({
        message: errorMessage,
        type: 'error',
        timestamp: Date.now(),
        recordId: record.id,
        modelId: model.id,
        modelName: model.name,
        progress,
      });

      return { success: false };
    }
  }

  /**
   * Builds the locale update map for a record by copying source locale values to target locale
   */
  private buildLocaleUpdates(
    record: Item,
    sourceLocale: string,
    targetLocale: string,
  ): Record<string, LocalizedField> {
    let updates: Record<string, LocalizedField> = {};

    const recordData = { ...record };
    const {
      id: _id,
      type: _type,
      item_type: _itemType,
      creator: _creator,
      meta: _meta,
      ...fields
    } = recordData;

    for (const [fieldKey, fieldValue] of Object.entries(fields)) {
      if (this.shouldSkipField(fieldKey)) {
        continue;
      }

      if (this.isLocalizedFieldWithSourceLocale(fieldValue, sourceLocale)) {
        const localizedField = fieldValue as Record<string, unknown>;
        updates[fieldKey] = { ...localizedField };
        updates[fieldKey][targetLocale] = localizedField[sourceLocale];
        updates = removeBlockItemIdsMutable(updates) as Record<
          string,
          LocalizedField
        >;
      }
    }

    return updates;
  }

  /**
   * Checks if a field key should be skipped during locale duplication
   */
  private shouldSkipField(fieldKey: string): boolean {
    const systemFields = [
      'id',
      'type',
      'meta',
      'created_at',
      'updated_at',
      'is_valid',
      'item_type',
    ];
    return fieldKey.startsWith('_') || systemFields.includes(fieldKey);
  }

  /**
   * Checks if a value is a localized field containing the source locale
   */
  private isLocalizedFieldWithSourceLocale(
    fieldValue: unknown,
    sourceLocale: string,
  ): boolean {
    return (
      fieldValue !== null &&
      typeof fieldValue === 'object' &&
      !Array.isArray(fieldValue) &&
      Object.keys(fieldValue).includes(sourceLocale)
    );
  }

  /**
   * Bulk publish records in sequential batches to avoid API limits
   */
  private async publishRecords(onProgress: ProgressCallback): Promise<number> {
    onProgress({
      message: `Publishing ${this.recordsToPublish.length} updated records...`,
      type: 'info',
      timestamp: Date.now(),
      progress: 95,
    });

    try {
      const batchSize = 100;
      const batches: Array<Array<{ type: 'item'; id: string }>> = [];
      for (let i = 0; i < this.recordsToPublish.length; i += batchSize) {
        batches.push(this.recordsToPublish.slice(i, i + batchSize));
      }

      let publishedCount = 0;
      await batches.reduce(async (promiseChain, batch) => {
        await promiseChain;
        await this.client.items.bulkPublish({ items: batch });
        publishedCount += batch.length;
      }, Promise.resolve());

      onProgress({
        message: `Successfully published ${publishedCount} records`,
        type: 'success',
        timestamp: Date.now(),
        progress: 98,
      });

      return publishedCount;
    } catch (publishError) {
      const errorMessage = formatErrorMessage('PUBLISH_FAILED', {
        errorDetails: 'Some records may remain in draft state',
      });

      onProgress({
        message: errorMessage,
        type: 'error',
        timestamp: Date.now(),
        progress: 98,
      });

      console.error('Bulk publish error:', publishError);
      return 0;
    }
  }
}
