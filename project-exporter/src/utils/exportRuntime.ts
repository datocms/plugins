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

/** How long a download's object URL stays valid after the browser takes it. */
export const DOWNLOAD_URL_LIFETIME_MS = 60_000;

// Hands the file to the browser and returns at once, so the export ends when
// the download starts. The URL is released later, once the browser has taken
// it; this cannot verify disk writes.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  element.href = url;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  element.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}
