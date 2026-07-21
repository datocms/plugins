import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import AnthropicProvider from './providers/AnthropicProvider';
import DeepLProvider from './providers/DeepLProvider';
import GeminiProvider from './providers/GeminiProvider';
import OpenAIProvider from './providers/OpenAIProvider';
import YandexProvider from './providers/YandexProvider';
import type { TranslationProvider, VendorId } from './types';
import { ProviderConfigurationError } from './types';

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
  | { vendor: 'deepl'; apiKey: string; baseUrl: string }
  | { vendor: 'yandex'; apiKey: string; folderId?: string };

/**
 * Resolves the DeepL base URL from plugin configuration.
 * Honors explicit endpoint settings; falls back to toggle or key suffix heuristics.
 *
 * @param apiKey - The DeepL API key (used to detect free keys via the :fx suffix).
 * @param deeplUseFree - Whether the "Use Free endpoint" toggle is enabled.
 * @param deeplEndpoint - Explicit endpoint setting ('free', 'pro', or 'auto').
 * @returns The resolved base URL for the DeepL API.
 */
function resolveDeepLBaseUrl(
  apiKey: string,
  deeplUseFree: boolean,
  deeplEndpoint: string,
): string {
  if (deeplEndpoint === 'free') return 'https://api-free.deepl.com';
  if (deeplEndpoint === 'pro') return 'https://api.deepl.com';
  // Auto-detect: trust the toggle first, then fall back to key suffix heuristic
  const isFreeByHeuristic = deeplUseFree || /:fx\b/i.test(apiKey);
  return isFreeByHeuristic
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';
}

/**
 * Extracts credentials for the Google/Gemini vendor.
 *
 * @param pluginParams - Plugin configuration.
 * @returns Credentials or null if incomplete.
 */
function extractGoogleCredentials(
  pluginParams: ctxParamsType,
): VendorCredentials | null {
  const apiKey = pluginParams.googleApiKey ?? '';
  const model = pluginParams.geminiModel ?? '';
  if (apiKey && model) {
    return { vendor: 'google', apiKey, model };
  }
  return null;
}

/**
 * Extracts credentials for the Anthropic vendor.
 *
 * @param pluginParams - Plugin configuration.
 * @returns Credentials or null if incomplete.
 */
function extractAnthropicCredentials(
  pluginParams: ctxParamsType,
): VendorCredentials | null {
  const apiKey = pluginParams.anthropicApiKey ?? '';
  const model = pluginParams.anthropicModel ?? '';
  if (apiKey && model) {
    return { vendor: 'anthropic', apiKey, model };
  }
  return null;
}

/**
 * Extracts credentials for the DeepL vendor.
 *
 * @param pluginParams - Plugin configuration.
 * @returns Credentials or null if incomplete.
 */
function extractDeepLCredentials(
  pluginParams: ctxParamsType,
): VendorCredentials | null {
  const apiKey = pluginParams.deeplApiKey ?? '';
  if (!apiKey) return null;

  const useFreeToggle = pluginParams.deeplUseFree === true;
  const endpointSetting = pluginParams.deeplEndpoint ?? 'auto';
  const baseUrl = resolveDeepLBaseUrl(apiKey, useFreeToggle, endpointSetting);
  return { vendor: 'deepl', apiKey, baseUrl };
}

/**
 * Extracts credentials for Yandex Translate.
 * The Folder ID is optional because service-account API keys can infer their
 * home folder in some Yandex Cloud configurations.
 *
 * @param pluginParams - Plugin configuration.
 * @returns Credentials or null when the API key is missing.
 */
function extractYandexCredentials(
  pluginParams: ctxParamsType,
): VendorCredentials | null {
  const apiKey = pluginParams.yandexApiKey?.trim() ?? '';
  if (!apiKey) return null;

  const folderId = pluginParams.yandexFolderId?.trim() || undefined;
  return { vendor: 'yandex', apiKey, folderId };
}

/**
 * Extracts credentials for the OpenAI vendor.
 *
 * @param pluginParams - Plugin configuration.
 * @returns Credentials or null if incomplete.
 */
function extractOpenAICredentials(
  pluginParams: ctxParamsType,
): VendorCredentials | null {
  const apiKey = pluginParams.apiKey ?? '';
  const model = pluginParams.gptModel ?? '';
  if (apiKey && model && model !== 'None') {
    return { vendor: 'openai', apiKey, model };
  }
  return null;
}

/**
 * Extracts and validates credentials for the selected vendor.
 * DRY: Single source of truth for credential validation logic.
 *
 * @param pluginParams - Configuration captured from the settings screen.
 * @returns Validated credentials or null if incomplete.
 */
function extractVendorCredentials(
  pluginParams: ctxParamsType,
): VendorCredentials | null {
  const vendor = (pluginParams.vendor ?? 'openai') as VendorId;

  switch (vendor) {
    case 'google':
      return extractGoogleCredentials(pluginParams);
    case 'anthropic':
      return extractAnthropicCredentials(pluginParams);
    case 'deepl':
      return extractDeepLCredentials(pluginParams);
    case 'yandex':
      return extractYandexCredentials(pluginParams);
    case 'openai':
      return extractOpenAICredentials(pluginParams);
    default:
      return null;
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
    case 'yandex':
      return 'Yandex Translate API key must be configured in settings.';
    case 'openai':
      return 'OpenAI API key and model must be configured in settings.';
    default:
      return 'A supported translation provider must be selected in settings.';
  }
}

/**
 * Returns a memoized translation provider instance based on the plugin
 * configuration. Supports OpenAI (default), Google/Gemini, Anthropic/Claude
 * DeepL (array translation), and Yandex Translate (native array translation)
 * with provider-specific endpoint and credential handling.
 *
 * @param pluginParams - Configuration captured from the settings screen.
 * @returns A provider implementing the `TranslationProvider` interface.
 * @throws ProviderConfigurationError if the selected vendor is not properly configured.
 */
export function getProvider(pluginParams: ctxParamsType): TranslationProvider {
  const vendor = (pluginParams.vendor ?? 'openai') as VendorId;
  const credentials = extractVendorCredentials(pluginParams);

  if (!credentials) {
    throw new ProviderConfigurationError(
      vendor,
      getMissingCredentialsMessage(vendor),
    );
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
    case 'yandex':
      cacheKey = `yandex:${safeCacheKey(credentials.apiKey)}:${credentials.folderId ?? ''}`;
      break;
    case 'openai':
      cacheKey = `openai:${safeCacheKey(credentials.apiKey)}:${credentials.model}`;
      break;
  }

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Create new provider instance
  let provider: TranslationProvider;
  switch (credentials.vendor) {
    case 'google':
      provider = new GeminiProvider({
        apiKey: credentials.apiKey,
        model: credentials.model,
      });
      break;
    case 'anthropic':
      provider = new AnthropicProvider({
        apiKey: credentials.apiKey,
        model: credentials.model,
      });
      break;
    case 'deepl':
      provider = new DeepLProvider({
        apiKey: credentials.apiKey,
        baseUrl: credentials.baseUrl,
      });
      break;
    case 'yandex':
      provider = new YandexProvider({
        apiKey: credentials.apiKey,
        folderId: credentials.folderId,
      });
      break;
    case 'openai':
      provider = new OpenAIProvider({
        apiKey: credentials.apiKey,
        model: credentials.model,
      });
      break;
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
