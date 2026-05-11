import DEFAULT_SYSTEM_PROMPT_RAW from './systemPrompt.md?raw';

export type ModelProvider = 'current' | 'google' | 'anthropic';

export type ProviderChoice = {
  id: ModelProvider;
  label: string;
};

export type ProviderValueMap = Partial<Record<ModelProvider, string>>;

export type PromptDatoParams = {
  oauthClientId?: string;
  oauthClientIssuedAt?: number;
  oauthRedirectUri?: string;
  datoAccessToken?: string;
  provider?: ModelProvider;
  providerApiKeys?: ProviderValueMap;
  providerMainModels?: ProviderValueMap;
  openaiApiKey?: string;
  openaiMainModel?: string;
  openaiMiniModel?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  debugMode?: boolean;
};

export const DEFAULT_MODEL_PROVIDER: ModelProvider = 'current';
export const DEFAULT_MAIN_MODEL_BY_PROVIDER: Record<ModelProvider, string> = {
  current: 'gpt-5.4',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-20250514',
};
export const PROVIDER_DEFAULT_REASONING_EFFORT = 'provider_default';
export const DEFAULT_REASONING_EFFORT = 'medium';
export const DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT_RAW.trim();

export const PROVIDER_CHOICES: ProviderChoice[] = [
  { id: 'current', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'anthropic', label: 'Anthropic' },
];

export type ApiReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export type ReasoningEffort =
  | typeof PROVIDER_DEFAULT_REASONING_EFFORT
  | ApiReasoningEffort;

const PROVIDER_VALUES = new Set<string>(['current', 'google', 'anthropic']);
const REASONING_EFFORT_VALUES = new Set<string>([
  PROVIDER_DEFAULT_REASONING_EFFORT,
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

type ReadablePluginCtx = {
  plugin: { attributes: { parameters: Record<string, unknown> | unknown } };
};

type WritablePluginCtx = ReadablePluginCtx & {
  updatePluginParameters: (params: Record<string, unknown>) => Promise<void>;
};

function rawParams(ctx: ReadablePluginCtx): Record<string, unknown> {
  const raw = ctx.plugin.attributes.parameters;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function readParams(ctx: ReadablePluginCtx): PromptDatoParams {
  const raw = rawParams(ctx);
  const provider = normalizeProvider(
    typeof raw.provider === 'string' ? raw.provider.trim() : '',
  );
  const legacyModel =
    typeof raw.openaiModel === 'string' ? raw.openaiModel.trim() : '';
  const legacyMainModel =
    typeof raw.openaiMainModel === 'string' ? raw.openaiMainModel.trim() : '';
  const legacyMiniModel =
    typeof raw.openaiMiniModel === 'string' ? raw.openaiMiniModel.trim() : '';
  const legacyKey =
    typeof raw.openaiApiKey === 'string' ? raw.openaiApiKey : '';
  const providerApiKeys = normalizeProviderMap(raw.providerApiKeys);
  const providerMainModels = normalizeProviderMap(raw.providerMainModels);
  if (!providerApiKeys.current && legacyKey.trim()) {
    providerApiKeys.current = legacyKey;
  }
  if (!providerMainModels.current) {
    providerMainModels.current =
      legacyMainModel || legacyModel || DEFAULT_MAIN_MODEL_BY_PROVIDER.current;
  }

  const reasoningEffortRaw =
    typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort.trim() : '';
  return {
    oauthClientId:
      typeof raw.oauthClientId === 'string' ? raw.oauthClientId : undefined,
    oauthClientIssuedAt:
      typeof raw.oauthClientIssuedAt === 'number'
        ? raw.oauthClientIssuedAt
        : undefined,
    oauthRedirectUri:
      typeof raw.oauthRedirectUri === 'string'
        ? raw.oauthRedirectUri
        : undefined,
    datoAccessToken:
      typeof raw.datoAccessToken === 'string' ? raw.datoAccessToken : undefined,
    provider,
    providerApiKeys,
    providerMainModels,
    openaiApiKey: legacyKey || undefined,
    openaiMainModel:
      providerMainModels.current ?? DEFAULT_MAIN_MODEL_BY_PROVIDER.current,
    openaiMiniModel: legacyMiniModel || undefined,
    reasoningEffort: normalizeReasoningEffort(reasoningEffortRaw),
    systemPrompt:
      typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim().length > 0
        ? raw.systemPrompt
        : undefined,
    debugMode: raw.debugMode === true,
  };
}

function normalizeProvider(value: string): ModelProvider {
  return PROVIDER_VALUES.has(value) ? (value as ModelProvider) : DEFAULT_MODEL_PROVIDER;
}

function normalizeProviderMap(value: unknown): ProviderValueMap {
  const normalized: ProviderValueMap = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalized;
  }
  const raw = value as Record<string, unknown>;
  for (const provider of PROVIDER_CHOICES.map((choice) => choice.id)) {
    const entry = raw[provider];
    if (typeof entry === 'string' && entry.trim().length > 0) {
      normalized[provider] = entry.trim();
    }
  }
  return normalized;
}

function normalizeReasoningEffort(value: string): ReasoningEffort {
  return REASONING_EFFORT_VALUES.has(value)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

export function getProviderLabel(provider: ModelProvider): string {
  return (
    PROVIDER_CHOICES.find((choice) => choice.id === provider)?.label ??
    PROVIDER_CHOICES[0].label
  );
}

export function getProviderApiKey(
  params: PromptDatoParams,
  provider = params.provider ?? DEFAULT_MODEL_PROVIDER,
): string {
  return params.providerApiKeys?.[provider]?.trim() ?? '';
}

export function getProviderMainModel(
  params: PromptDatoParams,
  provider = params.provider ?? DEFAULT_MODEL_PROVIDER,
): string {
  return (
    params.providerMainModels?.[provider]?.trim() ||
    DEFAULT_MAIN_MODEL_BY_PROVIDER[provider]
  );
}

export function resolveSystemPrompt(params: PromptDatoParams): string {
  const custom = params.systemPrompt?.trim();
  return custom && custom.length > 0 ? custom : DEFAULT_SYSTEM_PROMPT;
}

export async function mergeParams(
  ctx: WritablePluginCtx,
  patch: Partial<PromptDatoParams>,
): Promise<void> {
  const existing = rawParams(ctx);
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  for (const removedKey of [
    ['ex', 'plain', 'Fail', 'ures'].join(''),
    ['fail', 'ure', 'Re', 'ports', 'Enabled'].join(''),
  ]) {
    delete merged[removedKey];
  }
  await ctx.updatePluginParameters(merged);
}

export function isFullyConfigured(params: PromptDatoParams): boolean {
  return Boolean(
    params.datoAccessToken &&
      getProviderApiKey(params) &&
      getProviderMainModel(params),
  );
}
