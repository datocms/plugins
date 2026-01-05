/**
 * providerUtils.ts
 * ------------------------------------------------------
 * Shared utility functions for translation providers.
 * Extracts common patterns to reduce duplication across providers.
 */

import { createTimeoutSignal, DEFAULT_API_TIMEOUT_MS, type StreamOptions } from './types';

/**
 * Checks if a prompt is empty or whitespace-only.
 * EDGE-001: Skip API calls for empty prompts to avoid wasting resources.
 *
 * @param prompt - The prompt string to check.
 * @returns True if the prompt is empty or contains only whitespace.
 */
export function isEmptyPrompt(prompt: string): boolean {
  return !prompt || !prompt.trim();
}

/**
 * Executes a function with timeout protection.
 * EDGE-002: Prevents requests from hanging indefinitely.
 *
 * This utility wraps an async operation with a combined abort signal that
 * respects both the configured timeout and any external abort signal.
 * The cleanup is handled automatically when the operation completes.
 *
 * @param options - Stream options containing timeout and abort signal.
 * @param fn - The async function to execute, receives the combined abort signal.
 * @returns The result of the function execution.
 */
export async function withTimeout<T>(
  options: StreamOptions | undefined,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs, options?.abortSignal);

  try {
    return await fn(signal);
  } finally {
    cleanup();
  }
}

/**
 * Generator version of withTimeout for streaming operations.
 * EDGE-002: Prevents streaming requests from hanging indefinitely.
 *
 * @param options - Stream options containing timeout and abort signal.
 * @param fn - The async generator function to execute.
 * @returns An async iterable yielding the results.
 */
export async function* withTimeoutGenerator<T>(
  options: StreamOptions | undefined,
  fn: (signal: AbortSignal) => AsyncIterable<T>
): AsyncIterable<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const { signal, cleanup } = createTimeoutSignal(timeoutMs, options?.abortSignal);

  try {
    yield* fn(signal);
  } finally {
    cleanup();
  }
}
