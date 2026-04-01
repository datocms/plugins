import OpenAI from 'openai';
import {
  isEmptyPrompt,
  withTimeout,
  withTimeoutGenerator,
} from '../providerUtils';
import type { StreamOptions, TranslationProvider, VendorId } from '../types';

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
  async *streamText(
    prompt: string,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    if (isEmptyPrompt(prompt)) {
      return;
    }

    const client = this.client;
    const model = this.model;

    yield* withTimeoutGenerator(options, async function* (signal: AbortSignal) {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        },
        { signal },
      );

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        const content = delta && 'content' in delta ? delta.content : null;
        if (content) {
          yield content;
        }
      }
    });
  }

  /**
   * Completes a prompt and returns the final message text.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal.
   * @returns Final message content (or empty string).
   */
  async completeText(prompt: string, options?: StreamOptions): Promise<string> {
    if (isEmptyPrompt(prompt)) {
      return '';
    }

    return withTimeout(options, async (signal) => {
      const resp = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        },
        { signal },
      );
      return resp.choices?.[0]?.message?.content ?? '';
    });
  }
}
