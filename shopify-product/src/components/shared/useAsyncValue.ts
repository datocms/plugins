import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../../lib/shopifyClient';

export type AsyncValue<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: T | null;
  error: unknown;
  reload: () => void;
};

type State<T> = {
  key: string | null;
  status: AsyncValue<T>['status'];
  value: T | null;
  error: unknown;
};

/**
 * Loads one value per `key` (null disables it). A new key aborts the previous
 * request; aborts never surface as errors. With `keepPrevious`, the last
 * loaded value stays visible while the next key loads.
 */
export function useAsyncValue<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  options: { keepPrevious?: boolean } = {},
): AsyncValue<T> {
  const [state, setState] = useState<State<T>>({
    key,
    status: key === null ? 'idle' : 'loading',
    value: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastValue = useRef<T | null>(null);
  if (state.status === 'ready') lastValue.current = state.value;
  const fallback = options.keepPrevious ? lastValue.current : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request on reload.
  useEffect(() => {
    if (key === null) {
      setState({ key, status: 'idle', value: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ key, status: 'loading', value: null, error: null });
    loadRef
      .current(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setState({ key, status: 'ready', value, error: null });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ key, status: 'error', value: null, error });
      });
    return () => controller.abort();
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  if (state.key !== key) {
    return {
      status: key === null ? 'idle' : 'loading',
      value: fallback,
      error: null,
      reload,
    };
  }
  return {
    status: state.status,
    value: state.status === 'loading' ? fallback : state.value,
    error: state.error,
    reload,
  };
}
