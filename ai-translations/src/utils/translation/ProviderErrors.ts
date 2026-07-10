import type { Logger } from '../logging/Logger';
import { retryAfterFromHeaders } from './retryAfter';
import {
  hasStatusCode,
  isProviderConfigurationError,
  isProviderError,
  type VendorId,
} from './types';

/**
 * Source buckets used in user-facing error messages.
 */
export type ErrorSource = 'provider' | 'datocms' | 'plugin';

/**
 * Canonical error shape used across translation flows to surface actionable
 * messages, hints, and the origin of the failure to the UI.
 */
export type NormalizedProviderError = {
  code:
    | 'auth'
    | 'quota'
    | 'rate_limit'
    | 'model'
    | 'network'
    | 'datocms'
    | 'plugin'
    | 'unknown';
  source: ErrorSource;
  message: string;
  hint?: string;
  /**
   * Milliseconds the provider asked us to wait, threaded from
   * `ProviderError.retryAfterMs` (parsed from a `Retry-After` header). Usually
   * `undefined`: browser callers can only read the header when the server sets
   * `Access-Control-Expose-Headers`, so the pause machine must not depend on it.
   */
  retryAfterMs?: number;
};

/**
 * An `Error` that carries the already-normalized provider error alongside the
 * human-readable message. Throwing this (instead of a bare `Error`) across a
 * translation boundary keeps the structured `code`/`source`/`retryAfterMs`
 * intact: a second `normalizeProviderError` pass recovers them verbatim rather
 * than re-deriving `'unknown'` from a friendly message that no longer contains
 * any of the raw keywords. That distinction is load-bearing — only a preserved
 * `auth`/`rate_limit`/`quota`/`network` code lets the bulk run PAUSE instead of
 * silently failing every field.
 */
export class NormalizedError extends Error {
  readonly normalized: NormalizedProviderError;

  constructor(normalized: NormalizedProviderError, options?: ErrorOptions) {
    super(formatErrorForUser(normalized), options);
    this.name = 'NormalizedError';
    this.normalized = normalized;
  }
}

/** Type guard: an `Error` that already carries a {@link NormalizedProviderError}. */
export function isNormalizedError(err: unknown): err is NormalizedError {
  return err instanceof NormalizedError;
}

const SOURCE_LABEL_ENTRIES: Array<[ErrorSource, string]> = [
  ['provider', 'Translation provider error'],
  ['datocms', 'DatoCMS error'],
  ['plugin', 'Plugin error'],
];

/**
 * Case-insensitive substring check helper.
 *
 * @param s - String to inspect.
 * @param needles - One or more substrings to search for.
 * @returns True if any needle is found within `s` (case-insensitive).
 */
const includes = (s: unknown, ...needles: string[]) =>
  typeof s === 'string' &&
  needles.some((n) => s.toLowerCase().includes(n.toLowerCase()));

/**
 * Removes one of our own source prefixes from a formatted message, if present.
 */
function stripSourcePrefix(message: string): {
  source?: ErrorSource;
  message: string;
} {
  const trimmed = message.trim();
  for (const [source, label] of SOURCE_LABEL_ENTRIES) {
    const prefix = `${label}:`;
    if (trimmed.startsWith(prefix)) {
      return {
        source,
        message: trimmed.slice(prefix.length).trim(),
      };
    }
  }
  return { message: trimmed };
}

/**
 * Returns true when a message already starts with one of our source prefixes.
 */
function hasSourcePrefix(message: string): boolean {
  return SOURCE_LABEL_ENTRIES.some(([, label]) =>
    message.trim().startsWith(`${label}:`),
  );
}

/**
 * Returns the value if it is a number or string, otherwise undefined.
 */
