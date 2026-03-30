import { useMemo, useRef, useState } from 'react';

export type LongTaskStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed';

export type LongTaskProgress = {
  label?: string;
  done?: number;
  total?: number;
};

export type LongTaskState = {
  status: LongTaskStatus;
  cancelRequested: boolean;
  progress: LongTaskProgress;
  error?: Error;
};

const initialState: LongTaskState = {
  status: 'idle',
  cancelRequested: false,
  progress: {},
  error: undefined,
};

export type LongTaskController = {
  start(progress?: LongTaskProgress): void;
  setProgress(update: LongTaskProgress): void;
  complete(progress?: LongTaskProgress): void;
  fail(error: unknown): void;
  requestCancel(): void;
  reset(): void;
  isCancelRequested(): boolean;
};

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'Unknown error');
}

function mergeProgress(
  prev: LongTaskProgress,
  update: LongTaskProgress,
): LongTaskProgress {
  return {
    ...prev,
    ...update,
  };
}

export type UseLongTaskResult = {
  state: LongTaskState;
  controller: LongTaskController;
};

/**
 * Manage long-running async tasks (imports, exports, etc.) with progress + cancel support.
 */
export function useLongTask(): UseLongTaskResult {
  const [state, setState] = useState<LongTaskState>(initialState);
  const cancelRequestedRef = useRef(false);

  const controller = useMemo<LongTaskController>(() => {
    return {
      start(progress) {
        cancelRequestedRef.current = false;
        setState({
          status: 'running',
          cancelRequested: false,
          progress: progress ?? {},
          error: undefined,
        });
      },
      setProgress(update) {
        setState((prev) => ({
          ...prev,
          progress: mergeProgress(prev.progress, update),
        }));
      },
      complete(progress) {
        setState((prev) => ({
          status: 'completed',
          cancelRequested: prev.cancelRequested,
          progress: mergeProgress(prev.progress, progress ?? {}),
          error: undefined,
        }));
      },
      fail(error) {
        setState((prev) => ({
          status: 'failed',
          cancelRequested: prev.cancelRequested,
          progress: prev.progress,
          error: toError(error),
        }));
      },
      requestCancel() {
        cancelRequestedRef.current = true;
        setState((prev) => ({
          ...prev,
          status: prev.status === 'running' ? 'cancelling' : prev.status,
          cancelRequested: true,
        }));
      },
      reset() {
        cancelRequestedRef.current = false;
        setState(initialState);
      },
      isCancelRequested() {
        return cancelRequestedRef.current;
      },
    };
  }, []);

  return { state, controller };
}
