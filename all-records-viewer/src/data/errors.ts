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
    code: nonEmptyString(shapedError.code),
    status:
      typeof statusCandidate === 'number' && Number.isFinite(statusCandidate)
        ? statusCandidate
        : null,
  };
}

export function errorMessage(error: unknown, fallback?: string): string {
  return normalizeError(error, fallback).message;
}
