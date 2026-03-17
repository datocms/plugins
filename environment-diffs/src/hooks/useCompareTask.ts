import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CompareTaskCancelledError,
  createCompareTaskController,
} from '../lib/async';
import {
  clearSessionCacheValue,
  getSessionCacheValue,
  setSessionCacheValue,
} from '../lib/sessionCache';
import type { CompareTaskContext, ProgressState } from '../types';

type TaskStatus = 'idle' | 'loading' | 'success' | 'error';

type Loader<T> = (context: CompareTaskContext) => Promise<T>;

type State<T> = {
  status: TaskStatus;
  progress: ProgressState;
  data?: T;
  error?: string;
  cancelRequested: boolean;
};

const DEFAULT_PROGRESS: ProgressState = {
  current: 0,
  total: 1,
  label: 'Ready',
};

export function useCompareTask<T>(
  cacheKey: string,
  enabled: boolean,
  load: Loader<T>,
) {
  const [state, setState] = useState<State<T>>({
    status: 'idle',
    progress: DEFAULT_PROGRESS,
    cancelRequested: false,
  });
  const controllerRef = useRef<ReturnType<typeof createCompareTaskController> | null>(
    null,
  );

  const run = useCallback(
    async (force = false) => {
      if (!enabled) {
        return;
      }

      const cached = !force ? getSessionCacheValue<T>(cacheKey) : undefined;

      if (cached) {
        setState({
          status: 'success',
          progress: {
            current: 1,
            total: 1,
            label: 'Loaded cached diff',
          },
          data: cached,
          cancelRequested: false,
        });
        return;
      }

      controllerRef.current?.cancel();
      const controller = createCompareTaskController();
      controllerRef.current = controller;

      setState((previous) => ({
        ...previous,
        status: 'loading',
        error: undefined,
        cancelRequested: false,
        progress: {
          current: 0,
          total: 1,
          label: 'Loading…',
        },
      }));

      try {
        const data = await load({
          signal: controller.signal,
          reportProgress(current, total, label) {
            setState((previous) => ({
              ...previous,
              progress: {
                current,
                total,
                label,
              },
            }));
          },
        });

        if (controller.signal.cancelled) {
          return;
        }

        setSessionCacheValue(cacheKey, data);
        setState({
          status: 'success',
          progress: {
            current: 1,
            total: 1,
            label: 'Diff loaded',
          },
          data,
          cancelRequested: false,
        });
      } catch (error) {
        if (error instanceof CompareTaskCancelledError) {
          setState((previous) => ({
            ...previous,
            status: previous.data ? 'success' : 'idle',
            cancelRequested: false,
            progress: previous.data ? previous.progress : DEFAULT_PROGRESS,
          }));
          return;
        }

        setState((previous) => ({
          ...previous,
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Could not compute the diff.',
          cancelRequested: false,
        }));
      }
    },
    [cacheKey, enabled, load],
  );

  useEffect(() => {
    void run();

    return () => {
      controllerRef.current?.cancel();
    };
  }, [run]);

  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setState((previous) => ({
      ...previous,
      cancelRequested: true,
    }));
  }, []);

  const refresh = useCallback(async () => {
    clearSessionCacheValue(cacheKey);
    await run(true);
  }, [cacheKey, run]);

  return {
    ...state,
    run,
    cancel,
    refresh,
  };
}
