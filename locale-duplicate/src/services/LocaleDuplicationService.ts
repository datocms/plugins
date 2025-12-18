/**
 * Service for handling locale duplication logic
 */

import { buildClient, Client } from '@datocms/cma-client-browser';
import type { Item, ItemType, LocalizedField } from '../types';
import { removeBlockItemIdsMutable } from '../utils/fieldUtils';
import { formatErrorMessage } from '../utils/errorMessages';

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
  
  constructor(apiToken: string, environment?: string) {
    this.client = buildClient({
      apiToken,
      environment,
    });
  }
  
  /**
   * Duplicate content from one locale to another
   */
  async duplicateContent(
    config: DuplicationConfig,
    onProgress: ProgressCallback
  ): Promise<DuplicationResult> {
    const {
      sourceLocale,
      targetLocale,
      selectedModelIds,
      useDraftRecords = true,
      publishAfterDuplication = false,
      abortSignal
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
      
      // Step 2: Process each model
      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        
        if (abortSignal?.current) {
          onProgress({
            message: 'Process aborted by user',
            type: 'error',
            timestamp: Date.now(),
            progress: Math.round(((i + 1) / totalModels) * 90),
          });
          break;
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
          totalModels
        );
        
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
        publishedRecords
      };
      
    } catch (error) {
      onProgress({
        message: formatErrorMessage('API_REQUEST_FAILED', {
          errorDetails: error instanceof Error ? error.message : String(error)
        }),
        type: 'error',
        timestamp: Date.now(),
        progress: 100,
      });
      
      throw error;
    }
  }
  
  /**
   * Process a single model
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
    totalModels?: number
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;
    
    const modelStartProgress = modelIndex !== undefined && totalModels 
      ? Math.round((modelIndex / totalModels) * 90)
      : 0;
    const modelEndProgress = modelIndex !== undefined && totalModels
      ? Math.round(((modelIndex + 1) / totalModels) * 90)
      : 90;
    
    onProgress({
      message: `Processing model: ${model.name}`,
      type: 'info',
      timestamp: Date.now(),
      progress: modelStartProgress,
      modelId: model.id,
      modelName: model.name
    });
    
    try {
      // Collect all records for the current model
      const recordsToProcess: Item[] = [];
      for await (const record of this.client.items.listPagedIterator({
        filter: {
          type: model.api_key,
        },
        nested: true,
        version: useDraftRecords ? "current" : "published"
      })) {
        recordsToProcess.push(record);
      }
      
      // Process each record
      for (let j = 0; j < recordsToProcess.length; j++) {
        const record = recordsToProcess[j];
        
        if (abortSignal?.current) {
          onProgress({
            message: 'Process aborted by user',
            type: 'error',
            timestamp: Date.now(),
            progress: modelStartProgress + Math.round((j / recordsToProcess.length) * (modelEndProgress - modelStartProgress)),
          });
          return { successful, failed };
        }
        
        const recordResult = await this.processRecord(
          record,
          model,
          sourceLocale,
          targetLocale,
          publishAfterDuplication,
          onProgress,
          modelStartProgress + Math.round(((j + 1) / recordsToProcess.length) * (modelEndProgress - modelStartProgress))
        );
        
        if (recordResult.success) {
          successful++;
        } else {
          failed++;
        }
        
        this.totalRecordsProcessed++;
      }
      
    } catch (modelError) {
      const errorMessage = formatErrorMessage('MODEL_PROCESSING_FAILED', {
        modelName: model.name,
        errorDetails: modelError instanceof Error ? modelError.message : String(modelError)
      });
      
      onProgress({
        message: errorMessage,
        type: 'error',
        timestamp: Date.now(),
        modelId: model.id,
        modelName: model.name,
        progress: modelStartProgress
      });
    }
    
    return { successful, failed };
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
    progress: number
  ): Promise<{ success: boolean }> {
    try {
      // Initialize container for updates
      let updates: Record<string, LocalizedField> = {};
      
      // Analyze each field in the record
      const recordData = { ...record };
      // Remove system fields
      const { id, type, item_type, creator, meta, ...fields } = recordData;
      
      for (const [fieldKey, fieldValue] of Object.entries(fields)) {
        // Skip non-localizable or system fields
        if (
          fieldKey.startsWith('_') ||
          ['id', 'type', 'meta', 'created_at', 'updated_at', 'is_valid', 'item_type'].includes(fieldKey)
        ) {
          continue;
        }
        
        // Check if field is localized and contains the source locale
        if (
          fieldValue &&
          typeof fieldValue === 'object' &&
          !Array.isArray(fieldValue) &&
          Object.keys(fieldValue).includes(sourceLocale)
        ) {
          const localizedField = fieldValue as Record<string, unknown>;
          updates[fieldKey] = { ...localizedField };
          
          // Copy content from source locale to target locale
          updates[fieldKey][targetLocale] = localizedField[sourceLocale];
          
          // Process structured content to remove IDs
          updates = removeBlockItemIdsMutable(updates) as Record<string, LocalizedField>;
        }
      }
      
      // Apply updates if there are any changes
      if (Object.keys(updates).length > 0) {
        await this.client.items.update(record.id, updates);
        
        // Track record for bulk publishing later
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
          progress
        });
        
        return { success: true };
      }
      
      return { success: true };
      
    } catch (updateError) {
      const errorMessage = formatErrorMessage('RECORD_UPDATE_FAILED', {
        recordId: record.id,
        modelName: model.name,
        sourceLocale,
        targetLocale,
        errorDetails: 'Check if the original record is currently invalid and fix validation errors'
      });
      
      onProgress({
        message: errorMessage,
        type: 'error',
        timestamp: Date.now(),
        recordId: record.id,
        modelId: model.id,
        modelName: model.name,
        progress
      });
      
      return { success: false };
    }
  }
  
  /**
   * Bulk publish records
   */
  private async publishRecords(onProgress: ProgressCallback): Promise<number> {
    onProgress({
      message: `Publishing ${this.recordsToPublish.length} updated records...`,
      type: 'info',
      timestamp: Date.now(),
      progress: 95,
    });
    
    try {
      // Publish records in batches of 100 to avoid API limits
      const batchSize = 100;
      let publishedCount = 0;
      
      for (let i = 0; i < this.recordsToPublish.length; i += batchSize) {
        const batch = this.recordsToPublish.slice(i, i + batchSize);
        await this.client.items.bulkPublish({
          items: batch
        });
        publishedCount += batch.length;
      }
      
      onProgress({
        message: `Successfully published ${publishedCount} records`,
        type: 'success',
        timestamp: Date.now(),
        progress: 98,
      });
      
      return publishedCount;
      
    } catch (publishError) {
      const errorMessage = formatErrorMessage('PUBLISH_FAILED', {
        errorDetails: 'Some records may remain in draft state'
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