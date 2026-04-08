// Vendor-agnostic translation types and interfaces
// -------------------------------------------------

/**
 * Supported vendor identifiers for translation providers.
 */
export type VendorId = 'openai' | 'google' | 'anthropic' | 'deepl';

/**
 * Default timeout for API calls in milliseconds (2 minutes).
 * EDGE-002: Prevents requests from hanging indefinitely.
 */
export const DEFAULT_API_TIMEOUT_MS = 120000;

/**
 * Options passed to provider calls to control request lifecycle.
 */
export interface StreamOptions {
  /** Optional abort signal for cancellation. */
  abortSignal?: AbortSignal;
  /** Optional timeout in milliseconds (defaults to DEFAULT_API_TIMEOUT_MS). */
  timeoutMs?: number;
}

/**
 * Creates an AbortSignal that will abort after the specified timeout,
 * optionally combined with an external abort signal.
 * EDGE-002: Utility for adding timeouts to API calls.
 *
 * @param timeoutMs - Timeout in milliseconds.
 * @param externalSignal - Optional external abort signal to combine with.
 * @returns An object with the combined signal and a cleanup function.
 */
export function createTimeoutSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  // Set up timeout
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  // Listen to external signal if provided
  const externalAbortHandler = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', externalAbortHandler, {
        once: true,
      });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', externalAbortHandler);
    }
  };

  return { signal: controller.signal, cleanup };
}

/**
 * Options for batch translation operations.
 * Used by providers that support native array translation (e.g., DeepL).
 */
export interface BatchTranslationOptions {
  /** Source language code (optional for auto-detect). */
  sourceLang?: string;
  /** Target language code (required). */
  targetLang: string;
  /** Whether the content contains HTML markup. */
  isHTML?: boolean;
  /** Formality level for the translation. */
  formality?: string;
  /** Whether to preserve formatting. */
  preserveFormatting?: boolean;
  /** HTML tags to ignore during translation. */
  ignoreTags?: string[];
  /** HTML tags that should not split sentences. */
  nonSplittingTags?: string[];
  /** HTML tags that should split sentences. */
  splittingTags?: string[];
  /** Glossary ID for terminology consistency. */
  glossaryId?: string;
  /** Optional timeout in milliseconds. */
  timeoutMs?: number;
  /** Original DatoCMS source locale before normalization (for error messages). */
  originalSourceLocale?: string;
  /** Original DatoCMS target locale before normalization (for error messages). */
  originalTargetLocale?: string;
}

/**
 * Minimal vendor-agnostic interface used by the translation utilities.
 *
 * NOTE: All translation flows use `completeText()` via `translateArray()`.
 * The `streamText()` method is retained for potential future streaming UI
 * features but is currently unused in production code paths.
 *
 * The optional `translateArray()` method enables providers with native batch
 * translation (like DeepL) to use their more efficient API directly.
 */
export interface TranslationProvider {
  /** Provider id (e.g., 'openai', 'google'). */
  readonly vendor: VendorId;
  /**
   * Streaming response for prompts. Currently unused in production;
   * retained for future streaming UI capabilities.
   */
  streamText(prompt: string, options?: StreamOptions): AsyncIterable<string>;
  /** Single-shot text completion - the primary translation method. */
  completeText(prompt: string, options?: StreamOptions): Promise<string>;
  /**
   * Optional batch translation for providers that support it natively.
   * When present, translateArray() will use this instead of building prompts.
   */
  translateArray?(
    texts: string[],
    options: BatchTranslationOptions,
  ): Promise<string[]>;
}

/**
 * Base cancellation interface shared by all translation callback options.
 * Provides consistent naming for cancellation across sidebar, modal, and field flows.
 */
export interface CancellationOptions {
  /** Returns true if user has requested cancellation. */
  checkCancellation?: () => boolean;
  /** Abort signal for cancelling in-flight requests. */
  abortSignal?: AbortSignal;
}

/**
 * Callback interface for streaming translation results.
 * Used across translation modules to handle progress updates,
 * completion notifications, and cancellation.
 */
export type StreamCallbacks = CancellationOptions & {
  /** Called with accumulated content as translation streams in. */
  onStream?: (chunk: string) => void;
  /** Called when translation completes successfully. */
  onComplete?: () => void;
};

/**
 * Custom error class for provider errors that includes HTTP status code.
 * This provides type-safe access to status without using `as any` casts.
 */
export class ProviderError extends Error {
  /** HTTP status code from the provider response, if applicable. */
  public readonly status?: number;
  /** The vendor that generated this error. */
  public readonly vendor?: VendorId;

  /**
   * Creates a new ProviderError.
   *
   * @param message - Error message describing the failure.
   * @param status - Optional HTTP status code from the provider.
   * @param vendor - Optional vendor identifier for error context.
   */
  constructor(message: string, status?: number, vendor?: VendorId) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.vendor = vendor;
  }
}

/**
 * Type guard to check if an error is a ProviderError with a status code.
 *
 * @param err - The error to check.
 * @returns True if the error is a ProviderError with a status property.
 */
export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

/**
 * Type guard to check if an unknown value has a numeric status property.
 * Useful for checking errors from external libraries.
 *
 * @param err - The value to check.
 * @returns True if err has a numeric status property.
 */
export function hasStatusCode(err: unknown): err is { status: number } {
  return (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  );
}

/**
 * Error thrown when a provider is not properly configured.
 * This replaces the silent fallback behavior with explicit error signaling.
 */
export class ProviderConfigurationError extends Error {
  /** The vendor that has configuration issues. */
  public readonly vendor: VendorId;

  /**
   * Creates a new ProviderConfigurationError.
   *
   * @param vendor - The vendor with configuration issues.
   * @param message - Description of what's missing or invalid.
   */
  constructor(vendor: VendorId, message: string) {
    super(`${vendor}: ${message}`);
    this.name = 'ProviderConfigurationError';
    this.vendor = vendor;
  }
}

/**
 * Type guard to check if an error is a ProviderConfigurationError.
 *
 * @param err - The error to check.
 * @returns True if the error is a ProviderConfigurationError.
 */
export function isProviderConfigurationError(
  err: unknown,
): err is ProviderConfigurationError {
  return err instanceof ProviderConfigurationError;
}
