export const DEFAULT_MODEL = 'gpt-5.6-terra';

export const DEFAULT_VERCEL_MODEL = 'anthropic/claude-sonnet-5.5';

export const AGENT_PROVIDERS = ['openai', 'anthropic', 'vercel'] as const;

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
  vercelApiKey: string;
  /**
   * Gateway model IDs use the `provider/model` form returned by
   * `https://ai-gateway.vercel.sh/v1/models`.
   */
  vercelModel: string;
  /**
   * Maximum output-token capability reported by the gateway catalog for the
   * selected model. Older saved configurations omit it and safely use the
   * runtime fallback until an administrator next saves discovered metadata.
   */
  vercelModelMaxOutputTokens: number | null;
  vercelReasoningEffort: ReasoningEffort;
  /**
   * Effort levels reported by the gateway catalog for `vercelModel`. An empty
   * list means the selected model does not expose reasoning controls.
   */
  vercelModelReasoningEfforts: ReasoningEffort[];
  vercelFastMode: boolean;
  /**
   * When false, the model picker shows only the curated recommended models.
   * The full tool-capable catalog stays available behind this setting.
   */
  vercelShowAllModels: boolean;
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
  vercelApiKey: '',
  vercelModel: DEFAULT_VERCEL_MODEL,
  vercelModelMaxOutputTokens: null,
  vercelReasoningEffort: 'high',
  vercelModelReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  vercelFastMode: false,
  vercelShowAllModels: false,
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

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

function normalizeReasoningEffortList(
  value: unknown,
): ReasoningEffort[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const supported = new Set<ReasoningEffort>();
  for (const entry of value) {
    if (isReasoningEffort(entry)) {
      supported.add(entry);
    }
  }

  return REASONING_EFFORTS.filter((effort) => supported.has(effort));
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
  if (
    candidate === 'vercel' ||
    candidate === 'ai-gateway' ||
    candidate === 'vercel-ai-gateway'
  ) {
    return 'vercel';
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
  const vercelApiKey = trimmedString(source.vercelApiKey);
  const vercelModel =
    trimmedString(source.vercelModel) || DEFAULT_CONFIG.vercelModel;
  const vercelModelMaxOutputTokens = positiveSafeInteger(
    source.vercelModelMaxOutputTokens,
  );
  const vercelReasoningEffort =
    REASONING_EFFORTS.find(
      (effort) => effort === source.vercelReasoningEffort,
    ) ?? DEFAULT_CONFIG.vercelReasoningEffort;
  const vercelModelReasoningEfforts =
    normalizeReasoningEffortList(source.vercelModelReasoningEfforts) ??
    DEFAULT_CONFIG.vercelModelReasoningEfforts;
  const vercelFastMode =
    typeof source.vercelFastMode === 'boolean'
      ? source.vercelFastMode
      : DEFAULT_CONFIG.vercelFastMode;
  const vercelShowAllModels =
    typeof source.vercelShowAllModels === 'boolean'
      ? source.vercelShowAllModels
      : DEFAULT_CONFIG.vercelShowAllModels;
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
    vercelApiKey,
    vercelModel,
    vercelModelMaxOutputTokens,
    vercelReasoningEffort,
    vercelModelReasoningEfforts,
    vercelFastMode,
    vercelShowAllModels,
    additionalInstructions,
    readOnly,
    enableRecordSidebar,
    allowedRoleIds,
  };
}

function assertNeverProvider(provider: never): never {
  throw new Error(`Unsupported agent provider: ${String(provider)}`);
}

export function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI (ChatGPT)';
    case 'anthropic':
      return 'Anthropic (Claude)';
    case 'vercel':
      return 'Vercel AI Gateway';
    default:
      return assertNeverProvider(provider);
  }
}

export function activeApiKey(config: AgentConfig): string {
  switch (config.provider) {
    case 'openai':
      return config.openAiApiKey;
    case 'anthropic':
      return config.anthropicApiKey;
    case 'vercel':
      return config.vercelApiKey;
    default:
      return assertNeverProvider(config.provider);
  }
}

export function activeModel(config: AgentConfig): string {
  switch (config.provider) {
    case 'openai':
      return config.model;
    case 'anthropic':
      return config.anthropicModel;
    case 'vercel':
      return config.vercelModel;
    default:
      return assertNeverProvider(config.provider);
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
    case 'vercel':
      return config.vercelModelMaxOutputTokens ?? undefined;
    default:
      return assertNeverProvider(config.provider);
  }
}

export function activeReasoningEffort(config: AgentConfig): ReasoningEffort {
  switch (config.provider) {
    case 'openai':
      return config.reasoningEffort;
    case 'anthropic':
      return config.anthropicReasoningEffort;
    case 'vercel':
      return config.vercelReasoningEffort;
    default:
      return assertNeverProvider(config.provider);
  }
}

export function activeFastMode(config: AgentConfig): boolean {
  switch (config.provider) {
    case 'openai':
      return config.openAiFastMode;
    case 'anthropic':
      return config.anthropicFastMode;
    case 'vercel':
      return config.vercelFastMode;
    default:
      return assertNeverProvider(config.provider);
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
    case 'vercel':
      return { ...config, vercelApiKey: apiKey };
    default:
      return assertNeverProvider(config.provider);
  }
}

export function withActiveModel(
  config: AgentConfig,
  model: string,
  maxOutputTokens?: number,
  reasoningEfforts?: readonly ReasoningEffort[],
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
    case 'vercel':
      return {
        ...config,
        vercelModel: model,
        vercelModelMaxOutputTokens: positiveSafeInteger(maxOutputTokens),
        ...(reasoningEfforts
          ? {
              vercelModelReasoningEfforts:
                normalizeReasoningEffortList([...reasoningEfforts]) ?? [],
            }
          : {}),
      };
    default:
      return assertNeverProvider(config.provider);
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
    case 'vercel':
      return { ...config, vercelReasoningEffort: effort };
    default:
      return assertNeverProvider(config.provider);
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
    case 'vercel':
      return { ...config, vercelFastMode: fastMode };
    default:
      return assertNeverProvider(config.provider);
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
