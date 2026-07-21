import AltTextAiProvider from './AltTextAiProvider';
import AnthropicProvider from './AnthropicProvider';
import { AltTextProviderError } from './errors';
import GeminiProvider from './GeminiProvider';
import OpenAIProvider from './OpenAIProvider';
import type {
  AltTextProvider,
  AltTextProviderConfig,
  AltTextProviderId,
} from './types';

function requireValue(
  provider: AltTextProviderId,
  value: string,
  name: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AltTextProviderError(
      provider,
      'configuration',
      `${name} is required.`,
    );
  }
  return normalized;
}

export function createAltTextProvider(
  config: AltTextProviderConfig,
): AltTextProvider {
  const apiKey = requireValue(config.provider, config.apiKey, 'API key');

  switch (config.provider) {
    case 'alttext-ai':
      return new AltTextAiProvider({ ...config, apiKey });
    case 'openai':
      return new OpenAIProvider({
        ...config,
        apiKey,
        model: requireValue(config.provider, config.model, 'Model'),
      });
    case 'anthropic':
      return new AnthropicProvider({
        ...config,
        apiKey,
        model: requireValue(config.provider, config.model, 'Model'),
      });
    case 'gemini':
      return new GeminiProvider({
        ...config,
        apiKey,
        model: requireValue(config.provider, config.model, 'Model'),
      });
  }
}
