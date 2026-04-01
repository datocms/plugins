import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Returns the default status label when a progress update has no explicit message.
 */
function defaultStatusLabel(
  status: 'completed' | 'processing' | 'error' | string,
): string {
  if (status === 'completed') return 'Completed';
  if (status === 'processing') return 'Processing...';
  if (status === 'error') return 'Error';
  return '';
}

/**
 * Renders a single progress list item for one record.
 */
function ProgressListItem({
  update,
}: {
  update: import('../utils/translation/ItemsDropdownUtils').ProgressUpdate;
}) {
  const label = update.message ?? defaultStatusLabel(update.status);
  return (
    <li
      key={update.recordId}
      className={`TranslationProgressModal__update-item TranslationProgressModal__update-item--${update.status}`}
    >
      <span className="TranslationProgressModal__update-status">
        {update.status === 'completed' && '✓'}
        {update.status === 'processing' && <Spinner size={16} />}
        {update.status === 'error' && '✗'}
      </span>
      <span className="TranslationProgressModal__update-message">{label}</span>
    </li>
  );
}

import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { buildDatoCMSClient } from '../utils/clients';
import { getLocaleName } from '../utils/localeUtils';
import { createSchemaRepository } from '../utils/schemaRepository';
// no direct types from OpenAI or buildClient needed here
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
  toLocale: string;
  accessToken: string;
  pluginParams: ctxParamsType;
  itemIds: string[];
}

interface TranslationProgressModalProps {
  ctx: RenderModalCtx;
  parameters: TranslationProgressModalParams;
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
    toLocale,
    accessToken,
    pluginParams,
    itemIds,
  } = parameters;
  const [progress, setProgress] = useState<ProgressUpdate[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const updatesRef = useRef<HTMLDivElement | null>(null);

  // Use a ref to track if we've started the translation process
  const hasStartedTranslation = useRef(false);

  // Stable callback to add a progress update — wrapped in useCallback so it
  // can be safely listed as a useEffect dependency without causing re-runs.
  const addProgressUpdate = useCallback((update: ProgressUpdate) => {
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
      setIsProcessing(true);

      try {
        const client = buildDatoCMSClient(accessToken, ctx.environment);
        const records = await fetchRecordsWithPagination(client, itemIds);
        const provider = getProvider(pluginParams);

        // Create SchemaRepository for cached schema lookups
        const schemaRepository = createSchemaRepository(client);

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
          toLocale,
          getFieldTypeDictionary,
          pluginParams,
          ctx,
          accessToken,
          {
            onProgress: addProgressUpdate,
            checkCancellation: () => isCancelled,
            abortSignal: controller.signal,
          },
          schemaRepository,
        );
      } catch (_error) {
        if (isMounted) {
          setIsProcessing(false);
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
    isCancelled,
    itemIds,
    pluginParams,
    toLocale,
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

  const percentComplete =
    totalRecords > 0 ? Math.round((completedCount / totalRecords) * 100) : 0;

  // Make sure to set completed state when all records are processed
  useEffect(() => {
    if (completedCount === totalRecords && totalRecords > 0) {
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
    ctx.resolve({ completed: isCompleted, progress });
  };

  const handleCancel = () => {
    setIsCancelled(true);
    // Abort in-flight requests to stop streaming immediately
    abortRef.current?.abort();
    ctx.resolve({ completed: false, canceled: true });
  };

  return (
    <Canvas ctx={ctx}>
      <div className="TranslationProgressModal">
        <div className="TranslationProgressModal__intro">
          <div className="TranslationProgressModal__languages">
            <p>
              Translating from <strong>{getLocaleName(fromLocale)}</strong> to{' '}
              <strong>{getLocaleName(toLocale)}</strong>
            </p>
            <p className="TranslationProgressModal__progress-text">
              Progress: {completedCount} of {totalRecords} records processed (
              {percentComplete}%)
            </p>
            <p className="TranslationProgressModal__stats">
              {
                processedRecords.filter(
                  (update) => update.status === 'completed',
                ).length
              }{' '}
              successful,{' '}
              {
                processedRecords.filter((update) => update.status === 'error')
                  .length
              }{' '}
              failed
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
                  <ProgressListItem key={update.recordId} update={update} />
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
