import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { buildDatoCMSClient } from '../utils/clients';
import {
  loadRecordBatches,
  type RecordBatch,
} from '../utils/translation/BulkRecordLoader';
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
} from '../utils/translation/BulkPublishUtils';
import {
  FULL_TRANSLATION_HISTORY_LIMIT,
  TranslationProgressStore,
  VISIBLE_TRANSLATION_UPDATE_LIMIT,
} from '../utils/translation/TranslationProgressStore';
import {
  formatErrorForUser,
  normalizeProviderError,
} from '../utils/translation/ProviderErrors';
import {
  buildFieldTypeDictionaryWithRepo,
  type DatoCMSRecordFromAPI,
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

const PROGRESS_RENDER_INTERVAL_MS = 100;

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
  cancellation: { abortSignal: AbortSignal; checkCancellation: () => boolean },
): Promise<string[] | undefined> {
  try {
    return await getDraftModeItemTypeIds(
      records.map((record) => record.item_type.id),
      (itemTypeId) => schemaRepository.getItemTypeById(itemTypeId),
      cancellation,
    );
  } catch (error) {
    if (cancellation.abortSignal.aborted || cancellation.checkCancellation()) {
      throw error;
    }
    // Translation can still proceed if this optional eligibility lookup fails;
    // the publish action simply remains unavailable.
    if (enableDebugging) {
      console.error(
        'Could not determine which translated models support publishing:',
        error,
      );
    }
    return undefined;
  }
}

type BatchTranslationJob = {
  client: ReturnType<typeof buildDatoCMSClient>;
  provider: ReturnType<typeof getProvider>;
  schemaRepository: SchemaRepository;
  parameters: TranslationProgressModalParams;
  ctx: RenderModalCtx;
  progressStore: TranslationProgressStore;
  onProgress: (update: ProgressUpdate) => void;
  checkCancellation: () => boolean;
  abortSignal: AbortSignal;
};

async function translateLoadedBatch(
  batch: RecordBatch,
  job: BatchTranslationJob,
) {
  const {
    fromLocale,
    toLocales,
    pluginParams,
    accessToken,
    selectedFieldsByModel,
  } = job.parameters;
  for (const recordId of batch.missingItemIds) {
    job.onProgress({
      recordIndex: job.progressStore.getRecordIndex(recordId),
      recordId,
      status: 'error',
      message: 'DatoCMS error: Record is no longer available.',
      statusText: 'Record is no longer available',
      warnings: ['The record was deleted or is no longer accessible.'],
    });
  }

  const modelIds = await loadDraftModeItemTypeIds(
    batch.records,
    job.schemaRepository,
    pluginParams.enableDebugging,
    { abortSignal: job.abortSignal, checkCancellation: job.checkCancellation },
  );
  if (modelIds !== undefined) {
    job.progressStore.registerModelPublishingEligibility(
      batch.records.map((record) => record.item_type.id),
      modelIds,
    );
  }

  await translateAndUpdateRecords(
    batch.records,
    job.client,
    job.provider,
    fromLocale,
    toLocales,
    (id) => buildFieldTypeDictionaryWithRepo(job.schemaRepository, id),
    pluginParams,
    job.ctx,
    accessToken,
    {
      onProgress: job.onProgress,
      getRecordIndex: (id) => job.progressStore.getRecordIndex(id),
      checkCancellation: job.checkCancellation,
      abortSignal: job.abortSignal,
      selectedFieldsByModel,
    },
    job.schemaRepository,
  );
}

