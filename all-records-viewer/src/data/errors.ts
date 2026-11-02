type ErrorShape = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  response?: unknown;
  body?: unknown;
};

export type NormalizedError = {
  message: string;
  code: string | null;
  status: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorDetailsFromBody(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }

  const data = body.data;
  if (!Array.isArray(data)) {
    return null;
  }

  for (const entry of data) {
    if (!isRecord(entry)) {
      continue;
    }

    const attributes = entry.attributes;
    if (!isRecord(attributes)) {
      continue;
    }

    const details = nonEmptyString(attributes.details);
    if (details) {
      return details;
    }

    const title = nonEmptyString(attributes.title);
    if (title) {
      return title;
    }
  }

  return null;
}

// The code of the first error of an API answer ("INSUFFICIENT_PERMISSIONS")
function errorCodeFromBody(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return null;
  }

  for (const entry of body.data) {
    if (isRecord(entry) && isRecord(entry.attributes)) {
      const code = nonEmptyString(entry.attributes.code);
      if (code) {
        return code;
      }
    }
  }

  return null;
}

export function normalizeError(
  error: unknown,
  fallback = 'Could not load records. Please try again.',
): NormalizedError {
  if (!isRecord(error)) {
    return {
      message: nonEmptyString(error) ?? fallback,
      code: null,
      status: null,
    };
  }

  const shapedError = error as ErrorShape;
  const response = isRecord(shapedError.response) ? shapedError.response : null;
  const body = shapedError.body ?? response?.body ?? response?.data;
  const statusCandidate = shapedError.status ?? response?.status;

  return {
    message:
      errorDetailsFromBody(body) ??
      nonEmptyString(shapedError.message) ??
      fallback,
    code: nonEmptyString(shapedError.code) ?? errorCodeFromBody(body),
    status:
      typeof statusCandidate === 'number' && Number.isFinite(statusCandidate)
        ? statusCandidate
        : null,
  };
}

export function errorMessage(error: unknown, fallback?: string): string {
  return normalizeError(error, fallback).message;
}

/** The request got no answer: the connection dropped, or it timed out */
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === 'TimeoutError')
  );
}

/** The server refused the request: the role of the user can't do it */
export function isPermissionError(error: unknown): boolean {
  const { code, status } = normalizeError(error);
  return (
    status === 401 || status === 403 || code === 'INSUFFICIENT_PERMISSIONS'
  );
}

/** A failed load, as a blank slate shows it */
export type LoadError = {
  /**
   * The raw message for the `code` box, short: the code of the API and the
   * status ("INTERNAL_SERVER_ERROR (500)"), never the URL or the body of the
   * request
   */
  code: string;
  /** The request got no answer, thus the user checks their connection */
  connection: boolean;
};

export function loadError(error: unknown): LoadError {
  const { message, code, status } = normalizeError(error);
  return {
    code:
      status === null ? (code ?? message) : `${code ?? 'Error'} (${status})`,
    connection: isConnectionError(error),
  };
}

/**
 * What to do after a failed request, in a plain sentence for a toast. The
 * plugin's own errors already say it; a request error never shows its URL
 * or its body.
 */
export function errorAdvice(error: unknown): string {
  if (isConnectionError(error)) {
    return 'Check your connection, then try again.';
  }
  if (
    normalizeError(error).status === null &&
    error instanceof Error &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return 'Try again in a moment.';
}
