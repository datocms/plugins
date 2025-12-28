import { useCallback, useEffect, useRef, useState } from 'react';
import { logError } from '@/utils/errorLogger';
import {
  categorizeGeneralError,
  normalizeError,
} from '@utils/errorCategorization';

type AsyncOperationError = {
  source: string;
  message: string;
};

type UseAsyncOperationOptions<T> = {
  /**
   * Whether the operation should run. Defaults to true.
   */
  enabled?: boolean;
  /**
   * A descriptive name for this operation, used in error logging and messages.
   */
  operationName: string;
  /**
   * Additional context to include in error logs.
   */
  errorContext?: Record<string, unknown>;
  /**
   * Optional callback when an error occurs.
   */
  onError?: (error: Error) => void;
  /**
   * Optional callback when the operation succeeds.
   */
  onSuccess?: (data: T) => void;
};

type UseAsyncOperationReturn<T> = {
  data: T | null;
  isLoading: boolean;
  error: AsyncOperationError | null;
  /**
   * Retry the operation by incrementing the retry counter.
   */
  retry: () => void;
};

/**
 * A reusable hook for handling async operations with:
 * - Operation counter to prevent stale results from overwriting newer data
 * - Mounted check to prevent state updates after unmount
 * - Error handling with categorization
 * - Retry capability
 *
 * ASYNC CLEANUP NOTE:
 * This hook uses an isMounted flag + operation counter pattern instead of AbortController because:
 * 1. The DatoCMS Plugin SDK methods don't accept AbortSignals
 * 2. The underlying fetch requests can't be cancelled
 * 3. The isMounted + operation counter pattern effectively prevents:
 *    - State updates after unmount (memory safety)
 *    - Stale async results from overwriting newer data (race condition safety)
 *
 * @param asyncFn - The async function to execute. Should be memoized or stable.
 * @param deps - Dependencies array that triggers re-execution when changed.
 * @param options - Configuration options for the operation.
 */
export function useAsyncOperation<T>(
  asyncFn: () => Promise<T>,
  deps: readonly unknown[],
  options: UseAsyncOperationOptions<T>
): UseAsyncOperationReturn<T> {
  const {
    enabled = true,
    operationName,
    errorContext,
    onError,
    onSuccess,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AsyncOperationError | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Operation counter to prevent stale async results from overwriting newer data.
  // Each time the effect runs, we increment the counter. When the async operation
  // completes, we check if the counter still matches. If not, a newer operation
  // was started and we discard the stale result.
  const operationCounterRef = useRef(0);

  const retry = useCallback(() => {
    setError(null);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Increment operation counter and capture the current value
    const currentOperation = ++operationCounterRef.current;

    // Track if component is mounted to prevent state updates after unmount
    let isMounted = true;

    setIsLoading(true);

    asyncFn()
      .then((result) => {
        // Don't update state if component unmounted during fetch
        if (!isMounted) return;
        // Don't update if a newer operation was started (prevents stale results)
        if (currentOperation !== operationCounterRef.current) return;

        setData(result);
        setError(null);
        setIsLoading(false);

        // Wrap callback in try-catch to prevent unhandled rejections if callback throws.
        // Without this, a throwing onSuccess callback would cause an unhandled promise rejection.
        if (onSuccess) {
          try {
            onSuccess(result);
          } catch (callbackError) {
            logError(`onSuccess callback for "${operationName}" threw an error`, callbackError, errorContext);
          }
        }
      })
      .catch((err) => {
        // Don't update state if component unmounted
        if (!isMounted) return;
        // Don't update if a newer operation was started
        if (currentOperation !== operationCounterRef.current) return;

        const normalizedError = normalizeError(err);
        const categorized = categorizeGeneralError(normalizedError);

        logError(`Failed to ${operationName}`, err, errorContext);
        setError({ source: operationName, message: categorized.message });
        setIsLoading(false);

        // Wrap callback in try-catch to prevent unhandled rejections if callback throws.
        // Without this, a throwing onError callback would cause an unhandled promise rejection.
        if (onError) {
          try {
            onError(normalizedError);
          } catch (callbackError) {
            logError(`onError callback for "${operationName}" threw an error`, callbackError, errorContext);
          }
        }
      });

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
    // Note: We include retryCount to allow manual retries
    // The asyncFn and deps are spread to allow custom dependency control
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryCount, ...deps]);

  return {
    data,
    isLoading,
    error,
    retry,
  };
}