async function translateRecordBatches(
  job: BatchTranslationJob,
  loadingClient: ReturnType<typeof buildDatoCMSClient>,
  onLoaded: (loaded: number) => void,
) {
  for await (const batch of loadRecordBatches(
    loadingClient,
    job.parameters.itemIds,
    {
      checkCancellation: job.checkCancellation,
      abortSignal: job.abortSignal,
      onProgress: ({ loaded }) => onLoaded(loaded),
    },
  )) {
    if (job.checkCancellation()) break;
    // Consume each batch before loading more nested content.
    await translateLoadedBatch(batch, job);
    if (job.checkCancellation()) break;
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

function getPublishedNotice(publishedCount: number): string {
  return `Published ${publishedCount} translated record${publishedCount === 1 ? '' : 's'}.`;
}

function useBulkPublishing({
  ctx,
  accessToken,
  pluginParams,
  progressStore,
  publishableCount,
  canPublish,
}: {
  ctx: RenderModalCtx;
  accessToken: string;
  pluginParams: ctxParamsType;
  progressStore: TranslationProgressStore;
  publishableCount: number;
  canPublish: boolean;
}) {
  const publishedRecordIds = useRef(new Set<string>());
  const [publishedCount, setPublishedCount] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCancellingPublishing, setIsCancellingPublishing] = useState(false);
  const publishingController = useRef<AbortController | null>(null);
  const publishRenderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(false);
  const remainingCount = publishableCount - publishedCount;
  const hasPublishedAll = publishableCount > 0 && remainingCount === 0;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      publishingController.current?.abort();
      if (publishRenderTimer.current !== null) {
        clearTimeout(publishRenderTimer.current);
        publishRenderTimer.current = null;
      }
    };
  }, []);

  const cancelPublishing = () => {
    publishingController.current?.abort();
    setIsCancellingPublishing(true);
  };

  const flushPublishedCount = () => {
    if (publishRenderTimer.current !== null) {
      clearTimeout(publishRenderTimer.current);
      publishRenderTimer.current = null;
    }
    if (isMounted.current) {
      setPublishedCount(publishedRecordIds.current.size);
    }
  };

  const registerPublishedRecords = (batchRecordIds: string[]) => {
    for (const id of batchRecordIds) publishedRecordIds.current.add(id);
    if (isMounted.current && publishRenderTimer.current === null) {
      publishRenderTimer.current = setTimeout(
        flushPublishedCount,
        PROGRESS_RENDER_INTERVAL_MS,
      );
    }
  };

  const finishPublishing = () => {
    publishingController.current = null;
    flushPublishedCount();
    if (isMounted.current) {
      setIsPublishing(false);
      setIsCancellingPublishing(false);
    }
  };

  const reportPublishingFailure = async (
    error: unknown,
    publishedThisAttempt: number,
    controller: AbortController,
  ) => {
    if (controller.signal.aborted || !isMounted.current) return;
    await ctx.alert(
      `Could not publish all translated records.${getPartialPublishMessage(
        publishedThisAttempt,
      )} ${getTranslationErrorMessage(error, pluginParams.vendor)}`,
    );
  };

  const handlePublish = async () => {
    if (publishingController.current || remainingCount === 0 || !canPublish)
      return;

    const remainingRecordIds = progressStore
      .getPublishableRecordIds()
      .filter((recordId) => !publishedRecordIds.current.has(recordId));
    if (remainingRecordIds.length === 0) return;

    const controller = new AbortController();
    publishingController.current = controller;
    setIsPublishing(true);
    setIsCancellingPublishing(false);
    let publishedThisAttempt = 0;

    try {
      // Do not abort an in-flight mutation: await its acknowledged result,
      // then cooperatively stop before the next batch.
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
          registerPublishedRecords(batchRecordIds);
        },
        {
          abortSignal: controller.signal,
          expectedVersions: progressStore.getPublishableRecordVersions(),
        },
      );
    } catch (error) {
      await reportPublishingFailure(error, publishedThisAttempt, controller);
      return;
    } finally {
      finishPublishing();
    }

    if (isMounted.current && !controller.signal.aborted) {
      await ctx.notice(getPublishedNotice(publishedRecordIds.current.size));
    }
  };

  return {
    cancelPublishing,
    handlePublish,
    hasPublishedAll,
    isCancellingPublishing,
    isPublishing,
    publishButtonLabel: getPublishButtonLabel(
      isPublishing,
      publishedCount,
      publishableCount,
      remainingCount,
    ),
  };
}

