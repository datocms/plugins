/**
 * Error categorization utilities for DatoCMS plugin.
 *
 * Provides consistent error classification for user-friendly error messages
 * across different contexts (subscriptions, API calls, etc.).
 *
 * ============================================================================
 * ERROR HANDLING ARCHITECTURE - WHY MULTIPLE PATTERNS EXIST
 * ============================================================================
 *
 * This codebase intentionally uses MULTIPLE error handling patterns rather than
 * a single unified interface. Each pattern is optimized for its specific use case:
 *
 * 1. useOperationQueue → RetryState
 *    - Exposes retry progress to UI (attempt count, retry reason)
 *    - Distinguishes version conflicts from network errors
 *    - Allows UI to show "Retrying... attempt 3" indicators
 *    - Tracks termination state for giving up after max retries
 *
 * 2. useCommentsSubscription → ErrorCategorization
 *    - Uses this module's categorizeSubscriptionError()
 *    - Maps WebSocket/GraphQL errors to user-friendly messages
 *    - Focuses on actionable feedback ("reconfigure token", "check connection")
 *
 * 3. parseComments → Graceful Degradation
 *    - Returns empty array on corrupt data instead of throwing
 *    - Logs detailed info for debugging without crashing UI
 *    - Prioritizes stability over error visibility
 *
 * 4. useAsyncOperation → Wrapped Callbacks
 *    - Catches errors in success/error callbacks to prevent unhandled rejections
 *    - Logs callback failures without surfacing to caller
 *    - Prioritizes operation completion over callback failures
 *
 * WHY NOT UNIFY THESE PATTERNS:
 * -----------------------------
 * 1. DIFFERENT REQUIREMENTS: Retry state needs attempt counts; subscription errors
 *    need categorization; parse errors need silent degradation. A unified type
 *    would either be too complex or too limited for each use case.
 *
 * 2. TIGHT COUPLING RISK: A shared error interface would couple independent
 *    subsystems. Changes to retry logic would affect subscription error handling.
 *
 * 3. MAINTENANCE OVERHEAD: Adding Sentry/LogRocket integration would require
 *    modifying one place (logError in errorLogger.ts), not every error handler.
 *
 * 4. NO PRACTICAL BENEFIT: Each pattern works correctly for its use case.
 *    Unification would be architectural refactoring without user-visible benefit.
 *
 * IF YOU'RE ADDING ERROR TRACKING (Sentry, etc.):
 * -----------------------------------------------
 * Integrate at the logError() function in utils/errorLogger.ts, which is already
 * used by all error handling code paths. This provides a single integration point
 * without requiring unified error types.
 *
 * DO NOT attempt to unify error handling patterns unless you have a specific
 * requirement that cannot be met by the current architecture.
 * ============================================================================
 */

/**
 * Error types for subscription-related failures.
 * Used by the real-time comments subscription system.
 */
export type SubscriptionErrorType =
  | 'token_expired'
  | 'network_error'
  | 'graphql_error'
  | 'unknown';

/**
 * Error types for general API/data loading failures.
 * Used by hooks that load project data (users, fields, etc.).
 */
export type GeneralErrorType =
  | 'permission_denied'
  | 'network_error'
  | 'unknown';

/**
 * Result of error categorization with type and user-friendly message.
 */
export type ErrorCategorization<T extends string = string> = {
  type: T;
  message: string;
};

/**
 * ============================================================================
 * KNOWN LIMITATION: FRAGILE STRING-BASED ERROR CATEGORIZATION
 * ============================================================================
 *
 * This module relies on lowercased string matching against error messages,
 * which is inherently fragile for several reasons:
 *
 * 1. ERROR MESSAGE INSTABILITY: Error message text can change without notice
 *    in library updates or DatoCMS API changes. A message like "Unauthorized"
 *    could become "Authentication required" in a future version.
 *
 * 2. KEYWORD OVERLAP: Different error types may share keywords. For example,
 *    "connection forbidden by firewall" would incorrectly match 'forbidden'
 *    and be categorized as a token error instead of a network error.
 *
 * 3. LOCALIZATION RISK: If error messages are ever localized, English keyword
 *    matching would fail entirely.
 *
 * WHY THIS CANNOT BE FIXED NOW:
 * - DatoCMS's GraphQL subscription API (via react-datocms) does not currently
 *   provide structured error codes (e.g., error.code or error.extensions.code)
 * - The underlying WebSocket and GraphQL error types vary by failure mode
 * - We must provide SOME categorization for user feedback
 *
 * RECOMMENDED FUTURE FIX:
 * When DatoCMS provides structured error codes:
 * 1. Check for error.code or error.extensions.code first
 * 2. Fall back to string matching only for legacy/unknown errors
 * 3. Consider adding a 'categorization_confidence' field to results
 *
 * Example future implementation:
 *   if (error.extensions?.code === 'UNAUTHENTICATED') {
 *     return { type: 'token_expired', message: '...' };
 *   }
 *
 * CURRENT MITIGATION:
 * - Keywords are chosen to be specific enough to minimize false positives
 * - Network errors are checked before GraphQL errors to prioritize connectivity
 * - Unknown errors have a safe fallback message
 * ============================================================================
 */

