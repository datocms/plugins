export type SubscriptionErrorType =
  | 'token_expired'
  | 'network_error'
  | 'graphql_error'
  | 'unknown';

export type GeneralErrorType =
  | 'permission_denied'
  | 'network_error'
  | 'unknown';

export type ErrorCategorization<T extends string = string> = {
  type: T;
  message: string;
};

const AUTH_KEYWORDS = [
  'token',
  'unauthorized',
  '401',
  '403',
  'authentication',
  'forbidden',
] as const;

const NETWORK_KEYWORDS = [
  'network',
  'fetch',
  'connection',
  'timeout',
  'socket',
  'econnrefused',
] as const;

const GRAPHQL_KEYWORDS = ['graphql', 'query', 'syntax', 'validation'] as const;

// Subset of keywords for permission denied errors in general contexts
const PERMISSION_KEYWORDS = ['forbidden', '401', '403'] as const;

// Subset of keywords for network errors in general contexts
const GENERAL_NETWORK_KEYWORDS = ['network', 'fetch', 'timeout'] as const;

function messageContainsAny(
  errorMessage: string,
  keywords: readonly string[],
): boolean {
  return keywords.some((keyword) => errorMessage.includes(keyword));
}

export function categorizeSubscriptionError(
  error: Error,
): ErrorCategorization<SubscriptionErrorType> {
  const errorMessage = error.message.toLowerCase();

  if (messageContainsAny(errorMessage, AUTH_KEYWORDS)) {
    return {
      type: 'token_expired',
      message:
        'CDA token is invalid or expired. Please reconfigure in plugin settings.',
    };
  }

  if (messageContainsAny(errorMessage, NETWORK_KEYWORDS)) {
    return {
      type: 'network_error',
      message: 'Connection lost. Attempting to reconnect...',
    };
  }

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

export function categorizeGeneralError(
  error: Error,
): ErrorCategorization<GeneralErrorType> {
  const errorMessage = error.message.toLowerCase();

  if (messageContainsAny(errorMessage, PERMISSION_KEYWORDS)) {
    return {
      type: 'permission_denied',
      message: 'Permission denied.',
    };
  }

  if (messageContainsAny(errorMessage, GENERAL_NETWORK_KEYWORDS)) {
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

/** Normalizes unknown error values (from various APIs) to standard Error. */
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

function retryHeaderValue(
  headers: Record<string, string>,
  header: string,
): string {
  return (
    Object.entries(headers).find(
      ([name]) => name.toLowerCase() === header,
    )?.[1] ?? ''
  );
}

function retryAfterDelay(value: string, now: number): number {
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function minimumRetryDelay(
  headers: Record<string, string>,
  now: number,
): number {
  const retryAfter = retryHeaderValue(headers, 'retry-after');
  const resetSeconds = Number(retryHeaderValue(headers, 'x-ratelimit-reset'));
  return Math.max(
    retryAfterDelay(retryAfter, now),
    Number.isFinite(resetSeconds) ? resetSeconds * 1000 : 0,
  );
}

/** Explicit subscription/resource failures stop a batch instead of retrying writes. */
export function isQuotaOrBillingError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.response.status === 402) return true;
  return error.errors.some(({ attributes }) =>
    attributes.code === 'PLAN_UPGRADE_REQUIRED' ||
    (attributes.code === 'INVALID_FIELD' && attributes.details?.code === 'INVALID_FOR_CURRENT_PLAN') ||
    /quota|billing|usage|monthly|subscription|cost|resource_limit|max_allowed|(?:cap|records?|storage)_(?:limit|quota|exceeded|reached)/i.test(attributes.code),
  );
}

/** Retry only API/transport failures; malformed storage and logic errors fail closed. */
export function getCommentRetryInfo(
  error: unknown,
  now = Date.now(),
): { retryable: boolean; versionConflict: boolean; minimumDelayMs: number } {
  if (isQuotaOrBillingError(error))
    return { retryable: false, versionConflict: false, minimumDelayMs: 0 };
  if (error instanceof ApiError) {
    const versionConflict = Boolean(error.findError('STALE_ITEM_VERSION'));
    const retryable =
      versionConflict ||
      error.response.status === 429 ||
      error.response.status >= 500 ||
      error.errors.some((entry) => entry.attributes.transient === true);
    return {
      retryable,
      versionConflict,
      minimumDelayMs: minimumRetryDelay(error.response.headers ?? {}, now),
    };
  }
  return {
    retryable:
      error instanceof TimeoutError ||
      (error instanceof TypeError &&
        /fetch|network|load failed|connection/i.test(error.message)),
    versionConflict: false,
    minimumDelayMs: 0,
  };
}

import { ApiError, TimeoutError } from '@datocms/cma-client-browser';
