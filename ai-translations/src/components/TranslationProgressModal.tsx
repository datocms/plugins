import { useState, useEffect, useRef } from 'react';
import { Canvas, Button, Spinner } from 'datocms-react-ui';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
// no direct types from OpenAI or buildClient needed here
import {
  fetchRecordsWithPagination,
  buildFieldTypeDictionary,
  translateAndUpdateRecords,
  type ProgressUpdate
} from '../utils/translation/ItemsDropdownUtils';
import { buildDatoCMSClient } from '../utils/clients';
import { getProvider } from '../utils/translation/ProviderFactory';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { getLocaleName } from '../utils/localeUtils';
import './TranslationProgressModal.css';

// ProgressUpdate type imported from ItemsDropdownUtils

interface TranslationProgressModalProps {
  ctx: RenderModalCtx;
  parameters: {
    totalRecords: number;
    fromLocale: string;
    toLocale: string;
    accessToken: string;
    pluginParams: ctxParamsType;
    itemIds: string[];
  };
}

/**
 * Modal component that displays translation progress and handles the translation process.
 * Shows a progress bar, status updates for each record being translated,
 * and provides cancel/close actions.
 */
export default function TranslationProgressModal({ ctx, parameters }: TranslationProgressModalProps) {
  const { totalRecords, fromLocale, toLocale, accessToken, pluginParams, itemIds } = parameters;
  const [progress, setProgress] = useState<ProgressUpdate[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const updatesRef = useRef<HTMLDivElement | null>(null);
  
  // Use a ref to track if we've started the translation process
  const hasStartedTranslation = useRef(false);

  // Function to add a progress update
  const addProgressUpdate = (update: ProgressUpdate) => {
    setProgress(prev => {
      // Filter out previous updates for the same record and create a new array
      const filteredUpdates = prev.filter(p => p.recordIndex !== update.recordIndex);
      return [...filteredUpdates, update];
    });

    // Collect errors but don't change processing state
    if (update.status === 'error') {
      // Removed the setErrors call here
    }
  };
  
  // Handle the translation process
  useEffect(() => {
    let isMounted = true;

    const processTranslation = async () => {
      if (isProcessing || isCompleted || !isMounted || hasStartedTranslation.current) return;

      hasStartedTranslation.current = true;
      setIsProcessing(true);

      try {
        const client = buildDatoCMSClient(accessToken, ctx.environment);
        const records = await fetchRecordsWithPagination(client, itemIds);
        const provider = getProvider(pluginParams);

        // Cache field dictionaries per item type
        const cache = new Map<string, Record<string, { editor: string; id: string; isLocalized: boolean }>>();
        const getFieldTypeDictionary = async (itemTypeId: string) => {
          if (!cache.has(itemTypeId)) {
            const dict = await buildFieldTypeDictionary(client, itemTypeId);
            cache.set(itemTypeId, dict);
          }
          return cache.get(itemTypeId)!;
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
            checkCancelled: () => isCancelled,
            abortSignal: controller.signal,
          }
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
  }, [accessToken, fromLocale, toLocale, itemIds, pluginParams.apiKey, isProcessing, isCompleted, ctx.environment, isCancelled]);
  
  // Translation handled by shared translateAndUpdateRecords utility
  
  // Translation progress updates handled via shared translator callbacks

  // Calculate completed counts correctly considering all processed records (completed or error)
  const processedRecords = Object.values(
    progress.reduce((uniqueRecords, update) => {
      uniqueRecords[update.recordIndex] = update;
      return uniqueRecords;
    }, {} as Record<number, ProgressUpdate>)
  );
  
  const completedCount = processedRecords.filter(update => 
    update.status === 'completed' || update.status === 'error'
  ).length;
    
  const percentComplete = totalRecords > 0 ? Math.round((completedCount / totalRecords) * 100) : 0;
  
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
  }, [progress.length]);
  
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
              Translating from <strong>{getLocaleName(fromLocale)}</strong> to <strong>{getLocaleName(toLocale)}</strong>
            </p>
            <p className="TranslationProgressModal__progress-text">
              Progress: {completedCount} of {totalRecords} records processed ({percentComplete}%)
            </p>
            <p className="TranslationProgressModal__stats">
              {processedRecords.filter(update => update.status === 'completed').length} successful, {' '}
              {processedRecords.filter(update => update.status === 'error').length} failed
            </p>
          </div>
          {/* Progress bar */}
          <div className="TranslationProgressModal__progress-bar">
            <div 
              className="TranslationProgressModal__progress-bar-fill"
              style={{width: `${percentComplete}%`}}
            />
          </div>
        </div>

        {/* Progress list */}
        <div className="TranslationProgressModal__updates" ref={updatesRef} aria-live="polite">
          {progress.length > 0 ? (
            <ul className="TranslationProgressModal__update-list" role="list">
              {progress
                .slice()
                // Newest updates first so the most recent work is visible
                .sort((a, b) => b.recordIndex - a.recordIndex)
                .map((update) => (
                <li 
                  key={update.recordId}
                  role="listitem"
                  className={`TranslationProgressModal__update-item TranslationProgressModal__update-item--${update.status}`}
                >
                  <span className="TranslationProgressModal__update-status">
                    {update.status === 'completed' && '✓'}
                    {update.status === 'processing' && <Spinner size={16} />}
                    {update.status === 'error' && '✗'}
                  </span>
                  <span className="TranslationProgressModal__update-message">
                    {update.message ?? (update.status === 'completed'
                      ? 'Completed'
                      : update.status === 'processing'
                      ? 'Processing...'
                      : update.status === 'error'
                      ? 'Error'
                      : '')}
                  </span>
                </li>
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
