// Reject promptly even if a provider or mock fails to settle after cancellation.
// The original promise keeps a rejection handler; cancellation never retries it.
export function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException('Request cancelled.', 'AbortError'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}