/**
 * Keywords that indicate authentication/authorization errors.
 */
const AUTH_KEYWORDS = [
  'token',
  'unauthorized',
  '401',
  '403',
  'authentication',
  'forbidden',
] as const;

/**
 * Keywords that indicate network connectivity errors.
 */
const NETWORK_KEYWORDS = [
  'network',
  'fetch',
  'connection',
  'timeout',
  'socket',
  'econnrefused',
] as const;

/**
 * Keywords that indicate GraphQL-specific errors.
 */
const GRAPHQL_KEYWORDS = ['graphql', 'query', 'syntax', 'validation'] as const;

/**
 * Checks if an error message contains any of the specified keywords.
 */
function messageContainsAny(
  errorMessage: string,
  keywords: readonly string[]
): boolean {
  return keywords.some((keyword) => errorMessage.includes(keyword));
}

/**
 * Categorizes an error for subscription contexts.
 *
 * This function is optimized for GraphQL subscription errors and provides
 * detailed categorization for token, network, and GraphQL-specific errors.
 *
 * @param error - The error to categorize
 * @returns Categorization with type and user-friendly message
 */
export function categorizeSubscriptionError(
  error: Error
): ErrorCategorization<SubscriptionErrorType> {
  const errorMessage = error.message.toLowerCase();

  // Token-related errors
  if (messageContainsAny(errorMessage, AUTH_KEYWORDS)) {
    return {
      type: 'token_expired',
      message:
        'CDA token is invalid or expired. Please reconfigure in plugin settings.',
    };
  }

  // Network errors - check before GraphQL to prioritize connectivity issues
  if (messageContainsAny(errorMessage, NETWORK_KEYWORDS)) {
    return {
      type: 'network_error',
      message: 'Connection lost. Attempting to reconnect...',
    };
  }

  // GraphQL errors
  if (messageContainsAny(errorMessage, GRAPHQL_KEYWORDS)) {
    return {
      type: 'graphql_error',
      message: 'Query error. Please refresh the page.',
    };
  }

  return {
    type: 'unknown',
    message: 'Sync error occurred. Please try again.',
  };
}

/**
 * Categorizes an error for general API/data loading contexts.
 *
 * This function provides simpler categorization suitable for CMA API calls
 * and data loading operations (users, fields, etc.).
 *
 * @param error - The error to categorize
 * @returns Categorization with type and user-friendly message
 */
export function categorizeGeneralError(
  error: Error
): ErrorCategorization<GeneralErrorType> {
  const errorMessage = error.message.toLowerCase();

  // Permission/auth errors - use a subset of auth keywords
  if (
    errorMessage.includes('forbidden') ||
    errorMessage.includes('401') ||
    errorMessage.includes('403')
  ) {
    return {
      type: 'permission_denied',
      message: 'Permission denied.',
    };
  }

  // Network errors
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('timeout')
  ) {
    return {
      type: 'network_error',
      message: 'Network error. Check your connection.',
    };
  }

  return {
    type: 'unknown',
    message: 'Failed to load data.',
  };
}

/**
 * Normalizes an unknown error value to a standard Error object.
 *
 * The useQuerySubscription hook and other APIs can return various error formats.
 * This function ensures we always have a proper Error object to work with.
 *
 * @param error - Unknown error value (could be Error, object with message, or anything)
 * @returns A standard Error object
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as { message?: unknown };
    if (typeof errorObj.message === 'string') {
      return new Error(errorObj.message);
    }
  }
  return new Error(String(error));
}
