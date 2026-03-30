import type { TranslationProvider, VendorId, StreamOptions } from '../types';
import { GoogleGenerativeAI, type GenerativeModel, type GenerateContentRequest } from '@google/generative-ai';
import { isEmptyPrompt, withTimeout, withTimeoutGenerator } from '../providerUtils';

type GeminiProviderConfig = {
  apiKey: string;
  model: string;
  // Optional knobs for future parity; unused for now
  temperature?: number;
  maxOutputTokens?: number;
};

/**
 * Builds a GenerateContentRequest for the Gemini API.
 * The SDK's types don't always include generationConfig in all overloads,
 * so we construct the request object explicitly.
 *
 * @param prompt - The text prompt to send to the model.
 * @param temperature - Optional temperature for response randomness.
 * @param maxOutputTokens - Optional maximum tokens in the response.
 * @returns A properly typed GenerateContentRequest object.
 */
function buildGeminiRequest(
  prompt: string,
  temperature?: number,
  maxOutputTokens?: number
): GenerateContentRequest {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };
}

/**
 * Google Gemini provider backed by the Generative Language API. Implements
 * streaming and non-streaming calls using the `@google/generative-ai` SDK.
 */
export default class GeminiProvider implements TranslationProvider {
  public readonly vendor: VendorId = 'google';
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly temperature?: number;
  private readonly maxOutputTokens?: number;

  /**
   * Creates a Gemini provider instance bound to a model id.
   * The model instance is cached for reuse across translation calls.
   *
   * @param cfg - API key, model id and optional generation knobs.
   */
  constructor(cfg: GeminiProviderConfig) {
    this.genAI = new GoogleGenerativeAI(cfg.apiKey);
    // PERF-002: Cache model instance to avoid recreating on each call
    this.model = this.genAI.getGenerativeModel({ model: cfg.model });
    this.temperature = cfg.temperature;
    this.maxOutputTokens = cfg.maxOutputTokens;
  }

  /**
   * Streams text chunks for a prompt using `generateContentStream`.
   * Note: The Google SDK doesn't support request cancellation natively,
   * so we check the abort signal before starting and between chunks.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal for early termination.
   * @returns Async iterable of text deltas.
   */
  async *streamText(prompt: string, options?: StreamOptions): AsyncIterable<string> {
    if (isEmptyPrompt(prompt)) {
      return;
    }

    const model = this.model;
    const temperature = this.temperature;
    const maxOutputTokens = this.maxOutputTokens;

    yield* withTimeoutGenerator(options, async function* (signal) {
      // Check if already aborted before starting
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const request = buildGeminiRequest(prompt, temperature, maxOutputTokens);
      const result = await model.generateContentStream(request);

      for await (const item of result.stream) {
        // Check abort/timeout signal between chunks to allow early termination
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const text = item.text?.();
        if (text) {
          yield text;
        }
      }
    });
  }

  /**
   * Completes a prompt and returns the concatenated text.
   * Note: The Google SDK doesn't support request cancellation natively,
   * so we check the abort signal before starting.
   *
   * @param prompt - Prompt text to send to the model.
   * @param options - Optional abort signal for early termination.
   * @returns Final text response.
   */
  async completeText(prompt: string, options?: StreamOptions): Promise<string> {
    if (isEmptyPrompt(prompt)) {
      return '';
    }

    const model = this.model;
    const temperature = this.temperature;
    const maxOutputTokens = this.maxOutputTokens;

    return withTimeout(options, async (signal) => {
      // Check if already aborted before starting
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const request = buildGeminiRequest(prompt, temperature, maxOutputTokens);
      const result = await model.generateContent(request);
      return result.response?.text?.() ?? '';
    });
  }
}