function asNumberOrString(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

/**
 * Extracts a status code from a plain object, checking common field names.
 */
function extractStatusFromObject(
  obj: Record<string, unknown>,
): number | string | undefined {
  const directStatus = asNumberOrString(obj.status);
  if (directStatus !== undefined) return directStatus;

  const codeStatus = asNumberOrString(obj.code);
  if (codeStatus !== undefined) return codeStatus;

  // Check nested response.status (axios-style)
  if (obj.response && typeof obj.response === 'object') {
    const response = obj.response as Record<string, unknown>;
    if (typeof response.status === 'number') return response.status;
  }

  return undefined;
}

/**
 * Safely extracts the status code from an error object.
 *
 * @param err - The error to extract status from.
 * @returns The status code, or undefined if not present.
 */
function extractStatus(err: unknown): number | string | undefined {
  if (isProviderError(err)) return err.status;
  if (hasStatusCode(err)) return err.status;
  if (err !== null && typeof err === 'object') {
    return extractStatusFromObject(err as Record<string, unknown>);
  }
  return undefined;
}

/**
 * Safely extracts the error message from an error object.
 *
 * @param err - The error to extract message from.
 * @returns The error message string.
 */
function extractMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err !== null && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      return obj.message;
    }
    // Check nested error.message (some APIs return { error: { message } })
    if (obj.error && typeof obj.error === 'object') {
      const errorObj = obj.error as Record<string, unknown>;
      if (typeof errorObj.message === 'string') {
        return errorObj.message;
      }
    }
  }
  return String(err || 'Unknown error');
}

/**
 * Safely walks an object path and returns a nested plain object.
 */
function getNestedObject(
  obj: Record<string, unknown>,
  path: string[],
): Record<string, unknown> | undefined {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  if (current === null || typeof current !== 'object') return undefined;
  return current as Record<string, unknown>;
}

/**
 * Extracts structured DatoCMS API error entries from CMA client errors.
 */
function extractDatoCMSErrorEntries(err: unknown): unknown[] {
  if (err === null || typeof err !== 'object') return [];

  const obj = err as Record<string, unknown>;
  const responseBody = getNestedObject(obj, ['response', 'body']);
  const data = responseBody?.data;

  if (!Array.isArray(data)) return [];

  return data.filter((entry) => {
    if (entry === null || typeof entry !== 'object') return false;
    const entryObj = entry as Record<string, unknown>;
    return entryObj.type === 'api_error';
  });
}

/**
 * Extracts a DatoCMS API error code from one structured error entry.
 */
