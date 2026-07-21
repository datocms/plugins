import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { buildDatoCMSClient } from '../utils/clients';
import { buildRecordEditorUrl } from '../utils/recordUrl';
import {
  createSchemaRepository,
  type SchemaRepository,
} from '../utils/schemaRepository';
import { LocaleChip } from './BulkTranslations/LocaleChip';
import { ProgressRow } from './BulkTranslations/ProgressRow';
import {
  bulkPublishTranslatedRecords,
  getDraftModeItemTypeIds,
  getPublishableTranslatedRecordIds,
} from '../utils/translation/BulkPublishUtils';
import {
  formatErrorForUser,
  normalizeProviderError,
} from '../utils/translation/ProviderErrors';
import {
  buildFieldTypeDictionaryWithRepo,
  type DatoCMSRecordFromAPI,
  fetchRecordsWithPagination,
  type ProgressUpdate,
  translateAndUpdateRecords,
} from '../utils/translation/ItemsDropdownUtils';
import { getProvider } from '../utils/translation/ProviderFactory';
import './TranslationProgressModal.css';

// ProgressUpdate type imported from ItemsDropdownUtils

/**
 * Parameters passed to the translation modal.
 * NOTE: Keep in sync with TranslationProgressModalParams in main.tsx
 */
interface TranslationProgressModalParams {
  totalRecords: number;
  fromLocale: string;
  /**
   * Target locale keys (one or more). Each record is translated into every
   * target locale and saved in a single CMA call.
   */
  toLocales: string[];
  accessToken: string;
  pluginParams: ctxParamsType;
  itemIds: string[];
  /**
   * Optional per-model field allowlist (keyed by item_type id). When present,
   * only the listed field api_keys are translated for matching records.
   */
  selectedFieldsByModel?: Record<string, string[]>;
}

interface TranslationProgressModalProps {
  ctx: RenderModalCtx;
  parameters: TranslationProgressModalParams;
}

function getTranslationErrorMessage(
  error: unknown,
  vendor: ctxParamsType['vendor'],
): string {
  return formatErrorForUser(normalizeProviderError(error, vendor ?? 'openai'));
}

async function loadDraftModeItemTypeIds(
  records: DatoCMSRecordFromAPI[],
  schemaRepository: SchemaRepository,
  enableDebugging: boolean | undefined,
): Promise<string[]> {
  try {
    return await getDraftModeItemTypeIds(
      records.map((record) => record.item_type.id),
      (itemTypeId) => schemaRepository.getItemTypeById(itemTypeId),
    );
  } catch (error) {
    // Translation can still proceed if this optional eligibility lookup fails;
    // the publish action simply remains unavailable.
    if (enableDebugging) {
      console.error(
        'Could not determine which translated models support publishing:',
        error,
      );
    }
    return [];
  }
}

function getPublishButtonLabel(
  isPublishing: boolean,
  publishedCount: number,
  totalCount: number,
  remainingCount: number,
): string {
  if (isPublishing) {
    return `Publishing ${publishedCount} of ${totalCount}…`;
  }
  if (remainingCount === 0) {
    return `Published ${totalCount} record${totalCount === 1 ? '' : 's'}`;
  }
  if (publishedCount > 0) {
    return `Retry publishing remaining (${remainingCount})`;
  }
  return `Publish all translated records (${totalCount})`;
}

function getPartialPublishMessage(publishedCount: number): string {
  if (publishedCount === 0) return '';
  return ` ${publishedCount} record${publishedCount === 1 ? '' : 's'} were published before the operation stopped.`;
}

