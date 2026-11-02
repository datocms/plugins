/**
 * TranslationProgressModal.tsx
 * ----------------------------
 * Runs a bulk translation and shows its progress: a status line with a bar
 * and its count of records while it runs, the counts of the result once it
 * ends, and the latest records with their state (once it ends, the records
 * with problems first). The user can cancel the run, publish the translated
 * records of draft-mode models once it ends, and close the modal. Cancel
 * translation stops the run, Cancel publishing stops a large publishing, and
 * Close, enabled once the run and the publishing end, closes it. The modal opens with no host cross (`closeDisabled`): these buttons,
 * and Escape as Close, are the only ways out, so the run never ends without
 * its summary.
 *
 * The frame sizes itself with `useFrameHeight` (main.tsx renders it with
 * `noAutoResizer`): the list of records scrolls inside the modal, and the SDK
 * auto-resizer would grow the frame to fit the rows clipped by that box.
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { useRegisterActions } from 'datocms-react-ui/Actions';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import InfoList from 'datocms-react-ui/InfoList';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import Spinner from 'datocms-react-ui/Spinner';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { buildDatoCMSClient } from '../utils/clients';
import { buildRecordEditorPath } from '../utils/recordUrl';
import { isFocusLost, useBusyFocus } from '../utils/retryFocus';
import {
  createSchemaRepository,
  type SchemaRepository,
} from '../utils/schemaRepository';
import {
  bulkPublishTranslatedRecords,
  getDraftModeItemTypeIds,
} from '../utils/translation/BulkPublishUtils';
import {
  loadRecordBatches,
  type RecordBatch,
} from '../utils/translation/BulkRecordLoader';
import {
  buildFieldTypeDictionaryWithRepo,
  type DatoCMSRecordFromAPI,
  type ProgressUpdate,
  translateAndUpdateRecords,
} from '../utils/translation/ItemsDropdownUtils';
import {
  describeErrorForUser,
  formatErrorForUser,
  normalizeProviderError,
  type UserFacingError,
} from '../utils/translation/ProviderErrors';
import { getProvider } from '../utils/translation/ProviderFactory';
import {
  FULL_TRANSLATION_HISTORY_LIMIT,
  TranslationProgressStore,
  VISIBLE_TRANSLATION_UPDATE_LIMIT,
} from '../utils/translation/TranslationProgressStore';
import { useFrameHeight } from '../utils/useFrameHeight';
import {
  formatCount,
  recordCount,
  recordCountWas,
} from './BulkTranslations/bulkCopy';
import { ProgressRow } from './BulkTranslations/ProgressRow';
import { InsetRowList } from './InsetRowList';
import s from './TranslationProgressModal.module.css';

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

/**
 * The record ID of the update that reports a fatal error of the run. It is
 * not a record: the modal shows it as a danger Callout under the bar.
 */
const FATAL_UPDATE_ID = 'fatal';

/** Whether an update is a record's, not the fatal error of the run. */
function isRecordUpdate(update: ProgressUpdate): boolean {
  return update.recordId !== FATAL_UPDATE_ID;
}

/**
 * The order of the rows once the run ended: failed, not translated (left in
 * progress by a fatal error), translated with warnings, then translated.
 */
const TRANSLATED_RANK = 3;
function rowRank(update: ProgressUpdate): number {
  if (update.status === 'error') return 0;
  if (update.status === 'processing') return 1;
  if ((update.warnings?.length ?? 0) > 0) return 2;
  return TRANSLATED_RANK;
}

/**
 * The rows of the list, newest first, at most
 * VISIBLE_TRANSLATION_UPDATE_LIMIT of them. Once the run ended, the records
 * with problems come first, from the whole history of the run, so that the
 * window of the latest rows never hides one; the latest translated records
 * fill the rest.
 */
function listRows(
  latest: ProgressUpdate[],
  runEnded: boolean,
  getHistory: () => ProgressUpdate[],
): { rows: ProgressUpdate[]; problemCount: number } {
  const newestFirst = latest
    .filter(isRecordUpdate)
    .slice(-VISIBLE_TRANSLATION_UPDATE_LIMIT)
    .reverse();
  if (!runEnded) return { rows: newestFirst, problemCount: 0 };
  const problems = getHistory()
    .filter(
      (update) => isRecordUpdate(update) && rowRank(update) < TRANSLATED_RANK,
    )
    .reverse()
    .sort((a, b) => rowRank(a) - rowRank(b))
    .slice(0, VISIBLE_TRANSLATION_UPDATE_LIMIT);
  const translated = newestFirst
    .filter((update) => rowRank(update) === TRANSLATED_RANK)
    .slice(0, VISIBLE_TRANSLATION_UPDATE_LIMIT - problems.length);
  return { rows: [...problems, ...translated], problemCount: problems.length };
}

