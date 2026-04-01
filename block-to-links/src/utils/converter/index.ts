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
  BlockMigrationMapping,
  CMAClient,
  ConversionResult,
  NestedBlockPath,
  ProgressCallback,
} from '../../types';
import {
  analyzeBlock,
  buildNestedPathsToRootModels,
  getGroupedBlockInstances,
} from '../analyzer';
import {
  cleanupNestedBlocksFromOriginalField,
  convertModularContentToLinksField,
} from './field-handlers';
import {
  migrateBlocksToRecordsNested,
  migrateGroupedBlocksToRecords,
} from './migrate';
import {
  createNewModelFromBlock,
  deleteOriginalBlock,
  renameModelToOriginal,
} from './model';

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
/** Shared context passed between steps of the conversion */
type ConversionContext = {
  client: CMAClient;
  blockId: string;
  totalSteps: number;
  onProgress: ProgressCallback;
  recordsToPublish: Set<string>;
  publishAfterChanges: boolean;
  fullyReplace: boolean;
};

/**
 * Step 1+2: Analyzes the block and creates the new model.
 */
async function analyzeAndCreateModel(ctx: ConversionContext): Promise<{
  analysis: Awaited<ReturnType<typeof analyzeBlock>>;
  nestedPaths: NestedBlockPath[];
  shouldLocalizeFields: boolean;
  availableLocales: string[];
  newModel: { id: string; api_key: string };
}> {
  const { client, blockId, totalSteps, onProgress } = ctx;

  onProgress({
    currentStep: 1,
    totalSteps,
    stepDescription: 'Analyzing block structure...',
    percentage: 5,
  });
  const analysis = await analyzeBlock(client, blockId);

  const nestedPaths = await buildNestedPathsToRootModels(
    client,
    analysis.modularContentFields,
    blockId,
  );
  const shouldLocalizeFields = nestedPaths.some((p) => p.isInLocalizedContext);
  const site = await client.site.find();
  const availableLocales = site.locales;

  const localeNote = shouldLocalizeFields ? ' (with localized fields)' : '';
  onProgress({
    currentStep: 2,
    totalSteps,
    stepDescription: `Creating new model "${analysis.block.name}"${localeNote}...`,
    percentage: 15,
    details: `Copying ${analysis.fields.length} fields${shouldLocalizeFields ? ' as localized' : ''}`,
  });
  const newModel = await createNewModelFromBlock(
    client,
    analysis,
    shouldLocalizeFields,
  );

  return {
    analysis,
    nestedPaths,
    shouldLocalizeFields,
    availableLocales,
    newModel,
  };
}

/**
 * Step 3: Migrates all block instances to new records sequentially.
 */
async function migrateAllPaths(
  ctx: ConversionContext,
  nestedPaths: NestedBlockPath[],
  newModelId: string,
  availableLocales: string[],
  shouldLocalizeFields: boolean,
  onCount: (count: number) => void,
): Promise<BlockMigrationMapping> {
  const { client, blockId, totalSteps, onProgress } = ctx;

  onProgress({
    currentStep: 3,
    totalSteps,
    stepDescription: `Migrating block content to new records${shouldLocalizeFields ? ' (grouped by locale)' : ''}...`,
    percentage: 30,
    details: `Processing ${nestedPaths.length} nested paths`,
  });

  return nestedPaths.reduce(
    async (accPromise, nestedPath, i) => {
      const acc = await accPromise;
      onProgress({
        currentStep: 3,
        totalSteps,
        stepDescription: `Migrating blocks from "${nestedPath.rootModelName}" → ${nestedPath.path.map((p) => p.fieldApiKey).join(' → ')}...`,
        percentage: 30 + (20 * i) / nestedPaths.length,
      });

      const pathMapping = await migrateSingleNestedPath(
        client,
        nestedPath,
        blockId,
        newModelId,
        acc,
        availableLocales,
        shouldLocalizeFields,
        onCount,
      );

      return { ...acc, ...pathMapping };
    },
    Promise.resolve({} as BlockMigrationMapping),
  );
}

/**
 * Step 4: Converts all modular content fields to links fields in parallel.
 */
