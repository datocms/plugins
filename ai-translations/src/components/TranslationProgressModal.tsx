import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { buildDatoCMSClient } from '../utils/clients';
import {
  buildTranslationReportRows,
  downloadCsv,
  toCsv,
} from '../utils/csvExport';
import { buildRecordEditorUrl } from '../utils/recordUrl';
import { createSchemaRepository } from '../utils/schemaRepository';
import { LocaleChip } from './BulkTranslations/LocaleChip';
import { PausePanel } from './BulkTranslations/PausePanel';
import {
  createPauseController,
  type PauseController,
  type RunStatus,
} from './BulkTranslations/pauseController';
import { ProgressRow } from './BulkTranslations/ProgressRow';
import { summarizeBulkProgress } from './BulkTranslations/progressSummary';
import {
  formatErrorForUser,
  normalizeProviderError,
} from '../utils/translation/ProviderErrors';
import {
  buildFieldTypeDictionaryWithRepo,
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
  // The run's lifecycle state drives the pause screen, the footer buttons, and
  // (Task 9) Export gating. Starts `running`: the translation kicks off on mount.
  const [runStatus, setRunStatus] = useState<RunStatus>({ kind: 'running' });
  // Cancellation is read from inside a long-running async loop and a sync
  // callback, so it must be a ref: a state value would be captured stale in the
  // once-only effect closure. The controller owns the authoritative flag; this
  // mirror lets `addProgressUpdate` drop updates that arrive after a cancel.
  const isCancelledRef = useRef(false);
  const [hasFatalError, setHasFatalError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const updatesRef = useRef<HTMLDivElement | null>(null);

  // The pause machine — one instance per modal. `onStatus` drives `runStatus`
  // so the PausePanel can render; the same controller is passed into the run as
  // its `gate` and `onSystemic`, so pausing and cancelling share one source of
  // truth. Created lazily via a ref guard so it survives re-renders.
  const controllerRef = useRef<PauseController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createPauseController({
      onStatus: (status) => {
        if (status.kind === 'cancelled') isCancelledRef.current = true;
        setRunStatus(status);
      },
    });
  }
  const controller = controllerRef.current;

  const isCompleted = runStatus.kind === 'completed';
  // "Processing" means the run is underway but not terminal — a pause counts,
  // since the work will resume rather than stop.
  const isProcessing =
    runStatus.kind === 'running' || runStatus.kind === 'paused';

  // Use a ref to track if we've started the translation process
  const hasStartedTranslation = useRef(false);

  // Stable callback to add a progress update — wrapped in useCallback so it
  // can be safely listed as a useEffect dependency without causing re-runs.
  const addProgressUpdate = useCallback((update: ProgressUpdate) => {
    // Drop updates that arrive after a cancel: the modal has already resolved
    // and the loop is unwinding, so committing more state is wasted (and would
    // warn about setting state on an unmounting component).
    if (isCancelledRef.current) return;
    // A record that finished successfully means the provider is healthy again,
    // so reset the rate-limit auto-retry budget (an early 429 shouldn't keep the
    // pacer primed for the rest of a now-healthy run).
    if (
      update.status === 'completed' ||
      update.status === 'completed-with-warnings'
    ) {
      controllerRef.current?.onSuccess();
    }
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

    const processTranslation = async () => {
      // Guard: only start once per modal instance
      if (!isMounted || hasStartedTranslation.current) return;

      hasStartedTranslation.current = true;
      // Read the pause machine off the ref inside the effect so it isn't a hook
      // dependency (the instance is stable for the modal's life anyway).
      const pauseController = controllerRef.current;

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

        // Use SchemaRepository for field dictionary lookups (cached automatically)
        const getFieldTypeDictionary = async (itemTypeId: string) => {
          return buildFieldTypeDictionaryWithRepo(schemaRepository, itemTypeId);
        };

        // Prepare AbortController for in-flight cancellations
        const abortController = new AbortController();
        abortRef.current = abortController;

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
            // The pause machine is the run's between-unit gate and its
            // systemic-error handler: `gate` unwinds the run on cancel, while
            // `onSystemic` pauses on a rate limit/auth/quota/network error and
            // resumes (or cancels) once the user or the countdown decides.
            gate: pauseController?.gate,
            onSystemic: pauseController?.handleSystemic,
            abortSignal: abortController.signal,
            selectedFieldsByModel,
          },
          schemaRepository,
        );

        // Mark the run terminal on the happy path too. The completion effect
        // below only fires when every record reports back; if fewer records come
        // back than requested (e.g. some were deleted between selection and
        // fetch) that effect never runs, and without this the Close button would
        // stay disabled forever. A cancel already reached its terminal state, so
        // never override it.
        if (isMounted) {
          setRunStatus((s) => (s.kind === 'cancelled' ? s : { kind: 'completed' }));
        }
      } catch (error) {
        if (isMounted) {
          setHasFatalError(true);
          setRunStatus((s) => (s.kind === 'cancelled' ? s : { kind: 'completed' }));
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
            // Carry the reason as a warning so it also lands in the CSV `notes`
            // column (which is sourced from `warnings`, not `message`).
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

  // Three mutually-exclusive status buckets (design §6b) + the clamped percent,
  // derived by a pure helper that excludes the synthetic fatal-error entry
  // (recordIndex -1) so it can't push the counts/percent past the total.
  const {
    completedCount,
    successfulCount,
    withWarningsCount,
    failedCount,
    percentComplete,
  } = summarizeBulkProgress(processedRecords, totalRecords);

  const buildRecordUrl = (update: ProgressUpdate): string | undefined =>
    buildRecordEditorUrl({
      internalDomain: ctx.site?.attributes?.internal_domain,
      environment: ctx.environment,
      isEnvironmentPrimary: ctx.isEnvironmentPrimary,
      itemTypeId: update.itemTypeId,
      recordId: update.recordId,
    });

  const handleExportCsv = () => {
    const { headers, rows } = buildTranslationReportRows(processedRecords, {
      fromLocale,
      toLocales,
      buildUrl: buildRecordUrl,
    });
    downloadCsv(
      `ai-translations-report-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, rows),
    );
  };

  // Make sure to mark the run completed when all records are processed. A cancel
  // is already terminal, so never override it here.
  useEffect(() => {
    if (completedCount >= totalRecords && totalRecords > 0) {
      setRunStatus((s) => (s.kind === 'cancelled' ? s : { kind: 'completed' }));
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
    // Route through the controller so a pending pause (manual wait or countdown)
    // unwinds via RUN_CANCELLED; it also mirrors the cancel into isCancelledRef
    // and flips runStatus to 'cancelled'.
    controller.cancel();
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
              {successfulCount} successful, {withWarningsCount} with warnings,{' '}
              {failedCount} failed
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

        {runStatus.kind === 'paused' && (
          <PausePanel
            status={runStatus}
            onResume={controller.resume}
            onCancel={handleCancel}
          />
        )}

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
          {processedRecords.length > 0 && (
            <Button
              type="button"
              buttonType="muted"
              onClick={handleExportCsv}
              buttonSize="s"
              className="TranslationProgressModal__export-button"
            >
              Export CSV
            </Button>
          )}
          {runStatus.kind === 'running' && (
            <Button
              type="button"
              buttonType="negative"
              onClick={handleCancel}
              buttonSize="s"
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            buttonType="primary"
            onClick={handleClose}
            disabled={isProcessing && !isCompleted}
            buttonSize="s"
          >
            {isCompleted ? 'Close' : isProcessing ? 'Please wait...' : 'Close'}
          </Button>
        </div>
      </div>
    </Canvas>
  );
}
