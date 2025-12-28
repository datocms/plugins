const isDev = import.meta.env.DEV;

/**
 * Logs errors to the console.
 *
 * Errors are always logged in both development and production environments
 * to ensure visibility of issues that could cause data loss or failures.
 *
 * NOTE: In a real production environment, you would want to integrate with
 * an error reporting service like Sentry, Bugsnag, or similar. This would
 * provide better error tracking, aggregation, and alerting capabilities.
 */
export function logError(
  message: string,
  error?: unknown,
  context?: Record<string, unknown>
) {
  // Always log errors - production observability is critical for debugging issues
  console.error(`[RecordComments] ${message}`, error, context);
}

/**
 * Logs warnings to the console.
 *
 * Warnings are only logged in development mode to reduce noise in production
 * while still providing useful debugging information during development.
 */
export function logWarn(message: string, context?: Record<string, unknown>) {
  if (isDev) {
    console.warn(`[RecordComments] ${message}`, context);
  }
}
