import { AltTextProviderError } from './errors';
import {
  asRecord,
  fetchProviderJson,
  finalizeAltText,
  joinApiUrl,
  prepareGenerationInput,
} from './shared';
import type {
  AltTextProvider,
  AnthropicProviderConfig,
  GenerateAltTextInput,
} from './types';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_MAX_OUTPUT_TOKENS = 300;

function readableStopReason(value: string): string {
  return value.replace(/_/g, ' ');
}

function validateAnthropicResponse(payload: unknown): void {
  const response = asRecord(payload);
  const stopReason = response?.stop_reason;

  if (
    stopReason === undefined ||
    stopReason === null ||
    stopReason === 'end_turn' ||
    stopReason === 'stop_sequence'
  ) {
    return;
  }

  if (typeof stopReason !== 'string') {
    throw new AltTextProviderError(
      'anthropic',
      'invalid_response',
      'The response contained an invalid completion state.',
      { details: payload },
    );
  }

  throw new AltTextProviderError(
    'anthropic',
    stopReason === 'refusal' ? 'provider' : 'invalid_response',
    stopReason === 'refusal'
      ? 'The model refused to generate alt text for this image.'
      : `The response did not complete normally: ${readableStopReason(stopReason)}.`,
    { details: payload },
  );
}

export function extractAnthropicAltText(payload: unknown): string {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.content)) {
    return '';
  }

  const parts: string[] = [];
  for (const entry of response.content) {
    const content = asRecord(entry);
    if (content?.type === 'text' && typeof content.text === 'string') {
      parts.push(content.text);
    }
  }

  return parts.join('\n');
}

export default class AnthropicProvider implements AltTextProvider {
  public readonly id = 'anthropic' as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxOutputTokens: number;
  private readonly temperature?: number;

  constructor(config: AnthropicProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.temperature = config.temperature;
  }

  async generate(input: GenerateAltTextInput): Promise<string> {
    const prepared = prepareGenerationInput(this.id, input);
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: prepared.imageUrl },
            },
            { type: 'text', text: prepared.prompt },
          ],
        },
      ],
    };

    if (this.temperature !== undefined) {
      body.temperature = this.temperature;
    }

    const payload = await fetchProviderJson(
      this.id,
      joinApiUrl(this.baseUrl, 'messages'),
      {
        method: 'POST',
        headers: {
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: prepared.signal,
      },
    );

    validateAnthropicResponse(payload);
    return finalizeAltText(this.id, extractAnthropicAltText(payload));
  }
}
