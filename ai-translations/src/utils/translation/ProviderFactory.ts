import type { TranslationProvider, VendorId } from './types';
import { ProviderConfigurationError } from './types';
import OpenAIProvider from './providers/OpenAIProvider';
import GeminiProvider from './providers/GeminiProvider';
import AnthropicProvider from './providers/AnthropicProvider';
import DeepLProvider from './providers/DeepLProvider';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';

/**
 * Creates a safe cache key from an API key.
 * Uses first 8 chars + length + last 4 chars to identify uniquely without storing full key.
 * PERF-001: Avoids storing full API key in memory as cache key.
 *
 * @param apiKey - The full API key to create a safe cache key from.
 * @returns A shortened key suitable for cache lookups.
 */
function safeCacheKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 16) return apiKey;
  return `${apiKey.slice(0, 8)}...${apiKey.length}...${apiKey.slice(-4)}`;
}

// Simple memoization by key to avoid recreating clients excessively
const cache = new Map<string, TranslationProvider>();

/**
 * Credential extraction result for each vendor type.
 */
type VendorCredentials =
  | { vendor: 'openai'; apiKey: string; model: string }
  | { vendor: 'google'; apiKey: string; model: string }
  | { vendor: 'anthropic'; apiKey: string; model: string }
  | { vendor: 'deepl'; apiKey: string; baseUrl: string };

/**
 * Extracts and validates credentials for the selected vendor.
 * DRY: Single source of truth for credential validation logic.
 *
 * @param pluginParams - Configuration captured from the settings screen.
 * @returns Validated credentials or null if incomplete.
 */
function extractVendorCredentials(pluginParams: ctxParamsType): VendorCredentials | null {
  const vendor = (pluginParams.vendor ?? 'openai') as VendorId;

  switch (vendor) {
    case 'google': {
      const apiKey = pluginParams.googleApiKey ?? '';
      const model = pluginParams.geminiModel ?? '';
      if (apiKey && model) {
        return { vendor, apiKey, model };
      }
      return null;
    }

    case 'anthropic': {
      const apiKey = pluginParams.anthropicApiKey ?? '';
      const model = pluginParams.anthropicModel ?? '';
      if (apiKey && model) {
        return { vendor, apiKey, model };
      }
      return null;
    }

    case 'deepl': {
      const apiKey = pluginParams.deeplApiKey ?? '';
      if (!apiKey) return null;

      const useFreeToggle = pluginParams.deeplUseFree === true;
      const endpointSetting = pluginParams.deeplEndpoint ?? 'auto';
      // Resolve endpoint: honor explicit setting; otherwise decide based on toggle or key suffix (:fx = Free)
      const shouldUseFree = endpointSetting === 'free'
        ? true
        : endpointSetting === 'pro'
        ? false
        : (useFreeToggle || /:fx\b/i.test(apiKey));
      const baseUrl = shouldUseFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      return { vendor, apiKey, baseUrl };
    }
    default: {
      const apiKey = pluginParams.apiKey ?? '';
      const model = pluginParams.gptModel ?? '';
      if (apiKey && model && model !== 'None') {
        return { vendor: 'openai', apiKey, model };
      }
      return null;
    }
  }
}

/**
 * Gets a human-readable description of what's missing for a vendor.
 *
 * @param vendor - The vendor to describe.
 * @returns Description of required credentials.
 */
function getMissingCredentialsMessage(vendor: VendorId): string {
  switch (vendor) {
    case 'google':
      return 'Google API key and Gemini model must be configured in settings.';
    case 'anthropic':
      return 'Anthropic API key and Claude model must be configured in settings.';
    case 'deepl':
      return 'DeepL API key must be configured in settings.';
    default:
      return 'OpenAI API key and model must be configured in settings.';
  }
}

/**
 * Returns a memoized translation provider instance based on the plugin
 * configuration. Supports OpenAI (default), Google/Gemini, Anthropic/Claude
 * and DeepL (array translation) with light endpoint heuristics.
 *
 * @param pluginParams - Configuration captured from the settings screen.
 * @returns A provider implementing the `TranslationProvider` interface.
 * @throws ProviderConfigurationError if the selected vendor is not properly configured.
 */
export function getProvider(pluginParams: ctxParamsType): TranslationProvider {
  const vendor = (pluginParams.vendor ?? 'openai') as VendorId;
  const credentials = extractVendorCredentials(pluginParams);

  if (!credentials) {
    throw new ProviderConfigurationError(vendor, getMissingCredentialsMessage(vendor));
  }

  // Build cache key and check for existing provider
  let cacheKey: string;
  switch (credentials.vendor) {
    case 'google':
      cacheKey = `google:${safeCacheKey(credentials.apiKey)}:${credentials.model}`;
      break;
    case 'anthropic':
      cacheKey = `anthropic:${safeCacheKey(credentials.apiKey)}:${credentials.model}`;
      break;
    case 'deepl':
      cacheKey = `deepl:${safeCacheKey(credentials.apiKey)}:${credentials.baseUrl}`;
      break;
    default:
      cacheKey = `openai:${safeCacheKey(credentials.apiKey)}:${credentials.model}`;
  }

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Create new provider instance
  let provider: TranslationProvider;
  switch (credentials.vendor) {
    case 'google':
      provider = new GeminiProvider({ apiKey: credentials.apiKey, model: credentials.model });
      break;
    case 'anthropic':
      provider = new AnthropicProvider({ apiKey: credentials.apiKey, model: credentials.model });
      break;
    case 'deepl':
      provider = new DeepLProvider({ apiKey: credentials.apiKey, baseUrl: credentials.baseUrl });
      break;
    default:
      provider = new OpenAIProvider({ apiKey: credentials.apiKey, model: credentials.model });
  }

  cache.set(cacheKey, provider);
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
  return extractVendorCredentials(pluginParams) !== null;
}
