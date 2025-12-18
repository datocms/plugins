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
import { buildClient } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { 
  Canvas
} from 'datocms-react-ui';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ConfigurationForm } from '../components/ConfigurationForm/ConfigurationForm';
import { ProgressView } from '../components/ProgressView/ProgressView';
import type { ProgressUpdate } from '../components/ProgressView/ProgressView';
import { SummaryView } from '../components/SummaryView/SummaryView';
import { useDuplicationStats } from '../hooks/useDuplicationStats';
import { getLocaleLabel } from '../utils/localeHelpers';
import { getErrorMessage, LocalizedField, ModelOption } from '../types';
import { formatErrorMessage } from '../utils/errorMessages';
import { removeBlockItemIdsMutable } from '../utils/fieldUtils';

/**
 * Describes a structure that maps field keys to their localized fields.
 * This is used to accumulate updates for each record based on locale.
 * 
 * @interface Updates
 * @example
 * // Example structure:
 * {
 *   "title": { "en": "Title", "fr": "Titre" },
 *   "description": { "en": "Description", "fr": "Description" }
 * }
 */
interface Updates {
  [fieldKey: string]: LocalizedField;
}




/**
 * Core function to duplicate locale content from one locale to another.
 * 
 * This function performs the following steps:
 * 1. Fetches all content models from DatoCMS (excluding modular blocks)
 * 2. For each model, fetches all records
 * 3. For each record, copies localized fields from source to target locale
 * 4. Handles structured content by removing IDs to prevent collisions
 * 5. Updates records via the CMA API and provides progress updates
 *
 * @async
 * @param ctx - DatoCMS plugin context providing access to the CMA client
 * @param sourceLocale - The locale identifier to copy content from
 * @param targetLocale - The locale identifier to copy content into
 * @param onProgress - Callback function to report progress during the operation
 * @param selectedModelIds - Optional array of model IDs to process (if not provided, all models are processed)
 * @param abortSignal - Optional signal to abort the process
 * @throws Will throw an error if API requests fail or if content cannot be updated
 */
