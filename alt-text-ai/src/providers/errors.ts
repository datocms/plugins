import type { AltTextProviderId } from './types';

export type AltTextProviderErrorCode =
  | 'configuration'
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'model'
  | 'invalid_request'
  | 'network'
  | 'timeout'
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
  public readonly retryAfterMs?: number;

  constructor(
    provider: AltTextProviderId,
    code: AltTextProviderErrorCode,
    message: string,
    options?: { status?: number; details?: unknown; retryAfterMs?: number },
  ) {
    super(
      `${PROVIDER_LABELS[provider]}: ${message.trim() || 'Request failed'}`,
    );
    this.name = 'AltTextProviderError';
    this.provider = provider;
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export function isAltTextProviderError(
  error: unknown,
): error is AltTextProviderError {
  return error instanceof AltTextProviderError;
}

export function isFatalProviderFailure(error: unknown): boolean {
  return (
    isAltTextProviderError(error) &&
    ['configuration', 'auth', 'quota', 'model', 'rate_limit'].includes(
      error.code,
    )
  );
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.trim();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    const seconds = Number(normalized);
    const delayMs = seconds * 1000;
    return Number.isFinite(delayMs) && seconds >= 0 ? delayMs : undefined;
  }

  const date = Date.parse(normalized);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
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
  payload: unknown,
): AltTextProviderErrorCode {
  const normalized = message.toLowerCase();
  const record = asRecord(payload);
  const error = asRecord(record?.error);
  const details = asRecord(error?.details);
  const quotaCode = firstNonEmptyString([
    error?.code,
    details?.error_code,
    error?.type,
    record?.error_code,
  ]);
  const shortTermQuota = hasOnlyShortTermQuotaViolations(error?.details);

  if (
    status === 402 ||
    quotaCode === 'insufficient_quota' ||
    quotaCode === 'enforced_spend_limit_reached' ||
    /limit:\s*0/.test(normalized) ||
    (!shortTermQuota &&
      /billing|credit|monthly|daily|per day|usage (?:limit|threshold)|spend (?:limit|cap)/.test(
        normalized,
      )) ||
    (/quota/.test(normalized) &&
      !shortTermQuota &&
      !/per minute|per second|rate|too many requests/.test(normalized))
  ) {
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

function hasOnlyShortTermQuotaViolations(details: unknown): boolean {
  if (!Array.isArray(details)) {
    return false;
  }
  const quotaIds: string[] = [];
  for (const detailValue of details) {
    const detail = asRecord(detailValue);
    if (!Array.isArray(detail?.violations)) {
      continue;
    }
    for (const violationValue of detail.violations) {
      const quotaId = asRecord(violationValue)?.quotaId;
      if (typeof quotaId !== 'string') {
        return false;
      }
      quotaIds.push(quotaId.toLowerCase());
    }
  }
  return (
    quotaIds.length > 0 &&
    quotaIds.every((id) => /perminute|persecond/.test(id))
  );
}

function retryDelayFromPayload(payload: unknown): number | undefined {
  const details = asRecord(asRecord(payload)?.error)?.details;
  if (!Array.isArray(details)) {
    return undefined;
  }
  for (const detailValue of details) {
    const detail = asRecord(detailValue);
    if (detail?.['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo') {
      continue;
    }
    const duration = detail.retryDelay;
    if (typeof duration === 'string' && /^\d+(?:\.\d+)?s$/.test(duration)) {
      return parseRetryAfter(duration.slice(0, -1));
    }
  }
  return undefined;
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
    errorCodeForHttpStatus(response.status, message, payload),
    message,
    {
      status: response.status,
      retryAfterMs:
        parseRetryAfter(response.headers.get('retry-after')) ??
        retryDelayFromPayload(payload),
    },
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
