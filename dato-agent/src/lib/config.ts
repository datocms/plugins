export const DEFAULT_MODEL = 'gpt-5.6-terra';

export const AGENT_PROVIDERS = ['openai', 'anthropic'] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const REASONING_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const ANTHROPIC_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type AnthropicReasoningEffort =
  (typeof ANTHROPIC_REASONING_EFFORTS)[number];

export type AgentConfig = {
  provider: AgentProvider;
  openAiApiKey: string;
  /**
   * The OpenAI model field keeps its legacy name so previously saved
   * configuration, and older plugin builds, continue to read the same value.
   */
  model: string;
  reasoningEffort: ReasoningEffort;
  openAiFastMode: boolean;
  anthropicApiKey: string;
  anthropicModel: string;
  /**
   * Maximum output-token capability reported by Anthropic for the selected
   * model. Older saved configurations omit it and safely use the runtime
   * fallback until an administrator next saves discovered model metadata.
   */
  anthropicModelMaxOutputTokens: number | null;
  anthropicReasoningEffort: AnthropicReasoningEffort;
  anthropicFastMode: boolean;
  additionalInstructions: string;
  readOnly: boolean;
  enableRecordSidebar: boolean;
  /**
   * Collaborator roles allowed to use Dato Agent. Project owners are always
   * allowed separately. `null` means this setting has not been configured yet.
   */
  allowedRoleIds: string[] | null;
};

export const DEFAULT_CONFIG: AgentConfig = {
  provider: 'openai',
  openAiApiKey: '',
  model: DEFAULT_MODEL,
  reasoningEffort: 'medium',
  openAiFastMode: false,
  anthropicApiKey: '',
  anthropicModel: '',
  anthropicModelMaxOutputTokens: null,
  anthropicReasoningEffort: 'high',
  anthropicFastMode: false,
  additionalInstructions: '',
  readOnly: false,
  enableRecordSidebar: true,
  allowedRoleIds: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function normalizeRoleIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return [
    ...new Set(
      value
        .map((entry) => trimmedString(entry))
        .filter((entry) => entry.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function normalizeProvider(value: unknown): AgentProvider {
  const candidate = trimmedString(value).toLowerCase();

  if (candidate === 'anthropic' || candidate === 'claude') {
    return 'anthropic';
  }
  if (candidate === 'openai' || candidate === 'chatgpt') {
    return 'openai';
  }

  return DEFAULT_CONFIG.provider;
}

export function normalizeConfig(parameters: unknown): AgentConfig {
  const source = isRecord(parameters) ? parameters : {};
  const provider = normalizeProvider(source.provider);
  const openAiApiKey = trimmedString(source.openAiApiKey);
  const model = trimmedString(source.model) || DEFAULT_CONFIG.model;
  const reasoningEffort =
    REASONING_EFFORTS.find((effort) => effort === source.reasoningEffort) ??
    DEFAULT_CONFIG.reasoningEffort;
  const openAiFastMode =
    typeof source.openAiFastMode === 'boolean'
      ? source.openAiFastMode
      : DEFAULT_CONFIG.openAiFastMode;
  const anthropicApiKey = trimmedString(source.anthropicApiKey);
  const anthropicModel = trimmedString(source.anthropicModel);
  const anthropicModelMaxOutputTokens = positiveSafeInteger(
    source.anthropicModelMaxOutputTokens,
  );
  const anthropicReasoningEffort =
    ANTHROPIC_REASONING_EFFORTS.find(
      (effort) => effort === source.anthropicReasoningEffort,
    ) ?? DEFAULT_CONFIG.anthropicReasoningEffort;
  const anthropicFastMode =
    typeof source.anthropicFastMode === 'boolean'
      ? source.anthropicFastMode
      : DEFAULT_CONFIG.anthropicFastMode;
  const additionalInstructions =
    typeof source.additionalInstructions === 'string'
      ? source.additionalInstructions
      : DEFAULT_CONFIG.additionalInstructions;
  const readOnly =
    typeof source.readOnly === 'boolean'
      ? source.readOnly
      : DEFAULT_CONFIG.readOnly;
  const enableRecordSidebar =
    typeof source.enableRecordSidebar === 'boolean'
      ? source.enableRecordSidebar
      : DEFAULT_CONFIG.enableRecordSidebar;
  const allowedRoleIds = normalizeRoleIds(source.allowedRoleIds);

  return {
    provider,
    openAiApiKey,
    model,
    reasoningEffort,
    openAiFastMode,
    anthropicApiKey,
    anthropicModel,
    anthropicModelMaxOutputTokens,
    anthropicReasoningEffort,
    anthropicFastMode,
    additionalInstructions,
    readOnly,
    enableRecordSidebar,
    allowedRoleIds,
  };
}

export function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI (ChatGPT)';
    case 'anthropic':
      return 'Anthropic (Claude)';
  }
}

export function activeApiKey(config: AgentConfig): string {
  switch (config.provider) {
    case 'openai':
      return config.openAiApiKey;
    case 'anthropic':
      return config.anthropicApiKey;
  }
}

export function activeModel(config: AgentConfig): string {
  switch (config.provider) {
    case 'openai':
      return config.model;
    case 'anthropic':
      return config.anthropicModel;
  }
}

export function activeModelMaxOutputTokens(
  config: AgentConfig,
): number | undefined {
  switch (config.provider) {
    case 'openai':
      return undefined;
    case 'anthropic':
      return config.anthropicModelMaxOutputTokens ?? undefined;
  }
}

export function activeReasoningEffort(config: AgentConfig): ReasoningEffort {
  switch (config.provider) {
    case 'openai':
      return config.reasoningEffort;
    case 'anthropic':
      return config.anthropicReasoningEffort;
  }
}

export function activeFastMode(config: AgentConfig): boolean {
  switch (config.provider) {
    case 'openai':
      return config.openAiFastMode;
    case 'anthropic':
      return config.anthropicFastMode;
  }
}

export function withActiveApiKey(
  config: AgentConfig,
  apiKey: string,
): AgentConfig {
  switch (config.provider) {
    case 'openai':
      return { ...config, openAiApiKey: apiKey };
    case 'anthropic':
      return { ...config, anthropicApiKey: apiKey };
  }
}

export function withActiveModel(
  config: AgentConfig,
  model: string,
  maxOutputTokens?: number,
): AgentConfig {
  switch (config.provider) {
    case 'openai':
      return { ...config, model };
    case 'anthropic':
      return {
        ...config,
        anthropicModel: model,
        anthropicModelMaxOutputTokens: positiveSafeInteger(maxOutputTokens),
      };
  }
}

export function withActiveReasoningEffort(
  config: AgentConfig,
  effort: ReasoningEffort,
): AgentConfig {
  switch (config.provider) {
    case 'openai':
      return { ...config, reasoningEffort: effort };
    case 'anthropic':
      if (effort === 'none') {
        return config;
      }
      return { ...config, anthropicReasoningEffort: effort };
  }
}

export function withActiveFastMode(
  config: AgentConfig,
  fastMode: boolean,
): AgentConfig {
  switch (config.provider) {
    case 'openai':
      return { ...config, openAiFastMode: fastMode };
    case 'anthropic':
      return { ...config, anthropicFastMode: fastMode };
  }
}

export function serializeConfig(
  previousParameters: unknown,
  next: AgentConfig,
): Record<string, unknown> {
  const previous = isRecord(previousParameters) ? previousParameters : {};
  const currentParameters = { ...previous };
  delete currentParameters.defaultSidebarWidth;

  return {
    ...currentParameters,
    ...normalizeConfig(next),
  };
}
