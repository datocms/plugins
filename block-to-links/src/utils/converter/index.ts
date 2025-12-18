/**
 * Block-to-Model Converter
 * 
 * Main orchestration module for converting DatoCMS modular blocks into
 * independent models with links. This module coordinates the entire
 * conversion process including:
 * 
 * 1. Analyzing the block structure and usage
 * 2. Creating a new model with the same fields
 * 3. Migrating block instances to new records
 * 4. Converting field types and migrating data
 * 5. Cleaning up and optionally deleting the original block
 * 
 * @module utils/converter
 */

import type {
  CMAClient,
  ConversionResult,
  ProgressCallback,
  BlockMigrationMapping,
  NestedBlockPath,
} from '../../types';
import { analyzeBlock, buildNestedPathsToRootModels, getGroupedBlockInstances } from '../analyzer';
import {
  migrateBlocksToRecordsNested,
  migrateGroupedBlocksToRecords,
} from './migrate';
import {
  convertModularContentToLinksField,
  cleanupNestedBlocksFromOriginalField,
} from './field-handlers';
import {
  createNewModelFromBlock,
  deleteOriginalBlock,
  renameModelToOriginal,
} from './model';

// =============================================================================
// Re-exports for backwards compatibility
// =============================================================================

export { createNewModelFromBlock, deleteOriginalBlock, renameModelToOriginal } from './model';
export type { RenameResult } from './model';

// =============================================================================
// Main Conversion Function
// =============================================================================

/**
 * Converts a modular block into an independent model with links.
 * 
 * This is the main entry point for the conversion process. It orchestrates
 * all the steps needed to transform a block model into a regular model,
 * including creating records from block instances and updating field references.
 * 
 * @param client - DatoCMS CMA client
 * @param blockId - ID of the block model to convert
 * @param onProgress - Callback for progress updates
 * @param fullyReplace - If true, deletes the original block after conversion
 * @param publishAfterChanges - If true, publishes all affected records
 * @returns Result of the conversion including success status and counts
 * 
 * @example
 * const result = await convertBlockToModel(
 *   client,
 *   'block_123',
 *   (progress) => console.log(`${progress.percentage}% - ${progress.stepDescription}`),
 *   true,  // Fully replace block
 *   false  // Don't publish
 * );
 * 
 * if (result.success) {
 *   console.log(`Created model ${result.newModelApiKey} with ${result.migratedRecordsCount} records`);
 * }
 */
