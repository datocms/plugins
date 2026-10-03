/** Let the browser paint progress and deliver cancellation during cached reads. */
export function yieldGraphWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function ensureNotCancelled(shouldCancel: (() => boolean) | undefined) {
  if (shouldCancel?.()) throw new Error('Schema preparation cancelled');
}

/** Keep schema traversal bounded even when a frontier contains every model. */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>,
  shouldCancel?: () => boolean,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;

  const worker = async () => {
    while (!failed && nextIndex < values.length) {
      try {
        ensureNotCancelled(shouldCancel);
        const index = nextIndex++;
        // biome-ignore lint/performance/noAwaitInLoops: each worker must finish its request before taking another.
        results[index] = await map(values[index], index);
        if ((index + 1) % 50 === 0) {
          await yieldGraphWork();
        }
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };

  const limit = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 2;
  // Workers absorb failures so in-flight reads settle before the caller exits.
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, worker),
  );
  if (failed) throw failure;
  ensureNotCancelled(shouldCancel);
  return results;
}
