import type { AltTextProviderId } from './types';

export type AltTextProviderErrorCode =
  | 'configuration'
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'model'
  | 'invalid_request'
  | 'network'
  | 'invalid_response'
  | 'empty_response'
  | 'image_fetch'
  | 'provider';

const PROVIDER_LABELS: Record<AltTextProviderId, string> = {
  'alttext-ai': 'AltText.ai',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

export class AltTextProviderError extends Error {
  public readonly provider: AltTextProviderId;
  public readonly code: AltTextProviderErrorCode;
  public readonly status?: number;
  public readonly details?: unknown;

  constructor(
    provider: AltTextProviderId,
    code: AltTextProviderErrorCode,
    message: string,
    options?: { status?: number; details?: unknown },
  ) {
    super(
      `${PROVIDER_LABELS[provider]}: ${message.trim() || 'Request failed'}`,
    );
    this.name = 'AltTextProviderError';
    this.provider = provider;
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;
  }
}

export function isAltTextProviderError(
  error: unknown,
): error is AltTextProviderError {
  return error instanceof AltTextProviderError;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractBaseError(errors: unknown): string | null {
  const record = asRecord(errors);
  const base = record?.base;

  if (Array.isArray(base)) {
    return firstNonEmptyString(base);
  }

  return typeof base === 'string' && base.trim() ? base.trim() : null;
}

export function extractProviderErrorMessage(
  payload: unknown,
  fallback = 'Request failed',
): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  const record = asRecord(payload);
  if (!record) {
    return fallback;
  }

  const nestedError = asRecord(record.error);
  const directMessage = firstNonEmptyString([
    nestedError?.message,
    nestedError?.type,
    record.message,
    extractBaseError(record.errors),
    record.error_code,
    typeof record.error === 'string' ? record.error : null,
  ]);

  return directMessage ?? fallback;
}

function errorCodeForHttpStatus(
  status: number,
  message: string,
): AltTextProviderErrorCode {
  const normalized = message.toLowerCase();

  if (/quota|billing|credit|usage limit/.test(normalized)) {
    return 'quota';
  }

  if (status === 401 || status === 403) {
    return 'auth';
  }

  if (status === 429) {
    return 'rate_limit';
  }

  if (
    status === 404 ||
    /model.+(?:not found|does not exist|unsupported)|invalid model/.test(
      normalized,
    )
  ) {
    return 'model';
  }

  if (status === 400 || status === 409 || status === 422) {
    return 'invalid_request';
  }

  return 'provider';
}

export function createProviderHttpError(
  provider: AltTextProviderId,
  response: Response,
  payload: unknown,
): AltTextProviderError {
  const fallback =
    response.statusText.trim() || `Request failed with HTTP ${response.status}`;
  const message = extractProviderErrorMessage(payload, fallback);

  return new AltTextProviderError(
    provider,
    errorCodeForHttpStatus(response.status, message),
    message,
    { status: response.status },
  );
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function normalizeProviderFailure(
  provider: AltTextProviderId,
  error: unknown,
): AltTextProviderError {
  if (isAltTextProviderError(error)) {
    return error;
  }

  return new AltTextProviderError(
    provider,
    'network',
    'Could not reach the provider. Check the connection and browser access, then try again.',
  );
}
