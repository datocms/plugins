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
  enabled?: boolean;
  operationName: string;
  errorContext?: Record<string, unknown>;
  onError?: (error: Error) => void;
  onSuccess?: (data: T) => void;
};

type UseAsyncOperationReturn<T> = {
  data: T | null;
  isLoading: boolean;
  error: AsyncOperationError | null;
  retry: () => void;
};

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
  const operationCounterRef = useRef(0);

  const retry = useCallback(() => {
    setError(null);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const currentOperation = ++operationCounterRef.current;
    let isMounted = true;

    setIsLoading(true);

    asyncFn()
      .then((result) => {
        if (!isMounted) return;
        if (currentOperation !== operationCounterRef.current) return;

        setData(result);
        setError(null);
        setIsLoading(false);

        if (onSuccess) {
          try {
            onSuccess(result);
          } catch (callbackError) {
            logError(`onSuccess callback for "${operationName}" threw an error`, callbackError, errorContext);
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        if (currentOperation !== operationCounterRef.current) return;

        const normalizedError = normalizeError(err);
        const categorized = categorizeGeneralError(normalizedError);

        logError(`Failed to ${operationName}`, err, errorContext);
        setError({ source: operationName, message: categorized.message });
        setIsLoading(false);

        if (onError) {
          try {
            onError(normalizedError);
          } catch (callbackError) {
            logError(`onError callback for "${operationName}" threw an error`, callbackError, errorContext);
          }
        }
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryCount, ...deps]);

  return {
    data,
    isLoading,
    error,
    retry,
  };
}
