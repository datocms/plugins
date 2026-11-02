import type { Logger } from '../logging/Logger';
import { providerRetryAfterMs } from './ProviderRequestControl';
import {
  hasStatusCode,
  isProviderConfigurationError,
  isProviderError,
  ProviderError,
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
   * The vendor of a provider error, so the text for the user can name it
   * ("DeepL's usage limit is reached").
   */
  vendor?: VendorId;
};

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
      hint: 'Close other tabs editing the record, wait for the lock to clear, then try again.',
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
    if (typeof obj.code === 'string') return { code: obj.code };
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
function getRateLimitHint(vendor: VendorId): string {
  if (vendor === 'openai')
    return 'Reduce concurrency, switch to a more available model, or increase limits.';
  if (vendor === 'google')
    return 'Reduce request rate or increase quota in Google Cloud console.';
  if (vendor === 'anthropic')
    return 'Reduce request rate or increase Anthropic rate limits.';
  if (vendor === 'deepl')
    return 'Reduce concurrency or batch size; check DeepL plan limits.';
  return 'Reduce request rate or increase the Translate API quotas in Yandex Cloud.';
}

/** Per-vendor hint for quota errors. */
function getQuotaHint(vendor: VendorId): string {
  if (vendor === 'openai')
    return 'Check selected provider usage and billing; switch to a smaller model if needed.';
  if (vendor === 'google')
    return 'Verify Google project quotas and billing for Generative Language API.';
  if (vendor === 'anthropic')
    return 'Check Anthropic usage limits and billing.';
  if (vendor === 'deepl') return 'Check DeepL usage limits and plan.';
  return 'Check Yandex Cloud Translate quotas and billing for the configured folder.';
}

/** Per-vendor hint for model-not-found errors. */
function getModelHint(vendor: VendorId): string {
  if (vendor === 'openai')
    return 'Ensure the model exists on your account and is spelled correctly.';
  if (vendor === 'google')
    return 'Ensure the Gemini model id is correct and available in your region.';
  if (vendor === 'anthropic')
    return 'Ensure the Claude model id is correct and you have access.';
  if (vendor === 'deepl')
    return 'Ensure the language pair is valid for DeepL; check target code.';
  return 'Ensure the target locale is supported by Yandex Translate.';
}

