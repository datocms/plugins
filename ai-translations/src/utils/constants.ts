/**
 * constants.ts
 * Centralized constants for the AI Translations plugin.
 * Extracting magic numbers to named constants improves readability and maintainability.
 */

// ============================================================================
// UI Constants
// ============================================================================

/**
 * Maximum characters to show when previewing API responses in the UI.
 * Used in DeepL API key test to truncate long responses.
 */
export const RESPONSE_PREVIEW_MAX_LENGTH = 64;

/**
 * Seconds to wait before showing "not stuck" hint for pending translations.
 * Provides reassurance to users that large fields take time.
 */
export const PENDING_HINT_THRESHOLD_SECONDS = 15;

// ============================================================================
// SEO Constants
// ============================================================================

/**
 * Maximum length for SEO title field.
 * Based on Google's recommended title tag length for optimal display in SERPs.
 */
export const SEO_TITLE_MAX_LENGTH = 60;

/**
 * Maximum length for SEO description field.
 * Based on Google's recommended meta description length for optimal display.
 */
export const SEO_DESCRIPTION_MAX_LENGTH = 160;

// ============================================================================
// Concurrency Constants
// ============================================================================

/**
 * Concurrency thresholds for adaptive translation scheduling.
 * Based on field count to optimize throughput vs API rate limits.
 */
export const CONCURRENCY_THRESHOLDS = {
  /** Below this threshold, use minimal concurrency */
  LOW: 5,
  /** Between LOW and MEDIUM, use moderate concurrency */
  MEDIUM: 10,
  /** Between MEDIUM and HIGH, use higher concurrency */
  HIGH: 20,
} as const;

/**
 * Concurrency levels for different field count ranges.
 * Lower concurrency for smaller batches to avoid thundering herd on API.
 */
export const CONCURRENCY_LEVELS = {
  /** Concurrency when field count is below THRESHOLDS.LOW */
  MINIMAL: 1,
  /** Concurrency when field count between LOW and MEDIUM */
  LOW: 2,
  /** Concurrency when field count between MEDIUM and HIGH */
  MODERATE: 3,
  /** Concurrency when field count exceeds THRESHOLDS.HIGH */
  HIGH: 4,
} as const;

// ============================================================================
// Cache Constants
// ============================================================================

/**
 * Maximum number of block field metadata entries to cache.
 * Prevents unbounded memory growth while still benefiting from caching.
 */
export const BLOCK_FIELDS_CACHE_MAX_SIZE = 100;

// ============================================================================
// Timeout Constants
// ============================================================================

/**
 * Default timeout for individual API calls in milliseconds.
 * Already defined in types.ts as DEFAULT_API_TIMEOUT_MS = 120000 (2 minutes).
 * This is referenced here for documentation purposes.
 */
// See types.ts: DEFAULT_API_TIMEOUT_MS = 120000

/**
 * Maximum time in milliseconds to wait for a single field translation.
 * Intentionally large (5 minutes) to accommodate:
 * - Large structured text fields with many blocks
 * - Complex nested modular content
 * - Rate-limited API responses that take time to complete
 */
export const FIELD_TRANSLATION_TIMEOUT_MS = 300000; // 5 minutes

// ============================================================================
// DeepL Constants
// ============================================================================

/**
 * Maximum number of text segments per DeepL API request.
 * DeepL's API accepts up to 50 segments, but we use 45 to stay safely within
 * limits and account for potential metadata overhead.
 */
export const DEEPL_BATCH_SIZE = 45;

// ============================================================================
// Streaming Constants
// ============================================================================

/**
 * Throttle interval for streaming UI updates in milliseconds.
 * Limits UI updates to ~30fps to prevent performance issues.
 */
export const STREAM_THROTTLE_MS = 33;

// ============================================================================
// Rate Limit Constants
// ============================================================================

/**
 * Maximum number of retries for rate-limited requests.
 * Higher than regular errors because rate limits are transient.
 */
export const RATE_LIMIT_MAX_RETRIES = 10;

/**
 * Base delay for rate limit backoff in milliseconds.
 * Actual delay is calculated as: BASE_DELAY * 2^(retry-1)
 * Retry 1: 1000ms, Retry 2: 2000ms, Retry 3: 4000ms, etc.
 */
export const RATE_LIMIT_BASE_DELAY_MS = 1000;

/**
 * Maximum delay between rate limit retries in milliseconds.
 * Caps exponential backoff to prevent excessively long waits.
 */
export const RATE_LIMIT_MAX_DELAY_MS = 10000;

/**
 * Minimum delay between consecutive API requests in milliseconds.
 * Helps prevent hitting rate limits by spacing out requests.
 * Set per vendor in getRequestSpacingMs().
 */
export const DEFAULT_REQUEST_SPACING_MS = 50;

/**
 * Request spacing for Gemini API calls in milliseconds.
 * Gemini has stricter rate limits, so we space requests more.
 */
export const GEMINI_REQUEST_SPACING_MS = 200;