function ProgressActions({
  isCompleted,
  isProcessing,
  isCancelling,
  hasFatalError,
  isPublishing,
  isCancellingPublishing,
  hasPublishedAll,
  publishableCount,
  publishButtonLabel,
  onCancel,
  onCancelPublishing,
  onPublish,
  onClose,
}: {
  isCompleted: boolean;
  isProcessing: boolean;
  isCancelling: boolean;
  hasFatalError: boolean;
  isPublishing: boolean;
  isCancellingPublishing: boolean;
  hasPublishedAll: boolean;
  publishableCount: number;
  publishButtonLabel: string;
  onCancel: () => void;
  onCancelPublishing: () => void;
  onPublish: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="TranslationProgressModal__footer">
      {!isCompleted && isProcessing && (
        <Button
          type="button"
          buttonType="negative"
          onClick={onCancel}
          disabled={isCancelling}
          buttonSize="s"
        >
          {isCancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
      {isPublishing && publishableCount > FULL_TRANSLATION_HISTORY_LIMIT && (
        <Button
          type="button"
          buttonType="negative"
          onClick={onCancelPublishing}
          disabled={isCancellingPublishing}
          buttonSize="s"
        >
          {isCancellingPublishing ? 'Cancelling…' : 'Cancel publishing'}
        </Button>
      )}
      {!isProcessing &&
        (isCompleted || hasFatalError) &&
        publishableCount > 0 && (
          <Button
            type="button"
            buttonType="muted"
            onClick={onPublish}
            disabled={isPublishing || hasPublishedAll}
            buttonSize="s"
          >
            {publishButtonLabel}
          </Button>
        )}
      <Button
        type="button"
        buttonType="primary"
        onClick={onClose}
        disabled={isPublishing || (isProcessing && !isCompleted)}
        buttonSize="s"
      >
        {isCompleted ? 'Close' : isProcessing ? 'Please wait...' : 'Close'}
      </Button>
    </div>
  );
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
  const jobInputs = useRef({ ctx, parameters });
  const { fromLocale, toLocales } = jobInputs.current.parameters;
  const [progressStore] = useState(
    () => new TranslationProgressStore(parameters.itemIds),
  );
  const [progressSnapshot, setProgressSnapshot] = useState(() =>
    progressStore.snapshot(),
  );
  const [isCompleted, setIsCompleted] = useState(false);
  // Cancellation is read from inside a long-running async loop, so it must be a
  // ref: a state value would be captured stale in the once-only effect closure
  // (the `checkCancellation` callback would forever read its mount-time `false`).
  const isCancelledRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [hasFatalError, setHasFatalError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const updatesRef = useRef<HTMLDivElement | null>(null);
  const progressRenderTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isMountedRef = useRef(false);

  // Use a ref to track if we've started the translation process
  const hasStartedTranslation = useRef(false);

  const flushProgress = useCallback(() => {
    if (progressRenderTimer.current !== null) {
      clearTimeout(progressRenderTimer.current);
      progressRenderTimer.current = null;
    }
    if (isMountedRef.current) {
      setProgressSnapshot(progressStore.snapshot());
    }
  }, [progressStore]);

  const scheduleProgressRender = useCallback(() => {
    if (progressRenderTimer.current === null) {
      progressRenderTimer.current = setTimeout(
        flushProgress,
        PROGRESS_RENDER_INTERVAL_MS,
      );
    }
  }, [flushProgress]);

  // Every event updates the counters immediately. UI snapshots copy at most
  // 100 rows and are coalesced so rapid locale/field callbacks do not trigger
  // a full React render for every step of a massive run.
  const addProgressUpdate = useCallback(
    (update: ProgressUpdate) => {
      if (!isMountedRef.current) return;
      // Writes already submitted before Cancel are allowed to settle. Keep
      // their acknowledged completion in the final partial result.
      if (isCancelledRef.current && update.status !== 'completed') return;
      progressStore.add(update);
      scheduleProgressRender();
    },
    [progressStore, scheduleProgressRender],
  );

  // Handle the translation process - runs once on mount
  useEffect(() => {
    let isMounted = true;
    isMountedRef.current = true;
    // The host may replace ctx during a run; use the job's original inputs.
    const { ctx, parameters } = jobInputs.current;
    const { accessToken, pluginParams } = parameters;
    if (!hasStartedTranslation.current) isCancelledRef.current = false;
    const finishTranslation = () => {
      if (!isMounted || isCancelledRef.current) return;
      flushProgress();
      setIsCompleted(true);
      setIsProcessing(false);
    };
    const reportFailure = (error: unknown, controller: AbortController) => {
      if (!isMounted || isCancelledRef.current || controller.signal.aborted)
        return;
      setHasFatalError(true);
      setIsProcessing(false);
      const failureMessage = `Translation failed: ${getTranslationErrorMessage(error, pluginParams.vendor)}`;
      addProgressUpdate({
        recordIndex: -1,
        recordId: 'fatal',
        status: 'error',
        message: failureMessage,
        statusText: failureMessage,
        warnings: [failureMessage],
      });
      flushProgress();
    };

    const processTranslation = async () => {
      // Guard: only start once per modal instance
      if (!isMounted || hasStartedTranslation.current) return;

      hasStartedTranslation.current = true;
      setIsProcessing(true);
      // Loading and translation share one cancellation signal from the start.
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const client = buildDatoCMSClient(
          accessToken,
          ctx.environment,
          ctx.cmaBaseUrl,
        );
        const loadingClient = buildDatoCMSClient(
          accessToken,
          ctx.environment,
          ctx.cmaBaseUrl,
          controller.signal,
        );
        const provider = getProvider(pluginParams);

        // Create SchemaRepository for cached schema lookups
        const schemaRepository = createSchemaRepository(loadingClient);

        const job: BatchTranslationJob = {
          client,
          provider,
          schemaRepository,
          parameters,
          ctx,
          progressStore,
          onProgress: addProgressUpdate,
          checkCancellation: () => isCancelledRef.current,
          abortSignal: controller.signal,
        };

        await translateRecordBatches(job, loadingClient, (loaded) => {
          if (isMounted && !isCancelledRef.current) {
            progressStore.setLoadedCount(loaded);
            scheduleProgressRender();
          }
        });
        finishTranslation();
      } catch (error) {
        reportFailure(error, controller);
      } finally {
        if (isMounted && isCancelledRef.current) {
          flushProgress();
          setIsProcessing(false);
          ctx.resolve({
            completed: false,
            canceled: true,
            summary: progressStore.getSummary(),
          });
        }
      }
    };

    // Defer startup so StrictMode's setup/cleanup probe cannot start requests.
    void Promise.resolve().then(processTranslation);

    return () => {
      isMounted = false;
      isMountedRef.current = false;
      isCancelledRef.current = true;
      abortRef.current?.abort();
      if (progressRenderTimer.current !== null) {
        clearTimeout(progressRenderTimer.current);
        progressRenderTimer.current = null;
      }
    };
  }, [addProgressUpdate, flushProgress, progressStore, scheduleProgressRender]);

  const {
    updates: progress,
    totalRecords,
    processedCount: completedCount,
    successfulCount,
    failedCount,
    warningCount,
    loadedCount: loadedRecords,
    updateCount,
    publishableCount,
  } = progressSnapshot;
  const {
    cancelPublishing,
    handlePublish,
    hasPublishedAll,
    isCancellingPublishing,
    isPublishing,
    publishButtonLabel,
  } = useBulkPublishing({
    ctx: jobInputs.current.ctx,
    accessToken: jobInputs.current.parameters.accessToken,
    pluginParams: jobInputs.current.parameters.pluginParams,
    progressStore,
    publishableCount,
    canPublish: !isProcessing && (isCompleted || hasFatalError),
  });

  const buildRecordUrl = (update: ProgressUpdate): string | undefined =>
    buildRecordEditorUrl({
      internalDomain: jobInputs.current.ctx.site?.attributes?.internal_domain,
      environment: jobInputs.current.ctx.environment,
      isEnvironmentPrimary: jobInputs.current.ctx.isEnvironmentPrimary,
      itemTypeId: update.itemTypeId,
      recordId: update.recordId,
    });

  const percentComplete =
    totalRecords > 0
      ? Math.min(100, Math.round((completedCount / totalRecords) * 100))
      : 0;

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
    const summary = progressStore.getSummary();
    ctx.resolve({
      completed: isCompleted && !hasFatalError && summary.failedCount === 0,
      canceled: false,
      progress: progressStore.getResultUpdates(),
      progressTruncated: progressStore.snapshot().historyTruncated,
      summary,
    });
  };

  const handleCancel = () => {
    if (isCancelledRef.current) return;
    isCancelledRef.current = true;
    setIsCancelling(true);
    // Abort reads/provider work, then await already-submitted writes before
    // returning the partial result from the job's finally block.
    abortRef.current?.abort();
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
              {warningCount > 0 && ` (${warningCount} with warnings)`},{' '}
              {failedCount} failed
            </p>
            <p className="TranslationProgressModal__stats" role="status">
              Records loaded: {loadedRecords} of {totalRecords}
            </p>
          </div>
          {/* Progress bar */}
          <div
            className="TranslationProgressModal__progress-bar"
            role="progressbar"
            aria-label="Translation progress"
            aria-valuemin={0}
            aria-valuemax={totalRecords}
            aria-valuenow={completedCount}
          >
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
                .slice(-VISIBLE_TRANSLATION_UPDATE_LIMIT)
                .reverse()
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
                <span>Loading the first batch of records…</span>
              </div>
            </div>
          )}
        </div>

        {updateCount > VISIBLE_TRANSLATION_UPDATE_LIMIT && (
          <p className="TranslationProgressModal__stats">
            Showing the latest {VISIBLE_TRANSLATION_UPDATE_LIMIT} of{' '}
            {updateCount} updates.
          </p>
        )}

        <ProgressActions
          isCompleted={isCompleted}
          isProcessing={isProcessing}
          isCancelling={isCancelling}
          hasFatalError={hasFatalError}
          isPublishing={isPublishing}
          isCancellingPublishing={isCancellingPublishing}
          hasPublishedAll={hasPublishedAll}
          publishableCount={publishableCount}
          publishButtonLabel={publishButtonLabel}
          onCancel={handleCancel}
          onCancelPublishing={cancelPublishing}
          onPublish={handlePublish}
          onClose={handleClose}
        />
      </div>
    </Canvas>
  );
}