async function duplicateLocaleContent(
  ctx: RenderPageCtx,
  sourceLocale: string,
  targetLocale: string,
  onProgress: (update: ProgressUpdate) => void,
  selectedModelIds?: string[],
  abortSignal?: { current: boolean },
  useDraftRecords: boolean = true,
  publishAfterDuplication: boolean = false
) {
  // Initialize the CMA client with the current user's access token
  // Use empty string fallback to ensure type safety
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken || '',
    environment: ctx.environment,
  });

  try {
    // Step 1: Retrieve and filter content models
    const allModels = await client.itemTypes.list();
    // We exclude modular blocks as they're handled differently
    let models = allModels.filter((model) => !model.modular_block);
    
    // If selectedModelIds is provided, filter models to include only those selected
    if (selectedModelIds && selectedModelIds.length > 0) {
      models = models.filter(model => selectedModelIds.includes(model.id));
    }

    onProgress({
      message: `Found ${models.length} content models to process`,
      type: 'info',
      timestamp: Date.now(),
      progress: 5, // Initial progress indication
    });

    // Track total records processed and records to publish
    let totalRecordsProcessed = 0;
    const recordsToPublish: Array<{ type: 'item'; id: string }> = [];
    
    // Step 2: Process each content model
    for (let i = 0; i < models.length; i++) {
      // Check if abort was requested before processing each model
      if (abortSignal?.current) {
        onProgress({
          message: 'Process aborted by user',
          type: 'error',
          timestamp: Date.now(),
          progress: 5 + Math.round((i / models.length) * 90),
        });
        return;
      }
      
      const model = models[i];
      // Calculate progress range for this model
      const modelStartProgress = 5 + Math.round((i / models.length) * 90);
      const modelEndProgress = 5 + Math.round(((i + 1) / models.length) * 90);
      let recordsInModel = 0;
      
      onProgress({
        message: `Processing model: ${model.name}`,
        type: 'info',
        timestamp: Date.now(),
        progress: modelStartProgress,
        modelId: model.id,
        modelName: model.name
      });

      try {
        // Step 3: Collect all records for the current model first
        const recordsToProcess = [];
        for await (const record of client.items.rawListPagedIterator({
          filter: {
            type: model.api_key,
          },
          nested: true, // Include nested records for structured content
          version: useDraftRecords ? "current" : "published"
        })) {
          recordsToProcess.push(record);
        }
        
        // Now process each record with accurate progress
        for (let j = 0; j < recordsToProcess.length; j++) {
          const record = recordsToProcess[j];
          
          // Check if abort was requested before processing each record
          if (abortSignal?.current) {
            onProgress({
              message: 'Process aborted by user',
              type: 'error',
              timestamp: Date.now(),
              progress: modelStartProgress + Math.round((j / recordsToProcess.length) * (modelEndProgress - modelStartProgress)),
            });
            return;
          }
          
          try {
            // Initialize container for updates to this record
            let updates: Updates = {};

            // Step 4: Analyze each field in the record
            for (const [fieldKey, fieldValue] of Object.entries(
              record.attributes
            )) {
              // Skip non-localizable or system fields
              if (
                fieldKey.startsWith('_') ||
                [
                  'id',
                  'type',
                  'meta',
                  'created_at',
                  'updated_at',
                  'is_valid',
                  'item_type',
                ].includes(fieldKey)
              ) {
                continue;
              }

              // Step 5: Check if field is localized and contains the source locale
              if (
                fieldValue &&
                typeof fieldValue === 'object' &&
                !Array.isArray(fieldValue) &&
                Object.keys(fieldValue).includes(sourceLocale)
              ) {
                // Clone the localized field values
                const localizedField = fieldValue as Record<string, unknown>;
                updates[fieldKey] = { ...localizedField };

                // Step 6: Copy content from source locale to target locale
                updates[fieldKey][targetLocale] = localizedField[sourceLocale];

                // Step 7: Process structured content to remove IDs
                updates = removeBlockItemIdsMutable(updates) as Updates;
              }
            }

            // Step 8: Apply updates if there are any changes to make
            if (Object.keys(updates).length > 0) {
              try {
                await client.items.update(record.id, updates);
                
                // Track record for bulk publishing later
                if (publishAfterDuplication) {
                  recordsToPublish.push({ type: 'item', id: record.id });
                }
                
                totalRecordsProcessed++;
                recordsInModel++;
                const currentProgress = modelStartProgress + Math.round(((j + 1) / recordsToProcess.length) * (modelEndProgress - modelStartProgress));
                onProgress({
                  message: `Updated record ${record.id} in ${model.name}`,
                  type: 'success',
                  timestamp: Date.now(),
                  recordId: record.id,
                  modelId: model.id,
                  modelName: model.name,
                  progress: currentProgress
                });
              } catch (updateError: unknown) {
                totalRecordsProcessed++;
                recordsInModel++;
                const currentProgress = modelStartProgress + Math.round(((j + 1) / recordsToProcess.length) * (modelEndProgress - modelStartProgress));
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
                  progress: currentProgress
                });
                throw updateError;
              }
            }
          } catch (error) {
            // Error handling for the current record is complete, moving to next record
            // Individual record errors don't halt the entire process
          }
        }
      } catch (modelError) {
        const errorMessage = formatErrorMessage('MODEL_PROCESSING_FAILED', {
          modelName: model.name,
          errorDetails: getErrorMessage(modelError)
        });
        onProgress({
          message: errorMessage,
          type: 'error',
          timestamp: Date.now(),
          modelId: model.id,
          modelName: model.name,
          progress: modelStartProgress
        });
        // Error handling for the current model is complete, moving to next model
        // Individual model errors don't halt the entire process
      }
    }

    // Step 9: Bulk publish all updated records if enabled
    if (publishAfterDuplication && recordsToPublish.length > 0) {
      onProgress({
        message: `Publishing ${recordsToPublish.length} updated records...`,
        type: 'info',
        timestamp: Date.now(),
        progress: 95,
      });
      
      try {
        // Publish records in batches of 100 to avoid API limits
        const batchSize = 100;
        for (let i = 0; i < recordsToPublish.length; i += batchSize) {
          const batch = recordsToPublish.slice(i, i + batchSize);
          await client.items.bulkPublish({
            items: batch
          });
        }
        
        onProgress({
          message: `Successfully published ${recordsToPublish.length} records`,
          type: 'success',
          timestamp: Date.now(),
          progress: 98,
        });
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
      }
    }

    // Step 10: Finalize and report completion
    onProgress({
      message: 'Migration completed successfully!',
      type: 'success',
      timestamp: Date.now(),
      progress: 100, // Final progress indication
    });
  } catch (error) {
    // Handle any unexpected errors that weren't caught by more specific handlers
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
 * This component provides:  
 * 1. A user interface for selecting source and target locales  
 * 2. Controls to initiate the duplication process  
 * 3. Confirmation dialogs to prevent accidental operations  
 * 4. Real-time progress updates during the duplication  
 *
 * @component
 * @param props - Component properties
 * @param props.ctx - DatoCMS plugin context that provides access to site configuration and APIs
 * @returns A React element containing the plugin's locale duplication interface
 */
export default function SettingsAreaSidebar({ ctx }: { ctx: RenderPageCtx }) {
  // Retrieve available locales from the DatoCMS site configuration
  const currentSiteLocales = ctx.site.attributes.locales;

  // State management for locale selection
  const [sourceLocale, setSourceLocale] = useState<string>(
    currentSiteLocales[0] // Default to first locale as source
  );
  const [targetLocale, setTargetLocale] = useState<string>(
    currentSiteLocales[1] || currentSiteLocales[0] // Default to second locale as target
  );

  // State for tracking the duplication process
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [isAborting, setIsAborting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  
  // Use custom hook for duplication statistics management
  const { 
    stats: duplicationStats, 
    initializeStats,
    addSuccess,
    addFailure,
    finalizeStats,
    reset: resetStats 
  } = useDuplicationStats();
  
  // Reference to track if the process should be aborted
  const abortProcessRef = useRef(false);

  // State for available models and selected models
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);
  const [useDraftRecords, setUseDraftRecords] = useState<boolean>(true);
  const [publishAfterDuplication, setPublishAfterDuplication] = useState<boolean>(false);
  
  // Calculate progress percentage
  const lastUpdate = progressUpdates[progressUpdates.length - 1];
  const progressPercentage = lastUpdate?.progress ?? 0;


  // Fetch available models on component mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        // Initialize the CMA client
        const client = buildClient({
          apiToken: ctx.currentUserAccessToken || '',
          environment: ctx.environment,
        });

        // Fetch all item types (models)
        const models = await client.itemTypes.list();
        
        // Filter out modular blocks and convert to options format
        const modelOptions = models
          .filter(model => !model.modular_block)
          .map(model => ({
            label: model.name,
            value: model.id
          }));
          
        // Set available models
        setAvailableModels(modelOptions);
        
        // Initialize selected models with all models
        setSelectedModels(modelOptions);
      } catch (error) {
        console.error('Error fetching models:', error);
        ctx.notice(`Error fetching models: ${error}`);
      }
    };

    fetchModels();
  }, [ctx]);
  
  /**
   * Updates statistics based on progress updates
   */
  const updateStatistics = useCallback((update: ProgressUpdate) => {
    if (update.modelId && update.modelName && update.recordId) {
      if (update.type === 'success') {
        addSuccess(update.modelId, update.modelName, update.recordId);
      } else if (update.type === 'error') {
        addFailure(update.modelId, update.modelName, update.recordId);
      }
    }
  }, [addSuccess, addFailure]);

  /**
   * Handler function to add new progress updates to the state.
   * This is passed to the duplicateLocaleContent function as a callback.
   *
   * @param update - A progress update object with message, type, and timestamp
   */
  const handleProgress = useCallback((update: ProgressUpdate) => {
    setProgressUpdates((prev) => [...prev, update]);
    
    // Update statistics
    updateStatistics(update);
  }, [updateStatistics]);

  /**
   * Handles the abortion of the duplication process
   */
  const handleAbortProcess = useCallback(() => {
    ctx.openConfirm({
      title: 'Abort Process',
      content: 'Are you sure you want to abort the duplication process? This will stop the operation but changes already made will remain.',
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
    }).then((result) => {
      if (result === 'abort') {
        setIsAborting(true);
        abortProcessRef.current = true;
        
        // Add an update to the operation log
        handleProgress({
          message: 'Aborting process... Please wait while current operations finish.',
          type: 'error',
          timestamp: Date.now(),
        });
      }
    });
  }, [ctx, handleProgress]);
  
  /**
   * Handles the form submission for locale duplication
   */
  const handleSubmit = () => {
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
        // First confirmation step
        if (result === 'duplicate') {
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
              // Second confirmation step with more explicit warning
              if (result === 'overwrite') {
                // Initialize processing state
                setIsProcessing(true);
                setProgressUpdates([]);
                setShowSummary(false);
                
                // Initialize statistics
                initializeStats();
                
                // Execute the duplication process
                duplicateLocaleContent(
                  ctx,
                  sourceLocale,
                  targetLocale,
                  handleProgress,
                  selectedModels.map(model => model.value),
                  abortProcessRef,
                  useDraftRecords,
                  publishAfterDuplication
                )
                  .then(() => {
                    // Finalize statistics
                    const finalStats = finalizeStats();
                    
                    // Log final statistics for debugging
                    console.log('Final stats being saved:', finalStats);
                    
                    // Check if the process was aborted
                    if (abortProcessRef.current) {
                      ctx.notice('Duplication process was aborted');
                      setShowSummary(false);
                    } else {
                      // Handle successful completion
                      ctx.notice('Locale content duplicated successfully');
                      // Show summary screen
                      setShowSummary(true);
                      
                      // Force a log of final stats
                      console.log('Final duplication stats:', duplicationStats);
                    }
                    setIsProcessing(false);
                    setIsAborting(false);
                    abortProcessRef.current = false;
                  })
                  .catch((error) => {
                    // Handle errors during duplication
                    ctx.notice(
                      `Error duplicating locale content: ${error}`
                    );
                    finalizeStats();
                    setIsProcessing(false);
                    setIsAborting(false);
                    abortProcessRef.current = false;
                    // Still show summary even if there were errors
                    setShowSummary(true);
                  });
              }
            });
        }
      });
  };
  
  /**
   * Handles resetting the form after summary view
   */
  const handleReset = useCallback(() => {
    setShowSummary(false);
    setIsProcessing(false);
    setProgressUpdates([]);
    resetStats();
  }, [resetStats]);
  
  return (
    <ErrorBoundary ctx={ctx}>
      <Canvas ctx={ctx}>
      {/* Form container - hidden during processing or when summary is shown */}
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

      {/* Progress view - only shown during processing */}
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
      
      {/* Summary view - only shown after processing */}
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
