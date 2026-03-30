export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with optional jitter to prevent thundering herd. */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter = false
) {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitterAmount = jitter ? Math.random() * 100 : 0;
  return Math.min(exponentialDelay + jitterAmount, maxDelay);
}
