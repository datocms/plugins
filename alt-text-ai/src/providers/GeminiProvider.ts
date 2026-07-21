import { AltTextProviderError } from './errors';
import {
  asRecord,
  fetchImageAsBase64,
  fetchProviderJson,
  finalizeAltText,
  joinApiUrl,
  prepareGenerationInput,
} from './shared';
import type {
  AltTextProvider,
  GeminiProviderConfig,
  GenerateAltTextInput,
} from './types';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function stripModelsPrefix(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

function readableFinishReason(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

function thinkingConfigForModel(
  model: string,
): Record<string, string | number> | undefined {
  if (/^gemini-(?:3(?:\.\d+)?-)?flash(?:-lite)?(?:-|$)/.test(model)) {
    return { thinkingLevel: 'minimal' };
  }

  if (model === 'gemini-pro-latest' || /^gemini-3(?:[.-]|$)/.test(model)) {
    return { thinkingLevel: 'low' };
  }

  if (/^gemini-2\.5-pro(?:-|$)/.test(model)) {
    return { thinkingBudget: 128 };
  }

  if (/^gemini-2\.5-flash(?:-|$)/.test(model)) {
    return { thinkingBudget: 0 };
  }

  return undefined;
}

function validatePromptFeedback(
  promptFeedbackValue: unknown,
  payload: unknown,
): void {
  const promptFeedback = asRecord(promptFeedbackValue);
  const blockReason = promptFeedback?.blockReason;
  if (
    typeof blockReason !== 'string' ||
    blockReason === 'BLOCK_REASON_UNSPECIFIED'
  ) {
    return;
  }

  const message =
    typeof promptFeedback?.blockReasonMessage === 'string' &&
    promptFeedback.blockReasonMessage.trim()
      ? promptFeedback.blockReasonMessage.trim()
      : `The request was blocked: ${readableFinishReason(blockReason)}.`;

  throw new AltTextProviderError('gemini', 'provider', message, {
    details: payload,
  });
}

function validateCandidate(
  candidate: Record<string, unknown>,
  payload: unknown,
): void {
  const finishReason = candidate.finishReason;
  if (typeof finishReason !== 'string' || finishReason === 'STOP') {
    return;
  }

  const finishMessage = candidate.finishMessage;
  const message =
    typeof finishMessage === 'string' && finishMessage.trim()
      ? finishMessage.trim()
      : `The response did not complete normally: ${readableFinishReason(finishReason)}.`;

  throw new AltTextProviderError(
    'gemini',
    finishReason === 'MAX_TOKENS' ? 'invalid_response' : 'provider',
    message,
    { details: payload },
  );
}

function validateCandidates(candidates: unknown, payload: unknown): void {
  if (!Array.isArray(candidates)) {
    return;
  }

  for (const entry of candidates) {
    const candidate = asRecord(entry);
    if (candidate) {
      validateCandidate(candidate, payload);
    }
  }
}

function validateGeminiResponse(payload: unknown): void {
  const response = asRecord(payload);
  if (!response) {
    return;
  }

  validatePromptFeedback(response.promptFeedback, payload);
  validateCandidates(response.candidates, payload);
}

export function extractGeminiAltText(payload: unknown): string {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.candidates)) {
    return '';
  }

  const parts: string[] = [];
  for (const entry of response.candidates) {
    const candidate = asRecord(entry);
    const content = asRecord(candidate?.content);
    if (!Array.isArray(content?.parts)) {
      continue;
    }

    for (const partEntry of content.parts) {
      const part = asRecord(partEntry);
      if (part?.thought !== true && typeof part?.text === 'string') {
        parts.push(part.text);
      }
    }
  }

  return parts.join('\n');
}

export default class GeminiProvider implements AltTextProvider {
  public readonly id = 'gemini' as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxOutputTokens?: number;
  private readonly temperature?: number;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = stripModelsPrefix(config.model);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxOutputTokens = config.maxOutputTokens;
    this.temperature = config.temperature;
  }

  async generate(input: GenerateAltTextInput): Promise<string> {
    const prepared = prepareGenerationInput(this.id, input);
    const image = await fetchImageAsBase64(
      this.id,
      prepared.imageUrl,
      prepared.signal,
    );
    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: image.mimeType,
                data: image.data,
              },
            },
            { text: prepared.prompt },
          ],
        },
      ],
    };
    const generationConfig: Record<string, unknown> = {};

    if (this.maxOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = this.maxOutputTokens;
    }
    if (this.temperature !== undefined) {
      generationConfig.temperature = this.temperature;
    }
    const thinkingConfig = thinkingConfigForModel(this.model);
    if (thinkingConfig) {
      generationConfig.thinkingConfig = thinkingConfig;
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    const modelPath = `models/${encodeURIComponent(this.model)}:generateContent`;
    const payload = await fetchProviderJson(
      this.id,
      joinApiUrl(this.baseUrl, modelPath),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: prepared.signal,
      },
    );

    validateGeminiResponse(payload);
    return finalizeAltText(this.id, extractGeminiAltText(payload));
  }
}
