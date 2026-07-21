export type AltTextProviderId =
  | 'alttext-ai'
  | 'openai'
  | 'anthropic'
  | 'gemini';

export type DirectAltTextProviderId = Exclude<AltTextProviderId, 'alttext-ai'>;

export type GenerateAltTextInput = {
  /** Public, transformed image URL that the provider can fetch. */
  imageUrl: string;
  /** Stable DatoCMS upload identifier. */
  assetId: string;
  locale: string;
  filename: string;
  /** Supports the `{locale}` and `{filename}` placeholders. */
  promptTemplate: string;
  signal?: AbortSignal;
};

export interface AltTextProvider {
  readonly id: AltTextProviderId;
  generate(input: GenerateAltTextInput): Promise<string>;
}

export type AltTextAiProviderConfig = {
  provider: 'alttext-ai';
  apiKey: string;
  endpoint?: string;
};

export type OpenAIProviderConfig = {
  provider: 'openai';
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxOutputTokens?: number;
};

export type AnthropicProviderConfig = {
  provider: 'anthropic';
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export type GeminiProviderConfig = {
  provider: 'gemini';
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  temperature?: number;
};

export type AltTextProviderConfig =
  | AltTextAiProviderConfig
  | OpenAIProviderConfig
  | AnthropicProviderConfig
  | GeminiProviderConfig;
