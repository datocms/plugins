const isDev = import.meta.env.DEV;

// TODO: Integrate with error reporting service (Sentry, Bugsnag) in production
export function logError(
  message: string,
  error?: unknown,
  context?: Record<string, unknown>
) {
  console.error(`[RecordComments] ${message}`, error, context);
}

/** Only logs in development to reduce production noise. */
export function logWarn(message: string, context?: Record<string, unknown>) {
  if (isDev) {
    console.warn(`[RecordComments] ${message}`, context);
  }
}
