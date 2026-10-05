export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled.', 'AbortError');
  }
}

export function waitForExport(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Export cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function yieldToBrowser(): Promise<void> {
  return waitForExport(0);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  async function worker() {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each worker must finish one job before consuming another to bound concurrency.
        results[index] = await mapper(items[index], index);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  if (failed) {
    throw failure;
  }
  return results;
}

// Await revocation so a long export never keeps hundreds of object URLs alive.
// The browser accepts the download independently; this cannot verify disk writes.
export async function downloadBlob(
  blob: Blob,
  filename: string,
): Promise<void> {
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  try {
    element.href = url;
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    await waitForExport(1000);
  } finally {
    element.remove();
    URL.revokeObjectURL(url);
  }
}
