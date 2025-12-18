import type { TranslationProvider } from './types';
import OpenAIProvider from './providers/OpenAIProvider';
import GeminiProvider from './providers/GeminiProvider';
import AnthropicProvider from './providers/AnthropicProvider';
import DeepLProvider from './providers/DeepLProvider';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';

// Simple memoization by key to avoid recreating clients excessively
const cache = new Map<string, TranslationProvider>();

/**
 * Returns a memoized translation provider instance based on the plugin
 * configuration. Supports OpenAI (default), Google/Gemini, Anthropic/Claude
 * and DeepL (array translation) with light endpoint heuristics.
 *
 * @param pluginParams - Configuration captured from the settings screen.
 * @returns A provider implementing the `TranslationProvider` interface.
 */
export function getProvider(pluginParams: ctxParamsType): TranslationProvider {
  const vendor = pluginParams.vendor ?? 'openai';

  if (vendor === 'google') {
    const apiKey = pluginParams.googleApiKey ?? '';
    const model = pluginParams.geminiModel ?? '';
    if (apiKey && model) {
      const key = `google:${apiKey}:${model}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const provider = new GeminiProvider({ apiKey, model });
      cache.set(key, provider);
      return provider;
    }
    // Fallback to OpenAI if Google is selected but incomplete
  }

  if (vendor === 'anthropic') {
    const apiKey = pluginParams.anthropicApiKey ?? '';
    const model = pluginParams.anthropicModel ?? '';
    if (apiKey && model) {
      const key = `anthropic:${apiKey}:${model}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const provider = new AnthropicProvider({ apiKey, model });
      cache.set(key, provider);
      return provider;
    }
  }

  if (vendor === 'deepl') {
    const apiKey = pluginParams.deeplApiKey ?? '';
    const useFreeToggle = pluginParams.deeplUseFree === true;
    const endpointSetting = pluginParams.deeplEndpoint ?? 'auto';
    // Resolve endpoint: honor explicit setting; otherwise decide based on toggle or key suffix (:fx = Free)
    const shouldUseFree = endpointSetting === 'free'
      ? true
      : endpointSetting === 'pro'
      ? false
      : (useFreeToggle || /:fx\b/i.test(apiKey));
    const baseUrl = shouldUseFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    if (apiKey) {
      const key = `deepl:${apiKey}:${baseUrl}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const provider = new DeepLProvider({ apiKey, baseUrl });
      cache.set(key, provider);
      return provider;
    }
  }

  // Default / OpenAI path
  const apiKey = pluginParams.apiKey;
  const model = pluginParams.gptModel;
  const key = `openai:${apiKey}:${model}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const provider = new OpenAIProvider({ apiKey, model });
  cache.set(key, provider);
  return provider;
}

/**
 * Checks if credentials are properly configured for the selected vendor.
 * Used to determine if the plugin is ready to perform translations.
 *
 * @param pluginParams - Configuration captured from the settings screen.
 * @returns True if the selected vendor has valid credentials configured.
 */
export function isProviderConfigured(pluginParams: ctxParamsType): boolean {
  const vendor = pluginParams.vendor ?? 'openai';
  switch (vendor) {
    case 'google':
      return !!pluginParams.googleApiKey && !!pluginParams.geminiModel;
    case 'anthropic':
      return !!pluginParams.anthropicApiKey && !!pluginParams.anthropicModel;
    case 'deepl':
      return !!pluginParams.deeplApiKey;
    case 'openai':
    default:
      return !!pluginParams.apiKey && !!pluginParams.gptModel && pluginParams.gptModel !== 'None';
  }
}
