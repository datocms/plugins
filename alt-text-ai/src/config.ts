export const PROVIDER_IDS = [
  'alttext-ai',
  'openai',
  'anthropic',
  'gemini',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderOption = {
  value: ProviderId;
  label: string;
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  'alttext-ai': 'AltText.ai',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
};

export const PROVIDER_OPTIONS: ProviderOption[] = PROVIDER_IDS.map(
  (provider) => ({
    value: provider,
    label: PROVIDER_LABELS[provider],
  }),
);

export const DEFAULT_PROVIDER: ProviderId = 'openai';

export const DEFAULT_ALT_TEXT_PROMPT =
  'Write concise, useful alternative text for this image in {locale}. ' +
  'Describe its meaningful visual content and include important visible text. ' +
  'Use the filename "{filename}" only as supporting context, and do not invent details. ' +
  'Do not begin with phrases such as "image of" or "picture of". ' +
  'Return only the alt text, without quotation marks or an explanation.';

export type PluginConfiguration = {
  provider: ProviderId;
  altTextAiApiKey: string;
  openAiApiKey: string;
  openAiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  geminiApiKey: string;
  geminiModel: string;
  prompt: string;
};

export type SerializedPluginConfiguration = PluginConfiguration & {
  /** Kept in sync with altTextAiApiKey so older plugin versions still work. */
  apiKey: string;
};

type ProviderValidator = (config: PluginConfiguration) => string | null;

const PROVIDER_ALIASES: Record<string, ProviderId> = {
  google: 'gemini',
  claude: 'anthropic',
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProvider(
  value: unknown,
  hasAltTextAiConfiguration: boolean,
): ProviderId {
  const candidate = trimmedString(value).toLowerCase();
  const aliasedProvider = PROVIDER_ALIASES[candidate] ?? candidate;

  if (PROVIDER_IDS.includes(aliasedProvider as ProviderId)) {
    return aliasedProvider as ProviderId;
  }

  return hasAltTextAiConfiguration ? 'alttext-ai' : DEFAULT_PROVIDER;
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return DEFAULT_ALT_TEXT_PROMPT;
  }

  return value;
}

function requiredValue(value: string, message: string): string | null {
  return value.trim() ? null : message;
}

const PROVIDER_VALIDATORS: Record<ProviderId, ProviderValidator> = {
  'alttext-ai': (config) =>
    requiredValue(config.altTextAiApiKey, 'AltText.ai API key is required.'),
  openai: (config) =>
    requiredValue(config.openAiApiKey, 'OpenAI API key is required.') ??
    requiredValue(config.openAiModel, 'OpenAI model is required.'),
  anthropic: (config) =>
    requiredValue(config.anthropicApiKey, 'Anthropic API key is required.') ??
    requiredValue(config.anthropicModel, 'Anthropic model is required.'),
  gemini: (config) =>
    requiredValue(config.geminiApiKey, 'Gemini API key is required.') ??
    requiredValue(config.geminiModel, 'Gemini model is required.'),
};

/**
 * Converts empty, partial, malformed, and legacy plugin parameters into the
 * complete shape consumed by the configuration UI and generation services.
 */
export function normalizePluginConfiguration(
  raw: unknown,
): PluginConfiguration {
  const parameters = asRecord(raw);
  const legacyAltTextAiApiKey = trimmedString(parameters.apiKey);
  const altTextAiApiKey =
    trimmedString(parameters.altTextAiApiKey) || legacyAltTextAiApiKey;

  return {
    provider: normalizeProvider(parameters.provider, Boolean(altTextAiApiKey)),
    altTextAiApiKey,
    openAiApiKey: trimmedString(parameters.openAiApiKey),
    openAiModel: trimmedString(parameters.openAiModel),
    anthropicApiKey: trimmedString(parameters.anthropicApiKey),
    anthropicModel: trimmedString(parameters.anthropicModel),
    geminiApiKey: trimmedString(parameters.geminiApiKey),
    geminiModel: trimmedString(parameters.geminiModel),
    prompt: normalizePrompt(parameters.prompt),
  };
}

/**
 * Produces the persisted parameter shape. The legacy apiKey property mirrors
 * the AltText.ai key to make rolling back to an older plugin version safe.
 */
export function serializePluginConfiguration(
  config: PluginConfiguration,
): SerializedPluginConfiguration {
  const normalized = normalizePluginConfiguration(config);

  return {
    ...normalized,
    apiKey: normalized.altTextAiApiKey,
  };
}

/** Returns a user-facing error for the selected provider, or null when valid. */
export function activeProviderValidationError(
  config: PluginConfiguration,
): string | null {
  return (
    PROVIDER_VALIDATORS[config.provider](config) ??
    (config.provider !== 'alttext-ai' && !config.prompt.trim()
      ? 'Prompt is required for direct AI providers.'
      : null)
  );
}
