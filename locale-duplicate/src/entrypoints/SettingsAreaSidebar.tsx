/**
 * @file SettingsAreaSidebar.tsx
 * @description Settings area sidebar for the DatoCMS Locale Duplicate plugin.
 * This component provides the mass locale duplication functionality,
 * enabling content editors to duplicate content from one locale to another,
 * maintaining structured content relationships while properly handling nested blocks.
 *
 * This file contains the UI components and core business logic for locale duplication.
 */

// External dependencies
import { buildClient, type Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfigurationForm } from '../components/ConfigurationForm/ConfigurationForm';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { ProgressUpdate } from '../components/ProgressView/ProgressView';
import { ProgressView } from '../components/ProgressView/ProgressView';
import { SummaryView } from '../components/SummaryView/SummaryView';
import { useDuplicationStats } from '../hooks/useDuplicationStats';
import {
  getErrorMessage,
  type LocalizedField,
  type ModelOption,
} from '../types';
import { formatErrorMessage } from '../utils/errorMessages';
import { removeBlockItemIdsMutable } from '../utils/fieldUtils';
import { getLocaleLabel } from '../utils/localeHelpers';

/**
 * Describes a structure that maps field keys to their localized fields.
 */
interface Updates {
  [fieldKey: string]: LocalizedField;
}

/**
 * System fields that should never be copied between locales.
 */
const SYSTEM_FIELDS = new Set([
  'id',
  'type',
  'meta',
  'created_at',
  'updated_at',
  'is_valid',
  'item_type',
]);

/**
 * Checks whether a field should be skipped during locale duplication.
 */
function shouldSkipField(fieldKey: string): boolean {
  return fieldKey.startsWith('_') || SYSTEM_FIELDS.has(fieldKey);
}

/**
 * Checks whether a value is a localized field that contains the source locale.
 */
function isLocalizedFieldWithSourceLocale(
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
 * Builds the update payload for a single record, copying source locale values to target locale.
 */
function buildRecordUpdates(
  recordAttributes: Record<string, unknown>,
  sourceLocale: string,
  targetLocale: string,
): Updates {
  let updates: Updates = {};

  for (const [fieldKey, fieldValue] of Object.entries(recordAttributes)) {
    if (shouldSkipField(fieldKey)) {
      continue;
    }

    if (isLocalizedFieldWithSourceLocale(fieldValue, sourceLocale)) {
      const localizedField = fieldValue as Record<string, unknown>;
      updates[fieldKey] = { ...localizedField };
      updates[fieldKey][targetLocale] = localizedField[sourceLocale];
      updates = removeBlockItemIdsMutable(updates) as Updates;
    }
  }

  return updates;
}

/**
 * Updates a single record by copying locale content and reports progress.
 */
async function updateSingleRecord(
  client: Client,
  record: { id: string; attributes: Record<string, unknown> },
  modelName: string,
  modelId: string,
  sourceLocale: string,
  targetLocale: string,
  publishAfterDuplication: boolean,
  onProgress: (update: ProgressUpdate) => void,
  currentProgress: number,
  recordsToPublish: Array<{ type: 'item'; id: string }>,
): Promise<void> {
  const updates = buildRecordUpdates(
    record.attributes,
    sourceLocale,
    targetLocale,
  );

  if (Object.keys(updates).length === 0) {
    return;
  }

  try {
    await client.items.update(record.id, updates);

    if (publishAfterDuplication) {
      recordsToPublish.push({ type: 'item', id: record.id });
    }

    onProgress({
      message: `Updated record ${record.id} in ${modelName}`,
      type: 'success',
      timestamp: Date.now(),
      recordId: record.id,
      modelId,
      modelName,
      progress: currentProgress,
    });
  } catch (updateError: unknown) {
    const errorMessage = formatErrorMessage('RECORD_UPDATE_FAILED', {
      recordId: record.id,
      modelName,
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
      modelId,
      modelName,
      progress: currentProgress,
    });
    throw updateError;
  }
}

/**
 * Processes all records for a single model, sequentially to support abort signals and progress.
 */
async function processModelRecords(
  client: Client,
  model: { id: string; name: string; api_key: string },
  sourceLocale: string,
  targetLocale: string,
  useDraftRecords: boolean,
  publishAfterDuplication: boolean,
  onProgress: (update: ProgressUpdate) => void,
  abortSignal: { current: boolean } | undefined,
  modelStartProgress: number,
  modelEndProgress: number,
  recordsToPublish: Array<{ type: 'item'; id: string }>,
): Promise<void> {
  // Collect all records first (for-await only used in collection, not inside a loop)
  const recordsToProcess: Array<{
    id: string;
    attributes: Record<string, unknown>;
  }> = [];
  for await (const record of client.items.rawListPagedIterator({
    filter: { type: model.api_key },
    nested: true,
    version: useDraftRecords ? 'current' : 'published',
  })) {
    recordsToProcess.push(record);
  }

  // Process each record sequentially using reduce to avoid await-in-loop
  await recordsToProcess.reduce(async (promiseChain, record, j) => {
    await promiseChain;

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
      return;
    }

    const currentProgress =
      modelStartProgress +
      Math.round(
        ((j + 1) / recordsToProcess.length) *
          (modelEndProgress - modelStartProgress),
      );

    try {
      await updateSingleRecord(
        client,
        record,
        model.name,
        model.id,
        sourceLocale,
        targetLocale,
        publishAfterDuplication,
        onProgress,
        currentProgress,
        recordsToPublish,
      );
    } catch (_error) {
      // Individual record errors do not halt the entire process
    }
  }, Promise.resolve());
}