export async function convertBlockToModel(
  client: CMAClient,
  blockId: string,
  onProgress: ProgressCallback,
  fullyReplace: boolean = false,
  publishAfterChanges: boolean = false
): Promise<ConversionResult> {
  // Calculate total steps dynamically
  let totalSteps = 6; // Base: analyze, create model, migrate, convert, cleanup, done
  if (fullyReplace) totalSteps++;
  if (publishAfterChanges) totalSteps++;
  
  // Track records for publishing and counts
  const recordsToPublish = new Set<string>();
  let migratedRecordsCount = 0;
  let convertedFieldsCount = 0;

  try {
    // =========================================================================
    // Step 1: Analyze the block
    // =========================================================================
    onProgress({
      currentStep: 1,
      totalSteps,
      stepDescription: 'Analyzing block structure...',
      percentage: 5,
    });

    const analysis = await analyzeBlock(client, blockId);

    if (analysis.modularContentFields.length === 0) {
      return {
        success: false,
        migratedRecordsCount: 0,
        convertedFieldsCount: 0,
        error: 'This block is not used in any modular content fields',
      };
    }

    // Build nested paths for all fields
    const nestedPaths = await buildNestedPathsToRootModels(
      client,
      analysis.modularContentFields,
      blockId
    );

    // Check if any path is in a localized context
    const shouldLocalizeFields = nestedPaths.some(p => p.isInLocalizedContext);

    // Fetch available locales
    const site = await client.site.find();
    const availableLocales = site.locales;

    // =========================================================================
    // Step 2: Create new model
    // =========================================================================
    onProgress({
      currentStep: 2,
      totalSteps,
      stepDescription: `Creating new model "${analysis.block.name}"${shouldLocalizeFields ? ' (with localized fields)' : ''}...`,
      percentage: 15,
      details: `Copying ${analysis.fields.length} fields${shouldLocalizeFields ? ' as localized' : ''}`,
    });

    const newModel = await createNewModelFromBlock(client, analysis, shouldLocalizeFields);

    // =========================================================================
    // Step 3: Migrate block content to new records
    // =========================================================================
    onProgress({
      currentStep: 3,
      totalSteps,
      stepDescription: `Migrating block content to new records${shouldLocalizeFields ? ' (grouped by locale)' : ''}...`,
      percentage: 30,
      details: `Processing ${nestedPaths.length} nested paths`,
    });

    const globalMapping: BlockMigrationMapping = {};

    for (let i = 0; i < nestedPaths.length; i++) {
      const nestedPath = nestedPaths[i];
      onProgress({
        currentStep: 3,
        totalSteps,
        stepDescription: `Migrating blocks from "${nestedPath.rootModelName}" → ${nestedPath.path.map(p => p.fieldApiKey).join(' → ')}...`,
        percentage: 30 + (20 * i) / nestedPaths.length,
      });

      let mapping: BlockMigrationMapping;

      if (nestedPath.isInLocalizedContext) {
        // Grouped migration for localized contexts
        const groupedInstances = await getGroupedBlockInstances(client, nestedPath, blockId);
        
        mapping = await migrateGroupedBlocksToRecords(
          client,
          groupedInstances,
          newModel.id,
          availableLocales,
          globalMapping,
          (count) => { migratedRecordsCount = count; }
        );
      } else {
        // Standard migration
        mapping = await migrateBlocksToRecordsNested(
          client,
          nestedPath,
          blockId,
          newModel.id,
          globalMapping,
          (count) => { migratedRecordsCount = count; },
          {
            forceLocalizedFields: shouldLocalizeFields,
            availableLocales,
          }
        );
      }

      Object.assign(globalMapping, mapping);
    }

    // Track newly created records for publishing
    if (publishAfterChanges) {
      for (const newRecordId of Object.values(globalMapping)) {
        recordsToPublish.add(newRecordId);
      }
    }

    // =========================================================================
    // Step 4: Convert fields and migrate data
    // =========================================================================
    onProgress({
      currentStep: 4,
      totalSteps,
      stepDescription: 'Converting field types and migrating data...',
      percentage: 55,
    });

    for (let i = 0; i < analysis.modularContentFields.length; i++) {
      const mcField = analysis.modularContentFields[i];
      onProgress({
        currentStep: 4,
        totalSteps,
        stepDescription: `Converting "${mcField.parentModelName}.${mcField.apiKey}" to links field...`,
        percentage: 55 + (15 * i) / analysis.modularContentFields.length,
      });

      await convertModularContentToLinksField({
        client,
        mcField,
        newModelId: newModel.id,
        blockIdToRemove: blockId,
        mapping: globalMapping,
        nestedPaths,
        availableLocales,
        fullyReplace,
        recordsToPublish: publishAfterChanges ? recordsToPublish : undefined,
      });
      convertedFieldsCount++;
    }

    // =========================================================================
    // Step 5: Cleanup nested block references (only when fully replacing)
    // =========================================================================
    if (fullyReplace) {
      onProgress({
        currentStep: 5,
        totalSteps,
        stepDescription: 'Cleaning up nested block references...',
        percentage: 75,
      });

      // Group paths by root model for efficient cleanup
      const pathsByRootModel = groupPathsByRootModel(nestedPaths, blockId);

      let rootModelIndex = 0;
      for (const [rootModelId, paths] of pathsByRootModel) {
        const rootModelName = paths[0].rootModelName;
        onProgress({
          currentStep: 5,
          totalSteps,
          stepDescription: `Cleaning up nested blocks in "${rootModelName}"...`,
          percentage: 75 + (15 * rootModelIndex) / pathsByRootModel.size,
        });

        await cleanupNestedBlocksFromOriginalField(
          client,
          rootModelId,
          paths,
          blockId,
          publishAfterChanges ? recordsToPublish : undefined
        );
        rootModelIndex++;
      }
    } else {
      // Skip cleanup when not fully replacing - keep original data intact
      onProgress({
        currentStep: 5,
        totalSteps,
        stepDescription: 'Skipping cleanup (preserving original block data)...',
        percentage: 75,
      });
    }

    // =========================================================================
    // Step 6+: Optional delete, rename, and publish steps
    // =========================================================================
    let currentStep = 6;
    let finalModelApiKey = newModel.api_key;

    // Delete original block and rename converted model if fully replacing
    if (fullyReplace) {
      onProgress({
        currentStep,
        totalSteps,
        stepDescription: 'Deleting original block model...',
        percentage: 80,
      });

      await deleteOriginalBlock(client, blockId);
      
      // Rename the converted model to use the original name/API key
      onProgress({
        currentStep,
        totalSteps,
        stepDescription: 'Renaming converted model to original name...',
        percentage: 85,
      });

      const renameResult = await renameModelToOriginal(
        client,
        newModel.id,
        analysis.block.name,
        analysis.block.apiKey
      );
      
      if (renameResult.success) {
        finalModelApiKey = renameResult.finalApiKey;
      }
      
      currentStep++;
    }

    // Publish records if requested
    if (publishAfterChanges && recordsToPublish.size > 0) {
      await publishRecords(client, recordsToPublish, currentStep, totalSteps, onProgress);
      currentStep++;
    }

    // =========================================================================
    // Final step: Conversion complete
    // =========================================================================
    const completionDetails = buildCompletionDetails(
      finalModelApiKey,
      migratedRecordsCount,
      fullyReplace,
      publishAfterChanges,
      recordsToPublish.size
    );

    onProgress({
      currentStep,
      totalSteps,
      stepDescription: 'Conversion complete!',
      percentage: 100,
      details: completionDetails,
    });

    return {
      success: true,
      newModelId: newModel.id,
      newModelApiKey: finalModelApiKey,
      migratedRecordsCount,
      convertedFieldsCount,
      originalBlockName: analysis.block.name,
      originalBlockApiKey: analysis.block.apiKey,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      success: false,
      migratedRecordsCount,
      convertedFieldsCount,
      error: errorMessage,
    };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Groups nested paths by their root model ID for efficient batch processing.
 * Only includes paths with nested blocks (more than 1 step) where there are
 * remaining block types in the field.
 */
function groupPathsByRootModel(
  nestedPaths: NestedBlockPath[],
  blockId: string
): Map<string, NestedBlockPath[]> {
  const pathsByRootModel = new Map<string, NestedBlockPath[]>();
  
  for (const path of nestedPaths) {
    // Only process paths with nested blocks where there are remaining block types
    if (path.path.length > 1) {
      const mcField = path.fieldInfo;
      const remainingBlockIds = mcField.allowedBlockIds.filter((id) => id !== blockId);
      if (remainingBlockIds.length > 0) {
        const existing = pathsByRootModel.get(path.rootModelId) || [];
        existing.push(path);
        pathsByRootModel.set(path.rootModelId, existing);
      }
    }
  }
  
  return pathsByRootModel;
}

/**
 * Publishes records in batches with progress updates.
 */
async function publishRecords(
  client: CMAClient,
  recordsToPublish: Set<string>,
  currentStep: number,
  totalSteps: number,
  onProgress: ProgressCallback
): Promise<void> {
  onProgress({
    currentStep,
    totalSteps,
    stepDescription: `Publishing ${recordsToPublish.size} records...`,
    percentage: 90,
  });

  const recordIds = Array.from(recordsToPublish);
  const batchSize = 10;
  
  for (let i = 0; i < recordIds.length; i += batchSize) {
    const batch = recordIds.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (recordId) => {
        try {
          await client.items.publish(recordId);
        } catch (error) {
          console.warn(`Failed to publish record ${recordId}:`, error);
        }
      })
    );

    // Update progress
    const progressPercent = 90 + (10 * Math.min(i + batchSize, recordIds.length)) / recordIds.length;
    onProgress({
      currentStep,
      totalSteps,
      stepDescription: `Publishing records... (${Math.min(i + batchSize, recordIds.length)}/${recordIds.length})`,
      percentage: Math.min(progressPercent, 99),
    });
  }
}

/**
 * Builds the completion details message.
 */
function buildCompletionDetails(
  newModelApiKey: string,
  migratedRecordsCount: number,
  fullyReplace: boolean,
  publishAfterChanges: boolean,
  publishedCount: number
): string {
  const details = [
    `Created model "${newModelApiKey}" with ${migratedRecordsCount} records`,
  ];
  
  if (fullyReplace) {
    details.push('original block deleted');
  }
  if (publishAfterChanges && publishedCount > 0) {
    details.push(`${publishedCount} records published`);
  }
  
  return details.join(', ');
}

