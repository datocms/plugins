import {
  ProviderRequestControl,
  retryAfterMs,
} from '../ProviderRequestControl';
import { isEmptyPrompt, withTimeout } from '../providerUtils';
import type { StreamOptions, TranslationProvider, VendorId } from '../types';
import { ProviderError } from '../types';

type AnthropicProviderConfig = {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  baseUrl?: string; // optional override
};

/**
 * Anthropic Claude provider using the Messages API. Implements a lightweight
 * fetch-based client and exposes streaming via single-yield (non-streaming
 * on server) to conform to the TranslationProvider interface.
 *
 * Note: streamText() yields the complete response once (not true streaming)
 * because the Anthropic Messages API streaming adds complexity for minimal
 * benefit in this translation context.
 */
export default class AnthropicProvider implements TranslationProvider {
  public readonly vendor: VendorId = 'anthropic';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxOutputTokens?: number;
  private readonly baseUrl: string;
  private readonly requests = new ProviderRequestControl('anthropic');

  /**
   * Creates a Claude provider with the given configuration.
   *
   * @param cfg - API key, model id and optional tuning parameters.
   */
  constructor(cfg: AnthropicProviderConfig) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.temperature = cfg.temperature;
    this.maxOutputTokens = cfg.maxOutputTokens ?? 4096;
    this.baseUrl = cfg.baseUrl ?? 'https://api.anthropic.com/v1/messages';
  }

  /**
   * Yields the final response text once to emulate a streaming interface.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal.
   */
  async *streamText(
    prompt: string,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    // Non-streaming implementation: yield the final text once.
    const txt = await this.completeText(prompt, options);
    if (txt) {
      yield txt;
    }
  }

  /**
   * Sends the request body to the Anthropic API and returns the parsed response text.
   * Throws a ProviderError if the response is not OK.
   *
   * @param body - The request payload to send.
   * @param signal - Abort signal for request cancellation.
   * @param prompt - Original prompt, used for empty-response warning.
   * @returns Concatenated text content from the API response.
   */
  private async fetchAnthropicResponse(
    body: Record<string, unknown>,
    signal: AbortSignal,
    prompt: string,
    debug?: StreamOptions['debug'],
  ): Promise<string> {
    debug?.request?.('Provider request', {
      provider: this.vendor,
      operation: 'completeText',
      url: this.baseUrl,
      body,
    });

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let msg = res.statusText;
      let rawError: unknown = null;
      try {
        const err = await res.json();
        rawError = err;
        msg = err?.error?.message || msg;
      } catch {
        // JSON parsing failed, use statusText
      }
      debug?.response?.('Provider error response', {
        provider: this.vendor,
        operation: 'completeText',
        status: res.status,
        statusText: res.statusText,
        response: rawError,
      });
      const errorCode =
        rawError && typeof rawError === 'object'
          ? (rawError as { error?: { details?: { error_code?: string } } })
              .error?.details?.error_code
          : undefined;
      throw new ProviderError(msg, res.status, 'anthropic', {
        retryAfterMs: retryAfterMs(res.headers),
        code: errorCode,
      });
    }

    const data = await res.json();
    if (data?.stop_reason === 'max_tokens') {
      throw new ProviderError(
        'The model truncated the translation. No content was saved.',
        422,
        'anthropic',
      );
    }
    const content = Array.isArray(data?.content) ? data.content : [];
    const parts: string[] = [];
    for (const c of content) {
      if (c?.type === 'text' && typeof c?.text === 'string') {
        parts.push(c.text);
      }
    }
    const result = parts.join('');
    debug?.response?.('Provider response', {
      provider: this.vendor,
      operation: 'completeText',
      status: res.status,
      response: data,
      text: result,
    });

    if (!result && prompt.trim()) {
      debug?.response?.('Provider empty response warning', {
        provider: this.vendor,
        operation: 'completeText',
        status: res.status,
        response: data,
      });
    }
    return result;
  }

  /**
   * Calls the Anthropic Messages API and returns concatenated text parts.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal.
   * @returns Response text string.
   */
  async completeText(prompt: string, options?: StreamOptions): Promise<string> {
    if (isEmptyPrompt(prompt)) {
      return '';
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      temperature: this.temperature,
      messages: [{ role: 'user', content: prompt }],
    };

    return this.requests.run(
      () =>
        withTimeout(options, (signal) =>
          this.fetchAnthropicResponse(body, signal, prompt, options?.debug),
        ),
      options?.abortSignal,
    );
  }
}