/**
 * Publishes records in sequential batches to respect API rate limits.
 */
async function publishInBatches(
  client: Client,
  recordsToPublish: Array<{ type: 'item'; id: string }>,
  onProgress: (update: ProgressUpdate) => void,
): Promise<void> {
  onProgress({
    message: `Publishing ${recordsToPublish.length} updated records...`,
    type: 'info',
    timestamp: Date.now(),
    progress: 95,
  });

  try {
    const batchSize = 100;
    const batches: Array<Array<{ type: 'item'; id: string }>> = [];
    for (let i = 0; i < recordsToPublish.length; i += batchSize) {
      batches.push(recordsToPublish.slice(i, i + batchSize));
    }

    await batches.reduce(async (promiseChain, batch) => {
      await promiseChain;
      await client.items.bulkPublish({ items: batch });
    }, Promise.resolve());

    onProgress({
      message: `Successfully published ${recordsToPublish.length} records`,
      type: 'success',
      timestamp: Date.now(),
      progress: 98,
    });
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
  }
}

/**
 * Core function to duplicate locale content from one locale to another.
 *
 * @async
 * @param ctx - DatoCMS plugin context providing access to the CMA client
 * @param sourceLocale - The locale identifier to copy content from
 * @param targetLocale - The locale identifier to copy content into
 * @param onProgress - Callback function to report progress during the operation
 * @param selectedModelIds - Optional array of model IDs to process
 * @param abortSignal - Optional signal to abort the process
 * @param useDraftRecords - Whether to use draft (current) records
 * @param publishAfterDuplication - Whether to publish records after duplication
 */
