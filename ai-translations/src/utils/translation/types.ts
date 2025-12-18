// Vendor-agnostic translation types and interfaces
// -------------------------------------------------

/**
 * Supported vendor identifiers for translation providers.
 */
export type VendorId = 'openai' | 'google' | 'anthropic' | 'deepl';

/**
 * Capabilities advertised by a provider implementation.
 */
export interface ProviderCapabilities {
  /** Whether the provider supports server-side streaming. */
  streaming: boolean;
}

/**
 * Options passed to provider calls to control request lifecycle.
 */
export interface StreamOptions {
  /** Optional abort signal for cancellation. */
  abortSignal?: AbortSignal;
}

/**
 * Minimal vendor-agnostic interface used by the translation utilities.
 */
export interface TranslationProvider {
  /** Provider id (e.g., 'openai', 'google'). */
  readonly vendor: VendorId;
  /** Provider capability flags. */
  readonly capabilities: ProviderCapabilities;
  /** Streaming response for prompts when supported. */
  streamText(prompt: string, options?: StreamOptions): AsyncIterable<string>;
  /** Single-shot text completion when streaming is not used. */
  completeText(prompt: string, options?: StreamOptions): Promise<string>;
}

/**
 * Callback interface for streaming translation results.
 * Used across translation modules to handle progress updates,
 * completion notifications, and cancellation.
 */
export type StreamCallbacks = {
  /** Called with accumulated content as translation streams in. */
  onStream?: (chunk: string) => void;
  /** Called when translation completes successfully. */
  onComplete?: () => void;
  /** Returns true if user has requested cancellation. */
  checkCancellation?: () => boolean;
  /** Abort signal for cancelling in-flight requests. */
  abortSignal?: AbortSignal;
};