/**
 * The lead of the message of a fatal error in the result of the modal,
 * before its cause.
 */
const FATAL_MESSAGE_PREFIX = 'Translation failed: ';

/**
 * The Escape of the modal: Close, with its disabled reason while the run or
 * the publishing goes on.
 */
const CLOSE_ACTION_ID = 'translationProgress.close';

const RUNNING_CLOSE_REASON =
  'The translation is still running. Wait for it to finish, or cancel it.';
const PUBLISHING_CLOSE_REASON = 'Wait for the publishing to finish.';

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
  // A record that didn't load has no title: the row says what became of it.
  for (const recordId of batch.missingItemIds) {
    job.onProgress({
      recordIndex: job.progressStore.getRecordIndex(recordId),
      recordId,
      recordLabel: 'Deleted record',
      status: 'error',
      message: 'DatoCMS error: Record is no longer available.',
      statusText: 'Failed',
      warnings: ['It was deleted, or is no longer available.'],
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
  onLoaded: (loaded: number) => void,
) {
  for await (const batch of loadRecordBatches(
    job.client,
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

/**
 * The label of the publish button: "Publish 10 records", "Publishing 3 of
 * 10…" while it runs, and "Publish the other 3 records" after a partial run.
 * Once every record is published, the button goes: the toast says it.
 */
function getPublishButtonLabel(
  isPublishing: boolean,
  publishedCount: number,
  totalCount: number,
  remainingCount: number,
  locale: string,
): string {
  if (isPublishing) {
    return `Publishing ${formatCount(publishedCount, locale)} of ${formatCount(totalCount, locale)}…`;
  }
  if (publishedCount > 0 && remainingCount > 0) {
    return `Publish the other ${recordCount(remainingCount, locale)}`;
  }
  return `Publish ${recordCount(totalCount, locale)}`;
}

/**
 * The part of a publishing failure that says how many records were
 * published before it stopped: " 1 record was published before the
 * operation stopped.", or nothing when none was.
 */
function getPartialPublishMessage(
  publishedCount: number,
  locale: string,
): string {
  if (publishedCount === 0) return '';
  return ` ${recordCountWas(publishedCount, locale)} published before the operation stopped.`;
}

/** The toast of a finished publishing: "Published 1,500 translated records." */
function getPublishedNotice(publishedCount: number, locale: string): string {
  return `Published ${formatCount(publishedCount, locale)} translated ${
    publishedCount === 1 ? 'record' : 'records'
  }.`;
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
        ctx.ui.locale,
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
      await ctx.notice(
        getPublishedNotice(publishedRecordIds.current.size, ctx.ui.locale),
      );
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
      ctx.ui.locale,
    ),
  };
}

/**
 * Why Close is disabled, if it is: the run must end (or be cancelled), and a
 * publishing must finish, before the modal can close.
 */
function getCloseBlockedReason(
  isRunning: boolean,
  isPublishing: boolean,
): string | undefined {
  if (isRunning) return RUNNING_CLOSE_REASON;
  if (isPublishing) return PUBLISHING_CLOSE_REASON;
  return undefined;
}

/**
 * The actions row, like a dialog footer: at the left the Cancel of the
 * dialog while the run goes on ("Cancel translation": it stops the run and
 * closes the modal, and its label tells it apart from Close); at
 * the right Cancel publishing while a large set of records is published
 * (a cancel only stops between batches, and a small set is one or a few
 * batches), the publish button once the run ended (until every record is
 * published), and Close, the main action. The publish button and Close take ids, not refs, for the focus
 * after a publishing and at the end of the run: while they are disabled
 * with a reason, the kit's tooltip clones them and reads `element.ref`,
 * which React 19 warns about.
 */
function ProgressActions({
  isCompleted,
  isProcessing,
  closeBlockedReason,
  isCancelling,
  hasFatalError,
  isPublishing,
  isCancellingPublishing,
  hasPublishedAll,
  publishableCount,
  publishButtonLabel,
  publishId,
  closeId,
  onCancel,
  onCancelPublishing,
  onPublish,
  onClose,
}: {
  isCompleted: boolean;
  isProcessing: boolean;
  /** Why Close is disabled, if it is (see getCloseBlockedReason). */
  closeBlockedReason: string | undefined;
  isCancelling: boolean;
  hasFatalError: boolean;
  isPublishing: boolean;
  isCancellingPublishing: boolean;
  hasPublishedAll: boolean;
  publishableCount: number;
  publishButtonLabel: string;
  publishId: string;
  closeId: string;
  onCancel: () => void;
  onCancelPublishing: () => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  return (
    <div className={s.actions}>
      {!isCompleted && isProcessing && (
        <Button
          tone="ghost"
          label="Cancel translation"
          className={s.cancel}
          busy={isCancelling}
          onClick={onCancel}
        />
      )}
      <div className={s.mainActions}>
        {isPublishing && publishableCount > FULL_TRANSLATION_HISTORY_LIMIT && (
          <Button
            tone="ghost"
            label="Cancel publishing"
            busy={isCancellingPublishing}
            onClick={onCancelPublishing}
          />
        )}
        {!isProcessing &&
          (isCompleted || hasFatalError) &&
          publishableCount > 0 &&
          !hasPublishedAll && (
            <Button
              id={publishId}
              label={publishButtonLabel}
              busy={isPublishing}
              onClick={onPublish}
            />
          )}
        <Button
          id={closeId}
          tone="primary"
          label="Close"
          disabled={
            closeBlockedReason ? { reason: closeBlockedReason } : undefined
          }
          onClick={onClose}
        />
      </div>
    </div>
  );
}

/**
 * The top of the modal: the state of the run (with an inline spinner while it
 * goes on), the bar of the records done, and, while it goes on, their count
 * under it. Once the run ended, the counts of the result say it.
 */
function ProgressSummary({
  isRunning,
  isCompleted,
  totalRecords,
  completedCount,
  percentComplete,
  locale,
}: {
  isRunning: boolean;
  isCompleted: boolean;
  totalRecords: number;
  completedCount: number;
  percentComplete: number;
  /** The user's language (`ctx.ui.locale`), for the separators of counts. */
  locale: string;
}) {
  // A run that is neither running nor completed stopped on a fatal error,
  // which the Callout under the bar explains.
  let status = 'Translation stopped';
  if (isRunning) status = 'Translating…';
  else if (isCompleted) status = 'Translation finished';

  return (
    <div className={s.summary}>
      {/* A div, not a p: the inline Spinner renders a div */}
      <div className={s.status} role="status">
        {isRunning && <Spinner inline label={false} />}
        {status}
      </div>
      {/* The bar is named by the visible status line next to it. */}
      <ProgressBar
        value={totalRecords > 0 ? completedCount / totalRecords : 0}
        ariaLabel={status}
      />
      {isRunning && (
        <p className={s.meta}>
          {`${formatCount(completedCount, locale)} of ${recordCount(totalRecords, locale)}`}
        </p>
      )}
      {/* The count above changes every few records: a screen reader hears
          the progress from this line instead, which changes only with the
          percentage. */}
      <span className={s.srOnly} role="status">
        {`${percentComplete}% of the records done`}
      </span>
    </div>
  );
}

/**
 * Modal component that runs the translation and displays its progress: a
 * status line with a bar, the counts, the state of the latest records, and
 * the cancel, publish and close actions.
 */
export default function TranslationProgressModal({
  ctx,
  parameters,
}: TranslationProgressModalProps) {
  const jobInputs = useRef({ ctx, parameters });
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
  // The error that stopped the run, for its Callout.
  const [fatalError, setFatalError] = useState<UserFacingError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const frameRef = useFrameHeight(ctx);
  // The counts get the separators of the language that the Canvas gives the
  // kit, like the kit's own numbers.
  const locale = ctx.ui.locale;
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
      setFatalError(
        describeErrorForUser(
          normalizeProviderError(error, pluginParams.vendor ?? 'openai'),
        ),
      );
      const failureMessage = `${FATAL_MESSAGE_PREFIX}${getTranslationErrorMessage(error, pluginParams.vendor)}`;
      addProgressUpdate({
        recordIndex: -1,
        recordId: FATAL_UPDATE_ID,
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
        const provider = getProvider(pluginParams);

        // Create SchemaRepository for cached schema lookups
        const schemaRepository = createSchemaRepository(client);

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

        await translateRecordBatches(job, (loaded) => {
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

  // The busy publish button is disabled, which drops its focus. Once the
  // publishing ends, the button takes it back while records are left to
  // publish (after a failure or a cancel), else Close, the next action.
  // `isPublishing` alone makes the button busy, so it is enabled again in
  // the commit that ends the publishing.
  const publishId = useId();
  const closeId = useId();
  const followPublish = useBusyFocus(isPublishing, () =>
    document.getElementById(hasPublishedAll ? closeId : publishId),
  );
  const startPublishing = () => {
    followPublish();
    void handlePublish();
  };

  const buildRecordPath = (update: ProgressUpdate): string | undefined =>
    buildRecordEditorPath({
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
  // The run is over once it completed or stopped on a fatal error. A cancel
  // resolves the modal, so it never shows as over.
  const isRunning = !isCompleted && !hasFatalError;
  // The records that the run neither translated nor failed: once it stopped
  // on an error, the one in progress and those it never reached.
  const notTranslatedCount = totalRecords - successfulCount - failedCount;
  const fatalUpdate = progress.find(
    (update) => update.recordId === FATAL_UPDATE_ID,
  );
  // The fatal error is a message of the run, not a record row.
  const { rows: recordUpdates, problemCount } = useMemo(
    () =>
      listRows(progress, !isRunning, () => progressStore.getResultUpdates()),
    [progress, isRunning, progressStore],
  );
  const recordUpdateCount = fatalUpdate ? updateCount - 1 : updateCount;

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
    // Stop provider work and further scheduling, then return the partial
    // result from the job's finally block.
    abortRef.current?.abort();
  };

  const closeBlockedReason = getCloseBlockedReason(isRunning, isPublishing);

  // The host draws no cross on this modal, so Escape is Close, as in the
  // kit's dialogs. While Close is disabled, the key shows its reason instead
  // of closing: an Escape never stops a run, which only Cancel does.
  useRegisterActions([
    {
      id: CLOSE_ACTION_ID,
      name: 'Close',
      shortcut: { key: 'escape' },
      palette: 'hidden',
      disabledReason: () => closeBlockedReason,
      run: handleClose,
    },
  ]);

  // The end of the run unmounts Cancel, and renders Close as a new element
  // (its disabled reason goes), which drops a focus on either to the body.
  // Close, the main action, takes it back. Only while the frame has the
  // focus and nothing in it does: never away from where the user put it,
  // nor out of the host.
  const wasRunning = useRef(isRunning);
  useLayoutEffect(() => {
    const ended = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (!ended || !document.hasFocus() || !isFocusLost()) return;
    document.getElementById(closeId)?.focus({ preventScroll: true });
  }, [isRunning, closeId]);

  return (
    <div ref={frameRef} className={s.modal}>
      <ProgressSummary
        isRunning={isRunning}
        isCompleted={isCompleted}
        totalRecords={totalRecords}
        completedCount={completedCount}
        percentComplete={percentComplete}
        locale={locale}
      />

      {/* The error that stopped the run: the problem as the title and what
          to do as the text, or the problem alone when there is nothing to
          do. The counts under it say how far the run got, with the records
          that it didn't translate. */}
      {fatalError && (
        <Callout
          tone="danger"
          title={
            fatalError.nextStep
              ? fatalError.problem.replace(/\.$/, '')
              : undefined
          }
          className={s.callout}
        >
          <span className={s.fatalCause}>
            {fatalError.nextStep ?? fatalError.problem}
          </span>
        </Callout>
      )}

      {/* The result, once the run ended: the bar showed the progress. */}
      {!isRunning && (
        <InfoList>
          <InfoList.Row title="Translated">
            {formatCount(successfulCount, locale)}
            {warningCount > 0 && (
              <span className={s.valueNote}>
                {`${formatCount(warningCount, locale)} with warnings`}
              </span>
            )}
          </InfoList.Row>
          {failedCount > 0 && (
            <InfoList.Row title="Failed">
              {formatCount(failedCount, locale)}
            </InfoList.Row>
          )}
          {notTranslatedCount > 0 && (
            <InfoList.Row title="Not translated">
              {formatCount(notTranslatedCount, locale)}
            </InfoList.Row>
          )}
        </InfoList>
      )}

      {/* Before the first records load, the spinning status line says
          that the run goes on. */}
      {recordUpdates.length > 0 && (
        <InsetRowList bodyPadding={ctx.bodyPadding} className={s.updates}>
          {recordUpdates.map((update) => (
            <ProgressRow
              key={update.recordId}
              update={update}
              recordPath={buildRecordPath(update)}
              runEnded={!isRunning}
            />
          ))}
        </InsetRowList>
      )}

      {recordUpdateCount > recordUpdates.length && (
        <p className={s.caption}>
          {`Showing ${problemCount > 0 ? '' : 'the latest '}${formatCount(recordUpdates.length, locale)} of ${formatCount(recordUpdateCount, locale)} records`}
        </p>
      )}

      <ProgressActions
        isCompleted={isCompleted}
        isProcessing={isProcessing}
        closeBlockedReason={closeBlockedReason}
        isCancelling={isCancelling}
        hasFatalError={hasFatalError}
        isPublishing={isPublishing}
        isCancellingPublishing={isCancellingPublishing}
        hasPublishedAll={hasPublishedAll}
        publishableCount={publishableCount}
        publishButtonLabel={publishButtonLabel}
        publishId={publishId}
        closeId={closeId}
        onCancel={handleCancel}
        onCancelPublishing={cancelPublishing}
        onPublish={startPublishing}
        onClose={handleClose}
      />
    </div>
  );
}