async function convertAllFields(
  ctx: ConversionContext,
  analysis: Awaited<ReturnType<typeof analyzeBlock>>,
  newModelId: string,
  globalMapping: BlockMigrationMapping,
  nestedPaths: NestedBlockPath[],
  availableLocales: string[],
): Promise<number> {
  const {
    client,
    blockId,
    totalSteps,
    onProgress,
    fullyReplace,
    publishAfterChanges,
    recordsToPublish,
  } = ctx;

  onProgress({
    currentStep: 4,
    totalSteps,
    stepDescription: 'Converting field types and migrating data...',
    percentage: 55,
  });

  await Promise.all(
    analysis.modularContentFields.map((mcField) =>
      convertModularContentToLinksField({
        client,
        mcField,
        newModelId,
        blockIdToRemove: blockId,
        mapping: globalMapping,
        nestedPaths,
        availableLocales,
        fullyReplace,
        recordsToPublish: publishAfterChanges ? recordsToPublish : undefined,
      }),
    ),
  );

  return analysis.modularContentFields.length;
}

/**
 * Step 5: Cleans up nested block references (only when fully replacing).
 */
async function cleanupIfFullyReplacing(
  ctx: ConversionContext,
  nestedPaths: NestedBlockPath[],
): Promise<void> {
  const {
    client,
    blockId,
    totalSteps,
    onProgress,
    fullyReplace,
    publishAfterChanges,
    recordsToPublish,
  } = ctx;

  if (fullyReplace) {
    onProgress({
      currentStep: 5,
      totalSteps,
      stepDescription: 'Cleaning up nested block references...',
      percentage: 75,
    });
    const pathsByRootModel = groupPathsByRootModel(nestedPaths, blockId);
    await Promise.all(
      Array.from(pathsByRootModel.entries()).map(([rootModelId, paths]) =>
        cleanupNestedBlocksFromOriginalField(
          client,
          rootModelId,
          paths,
          blockId,
          publishAfterChanges ? recordsToPublish : undefined,
        ),
      ),
    );
  } else {
    onProgress({
      currentStep: 5,
      totalSteps,
      stepDescription: 'Skipping cleanup (preserving original block data)...',
      percentage: 75,
    });
  }
}

/**
 * Steps 6+: Deletes original block and renames the new model (only when fully replacing).
 * Returns the final model API key and the next step index.
 */
async function deleteAndRenameIfFullyReplacing(
  ctx: ConversionContext,
  analysis: Awaited<ReturnType<typeof analyzeBlock>>,
  newModel: { id: string; api_key: string },
  startStep: number,
): Promise<{ finalModelApiKey: string; nextStep: number }> {
  const { client, blockId, totalSteps, onProgress, fullyReplace } = ctx;

  if (!fullyReplace)
    return { finalModelApiKey: newModel.api_key, nextStep: startStep };

  onProgress({
    currentStep: startStep,
    totalSteps,
    stepDescription: 'Deleting original block model...',
    percentage: 80,
  });
  await deleteOriginalBlock(client, blockId);

  onProgress({
    currentStep: startStep,
    totalSteps,
    stepDescription: 'Renaming converted model to original name...',
    percentage: 85,
  });
  const renameResult = await renameModelToOriginal(
    client,
    newModel.id,
    analysis.block.name,
    analysis.block.apiKey,
  );
  const finalModelApiKey = renameResult.success
    ? renameResult.finalApiKey
    : newModel.api_key;

  return { finalModelApiKey, nextStep: startStep + 1 };
}

