import type { TranslationProvider, ProviderCapabilities, VendorId, StreamOptions } from '../types';

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
 */
export default class AnthropicProvider implements TranslationProvider {
  public readonly vendor: VendorId = 'anthropic';
  public readonly capabilities: ProviderCapabilities = { streaming: false };
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxOutputTokens?: number;
  private readonly baseUrl: string;

  /**
   * Creates a Claude provider with the given configuration.
   *
   * @param cfg - API key, model id and optional tuning parameters.
   */
  constructor(cfg: AnthropicProviderConfig) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.temperature = cfg.temperature;
    this.maxOutputTokens = cfg.maxOutputTokens ?? 1024;
    this.baseUrl = cfg.baseUrl ?? 'https://api.anthropic.com/v1/messages';
  }

  /**
   * Yields the final response text once to emulate a streaming interface.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal.
   */
  async *streamText(prompt: string, options?: StreamOptions): AsyncIterable<string> {
    // Non-streaming implementation: yield the final text once.
    const txt = await this.completeText(prompt, options);
    if (txt) {
      yield txt;
    }
  }

  /**
   * Calls the Anthropic Messages API and returns concatenated text parts.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal.
   * @returns Response text string.
   */
  async completeText(prompt: string, options?: StreamOptions): Promise<string> {
    const controller = new AbortController();
    const signal = options?.abortSignal;
    if (signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const body = {
      model: this.model,
      max_output_tokens: this.maxOutputTokens,
      temperature: this.temperature,
      messages: [
        { role: 'user', content: prompt }
      ],
    } as Record<string, unknown>;

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let msg = res.statusText;
      try {
        const err = await res.json();
        msg = err?.error?.message || msg;
      } catch {}
      const e = new Error(msg);
      (e as any).status = res.status;
      throw e;
    }

    const data = await res.json();
    const parts: string[] = [];
    const content = Array.isArray(data?.content) ? data.content : [];
    for (const c of content) {
      if (c?.type === 'text' && typeof c?.text === 'string') {
        parts.push(c.text);
      }
    }
    return parts.join('');
  }
}