/** Per-vendor hint for authentication and permissions errors. */
function getAuthHint(vendor: VendorId): string {
  switch (vendor) {
    case 'openai':
      return 'Check the provider API key and organization access in settings.';
    case 'google':
      return 'Check the Google API key and that Generative Language API is enabled.';
    case 'anthropic':
      return 'Check the Anthropic API key and workspace access in settings.';
    case 'deepl':
      return 'Check the DeepL API key and selected Free or Pro endpoint in settings.';
    case 'yandex':
      return 'Check the Yandex service-account API key, ai.translate.user role, API key scope, and optional Folder ID in settings.';
  }
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
 * Normalizes Yandex credential, permission, and folder errors before generic
 * HTTP matching. These failures are configuration-fatal for record runs.
 */
function normalizeYandexConfigurationError(
  vendor: VendorId,
  status: number | string | undefined,
  message: string,
): NormalizedProviderError | null {
  if (vendor !== 'yandex') return null;

  const isFolderError =
    includes(
      message,
      'folder id',
      'folderid',
      'folder not found',
      'specified folder',
      'cloud resource not found',
    ) ||
    status === 404 ||
    status === 'NOT_FOUND';
  if (isFolderError) {
    return {
      source: 'provider',
      code: 'auth',
      message: 'Yandex Translate could not access the configured Folder ID.',
      hint: 'Check the Folder ID and make sure the service account belongs to that folder and has the ai.translate.user role.',
    };
  }

  const isPermissionError =
    status === 403 ||
    status === 'PERMISSION_DENIED' ||
    includes(message, 'permission denied', 'permission_denied', 'forbidden');
  if (isPermissionError) {
    return {
      source: 'provider',
      code: 'auth',
      message: 'Yandex Cloud denied access to the Translate API.',
      hint: getAuthHint(vendor),
    };
  }

  return null;
}

/**
 * Normalizes known provider-side error patterns.
 */
function normalizeKnownProviderError(
  vendor: VendorId,
  status: number | string | undefined,
  message: string,
  errorDetails: { code?: string; param?: string },
): NormalizedProviderError | null {
  if (
    status === 456 ||
    errorDetails.code === 'insufficient_quota' ||
    errorDetails.code === 'enforced_spend_limit_reached' ||
    includes(
      message,
      'monthly API usage threshold',
      'specified API usage limits',
      'specified workspace API usage limits',
      'perday',
      'per_day',
      'per day',
      'daily quota',
      'daily limit',
    )
  ) {
    return {
      source: 'provider',
      code: 'quota',
      message: 'Quota exceeded for the selected translation provider.',
      hint: getQuotaHint(vendor),
    };
  }
  const yandexConfigurationError = normalizeYandexConfigurationError(
    vendor,
    status,
    message,
  );
  if (yandexConfigurationError) return yandexConfigurationError;

  if (isOpenAIStreamVerificationError(vendor, status, message, errorDetails)) {
    return {
      source: 'provider',
      code: 'auth',
      message,
      hint: 'Verify your organization with the provider or choose a different model.',
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
      hint: getAuthHint(vendor),
    };
  }

  const isQuotaError = includes(
    message,
    'insufficient_quota',
    'quota exceeded',
    'quota limit exceeded',
    'resource has been exhausted',
    'resource exhausted',
    'out of quota',
  );
  if (
    !isQuotaError &&
    (status === 429 || includes(message, 'rate limit', 'too many requests'))
  ) {
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
  vendor: VendorId,
  status: number | string | undefined,
  message: string,
): NormalizedProviderError | null {
  const isQuotaError = includes(
    message,
    'insufficient_quota',
    'quota exceeded',
    'quota limit exceeded',
    'resource has been exhausted',
    'resource exhausted',
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
      'unsupported target language',
      'unsupported language code',
      'does not support the target locale',
    );
  if (isModelError) {
    return {
      source: 'provider',
      code: 'model',
      message:
        vendor === 'yandex'
          ? 'The target language is unavailable in Yandex Translate.'
          : 'The selected model is unavailable or not accessible.',
      hint: getModelHint(vendor),
    };
  }

  const isYandexServiceError =
    vendor === 'yandex' &&
    (status === 500 ||
      status === 503 ||
      status === 504 ||
      status === 'INTERNAL' ||
      status === 'UNAVAILABLE' ||
      status === 'DEADLINE_EXCEEDED');
  if (isYandexServiceError) {
    return {
      source: 'provider',
      code: 'network',
      message,
      hint: 'Yandex Translate may be temporarily unavailable. Wait and try again; use the request ID when contacting Yandex support.',
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
      hint: 'Match the endpoint to your plan: Free (:fx) → api-free.deepl.com; Pro → api.deepl.com.',
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
 * Normalizes provider-specific errors to a compact, user-friendly shape, with
 * special handling for common authentication, quota, rate-limit and model
 * errors. Includes targeted hints where we can determine a likely fix.
 *
 * @param err - Raw error thrown from a provider client or fetch call.
 * @param vendor - Provider id for vendor-specific mappings.
 * @returns A normalized error with `code`, `message`, and optional `hint`.
 */
export function normalizeProviderError(
  err: unknown,
  vendor: VendorId,
): NormalizedProviderError {
  const normalized = normalizeError(err, vendor);
  return normalized.source === 'provider'
    ? { ...normalized, vendor }
    : normalized;
}

/** The body of {@link normalizeProviderError}, before it adds the vendor. */
function normalizeError(
  err: unknown,
  vendor: VendorId,
): NormalizedProviderError {
  const status = extractStatus(err);
  const rawMessage = extractMessage(err);
  const datoCMSError = normalizeDatoCMSError(err, rawMessage);
  if (datoCMSError) return datoCMSError;

  const stripped = stripSourcePrefix(rawMessage);
  const errorDetails = extractErrorDetails(err);
  const message = stripped.message;
  if (
    vendor === 'google' &&
    status === 429 &&
    providerRetryAfterMs(err) !== undefined &&
    !/per.?day|daily (?:quota|limit)/i.test(message)
  ) {
    return {
      source: 'provider',
      code: 'rate_limit',
      message: 'Rate limit reached. Please wait and try again.',
      hint: getRateLimitHint(vendor),
    };
  }

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
 * Returns true when continuing a record run would repeat a provider
 * configuration failure for every remaining field or record.
 *
 * @param vendor - Active translation provider.
 * @param error - Already normalized provider error.
 */
export function isFatalProviderError(
  vendor: VendorId,
  error: NormalizedProviderError,
): boolean {
  if (error.code === 'auth' || error.code === 'quota') return true;
  if (
    error.code === 'model' &&
    !includes(error.message, 'unexpected response', 'target language')
  ) return true;
  if (vendor === 'deepl' && includes(error.message, 'wrong endpoint')) {
    return true;
  }
  if (vendor === 'openai' && includes(error.message, 'verified to stream')) {
    return true;
  }
  if (vendor === 'yandex') {
    return includes(error.message, 'folder id', 'permission denied');
  }
  return false;
}

/**
 * Formats a normalized error as the message of a thrown error: the source
 * label, the message and the hint. The layers above read such a message
 * again (`normalizeProviderError` strips the label and matches the
 * message), so it keeps the wording of the normalized error. Never shown
 * as is: the text for the user is {@link formatErrorForUser}.
 *
 * @param error - The normalized error object.
 * @returns The message of the error to throw.
 */
export function formatErrorMessage(error: NormalizedProviderError): string {
  const body = error.hint ? `${error.message} ${error.hint}` : error.message;
  if (hasSourcePrefix(body)) return body;

  const sourceLabel = SOURCE_LABEL_ENTRIES.find(
    ([source]) => source === error.source,
  )?.[1];

  return sourceLabel ? `${sourceLabel}: ${body}` : body;
}

/** The name of each vendor in the texts for the user. */
const VENDOR_NAMES: Record<VendorId, string> = {
  openai: 'OpenAI',
  google: 'Google',
  anthropic: 'Anthropic',
  deepl: 'DeepL',
  yandex: 'Yandex',
};

/** The name of a vendor in a text for the user: "DeepL". */
export function vendorName(vendor: VendorId): string {
  return VENDOR_NAMES[vendor] ?? VENDOR_NAMES.openai;
}

/** What to check when the usage limit of a vendor is reached. */
const QUOTA_NEXT_STEPS: Record<VendorId, string> = {
  openai: 'Check the billing of your OpenAI account.',
  google: 'Check the quota and the billing of your Google project.',
  anthropic: 'Check the plan of your Anthropic account.',
  deepl: 'Check your DeepL plan.',
  yandex: 'Check the quotas of your Yandex Cloud folder.',
};

/** An error for the user: the problem, and what to do about it. */
export type UserFacingError = {
  /** What went wrong, in one sentence. */
  problem: string;
  /** What the user can do about it, in one sentence. */
  nextStep?: string;
};

/** A text that ends with a period. */
function withPeriod(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** An authentication error of a vendor, in plain words. */
function describeAuthError(
  vendor: VendorId,
  name: string,
  message: string,
): UserFacingError {
  if (vendor === 'yandex' && includes(message, 'folder id')) {
    return {
      problem: "Yandex can't access the Folder ID.",
      nextStep: 'Check the Folder ID and the role of the service account.',
    };
  }
  if (vendor === 'yandex') {
    return {
      problem: 'Yandex rejected the API key.',
      nextStep: 'Check the key and its role in Yandex Cloud.',
    };
  }
  if (vendor === 'deepl' && includes(message, 'wrong endpoint')) {
    return {
      problem: 'DeepL rejected the key for this plan.',
      nextStep: 'Check “Key from the DeepL Free plan” in the plugin settings.',
    };
  }
  if (vendor === 'openai' && includes(message, 'verified to stream')) {
    return {
      problem: 'OpenAI needs your organization to be verified for this model.',
      nextStep: 'Verify it, or pick another model in the plugin settings.',
    };
  }
  return {
    problem: `${name} rejected the API key.`,
    nextStep: 'Check the key in the plugin settings.',
  };
}

/** An error of a vendor, in plain words that name the vendor. */
function describeProviderError(
  error: NormalizedProviderError,
  vendor: VendorId,
): UserFacingError {
  const name = VENDOR_NAMES[vendor] ?? 'The translation service';
  const { message } = error;
  switch (error.code) {
    case 'quota':
      return {
        problem: `${name}'s usage limit is reached.`,
        nextStep: QUOTA_NEXT_STEPS[vendor],
      };
    case 'rate_limit':
      return {
        problem: `${name} is getting too many requests.`,
        nextStep: 'Wait a moment, then try again.',
      };
    case 'auth':
      return describeAuthError(vendor, name, message);
    case 'model':
      if (includes(message, 'unexpected response')) {
        return {
          problem: `${name} returned an answer that the plugin can't read.`,
          nextStep: 'Try again, or pick another model in the plugin settings.',
        };
      }
      if (vendor === 'deepl' || vendor === 'yandex') {
        return { problem: `${name} doesn't support one of these languages.` };
      }
      return {
        problem: `The selected ${name} model isn't available.`,
        nextStep: 'Pick another model in the plugin settings.',
      };
    case 'network':
      if (vendor === 'yandex' && includes(error.hint, 'temporarily')) {
        return {
          problem: "Yandex Translate isn't available right now.",
          nextStep: 'Try again later.',
        };
      }
      return {
        problem: `Couldn't reach ${name}.`,
        nextStep: 'Check the connection, then try again.',
      };
    default:
      return { problem: `${name} returned an error: ${withPeriod(message)}` };
  }
}

/**
 * An error for the user, as the problem and the next step. A vendor error
 * names the vendor in plain words; a DatoCMS or plugin error keeps its
 * source label, its message and its hint.
 *
 * @param error - The normalized error object.
 */
export function describeErrorForUser(
  error: NormalizedProviderError,
): UserFacingError {
  if (error.source === 'provider' && error.vendor) {
    return describeProviderError(error, error.vendor);
  }
  const sourceLabel = SOURCE_LABEL_ENTRIES.find(
    ([source]) => source === error.source,
  )?.[1];
  const problem =
    sourceLabel && error.source !== 'provider'
      ? `${sourceLabel}: ${error.message}`
      : error.message;
  return { problem, nextStep: error.hint };
}

/**
 * Formats a normalized error for display to users: the problem, then what to
 * do about it.
 *
 * @param error - The normalized error object.
 * @returns A formatted string suitable for display in alerts/notices.
 */
export function formatErrorForUser(error: NormalizedProviderError): string {
  const { problem, nextStep } = describeErrorForUser(error);
  return nextStep ? `${problem} ${nextStep}` : problem;
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
  // The layers above normalize the message again: it keeps its wording.
  const message = formatErrorMessage(normalized);
  if (isProviderError(error)) {
    throw new ProviderError(message, error.status, error.vendor ?? vendor, {
      cause: error,
      retryAfterMs: error.retryAfterMs,
      retryExhausted: error.retryExhausted,
      code: error.code,
    });
  }
  throw new Error(message, { cause: error });
}

/**
 * Context interface for DatoCMS UI operations that can display alerts/notices.
 */
interface UIContext {
  alert: (msg: string) => void;
  notice: (msg: string) => void;
}

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
    ctx.notice('Translation cancelled.');
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
