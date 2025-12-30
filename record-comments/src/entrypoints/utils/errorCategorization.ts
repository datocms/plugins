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

function messageContainsAny(
  errorMessage: string,
  keywords: readonly string[]
): boolean {
  return keywords.some((keyword) => errorMessage.includes(keyword));
}

export function categorizeSubscriptionError(
  error: Error
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
  error: Error
): ErrorCategorization<GeneralErrorType> {
  const errorMessage = error.message.toLowerCase();

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