async function duplicateLocaleContent(
  ctx: RenderPageCtx,
  sourceLocale: string,
  targetLocale: string,
  onProgress: (update: ProgressUpdate) => void,
  selectedModelIds?: string[],
  abortSignal?: { current: boolean },
  useDraftRecords = true,
  publishAfterDuplication = false,
) {
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken ?? '',
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  });

  try {
    const allModels = await client.itemTypes.list();
    let models = allModels.filter((model) => !model.modular_block);

    if (selectedModelIds && selectedModelIds.length > 0) {
      models = models.filter((model) => selectedModelIds.includes(model.id));
    }

    onProgress({
      message: `Found ${models.length} content models to process`,
      type: 'info',
      timestamp: Date.now(),
      progress: 5,
    });

    const recordsToPublish: Array<{ type: 'item'; id: string }> = [];

    // Process each model sequentially using reduce to avoid await-in-loop
    await models.reduce(async (promiseChain, model, i) => {
      await promiseChain;

      if (abortSignal?.current) {
        onProgress({
          message: 'Process aborted by user',
          type: 'error',
          timestamp: Date.now(),
          progress: 5 + Math.round((i / models.length) * 90),
        });
        return;
      }

      const modelStartProgress = 5 + Math.round((i / models.length) * 90);
      const modelEndProgress = 5 + Math.round(((i + 1) / models.length) * 90);

      onProgress({
        message: `Processing model: ${model.name}`,
        type: 'info',
        timestamp: Date.now(),
        progress: modelStartProgress,
        modelId: model.id,
        modelName: model.name,
      });

      try {
        await processModelRecords(
          client,
          model,
          sourceLocale,
          targetLocale,
          useDraftRecords,
          publishAfterDuplication,
          onProgress,
          abortSignal,
          modelStartProgress,
          modelEndProgress,
          recordsToPublish,
        );
      } catch (modelError) {
        const errorMessage = formatErrorMessage('MODEL_PROCESSING_FAILED', {
          modelName: model.name,
          errorDetails: getErrorMessage(modelError),
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
    }, Promise.resolve());

    if (publishAfterDuplication && recordsToPublish.length > 0) {
      await publishInBatches(client, recordsToPublish, onProgress);
    }

    onProgress({
      message: 'Migration completed successfully!',
      type: 'success',
      timestamp: Date.now(),
      progress: 100,
    });
  } catch (error) {
    onProgress({
      message: `Error during migration: ${getErrorMessage(error)} (Check if the original record is currently invalid, and fix validation errors present)`,
      type: 'error',
      timestamp: Date.now(),
    });
    throw error;
  }
}

/**
 * The SettingsAreaSidebar component is the main UI entry point for mass locale duplication.
 *
 * @component
 * @param props - Component properties
 * @param props.ctx - DatoCMS plugin context that provides access to site configuration and APIs
 * @returns A React element containing the plugin's locale duplication interface
 */
export default function SettingsAreaSidebar({ ctx }: { ctx: RenderPageCtx }) {
  const currentSiteLocales = ctx.site.attributes.locales;

  const [sourceLocale, setSourceLocale] = useState<string>(
    currentSiteLocales[0],
  );
  const [targetLocale, setTargetLocale] = useState<string>(
    currentSiteLocales[1] ?? currentSiteLocales[0],
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [isAborting, setIsAborting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const {
    stats: duplicationStats,
    initializeStats,
    addSuccess,
    addFailure,
    finalizeStats,
    reset: resetStats,
  } = useDuplicationStats();

  const abortProcessRef = useRef(false);

  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);
  const [useDraftRecords, setUseDraftRecords] = useState(true);
  const [publishAfterDuplication, setPublishAfterDuplication] = useState(false);

  const lastUpdate = progressUpdates[progressUpdates.length - 1];
  const progressPercentage = lastUpdate?.progress ?? 0;

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const client = buildClient({
          apiToken: ctx.currentUserAccessToken ?? '',
          environment: ctx.environment,
          baseUrl: ctx.cmaBaseUrl,
        });

        const models = await client.itemTypes.list();

        const modelOptions = models
          .filter((model) => !model.modular_block)
          .map((model) => ({
            label: model.name,
            value: model.id,
          }));

        setAvailableModels(modelOptions);
        setSelectedModels(modelOptions);
      } catch (error) {
        console.error('Error fetching models:', error);
        ctx.notice(`Error fetching models: ${error}`);
      }
    };

    fetchModels();
  }, [ctx]);

  const updateStatistics = useCallback(
    (update: ProgressUpdate) => {
      if (update.modelId && update.modelName && update.recordId) {
        if (update.type === 'success') {
          addSuccess(update.modelId, update.modelName, update.recordId);
        } else if (update.type === 'error') {
          addFailure(update.modelId, update.modelName, update.recordId);
        }
      }
    },
    [addSuccess, addFailure],
  );

  const handleProgress = useCallback(
    (update: ProgressUpdate) => {
      setProgressUpdates((prev) => [...prev, update]);
      updateStatistics(update);
    },
    [updateStatistics],
  );

  const handleAbortProcess = useCallback(() => {
    ctx
      .openConfirm({
        title: 'Abort Process',
        content:
          'Are you sure you want to abort the duplication process? This will stop the operation but changes already made will remain.',
        choices: [
          {
            label: 'Yes, abort process',
            value: 'abort',
            intent: 'negative',
          },
        ],
        cancel: {
          label: 'No, continue',
          value: false,
        },
      })
      .then((result) => {
        if (result === 'abort') {
          setIsAborting(true);
          abortProcessRef.current = true;

          handleProgress({
            message:
              'Aborting process... Please wait while current operations finish.',
            type: 'error',
            timestamp: Date.now(),
          });
        }
      });
  }, [ctx, handleProgress]);

  /**
   * Runs the actual duplication after user confirmations are resolved.
   */
  const runDuplication = useCallback(() => {
    setIsProcessing(true);
    setProgressUpdates([]);
    setShowSummary(false);
    initializeStats();

    duplicateLocaleContent(
      ctx,
      sourceLocale,
      targetLocale,
      handleProgress,
      selectedModels.map((model) => model.value),
      abortProcessRef,
      useDraftRecords,
      publishAfterDuplication,
    )
      .then(() => {
        const finalStats = finalizeStats();
        console.log('Final stats being saved:', finalStats);

        if (abortProcessRef.current) {
          ctx.notice('Duplication process was aborted');
          setShowSummary(false);
        } else {
          ctx.notice('Locale content duplicated successfully');
          setShowSummary(true);
          console.log('Final duplication stats:', duplicationStats);
        }
        setIsProcessing(false);
        setIsAborting(false);
        abortProcessRef.current = false;
      })
      .catch((error) => {
        ctx.notice(`Error duplicating locale content: ${error}`);
        finalizeStats();
        setIsProcessing(false);
        setIsAborting(false);
        abortProcessRef.current = false;
        setShowSummary(true);
      });
  }, [
    ctx,
    sourceLocale,
    targetLocale,
    handleProgress,
    selectedModels,
    useDraftRecords,
    publishAfterDuplication,
    initializeStats,
    finalizeStats,
    duplicationStats,
  ]);

  /**
   * Handles the second confirmation (overwrite) step.
   */
  const handleOverwriteConfirmation = useCallback(() => {
    ctx
      .openConfirm({
        title: 'Confirm locale overwrite',
        content: `This will overwrite the content of the target locale (${getLocaleLabel(targetLocale)}) with the content of the source locale (${getLocaleLabel(sourceLocale)}).`,
        choices: [
          {
            label: `Overwrite everything in the ${getLocaleLabel(targetLocale)} locale`,
            value: 'overwrite',
            intent: 'negative',
          },
        ],
        cancel: {
          label: 'Cancel',
          value: false,
        },
      })
      .then((result) => {
        if (result === 'overwrite') {
          runDuplication();
        }
      });
  }, [ctx, sourceLocale, targetLocale, runDuplication]);

  /**
   * Handles the form submission for locale duplication (first confirmation step).
   */
  const handleSubmit = useCallback(() => {
    ctx
      .openConfirm({
        title: 'Duplicate locale content',
        content: 'Are you sure you want to duplicate the locale content?',
        choices: [
          {
            label: 'Duplicate',
            value: 'duplicate',
            intent: 'positive',
          },
        ],
        cancel: {
          label: 'Cancel',
          value: false,
        },
      })
      .then((result) => {
        if (result === 'duplicate') {
          handleOverwriteConfirmation();
        }
      });
  }, [ctx, handleOverwriteConfirmation]);

  const handleReset = useCallback(() => {
    setShowSummary(false);
    setIsProcessing(false);
    setProgressUpdates([]);
    resetStats();
  }, [resetStats]);

  return (
    <ErrorBoundary ctx={ctx}>
      <Canvas ctx={ctx}>
        {!isProcessing && !showSummary && (
          <ConfigurationForm
            sourceLocale={sourceLocale}
            targetLocale={targetLocale}
            currentSiteLocales={currentSiteLocales}
            selectedModels={selectedModels}
            allModels={availableModels}
            useDraftRecords={useDraftRecords}
            publishAfterDuplication={publishAfterDuplication}
            getLocaleLabel={getLocaleLabel}
            onSourceLocaleChange={setSourceLocale}
            onTargetLocaleChange={setTargetLocale}
            onModelsChange={setSelectedModels}
            onUseDraftRecordsChange={setUseDraftRecords}
            onPublishAfterDuplicationChange={setPublishAfterDuplication}
            onSubmit={handleSubmit}
          />
        )}

        {isProcessing && (
          <ProgressView
            ctx={ctx}
            progressUpdates={progressUpdates}
            progressPercentage={progressPercentage}
            isAborting={isAborting}
            sourceLocale={sourceLocale}
            targetLocale={targetLocale}
            getLocaleLabel={getLocaleLabel}
            onAbort={handleAbortProcess}
          />
        )}

        {showSummary && (
          <SummaryView
            duplicationStats={duplicationStats}
            progressUpdates={progressUpdates}
            onReturn={handleReset}
          />
        )}
      </Canvas>
    </ErrorBoundary>
  );
}
