export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('The scan was cancelled.', 'AbortError');
}

/** The SDK has no per-call signal: stop waiting on cancellation, but keep observing the late outcome. */
export function cancellable<T>(
  request: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('The scan was cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    request
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