function useBulkPublishing({
  ctx,
  accessToken,
  pluginParams,
  publishableRecordIds,
  canPublish,
}: {
  ctx: RenderModalCtx;
  accessToken: string;
  pluginParams: ctxParamsType;
  publishableRecordIds: string[];
  canPublish: boolean;
}) {
  const [publishedRecordIds, setPublishedRecordIds] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const publishedRecordIdSet = new Set(publishedRecordIds);
  const remainingRecordIds = publishableRecordIds.filter(
    (recordId) => !publishedRecordIdSet.has(recordId),
  );
  const hasPublishedAll =
    publishableRecordIds.length > 0 && remainingRecordIds.length === 0;

  const handlePublish = async () => {
    if (isPublishing || remainingRecordIds.length === 0 || !canPublish) return;

    setIsPublishing(true);
    let publishedThisAttempt = 0;

    try {
      const client = buildDatoCMSClient(
        accessToken,
        ctx.environment,
        ctx.cmaBaseUrl,
      );
      await bulkPublishTranslatedRecords(
        client,
        remainingRecordIds,
        (batchRecordIds) => {
          publishedThisAttempt += batchRecordIds.length;
          setPublishedRecordIds((currentRecordIds) => [
            ...new Set([...currentRecordIds, ...batchRecordIds]),
          ]);
        },
      );
    } catch (error) {
      await ctx.alert(
        `Could not publish all translated records.${getPartialPublishMessage(
          publishedThisAttempt,
        )} ${getTranslationErrorMessage(error, pluginParams.vendor)}`,
      );
      return;
    } finally {
      setIsPublishing(false);
    }

    await ctx.notice(
      `Published ${publishableRecordIds.length} translated record${publishableRecordIds.length === 1 ? '' : 's'}.`,
    );
  };

  return {
    handlePublish,
    hasPublishedAll,
    isPublishing,
    publishButtonLabel: getPublishButtonLabel(
      isPublishing,
      publishedRecordIds.length,
      publishableRecordIds.length,
      remainingRecordIds.length,
    ),
  };
}

/**
 * Modal component that displays translation progress and handles the translation process.
 * Shows a progress bar, status updates for each record being translated,
 * and provides cancel/close actions.
 */
