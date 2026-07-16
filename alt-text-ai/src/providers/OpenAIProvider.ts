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
  GenerateAltTextInput,
  OpenAIProviderConfig,
} from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function baseModelId(model: string): string {
  const normalized = model.toLowerCase();
  return normalized.startsWith('ft:')
    ? (normalized.split(':')[1] ?? '')
    : normalized;
}

function reasoningEffortForModel(
  model: string,
): 'low' | 'minimal' | 'none' | undefined {
  const id = baseModelId(model);
  if (/-pro(?:[.-]|$)/.test(id)) {
    return undefined;
  }

  if (/^o[1-9](?:[.-]|$)/.test(id)) {
    return 'low';
  }

  const version = id.match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (!version || Number(version[1]) < 5) {
    return undefined;
  }

  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  return major > 5 || minor >= 1 ? 'none' : 'minimal';
}

function readableState(value: string): string {
  return value.replace(/_/g, ' ');
}

function extractRefusal(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  for (const entry of content) {
    const part = asRecord(entry);
    if (part?.type !== 'refusal') {
      continue;
    }

    if (typeof part.refusal === 'string' && part.refusal.trim()) {
      return part.refusal.trim();
    }

    return 'The model refused to generate alt text for this image.';
  }

  return null;
}

function validateResponseStatus(
  response: Record<string, unknown>,
  payload: unknown,
): void {
  if (typeof response.status !== 'string' || response.status === 'completed') {
    return;
  }

  const incompleteDetails = asRecord(response.incomplete_details);
  const reason =
    typeof incompleteDetails?.reason === 'string'
      ? ` (${readableState(incompleteDetails.reason)})`
      : '';
  const code = response.status === 'failed' ? 'provider' : 'invalid_response';

  throw new AltTextProviderError(
    'openai',
    code,
    `The response did not complete: ${readableState(response.status)}${reason}.`,
    { details: payload },
  );
}

function directRefusalFromItem(item: Record<string, unknown>): string | null {
  if (item.type !== 'refusal') {
    return null;
  }

  if (typeof item.refusal === 'string' && item.refusal.trim()) {
    return item.refusal.trim();
  }

  return 'The model refused to generate alt text for this image.';
}

function validateOutputItem(
  item: Record<string, unknown>,
  payload: unknown,
): void {
  if (typeof item.status === 'string' && item.status !== 'completed') {
    throw new AltTextProviderError(
      'openai',
      'invalid_response',
      `The generated message did not complete: ${readableState(item.status)}.`,
      { details: payload },
    );
  }

  const refusal = directRefusalFromItem(item) ?? extractRefusal(item.content);
  if (refusal) {
    throw new AltTextProviderError('openai', 'provider', refusal, {
      details: payload,
    });
  }
}

function validateOutputItems(output: unknown, payload: unknown): void {
  if (!Array.isArray(output)) {
    return;
  }

  for (const entry of output) {
    const item = asRecord(entry);
    if (item) {
      validateOutputItem(item, payload);
    }
  }
}

function validateLegacyChoice(
  choice: Record<string, unknown>,
  payload: unknown,
): void {
  const finishReason = choice.finish_reason;
  if (typeof finishReason === 'string' && finishReason !== 'stop') {
    throw new AltTextProviderError(
      'openai',
      finishReason === 'content_filter' ? 'provider' : 'invalid_response',
      `The response did not complete normally: ${readableState(finishReason)}.`,
      { details: payload },
    );
  }

  const message = asRecord(choice.message);
  if (typeof message?.refusal === 'string' && message.refusal.trim()) {
    throw new AltTextProviderError(
      'openai',
      'provider',
      message.refusal.trim(),
      { details: payload },
    );
  }
}

function validateLegacyChoices(choices: unknown, payload: unknown): void {
  if (!Array.isArray(choices)) {
    return;
  }

  for (const entry of choices) {
    const choice = asRecord(entry);
    if (choice) {
      validateLegacyChoice(choice, payload);
    }
  }
}

function validateOpenAIResponse(payload: unknown): void {
  const response = asRecord(payload);
  if (!response) {
    return;
  }

  validateResponseStatus(response, payload);
  validateOutputItems(response.output, payload);
  validateLegacyChoices(response.choices, payload);
}

function extractTextParts(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const entry of content) {
    const part = asRecord(entry);
    if (
      (part?.type === 'output_text' || part?.type === 'text') &&
      typeof part.text === 'string'
    ) {
      parts.push(part.text);
    }
  }

  return parts;
}

function extractOutputItems(output: unknown): string[] {
  if (!Array.isArray(output)) {
    return [];
  }

  const parts: string[] = [];
  for (const entry of output) {
    const item = asRecord(entry);
    if (!item) {
      continue;
    }

    if (
      (item.type === 'output_text' || item.type === 'text') &&
      typeof item.text === 'string'
    ) {
      parts.push(item.text);
    }

    parts.push(...extractTextParts(item.content));
  }

  return parts;
}

function extractLegacyChoice(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.choices)) {
    return '';
  }

  const firstChoice = asRecord(payload.choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message?.content;

  if (typeof content === 'string') {
    return content;
  }

  return extractTextParts(content).join('\n');
}

export function extractOpenAIAltText(payload: unknown): string {
  const response = asRecord(payload);
  if (!response) {
    return '';
  }

  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  const outputText = extractOutputItems(response.output).join('\n');
  return outputText || extractLegacyChoice(response);
}

export default class OpenAIProvider implements AltTextProvider {
  public readonly id = 'openai' as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxOutputTokens?: number;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxOutputTokens = config.maxOutputTokens;
  }

  async generate(input: GenerateAltTextInput): Promise<string> {
    const prepared = prepareGenerationInput(this.id, input);
    const body: Record<string, unknown> = {
      model: this.model,
      store: false,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prepared.prompt },
            {
              type: 'input_image',
              image_url: prepared.imageUrl,
              detail: 'auto',
            },
          ],
        },
      ],
    };

    if (this.maxOutputTokens !== undefined) {
      body.max_output_tokens = this.maxOutputTokens;
    }
    const reasoningEffort = reasoningEffortForModel(this.model);
    if (reasoningEffort) {
      body.reasoning = { effort: reasoningEffort };
    }

    const payload = await fetchProviderJson(
      this.id,
      joinApiUrl(this.baseUrl, 'responses'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: prepared.signal,
      },
    );

    validateOpenAIResponse(payload);
    return finalizeAltText(this.id, extractOpenAIAltText(payload));
  }
}
