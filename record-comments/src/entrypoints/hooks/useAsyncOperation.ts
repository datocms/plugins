import {
  categorizeGeneralError,
  normalizeError,
} from '@utils/errorCategorization';
import { useCallback, useEffect, useRef, useState } from 'react';
import { logError } from '@/utils/errorLogger';

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
  options: UseAsyncOperationOptions<T>,
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
  const asyncFnRef = useRef(asyncFn);
  const optionsRef = useRef({
    errorContext,
    onError,
    onSuccess,
    operationName,
  });

  useEffect(() => {
    asyncFnRef.current = asyncFn;
    optionsRef.current = {
      errorContext,
      onError,
      onSuccess,
      operationName,
    };
  }, [asyncFn, errorContext, onError, onSuccess, operationName]);

  const retry = useCallback(() => {
    setError(null);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    const currentOperation = ++operationCounterRef.current;
    let isMounted = true;

    setIsLoading(true);

    asyncFnRef
      .current()
      .then((result) => {
        if (!isMounted) return;
        if (currentOperation !== operationCounterRef.current) return;

        const latestOptions = optionsRef.current;

        setData(result);
        setError(null);
        setIsLoading(false);

        if (latestOptions.onSuccess) {
          try {
            latestOptions.onSuccess(result);
          } catch (callbackError) {
            logError(
              `onSuccess callback for "${latestOptions.operationName}" threw an error`,
              callbackError,
              latestOptions.errorContext,
            );
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        if (currentOperation !== operationCounterRef.current) return;

        const latestOptions = optionsRef.current;
        const normalizedError = normalizeError(err);
        const categorized = categorizeGeneralError(normalizedError);

        logError(
          `Failed to ${latestOptions.operationName}`,
          err,
          latestOptions.errorContext,
        );
        setError({
          source: latestOptions.operationName,
          message: categorized.message,
        });
        setIsLoading(false);

        if (latestOptions.onError) {
          try {
            latestOptions.onError(normalizedError);
          } catch (callbackError) {
            logError(
              `onError callback for "${latestOptions.operationName}" threw an error`,
              callbackError,
              latestOptions.errorContext,
            );
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
