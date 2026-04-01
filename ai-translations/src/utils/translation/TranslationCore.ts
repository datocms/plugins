/**
 * TranslationCore.ts
 * ------------------
 * Shared utilities for both form-based (sidebar) and CMA-based (modal/bulk)
 * translation flows. These utilities are intentionally pure and context-free
 * to enable reuse across different DatoCMS plugin entry points.
 *
 * See also:
 * - translateRecordFields.ts: Form context, uses ctx.setFieldValue()
 * - ItemsDropdownUtils.ts: CMA context, builds update payloads
 */

import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { modularContentVariations } from '../../entrypoints/Config/ConfigScreen';
import { isFieldExcluded, isFieldTranslatable } from './SharedFieldUtils';
import { isEmptyStructuredText } from './utils';
import {
  DEFAULT_REQUEST_SPACING_MS,
  GEMINI_REQUEST_SPACING_MS,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
} from '../constants';

/**
 * Determines if a field should be processed for translation based on
 * field type, exclusion rules, and plugin configuration.
 *
 * @param fieldType - The field's editor type (e.g., 'single_line', 'structured_text').
 * @param fieldId - The field's unique ID for exclusion checking.
 * @param pluginParams - Plugin configuration parameters.
 * @returns True if the field should be translated.
 */
export function shouldProcessField(
  fieldType: string,
  fieldId: string,
  pluginParams: ctxParamsType,
  fieldApiKey?: string
): boolean {
  const isTranslatable = isFieldTranslatable(
    fieldType,
    pluginParams.translationFields,
    modularContentVariations
  );

  const isExcluded = isFieldExcluded(
    pluginParams.apiKeysToBeExcludedFromThisPlugin,
    [fieldId, fieldApiKey]
  );

  return isTranslatable && !isExcluded;
}

/**
 * Determines whether a localized source value contains meaningful content for
 * the given field type.
 *
 * @param fieldType - The field editor type.
 * @param sourceValue - The source-locale value to inspect.
 * @returns True when the value should be sent to translation.
 */
export function hasTranslatableSourceValue(
  fieldType: string,
  sourceValue: unknown
): boolean {
  if (sourceValue === undefined || sourceValue === null || sourceValue === '') {
    return false;
  }

  if (fieldType === 'structured_text') {
    return !isEmptyStructuredText(sourceValue);
  }

  if (Array.isArray(sourceValue) && sourceValue.length === 0) {
    return false;
  }

  return true;
}

/**
 * Determines the maximum concurrency for translation operations based on
 * the configured model. Lighter/faster models allow higher concurrency.
 * Gemini has stricter rate limits so we use lower concurrency for all Gemini models.
 *
 * @param pluginParams - Plugin configuration parameters.
 * @returns Maximum number of concurrent translation operations.
 */
export function getMaxConcurrency(pluginParams: ctxParamsType): number {
  const vendor = pluginParams.vendor ?? 'openai';
  const modelId = vendor === 'google'
    ? String(pluginParams.geminiModel ?? '').toLowerCase()
    : String(pluginParams.gptModel ?? '').toLowerCase();

  // Gemini has stricter rate limits - use lower concurrency across all models
  if (vendor === 'google') {
    // Light/fast Gemini models (flash, nano)
    if (/(^|[-])nano\b/.test(modelId) || /flash|lite/.test(modelId)) return 3;
    // Heavier "pro" models
    if (/pro/.test(modelId)) return 2;
    // Default for Gemini
    return 2;
  }

  // Non-Gemini vendors (OpenAI, Anthropic, DeepL)
  // Light/fast profiles
  if (/(^|[-])nano\b/.test(modelId) || /flash|mini|lite/.test(modelId)) return 6;
  // Medium
  if (/mini/.test(modelId) || /1\.5/.test(modelId)) return 5;
  // Heavier "pro" / general models
  if (/pro/.test(modelId)) return 3;
  // Default middle ground
  return 4;
}

/**
 * Gets the minimum delay between API requests for a vendor.
 * Helps prevent hitting rate limits by spacing out requests.
 *
 * @param pluginParams - Plugin configuration parameters.
 * @returns Delay in milliseconds between requests.
 */
export function getRequestSpacingMs(pluginParams: ctxParamsType): number {
  const vendor = pluginParams.vendor ?? 'openai';

  // Gemini has stricter rate limits
  if (vendor === 'google') {
    return GEMINI_REQUEST_SPACING_MS;
  }

  return DEFAULT_REQUEST_SPACING_MS;
}

/**
 * Calculates the backoff delay for a rate-limited request using exponential backoff.
 * Formula: min(BASE_DELAY * 2^(retry-1), MAX_DELAY)
 *
 * @param retryCount - The current retry attempt number (1-based).
 * @returns Delay in milliseconds before the next retry.
 */
export function calculateRateLimitBackoff(retryCount: number): number {
  const exponentialDelay = RATE_LIMIT_BASE_DELAY_MS * 2 ** (retryCount - 1);
  return Math.min(exponentialDelay, RATE_LIMIT_MAX_DELAY_MS);
}

/**
 * Checks if an error represents a rate limit response from an API.
 * Works across different error shapes from various providers.
 *
 * @param err - The error to check.
 * @returns True if the error indicates rate limiting.
 */
export function isRateLimitError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;

  const anyErr = err as { status?: number; code?: string; message?: string };
  return (
    anyErr?.status === 429 ||
    anyErr?.code === 'rate_limit_exceeded' ||
    /\b429\b|rate limit|Too Many Requests/i.test(String(anyErr?.message ?? ''))
  );
}

/**
 * Type guard to check if an error is an AbortError (user-initiated cancellation).
 *
 * @param error - The error to check.
 * @returns True if the error is a DOMException with name 'AbortError'.
 */
export function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Creates a delay promise for implementing backoff strategies.
 *
 * @param ms - Milliseconds to delay.
 * @returns Promise that resolves after the delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