function extractDatoCMSErrorCode(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null;
  const entryObj = entry as Record<string, unknown>;
  const attributes = entryObj.attributes;
  if (attributes === null || typeof attributes !== 'object') return null;
  const code = (attributes as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Returns true when an error has the DatoCMS CMA client error shape.
 */
function isDatoCMSClientError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;

  const obj = err as Record<string, unknown>;
  const request = getNestedObject(obj, ['request']);
  const response = getNestedObject(obj, ['response']);
  const requestUrl = request?.url;

  return (
    !!request &&
    (!!response ||
      extractDatoCMSErrorEntries(err).length > 0 ||
      typeof requestUrl === 'string')
  );
}

/**
 * Builds a compact code suffix for structured DatoCMS API errors.
 */
function formatDatoCMSCodeSuffix(codes: string[]): string {
  if (codes.length === 0) return '';
  return ` (${codes.join(', ')})`;
}

/**
 * Maps a DatoCMS field-validator code to a short human-readable reason.
 */
function describeValidatorCode(code: string | undefined): string {
  switch (code) {
    case 'VALIDATION_LENGTH':
      // The CMA does not tell us which bound was violated (min/max/eq), so the
      // message must not assert a direction it cannot know.
      return 'has a length outside the allowed range';
    case 'VALIDATION_REQUIRED':
      return 'is required but the translation is empty';
    case 'VALIDATION_FORMAT':
    case 'VALIDATION_SLUG_FORMAT':
      return 'has an invalid format';
    case 'VALIDATION_UNIQUENESS':
      return 'must be unique';
    default:
      return code ? `failed validation (${code})` : 'failed validation';
  }
}

/**
 * Pulls `{ field, code }` from each structured validation entry's
 * `attributes.details`, so a 422 can name the offending field(s) and reason(s)
 * instead of surfacing an opaque "rejected the record update" message.
 */
type ValidationFieldError = { field?: string; code?: string };

/** Pulls `{ field, code }` from one entry's `attributes.details`, or `null`. */
function extractFieldError(entry: unknown): ValidationFieldError | null {
  if (entry === null || typeof entry !== 'object') return null;
  const details = getNestedObject(entry as Record<string, unknown>, [
    'attributes',
    'details',
  ]);
  if (!details) return null;
  const field = typeof details.field === 'string' ? details.field : undefined;
  const code = typeof details.code === 'string' ? details.code : undefined;
  return field || code ? { field, code } : null;
}

function extractValidationFieldErrors(
  entries: unknown[],
): ValidationFieldError[] {
  return entries
    .map(extractFieldError)
    .filter((e): e is ValidationFieldError => e !== null);
}

/**
 * Builds a field-named message for a 422 validation rejection, or `null` when
 * no per-field details are present (caller falls back to a generic message).
 */
function formatValidationMessage(entries: unknown[]): string | null {
  const named = extractValidationFieldErrors(entries).filter((e) => e.field);
  if (named.length === 0) return null;
  const parts = named.map(
    (e) => `field "${e.field}" ${describeValidatorCode(e.code)}`,
  );
  // No "DatoCMS" prefix here — formatErrorForUser adds the single source label.
  return `The record update was rejected because ${parts.join('; ')}.`;
}

/**
 * Normalizes DatoCMS CMA client errors before generic provider matching.
 */
function normalizeDatoCMSError(
  err: unknown,
  rawMessage: string,
): NormalizedProviderError | null {
  if (!isDatoCMSClientError(err)) return null;

  const obj = err as Record<string, unknown>;
  const response = getNestedObject(obj, ['response']);
  const status = typeof response?.status === 'number' ? response.status : null;
  const statusText =
    typeof response?.statusText === 'string' ? response.statusText : '';
  const entries = extractDatoCMSErrorEntries(err);
  const codes = entries
    .map(extractDatoCMSErrorCode)
    .filter((code): code is string => code !== null);
  const codeSuffix = formatDatoCMSCodeSuffix(codes);

  if (codes.includes('ITEM_LOCKED')) {
    return {
      source: 'datocms',
      code: 'datocms',
      message:
        'Cannot save translations because the record is locked for editing.',
      hint:
        'Close other tabs editing the record, wait for the lock to clear, then try again.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      source: 'datocms',
      code: 'auth',
      message: `DatoCMS authorization failed${codeSuffix}.`,
      hint: 'Check the current user token permissions for this project.',
    };
  }

  if (status === 404) {
    return {
      source: 'datocms',
      code: 'datocms',
      message: `DatoCMS could not find the requested record or schema${codeSuffix}.`,
      hint: 'Refresh the page and try again.',
    };
  }

  if (status === 422) {
    const validationMessage = formatValidationMessage(entries);
    if (validationMessage) {
      return {
        source: 'datocms',
        code: 'datocms',
        message: validationMessage,
        hint: 'Shorten or fix the translated value(s), or relax the field validator(s) in the model settings, then retry.',
      };
    }
    return {
      source: 'datocms',
      code: 'datocms',
      message: `DatoCMS rejected the record update${codeSuffix}.`,
      hint: 'Check field validations, required locales, and record locks.',
    };
  }

  if (status === 429) {
    return {
      source: 'datocms',
      code: 'rate_limit',
      message:
        'DatoCMS rate limit reached while reading or saving records. Please wait and try again.',
    };
  }

  if (includes(rawMessage, 'timeout')) {
    return {
      source: 'datocms',
      code: 'network',
      message:
        'DatoCMS request timed out while reading or saving records. Please wait and try again.',
    };
  }

  const statusPart =
    status === null ? '' : ` (${status}${statusText ? ` ${statusText}` : ''})`;

  return {
    source: 'datocms',
    code: 'datocms',
    message: `DatoCMS request failed${statusPart}${codeSuffix}.`,
  };
}

/**
 * Safely extracts nested error properties for OpenAI-specific checks.
 *
 * @param err - The error object.
 * @returns Object with code and param if present.
 */
function extractErrorDetails(err: unknown): { code?: string; param?: string } {
  if (err !== null && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (obj.error && typeof obj.error === 'object') {
      const errorObj = obj.error as Record<string, unknown>;
      return {
        code: typeof errorObj.code === 'string' ? errorObj.code : undefined,
        param: typeof errorObj.param === 'string' ? errorObj.param : undefined,
      };
    }
  }
  return {};
}

/** Per-vendor hint for rate limit errors. */
function getRateLimitHint(
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
): string {
  if (vendor === 'openai')
    return 'Reduce concurrency, switch to a more available model, or increase limits.';
  if (vendor === 'google')
    return 'Reduce request rate or increase quota in Google Cloud console.';
  if (vendor === 'anthropic')
    return 'Reduce request rate or increase Anthropic rate limits.';
  return 'Reduce concurrency or batch size; check DeepL plan limits.';
}

/** Per-vendor hint for quota errors. */
function getQuotaHint(
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
): string {
  if (vendor === 'openai')
    return 'Check selected provider usage and billing; switch to a smaller model if needed.';
  if (vendor === 'google')
    return 'Verify Google project quotas and billing for Generative Language API.';
  if (vendor === 'anthropic')
    return 'Check Anthropic usage limits and billing.';
  return 'Check DeepL usage limits and plan.';
}

/** Per-vendor hint for model-not-found errors. */
function getModelHint(
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
): string {
  if (vendor === 'openai')
    return 'Ensure the model exists on your account and is spelled correctly.';
  if (vendor === 'google')
    return 'Ensure the Gemini model id is correct and available in your region.';
  if (vendor === 'anthropic')
    return 'Ensure the Claude model id is correct and you have access.';
  return 'Ensure the language pair is valid for DeepL; check target code.';
}

/**
 * Detects the OpenAI "must be verified to stream" error that occurs when an
 * organization has not been verified for streaming access with certain models.
 *
 * @param vendor - Provider vendor id.
 * @param status - HTTP status code extracted from the error.
 * @param message - Normalized error message string.
 * @param errorDetails - Parsed code/param details from the error body.
 * @returns True if this is an OpenAI stream-verification error.
 */
function isOpenAIStreamVerificationError(
  vendor: string,
  status: number | string | undefined,
  message: string,
  errorDetails: { code?: string; param?: string },
): boolean {
  if (vendor !== 'openai') return false;
  const hasUnsupportedValueOrBadRequest =
    errorDetails.code === 'unsupported_value' || status === 400;
  const hasStreamParam =
    errorDetails.param === 'stream' || includes(message, 'stream');
  return (
    hasUnsupportedValueOrBadRequest &&
    hasStreamParam &&
    includes(message, 'must be verified to stream this model')
  );
}

/**
 * Detects the DeepL "wrong endpoint" error that occurs when a Free API key
 * is used with the Pro endpoint or vice versa.
 *
 * @param vendor - Provider vendor id.
 * @param status - HTTP status code extracted from the error.
 * @param message - Normalized error message string.
 * @returns True if this is a DeepL wrong-endpoint error.
 */
function isDeepLWrongEndpointError(
  vendor: string,
  status: number | string | undefined,
  message: string,
): boolean {
  return (
    vendor === 'deepl' &&
    (status === 403 || includes(message, 'wrong endpoint'))
  );
}

/**
 * Normalizes errors that already contain one of our own source prefixes.
 */
function normalizePrefixedError(
  source: ErrorSource | undefined,
  message: string,
): NormalizedProviderError | null {
  if (source === 'datocms') {
    return {
      source: 'datocms',
      code: 'datocms',
      message,
    };
  }

  if (source === 'plugin') {
    return {
      source: 'plugin',
      code: 'plugin',
      message,
    };
  }

  return null;
}

/**
 * Normalizes known provider-side error patterns.
 */
function normalizeKnownProviderError(
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
  status: number | string | undefined,
  message: string,
  errorDetails: { code?: string; param?: string },
): NormalizedProviderError | null {
  if (isOpenAIStreamVerificationError(vendor, status, message, errorDetails)) {
    return {
      source: 'provider',
      code: 'auth',
      message,
      hint:
        'Verify your organization with the provider or choose a different model.',
    };
  }

  const isAuthError =
    status === 401 ||
    includes(
      message,
      'unauthorized',
      'invalid api key',
      'invalid authentication',
      'not valid api key',
      'permission_denied',
    );

  if (isAuthError) {
    return {
      source: 'provider',
      code: 'auth',
      message: 'Authentication failed for the selected translation provider.',
      hint:
        vendor === 'openai'
          ? 'Check the provider API key and organization access in settings.'
          : 'Check Google API key and that Generative Language API is enabled.',
    };
  }

  if (status === 429 || includes(message, 'rate limit', 'too many requests')) {
    return {
      source: 'provider',
      code: 'rate_limit',
      message: 'Rate limit reached. Please wait and try again.',
      hint: getRateLimitHint(vendor),
    };
  }

  return normalizeProviderQuotaModelNetworkError(vendor, status, message);
}

/**
 * Normalizes quota, model, network, and endpoint provider errors.
 */
function normalizeProviderQuotaModelNetworkError(
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
  status: number | string | undefined,
  message: string,
): NormalizedProviderError | null {
  const isQuotaError = includes(
    message,
    'insufficient_quota',
    'quota exceeded',
    'resource has been exhausted',
    'out of quota',
  );
  if (isQuotaError) {
    return {
      source: 'provider',
      code: 'quota',
      message: 'Quota exceeded for the selected translation provider.',
      hint: getQuotaHint(vendor),
    };
  }

  const isModelError =
    status === 404 ||
    includes(
      message,
      'model not found',
      'no such model',
      'unsupported model',
      'not found: model',
    );
  if (isModelError) {
    return {
      source: 'provider',
      code: 'model',
      message: 'The selected model is unavailable or not accessible.',
      hint: getModelHint(vendor),
    };
  }

  const isNetworkError = includes(
    message,
    'failed to fetch',
    'fetch failed',
    'network',
    'ecconn',
    'enotfound',
    'timeout',
  );
  if (isNetworkError) {
    return {
      source: 'provider',
      code: 'network',
      message,
      hint: 'This often indicates CORS/proxy issues or connectivity problems.',
    };
  }

  if (isDeepLWrongEndpointError(vendor, status, message)) {
    return {
      source: 'provider',
      code: 'auth',
      message:
        'DeepL: wrong endpoint for your API key. If your key ends with :fx, enable "Use DeepL Free endpoint (api-free.deepl.com)" in Settings. Otherwise, disable it to use api.deepl.com.',
      hint:
        'Match the endpoint to your plan: Free (:fx) → api-free.deepl.com; Pro → api.deepl.com.',
    };
  }

  if (includes(message, 'did not return a json array')) {
    return {
      source: 'provider',
      code: 'model',
      message: 'The translation provider returned an unexpected response.',
      hint: 'Please try again. If it continues, choose a different model.',
    };
  }

  return null;
}

/**
 * Derives the code/message/hint shape from a raw provider or DatoCMS error.
 * The exported `normalizeProviderError` wraps this to additionally thread any
 * `Retry-After` hint the adapter captured.
 *
 * @param err - Raw error thrown from a provider client or fetch call.
 * @param vendor - Provider id for vendor-specific mappings.
 * @returns A normalized error with `code`, `message`, and optional `hint`.
 */
function deriveNormalizedError(
  err: unknown,
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
): NormalizedProviderError {
  const status = extractStatus(err);
  const rawMessage = extractMessage(err);
  const datoCMSError = normalizeDatoCMSError(err, rawMessage);
  if (datoCMSError) return datoCMSError;

  const stripped = stripSourcePrefix(rawMessage);
  const errorDetails = extractErrorDetails(err);
  const message = stripped.message;

  const prefixedError = normalizePrefixedError(stripped.source, message);
  if (prefixedError) return prefixedError;

  const knownProviderError = normalizeKnownProviderError(
    vendor,
    status,
    message,
    errorDetails,
  );
  if (knownProviderError) return knownProviderError;

  const source: ErrorSource =
    stripped.source ||
    (isProviderError(err) || isProviderConfigurationError(err)
      ? 'provider'
      : 'plugin');

  return {
    source,
    code: 'unknown',
    message,
  };
}

/**
 * Recovers a `Retry-After` hint from whatever shape the error arrived in.
 *
 * The Anthropic and DeepL adapters build a `ProviderError` and pre-parse the
 * header onto `retryAfterMs`. The OpenAI and Google SDKs never pass through that
 * constructor: OpenAI's `APIError` carries the raw `headers`, and the Google SDK
 * nests them under `response.headers`. Reading all three here keeps the four
 * vendors on one path.
 *
 * Returns `undefined` for any other shape — and routinely will, since a
 * cross-origin caller can only read the header when the server sets
 * `Access-Control-Expose-Headers`. Callers must fall back to exponential backoff.
 */
function readRetryAfterMs(err: unknown): number | undefined {
  if (err === null || typeof err !== 'object') return undefined;

  const obj = err as {
    retryAfterMs?: unknown;
    headers?: unknown;
    response?: { headers?: unknown };
  };
  if (typeof obj.retryAfterMs === 'number') return obj.retryAfterMs;

  const now = Date.now();
  return (
    retryAfterFromHeaders(obj.headers, now) ??
    retryAfterFromHeaders(obj.response?.headers, now)
  );
}

/**
 * Normalizes provider-specific errors to a compact, user-friendly shape, with
 * special handling for common authentication, quota, rate-limit and model
 * errors. Includes targeted hints where we can determine a likely fix, and
 * threads any `Retry-After` the adapter captured so the pause machine can honor
 * it as an optimization over blind backoff.
 *
 * @param err - Raw error thrown from a provider client or fetch call.
 * @param vendor - Provider id for vendor-specific mappings.
 * @returns A normalized error with `code`, `message`, optional `hint`, and any
 *   `retryAfterMs` hint.
 */
export function normalizeProviderError(
  err: unknown,
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
): NormalizedProviderError {
  // Already normalized upstream (e.g. rethrown by translateArray): return the
  // preserved shape verbatim so its code/source/retryAfterMs survive the second
  // pass instead of collapsing to 'unknown'.
  if (isNormalizedError(err)) return err.normalized;

  const normalized = deriveNormalizedError(err, vendor);
  const retryAfterMs = readRetryAfterMs(err);
  return retryAfterMs === undefined
    ? normalized
    : { ...normalized, retryAfterMs };
}

/**
 * Formats a normalized error for display to users.
 * Combines message and hint into a single user-friendly string.
 *
 * @param error - The normalized error object.
 * @returns A formatted string suitable for display in alerts/notices.
 */
export function formatErrorForUser(error: NormalizedProviderError): string {
  const body = error.hint ? `${error.message} ${error.hint}` : error.message;
  if (hasSourcePrefix(body)) return body;

  const sourceLabel = SOURCE_LABEL_ENTRIES.find(
    ([source]) => source === error.source,
  )?.[1];

  return sourceLabel ? `${sourceLabel}: ${body}` : body;
}

/**
 * DRY-001: Centralized error handling for translation operations.
 * Logs the error, normalizes it, and throws a new error with the original as cause.
 *
 * @param error - The caught error
 * @param vendor - The vendor ID for error normalization
 * @param logger - Logger instance for error logging
 * @param context - Optional context string for the log message
 * @throws Error with normalized message and original error as cause
 */
export function handleTranslationError(
  error: unknown,
  vendor: VendorId,
  logger: Logger,
  context = 'Translation error',
): never {
  const normalized = normalizeProviderError(error, vendor);
  logger.error(context, {
    message: normalized.message,
    code: normalized.code,
    source: normalized.source,
    hint: normalized.hint,
  });
  // Preserve the structured error across this boundary: a bare Error would drop
  // the code so a downstream re-normalization sees only the friendly message and
  // collapses 'auth'/'rate_limit'/etc. to 'unknown', disabling the run's pause.
  throw isNormalizedError(error)
    ? error
    : new NormalizedError(normalized, { cause: error });
}

/**
 * Context interface for DatoCMS UI operations that can display alerts/notices.
 */
interface UIContext {
  alert: (msg: string) => void;
  notice: (msg: string) => void;
}

/** Error codes whose next call will fail identically — the run must pause. */
const SYSTEMIC_CODES = new Set<NormalizedProviderError['code']>([
  'rate_limit',
  'auth',
  'quota',
  'network',
]);

/**
 * Classifies a normalized error as systemic (the whole run must pause) or
 * content-scoped (fail this field and its record, then continue).
 *
 * @param err - The normalized provider error.
 * @returns True when continuing the run would only burn quota.
 */
export const isSystemicError = (err: NormalizedProviderError): boolean =>
  SYSTEMIC_CODES.has(err.code);

/**
 * UI-layer error handler for DatoCMS contexts.
 * Normalizes errors and displays them via ctx.alert().
 * Handles AbortError separately with ctx.notice() for graceful cancellation.
 *
 * Use this in entry points (main.tsx, sidebar, bulk page) to ensure consistent
 * error presentation to users across all plugin features.
 *
 * @param error - The caught error
 * @param vendor - The vendor ID for error normalization (defaults to 'openai' for generic errors)
 * @param ctx - DatoCMS context with alert/notice methods
 * @param logger - Optional logger for error logging
 */
export function handleUIError(
  error: unknown,
  vendor: VendorId | undefined,
  ctx: UIContext,
  logger?: Logger,
): void {
  // Handle user cancellation gracefully
  if (error instanceof Error && error.name === 'AbortError') {
    ctx.notice('Operation was cancelled');
    return;
  }

  const normalized = normalizeProviderError(error, vendor ?? 'openai');

  if (logger) {
    logger.error('UI Error', {
      message: normalized.message,
      code: normalized.code,
      source: normalized.source,
      hint: normalized.hint,
    });
  }

  ctx.alert(formatErrorForUser(normalized));
}
