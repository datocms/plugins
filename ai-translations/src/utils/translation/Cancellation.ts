import type { CancellationOptions } from './types';

/** Keep lifecycle callbacks out of provider options while forwarding cancellation. */
export function getCancellationOptions(
  options?: CancellationOptions,
): CancellationOptions {
  return {
    ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options?.checkCancellation
      ? { checkCancellation: options.checkCancellation }
      : {}),
  };
}

export function checkCancellation(options: CancellationOptions): void {
  if (options.abortSignal?.aborted || options.checkCancellation?.()) {
    throw new DOMException('Translation was cancelled', 'AbortError');
  }
}

/** DOMException is not an Error in every browser/test runtime. */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === 'AbortError'
  );
}

export function rethrowAbortError(error: unknown): void {
  if (isAbortError(error)) throw error;
}