export async function convertBlockToModel(
  client: CMAClient,
  blockId: string,
  onProgress: ProgressCallback,
  fullyReplace: boolean = false,
  publishAfterChanges: boolean = false,
): Promise<ConversionResult> {
  let totalSteps = 6;
  if (fullyReplace) totalSteps++;
  if (publishAfterChanges) totalSteps++;

  const recordsToPublish = new Set<string>();
  let migratedRecordsCount = 0;
  let convertedFieldsCount = 0;

  const ctx: ConversionContext = {
    client,
    blockId,
    totalSteps,
    onProgress,
    recordsToPublish,
    publishAfterChanges,
    fullyReplace,
  };

  try {
    const {
      analysis,
      nestedPaths,
      shouldLocalizeFields,
      availableLocales,
      newModel,
    } = await analyzeAndCreateModel(ctx);

    if (analysis.modularContentFields.length === 0) {
      return {
        success: false,
        migratedRecordsCount: 0,
        convertedFieldsCount: 0,
        error: 'This block is not used in any modular content fields',
      };
    }

    const globalMapping = await migrateAllPaths(
      ctx,
      nestedPaths,
      newModel.id,
      availableLocales,
      shouldLocalizeFields,
      (count) => {
        migratedRecordsCount = count;
      },
    );

    if (publishAfterChanges) {
      for (const newRecordId of Object.values(globalMapping)) {
        recordsToPublish.add(newRecordId);
      }
    }

    convertedFieldsCount = await convertAllFields(
      ctx,
      analysis,
      newModel.id,
      globalMapping,
      nestedPaths,
      availableLocales,
    );
    await cleanupIfFullyReplacing(ctx, nestedPaths);

    let currentStep = 6;
    const { finalModelApiKey, nextStep } =
      await deleteAndRenameIfFullyReplacing(
        ctx,
        analysis,
        newModel,
        currentStep,
      );
    currentStep = nextStep;

    if (publishAfterChanges && recordsToPublish.size > 0) {
      await publishRecords(
        client,
        recordsToPublish,
        currentStep,
        totalSteps,
        onProgress,
      );
      currentStep++;
    }

    const completionDetails = buildCompletionDetails(
      finalModelApiKey,
      migratedRecordsCount,
      fullyReplace,
      publishAfterChanges,
      recordsToPublish.size,
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
 * Migrates a single nested path — either using grouped (localized) or standard migration.
 * Extracted to keep the main loop body focused on iteration.
 */
async function migrateSingleNestedPath(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  blockId: string,
  newModelId: string,
  globalMapping: BlockMigrationMapping,
  availableLocales: string[],
  shouldLocalizeFields: boolean,
  onCount: (count: number) => void,
): Promise<BlockMigrationMapping> {
  if (nestedPath.isInLocalizedContext) {
    const groupedInstances = await getGroupedBlockInstances(
      client,
      nestedPath,
      blockId,
    );
    return migrateGroupedBlocksToRecords(
      client,
      groupedInstances,
      newModelId,
      availableLocales,
      globalMapping,
      onCount,
    );
  }

  return migrateBlocksToRecordsNested(
    client,
    nestedPath,
    blockId,
    newModelId,
    globalMapping,
    onCount,
    {
      forceLocalizedFields: shouldLocalizeFields,
      availableLocales,
    },
  );
}

/**
 * Groups nested paths by their root model ID for efficient batch processing.
 * Only includes paths with nested blocks (more than 1 step) where there are
 * remaining block types in the field.
 */
function groupPathsByRootModel(
  nestedPaths: NestedBlockPath[],
  blockId: string,
): Map<string, NestedBlockPath[]> {
  const pathsByRootModel = new Map<string, NestedBlockPath[]>();

  for (const path of nestedPaths) {
    // Only process paths with nested blocks where there are remaining block types
    if (path.path.length > 1) {
      const mcField = path.fieldInfo;
      const remainingBlockIds = mcField.allowedBlockIds.filter(
        (id) => id !== blockId,
      );
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
  onProgress: ProgressCallback,
): Promise<void> {
  onProgress({
    currentStep,
    totalSteps,
    stepDescription: `Publishing ${recordsToPublish.size} records...`,
    percentage: 90,
  });

  const recordIds = Array.from(recordsToPublish);
  const batchSize = 10;

  // Build all batches upfront and publish each batch concurrently
  const batches: string[][] = [];
  for (let i = 0; i < recordIds.length; i += batchSize) {
    batches.push(recordIds.slice(i, i + batchSize));
  }

  await Promise.all(
    batches.map((batch) =>
      Promise.all(
        batch.map(async (recordId) => {
          try {
            await client.items.publish(recordId);
          } catch (error) {
            console.warn(`Failed to publish record ${recordId}:`, error);
          }
        }),
      ),
    ),
  );

  onProgress({
    currentStep,
    totalSteps,
    stepDescription: `Published ${recordIds.length} records`,
    percentage: 99,
  });
}

/**
 * Builds the completion details message.
 */
function buildCompletionDetails(
  newModelApiKey: string,
  migratedRecordsCount: number,
  fullyReplace: boolean,
  publishAfterChanges: boolean,
  publishedCount: number,
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