export default function TranslationProgressModal({
  ctx,
  parameters,
}: TranslationProgressModalProps) {
  const {
    totalRecords,
    fromLocale,
    toLocales,
    accessToken,
    pluginParams,
    itemIds,
    selectedFieldsByModel,
  } = parameters;
  const [progress, setProgress] = useState<ProgressUpdate[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  // Cancellation is read from inside a long-running async loop, so it must be a
  // ref: a state value would be captured stale in the once-only effect closure
  // (the `checkCancellation` callback would forever read its mount-time `false`).
  const isCancelledRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasFatalError, setHasFatalError] = useState(false);
  const [draftModeItemTypeIds, setDraftModeItemTypeIds] = useState<string[]>(
    [],
  );
  const abortRef = useRef<AbortController | null>(null);
  const updatesRef = useRef<HTMLDivElement | null>(null);

  // Use a ref to track if we've started the translation process
  const hasStartedTranslation = useRef(false);

  // Stable callback to add a progress update — wrapped in useCallback so it
  // can be safely listed as a useEffect dependency without causing re-runs.
  const addProgressUpdate = useCallback((update: ProgressUpdate) => {
    // Drop updates that arrive after a cancel: the modal has already resolved
    // and the loop is unwinding, so committing more state is wasted (and would
    // warn about setting state on an unmounting component).
    if (isCancelledRef.current) return;
    setProgress((prev) => {
      // Filter out previous updates for the same record and create a new array
      const filteredUpdates = prev.filter(
        (p) => p.recordIndex !== update.recordIndex,
      );
      return [...filteredUpdates, update];
    });
  }, []);

  // Handle the translation process - runs once on mount
  useEffect(() => {
    let isMounted = true;
    const setDraftModeIdsIfMounted = (itemTypeIds: string[]) => {
      if (isMounted) setDraftModeItemTypeIds(itemTypeIds);
    };

    const processTranslation = async () => {
      // Guard: only start once per modal instance
      if (!isMounted || hasStartedTranslation.current) return;

      hasStartedTranslation.current = true;
      setIsProcessing(true);

      try {
        const client = buildDatoCMSClient(
          accessToken,
          ctx.environment,
          ctx.cmaBaseUrl,
        );
        const records = await fetchRecordsWithPagination(client, itemIds);
        const provider = getProvider(pluginParams);

        // Create SchemaRepository for cached schema lookups
        const schemaRepository = createSchemaRepository(client);

        // The publish action is only valid for records belonging to models
        // with DatoCMS draft/published mode enabled. Resolve this from the full
        // schema instead of the partial item-type data available on the ctx.
        const resolvedDraftModeItemTypeIds = await loadDraftModeItemTypeIds(
          records,
          schemaRepository,
          pluginParams.enableDebugging,
        );
        setDraftModeIdsIfMounted(resolvedDraftModeItemTypeIds);

        // Use SchemaRepository for field dictionary lookups (cached automatically)
        const getFieldTypeDictionary = async (itemTypeId: string) => {
          return buildFieldTypeDictionaryWithRepo(schemaRepository, itemTypeId);
        };

        // Prepare AbortController for in-flight cancellations
        const controller = new AbortController();
        abortRef.current = controller;

        await translateAndUpdateRecords(
          records,
          client,
          provider,
          fromLocale,
          toLocales,
          getFieldTypeDictionary,
          pluginParams,
          ctx,
          accessToken,
          {
            onProgress: addProgressUpdate,
            checkCancellation: () => isCancelledRef.current,
            abortSignal: controller.signal,
            selectedFieldsByModel,
          },
          schemaRepository,
        );

        // Clear the processing flag on the happy path too. The completion
        // effect below only fires when every record reports back; if fewer
        // records come back than requested (e.g. some were deleted between
        // selection and fetch) that effect never runs, and without this the
        // Close button would stay disabled forever.
        if (isMounted) {
          setIsProcessing(false);
        }
      } catch (error) {
        if (isMounted) {
          setHasFatalError(true);
          setIsProcessing(false);
          const failureMessage = `Translation failed: ${getTranslationErrorMessage(
            error,
            pluginParams.vendor,
          )}`;
          addProgressUpdate({
            recordIndex: -1,
            recordId: 'fatal',
            status: 'error',
            message: failureMessage,
            statusText: failureMessage,
            // Carry the reason as a warning so the row can expose the details.
            warnings: [failureMessage],
          });
        }
      }
    };

    processTranslation();

    return () => {
      isMounted = false;
    };
    // Intentionally run only on mount - hasStartedTranslation ref prevents re-execution
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accessToken,
    addProgressUpdate,
    ctx,
    fromLocale,
    itemIds,
    pluginParams,
    selectedFieldsByModel,
    toLocales,
  ]);

  // Translation handled by shared translateAndUpdateRecords utility

  // Translation progress updates handled via shared translator callbacks

  // Calculate completed counts correctly considering all processed records (completed or error)
  const processedRecords = Object.values(
    progress.reduce(
      (uniqueRecords, update) => {
        uniqueRecords[update.recordIndex] = update;
        return uniqueRecords;
      },
      {} as Record<number, ProgressUpdate>,
    ),
  );

  const completedCount = processedRecords.filter(
    (update) => update.status === 'completed' || update.status === 'error',
  ).length;

  const successfulCount = processedRecords.filter(
    (update) => update.status === 'completed',
  ).length;
  const failedCount = processedRecords.filter(
    (update) => update.status === 'error',
  ).length;
  // Records that finished but raised warnings (e.g. copied linked records),
  // ordered by their position so the list reads top-to-bottom.
  const recordsWithWarnings = processedRecords
    .filter((update) => (update.warnings?.length ?? 0) > 0)
    .sort((a, b) => a.recordIndex - b.recordIndex);
  const publishableRecordIds = getPublishableTranslatedRecordIds(
    processedRecords,
    draftModeItemTypeIds,
  );
  const {
    handlePublish,
    hasPublishedAll,
    isPublishing,
    publishButtonLabel,
  } = useBulkPublishing({
    ctx,
    accessToken,
    pluginParams,
    publishableRecordIds,
    canPublish: isCompleted && !hasFatalError,
  });

  const buildRecordUrl = (update: ProgressUpdate): string | undefined =>
    buildRecordEditorUrl({
      internalDomain: ctx.site?.attributes?.internal_domain,
      environment: ctx.environment,
      isEnvironmentPrimary: ctx.isEnvironmentPrimary,
      itemTypeId: update.itemTypeId,
      recordId: update.recordId,
    });

  const percentComplete =
    totalRecords > 0 ? Math.round((completedCount / totalRecords) * 100) : 0;

  // Make sure to set completed state when all records are processed
  useEffect(() => {
    if (completedCount >= totalRecords && totalRecords > 0) {
      setIsCompleted(true);
      setIsProcessing(false);
    }
  }, [completedCount, totalRecords]);

  // Keep the viewport anchored to the top so newest entries (rendered first)
  // are always visible without manual scrolling.
  useEffect(() => {
    const el = updatesRef.current;
    if (!el) return;
    // If user hasn't scrolled away from the top significantly, pin to top
    if (el.scrollTop <= 8) {
      el.scrollTop = 0;
    }
  }, []);

  const handleClose = () => {
    const hasErrors = hasFatalError || processedRecords.some(
      (update) => update.status === 'error',
    );
    ctx.resolve({ completed: isCompleted && !hasErrors, canceled: false, progress });
  };

  const handleCancel = () => {
    isCancelledRef.current = true;
    // Abort in-flight requests to stop streaming immediately
    abortRef.current?.abort();
    ctx.resolve({ completed: false, canceled: true });
  };

  return (
    <Canvas ctx={ctx}>
      <div className="TranslationProgressModal">
        <div className="TranslationProgressModal__intro">
          <div className="TranslationProgressModal__languages">
            <div className="TranslationProgressModal__lang-row">
              <span className="TranslationProgressModal__lang-label">From</span>
              <LocaleChip locale={fromLocale} />
            </div>
            <div className="TranslationProgressModal__lang-row">
              <span className="TranslationProgressModal__lang-label">To</span>
              <div className="TranslationProgressModal__lang-chips">
                {toLocales.map((loc) => (
                  <LocaleChip key={loc} locale={loc} />
                ))}
              </div>
            </div>
            <p className="TranslationProgressModal__progress-text">
              Progress: {completedCount} of {totalRecords} records processed (
              {percentComplete}%)
            </p>
            <p className="TranslationProgressModal__stats">
              {successfulCount} successful
              {recordsWithWarnings.length > 0 &&
                ` (${recordsWithWarnings.length} with warnings)`}
              , {failedCount} failed
            </p>
          </div>
          {/* Progress bar */}
          <div className="TranslationProgressModal__progress-bar">
            <div
              className="TranslationProgressModal__progress-bar-fill"
              style={{ width: `${percentComplete}%` }}
            />
          </div>
        </div>

        {/* Progress list */}
        <div
          className="TranslationProgressModal__updates"
          ref={updatesRef}
          aria-live="polite"
        >
          {progress.length > 0 ? (
            <ul className="TranslationProgressModal__update-list">
              {progress
                .slice()
                // Newest updates first so the most recent work is visible
                .sort((a, b) => b.recordIndex - a.recordIndex)
                .map((update) => (
                  <ProgressRow
                    key={update.recordId}
                    update={update}
                    recordUrl={buildRecordUrl(update)}
                  />
                ))}
            </ul>
          ) : (
            <div className="TranslationProgressModal__initializing">
              <div className="TranslationProgressModal__spinner-container">
                <Spinner size={20} />
                <span>Initializing translation...</span>
              </div>
            </div>
          )}
        </div>

        <div className="TranslationProgressModal__footer">
          {!isCompleted && isProcessing && (
            <Button
              type="button"
              buttonType="negative"
              onClick={handleCancel}
              buttonSize="s"
            >
              Cancel
            </Button>
          )}
          {isCompleted &&
            !hasFatalError &&
            publishableRecordIds.length > 0 && (
              <Button
                type="button"
                buttonType="muted"
                onClick={handlePublish}
                disabled={isPublishing || hasPublishedAll}
                buttonSize="s"
              >
                {publishButtonLabel}
              </Button>
            )}
          <Button
            type="button"
            buttonType="primary"
            onClick={handleClose}
            disabled={isPublishing || (isProcessing && !isCompleted)}
            buttonSize="s"
          >
            {isCompleted ? 'Close' : isProcessing ? 'Please wait...' : 'Close'}
          </Button>
        </div>
      </div>
    </Canvas>
  );
}
