import type { Logger } from '../logging/Logger';
import { hasStatusCode, isProviderError, type VendorId } from './types';

/**
 * Canonical error shape used across providers to surface actionable messages
 * and hints to the UI.
 */
export type NormalizedProviderError = {
  code: 'auth' | 'quota' | 'rate_limit' | 'model' | 'network' | 'unknown';
  message: string;
  hint?: string;
};

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
    return 'Check OpenAI usage and billing; switch to a smaller model if needed.';
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
  vendor: 'openai' | 'google' | 'anthropic' | 'deepl',
): NormalizedProviderError {
  const status = extractStatus(err);
  const rawMessage = extractMessage(err);
  const errorDetails = extractErrorDetails(err);
  const message = rawMessage;

  if (isOpenAIStreamVerificationError(vendor, status, message, errorDetails)) {
    return {
      code: 'auth',
      message,
      hint: 'Verify your organization in OpenAI or choose a different model.',
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
      code: 'auth',
      message: 'Authentication failed for the selected AI vendor.',
      hint:
        vendor === 'openai'
          ? 'Check OpenAI API key and organization access in settings.'
          : 'Check Google API key and that Generative Language API is enabled.',
    };
  }

  if (status === 429 || includes(message, 'rate limit', 'too many requests')) {
    return {
      code: 'rate_limit',
      message: 'Rate limit reached. Please wait and try again.',
      hint: getRateLimitHint(vendor),
    };
  }

  const isQuotaError = includes(
    message,
    'insufficient_quota',
    'quota exceeded',
    'resource has been exhausted',
    'out of quota',
  );
  if (isQuotaError) {
    return {
      code: 'quota',
      message: 'Quota exceeded for the selected AI vendor.',
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
      code: 'network',
      message: rawMessage,
      hint: 'This often indicates CORS/proxy issues or connectivity problems.',
    };
  }

  if (isDeepLWrongEndpointError(vendor, status, message)) {
    return {
      code: 'auth',
      message:
        'DeepL: wrong endpoint for your API key. If your key ends with :fx, enable "Use DeepL Free endpoint (api-free.deepl.com)" in Settings. Otherwise, disable it to use api.deepl.com.',
      hint: 'Match the endpoint to your plan: Free (:fx) → api-free.deepl.com; Pro → api.deepl.com.',
    };
  }

  return {
    code: 'unknown',
    message,
  };
}

/**
 * Formats a normalized error for display to users.
 * Combines message and hint into a single user-friendly string.
 *
 * @param error - The normalized error object.
 * @returns A formatted string suitable for display in alerts/notices.
 */
export function formatErrorForUser(error: NormalizedProviderError): string {
  if (error.hint) {
    return `${error.message} ${error.hint}`;
  }
  return error.message;
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
    hint: normalized.hint,
  });
  // Include hint in thrown error for consistent user-facing messages
  throw new Error(formatErrorForUser(normalized), { cause: error });
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
    ctx.notice('Operation was cancelled');
    return;
  }

  const normalized = normalizeProviderError(error, vendor ?? 'openai');

  if (logger) {
    logger.error('UI Error', {
      message: normalized.message,
      code: normalized.code,
      hint: normalized.hint,
    });
  }

  ctx.alert(formatErrorForUser(normalized));
}
