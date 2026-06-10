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
  private readonly baseUrl: string;

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
    this.baseUrl = cfg.baseUrl ?? 'https://api.openai.com/v1';
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
    const baseUrl = this.baseUrl;

    yield* withTimeoutGenerator(options, async function* (signal: AbortSignal) {
      const requestBody = {
        model,
        messages: [{ role: 'user' as const, content: prompt }],
        stream: true as const,
      };
      options?.debug?.request?.('Provider request', {
        provider: 'openai',
        operation: 'streamText',
        url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        body: requestBody,
      });
      const stream = await client.chat.completions.create(requestBody, {
        signal,
      });

      for await (const chunk of stream) {
        options?.debug?.response?.('Provider stream response chunk', {
          provider: 'openai',
          operation: 'streamText',
          chunk,
        });
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
      const requestBody = {
        model: this.model,
        messages: [{ role: 'user' as const, content: prompt }],
        stream: false as const,
      };
      options?.debug?.request?.('Provider request', {
        provider: this.vendor,
        operation: 'completeText',
        url: `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
        body: requestBody,
        options: {
          timeoutMs: options?.timeoutMs,
          hasAbortSignal: options?.abortSignal !== undefined,
        },
      });
      const resp = await this.client.chat.completions.create(requestBody, {
        signal,
      });
      const text = resp.choices?.[0]?.message?.content ?? '';
      options?.debug?.response?.('Provider response', {
        provider: this.vendor,
        operation: 'completeText',
        response: resp,
        text,
      });
      return text;
    });
  }
}
