import OpenAI from 'openai';
import type { TranslationProvider, ProviderCapabilities, VendorId, StreamOptions } from '../types';

type OpenAIProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
};

/**
 * OpenAI Chat Completions provider implementing the TranslationProvider
 * interface. Supports streaming and non-streaming text generation.
 */
export default class OpenAIProvider implements TranslationProvider {
  public readonly vendor: VendorId = 'openai';
  public readonly capabilities: ProviderCapabilities = { streaming: true };
  private readonly client: OpenAI;
  private readonly model: string;

  /**
   * Creates a provider bound to a model and API credentials.
   *
   * @param cfg - API key, model id and optional base URL/organization.
   */
  constructor(cfg: OpenAIProviderConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
      organization: cfg.organization,
      dangerouslyAllowBrowser: true,
    });
    this.model = cfg.model;
  }

  /**
   * Streams text deltas for a prompt using Chat Completions when supported.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal.
   * @returns Async iterable of text deltas.
   */
  async *streamText(prompt: string, options?: StreamOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      },
      { signal: options?.abortSignal }
    );

    for await (const chunk of stream) {
      const content = (chunk as any)?.choices?.[0]?.delta?.content || '';
      if (content) {
        yield content as string;
      }
    }
  }

  /**
   * Completes a prompt and returns the final message text.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal.
   * @returns Final message content (or empty string).
   */
  async completeText(prompt: string, options?: StreamOptions): Promise<string> {
    const resp = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      },
      { signal: options?.abortSignal }
    );
    return resp.choices?.[0]?.message?.content ?? '';
  }
}
