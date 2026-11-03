import {
  type AgentProvider,
  DEFAULT_MODEL,
  DEFAULT_VERCEL_MODEL,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from './config';
import {
  VERCEL_GATEWAY_CREDITS_ENDPOINT,
  VERCEL_GATEWAY_MODELS_ENDPOINT,
} from './vercelGateway';

const OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
const ANTHROPIC_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Curated models for the Dato Agent use case: strong tool use, reasoning, and
 * document input, ordered from the default balanced model to alternatives.
 * IDs missing from the live catalog are omitted rather than shown as broken
 * choices.
 */
export const VERCEL_RECOMMENDED_MODELS = [
  DEFAULT_VERCEL_MODEL,
  'anthropic/claude-opus-5.5',
  'anthropic/claude-haiku-5.5',
  'openai/gpt-6.1-sol',
  'openai/gpt-5.6-terra',
  'google/gemini-4-argon',
  'spacexai/grok-4.7',
] as const;
const MODEL_LIST_PAGE_SIZE = '1000';
const MAX_MODEL_LIST_PAGES = 50;

type FetchModels = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderModel = {
  id: string;
  label: string;
  maxOutputTokens?: number;
  reasoningEfforts: ReasoningEffort[];
  /**
   * Set for Vercel AI Gateway models that belong to the curated short list.
   */
  recommended?: boolean;
  /**
   * Set when the gateway catalog publishes an `${id}-fast` variant. Fast mode
   * selects that variant instead of a provider-specific speed flag.
   */
  supportsFastMode?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactApiKey(message: string, apiKey: string): string {
  const normalizedKey = apiKey.trim();
  const withoutKnownKey = normalizedKey
    ? message.split(normalizedKey).join('[redacted]')
    : message;

  return withoutKnownKey
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bvck_[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
}

function parseErrorMessage(
  payload: unknown,
  apiKey: string,
): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }

  return typeof payload.error.message === 'string'
    ? redactApiKey(payload.error.message, apiKey)
    : undefined;
}

async function readJsonResponse(
  response: Response,
  providerName: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`${providerName} returned an unreadable model list.`);
  }
}

function openAiModelVersion(modelId: string) {
  const match = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/i.exec(modelId);
  return match
    ? { major: Number(match[1]), minor: Number(match[2] ?? 0) }
    : undefined;
}

/**
 * The model-list API returns IDs, not Responses/tool/reasoning capabilities.
 * Accept general-purpose GPT-5 and later models, including new generations and
 * snapshots, without pinning discovery to a release or a list of variants.
 * Specialized endpoints and chat/coding variants do not share this runtime's
 * reasoning and verbosity controls.
 */
export function isCompatibleOpenAiAgentModel(modelId: string): boolean {
  const version = openAiModelVersion(modelId);
  return (
    Boolean(version && version.major >= 5) &&
    !/(?:^|-)(?:chat|codex|audio|realtime|transcribe|tts|image|search|instruct|embedding|moderation)(?:-|$)/i.test(
      modelId,
    )
  );
}

function openAiReasoningEfforts(modelId: string): ReasoningEffort[] {
  const version = openAiModelVersion(modelId);
  if (!version) {
    return [];
  }

  // Known historical restrictions are independent of which IDs are available
  // to this API key. New general-purpose generations inherit the current set.
  if (/(?:^|-)pro(?:-|$)/i.test(modelId)) {
    return version.major === 5 && version.minor === 0
      ? ['high']
      : ['medium', 'high', 'xhigh'];
  }
  if (version.major === 5) {
    if (version.minor === 0) return ['low', 'medium', 'high'];
    if (version.minor === 1) return ['none', 'low', 'medium', 'high'];
    if (version.minor < 6) {
      return ['none', 'low', 'medium', 'high', 'xhigh'];
    }
  }

  return REASONING_EFFORTS.filter(
    (effort) => effort !== 'none' || !/(?:^|-)astra(?:-|$)/i.test(modelId),
  );
}

export function providerModelSupportsFastMode(
  provider: AgentProvider,
  modelId: string,
  models?: readonly Pick<ProviderModel, 'id' | 'supportsFastMode'>[],
): boolean {
  const normalizedModelId = modelId.trim().toLowerCase();

  switch (provider) {
    case 'openai':
      return /^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-\d{4}-\d{2}-\d{2})?$/.test(
        normalizedModelId,
      );
    case 'anthropic':
      return /^(?:claude-opus-5|claude-opus-4-8)(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(
        normalizedModelId,
      );
    case 'vercel': {
      const selected = models?.find(
        (model) => model.id.trim().toLowerCase() === normalizedModelId,
      );
      if (selected?.supportsFastMode) {
        return true;
      }
      return (
        models?.some(
          (model) =>
            model.id.trim().toLowerCase() === `${normalizedModelId}-fast`,
        ) ?? false
      );
    }
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

function openAiModelPriority(modelId: string): number {
  if (modelId === 'gpt-5.6-terra') return 0;
  if (modelId === 'gpt-5.6-sol') return 1;
  if (modelId === 'gpt-5.6-luna') return 2;
  if (modelId === 'gpt-5.6') return 3;
  return 4;
}

function datedOpenAiModelParts(modelId: string): {
  familyPriority: number;
  date: string;
} {
  const match = modelId.match(
    /^gpt-5\.6(?:-(sol|terra|luna))?-(\d{4}-\d{2}-\d{2})$/,
  );
  const familyPriority =
    match?.[1] === 'terra'
      ? 0
      : match?.[1] === 'sol'
        ? 1
        : match?.[1] === 'luna'
          ? 2
          : 3;
  return { familyPriority, date: match?.[2] ?? '' };
}

function compareOpenAiModels(left: string, right: string): number {
  const leftPriority = openAiModelPriority(left);
  const rightPriority = openAiModelPriority(right);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  if (leftPriority < 4) {
    return left.localeCompare(right);
  }

  const leftDated = datedOpenAiModelParts(left);
  const rightDated = datedOpenAiModelParts(right);
  return (
    leftDated.familyPriority - rightDated.familyPriority ||
    rightDated.date.localeCompare(leftDated.date) ||
    left.localeCompare(right)
  );
}

function extractOpenAiModels(payload: unknown): ProviderModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('OpenAI returned an invalid model list.');
  }

  const modelIds = payload.data.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) {
      return [];
    }

    return [entry.id.trim()];
  });

  return Array.from(new Set(modelIds))
    .filter(isCompatibleOpenAiAgentModel)
    .sort(compareOpenAiModels)
    .map((id) => ({
      id,
      label: id,
      reasoningEfforts: openAiReasoningEfforts(id),
    }));
}

export async function listOpenAiProviderModels(
  apiKey: string,
  signal?: AbortSignal,
  fetchModels: FetchModels = fetch,
): Promise<ProviderModel[]> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new Error('Enter an OpenAI API key to load models.');
  }

  const response = await fetchModels(OPENAI_MODELS_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${normalizedKey}`,
    },
    signal,
  });
  const payload = await readJsonResponse(response, 'OpenAI');

  if (!response.ok) {
    throw new Error(
      parseErrorMessage(payload, normalizedKey) ??
        `OpenAI model discovery failed with status ${response.status}.`,
    );
  }

  return extractOpenAiModels(payload);
}

function hasCapability(value: unknown): boolean {
  return isRecord(value) && value.supported === true;
}

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function extractAnthropicModel(entry: unknown): ProviderModel | undefined {
  if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) {
    return undefined;
  }

  const id = entry.id.trim();
  const capabilities = isRecord(entry.capabilities)
    ? entry.capabilities
    : undefined;
  const effort =
    capabilities && isRecord(capabilities.effort)
      ? capabilities.effort
      : undefined;
  const thinking =
    capabilities && isRecord(capabilities.thinking)
      ? capabilities.thinking
      : undefined;
  const thinkingTypes =
    thinking && isRecord(thinking.types) ? thinking.types : undefined;

  if (
    !id.toLowerCase().startsWith('claude-') ||
    !effort ||
    effort.supported !== true ||
    !thinking ||
    thinking.supported !== true ||
    !thinkingTypes ||
    !hasCapability(thinkingTypes.adaptive)
  ) {
    return undefined;
  }

  const reasoningEfforts = (
    ['low', 'medium', 'high', 'xhigh', 'max'] as const
  ).filter((level) => hasCapability(effort[level]));
  if (reasoningEfforts.length === 0) {
    return undefined;
  }

  const displayName =
    typeof entry.display_name === 'string' ? entry.display_name.trim() : '';
  const maxOutputTokens = positiveSafeInteger(entry.max_tokens);

  return {
    id,
    label: displayName || id,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    reasoningEfforts: [...reasoningEfforts],
  };
}

function extractAnthropicModels(payload: unknown): ProviderModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Anthropic returned an invalid model list.');
  }

  return payload.data.flatMap((entry) => {
    const model = extractAnthropicModel(entry);
    return model ? [model] : [];
  });
}

function anthropicPaginationError(): Error {
  return new Error('Anthropic returned invalid model-list pagination data.');
}

async function loadAnthropicModelPages(
  apiKey: string,
  signal: AbortSignal | undefined,
  fetchModels: FetchModels,
  afterId?: string,
  page = 1,
): Promise<ProviderModel[]> {
  if (page > MAX_MODEL_LIST_PAGES) {
    throw anthropicPaginationError();
  }

  const url = new URL(ANTHROPIC_MODELS_ENDPOINT);
  url.searchParams.set('limit', MODEL_LIST_PAGE_SIZE);
  if (afterId) {
    url.searchParams.set('after_id', afterId);
  }

  const response = await fetchModels(url, {
    headers: {
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-version': ANTHROPIC_API_VERSION,
      'x-api-key': apiKey,
    },
    signal,
  });
  const payload = await readJsonResponse(response, 'Anthropic');

  if (!response.ok) {
    throw new Error(
      parseErrorMessage(payload, apiKey) ??
        `Anthropic model discovery failed with status ${response.status}.`,
    );
  }

  const models = extractAnthropicModels(payload);
  if (!isRecord(payload) || payload.has_more !== true) {
    return models;
  }

  const lastId = payload.last_id;
  if (typeof lastId !== 'string' || !lastId || lastId === afterId) {
    throw anthropicPaginationError();
  }

  return [
    ...models,
    ...(await loadAnthropicModelPages(
      apiKey,
      signal,
      fetchModels,
      lastId,
      page + 1,
    )),
  ];
}

function deduplicateModels(models: readonly ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();

  return models.filter((model) => {
    if (seen.has(model.id)) {
      return false;
    }
    seen.add(model.id);
    return true;
  });
}

function isBrowserNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /fetch|network|load failed|failed to fetch/i.test(error.message)
  );
}

export async function listAnthropicProviderModels(
  apiKey: string,
  signal?: AbortSignal,
  fetchModels: FetchModels = fetch,
): Promise<ProviderModel[]> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new Error('Enter an Anthropic API key to load models.');
  }

  try {
    return deduplicateModels(
      await loadAnthropicModelPages(normalizedKey, signal, fetchModels),
    );
  } catch (error) {
    if (isBrowserNetworkError(error)) {
      throw new Error(
        'Anthropic could not be reached from this browser. Anthropic organizations using Zero Data Retention require a server-side provider proxy.',
      );
    }
    throw error;
  }
}

const VERCEL_OWNER_LABELS: Record<string, string> = {
  alibaba: 'Alibaba',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  google: 'Google',
  meta: 'Meta',
  moonshotai: 'Moonshot',
  openai: 'OpenAI',
  spacexai: 'SpaceXAI',
};

function formatGatewayOwner(owner: string): string {
  const normalized = owner.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return (
    VERCEL_OWNER_LABELS[normalized] ??
    `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
  );
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

function gatewayReasoningEfforts(
  entry: Record<string, unknown>,
): ReasoningEffort[] {
  if (!Array.isArray(entry.reasoning_options)) {
    return [];
  }

  const supported = new Set<ReasoningEffort>();
  for (const option of entry.reasoning_options) {
    if (
      !isRecord(option) ||
      option.type !== 'effort' ||
      !Array.isArray(option.values)
    ) {
      continue;
    }
    for (const value of option.values) {
      if (isReasoningEffort(value)) {
        supported.add(value);
      }
    }
  }

  return REASONING_EFFORTS.filter((effort) => supported.has(effort));
}

function gatewayModelLabel(entry: Record<string, unknown>, id: string): string {
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const owner =
    typeof entry.owned_by === 'string' && entry.owned_by.trim()
      ? entry.owned_by
      : (id.split('/')[0] ?? '');
  const ownerLabel = formatGatewayOwner(owner);
  if (name && ownerLabel) {
    return `${name} (${ownerLabel})`;
  }
  return name || id;
}

function isSelectableGatewayModel(entry: unknown): entry is Record<
  string,
  unknown
> & {
  id: string;
} {
  if (
    !isRecord(entry) ||
    entry.type !== 'language' ||
    typeof entry.id !== 'string'
  ) {
    return false;
  }
  const id = entry.id.trim().toLowerCase();
  if (!id || id.endsWith('-batch') || id.endsWith('-fast')) {
    return false;
  }
  return Array.isArray(entry.tags) && entry.tags.includes('tool-use');
}

function recommendedModelRank(modelId: string): number {
  const index = VERCEL_RECOMMENDED_MODELS.indexOf(
    modelId as (typeof VERCEL_RECOMMENDED_MODELS)[number],
  );
  return index === -1 ? VERCEL_RECOMMENDED_MODELS.length : index;
}

function extractVercelGatewayModels(payload: unknown): ProviderModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Vercel AI Gateway returned an invalid model list.');
  }

  const entries = payload.data.filter(isSelectableGatewayModel);
  const fastVariantIds = new Set(
    payload.data.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string') {
        return [];
      }
      const id = entry.id.trim().toLowerCase();
      return id.endsWith('-fast') ? [id] : [];
    }),
  );

  return entries
    .map((entry) => {
      const id = entry.id.trim();
      const maxOutputTokens = positiveSafeInteger(entry.max_tokens);
      const recommended = VERCEL_RECOMMENDED_MODELS.some(
        (modelId) => modelId === id,
      );
      return {
        id,
        label: gatewayModelLabel(entry, id),
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        reasoningEfforts: gatewayReasoningEfforts(entry),
        recommended,
        supportsFastMode: fastVariantIds.has(`${id.toLowerCase()}-fast`),
      };
    })
    .sort(
      (left, right) =>
        recommendedModelRank(left.id) - recommendedModelRank(right.id) ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    );
}

function gatewayErrorMessage(
  payload: unknown,
  apiKey: string,
): string | undefined {
  const providerMessage = parseErrorMessage(payload, apiKey);
  if (providerMessage) {
    return providerMessage;
  }
  if (!isRecord(payload)) {
    return undefined;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return redactApiKey(payload.message, apiKey);
  }
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return redactApiKey(payload.error, apiKey);
  }
  return undefined;
}

async function assertVercelGatewayCredits(
  apiKey: string,
  signal: AbortSignal | undefined,
  fetchModels: FetchModels,
): Promise<void> {
  const response = await fetchModels(VERCEL_GATEWAY_CREDITS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const payload = await readJsonResponse(response, 'Vercel AI Gateway');

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      gatewayErrorMessage(payload, apiKey) ??
        'Vercel AI Gateway rejected the API key. Create one under Vercel → AI Gateway → API keys.',
    );
  }
  if (!response.ok) {
    throw new Error(
      gatewayErrorMessage(payload, apiKey) ??
        `Vercel AI Gateway credit check failed with status ${response.status}.`,
    );
  }
  if (!isRecord(payload)) {
    throw new Error('Vercel AI Gateway returned an invalid credit balance.');
  }

  const balance = Number(payload.balance);
  if (Number.isFinite(balance) && balance <= 0) {
    throw new Error(
      'This AI Gateway key has no credits left. Add credits, or configure bring-your-own provider keys, in the Vercel dashboard.',
    );
  }
}

export async function listVercelGatewayModels(
  apiKey: string,
  signal?: AbortSignal,
  fetchModels: FetchModels = fetch,
): Promise<ProviderModel[]> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new Error('Enter an AI Gateway API key to load models.');
  }

  try {
    await assertVercelGatewayCredits(normalizedKey, signal, fetchModels);
    const response = await fetchModels(VERCEL_GATEWAY_MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${normalizedKey}` },
      signal,
    });
    const payload = await readJsonResponse(response, 'Vercel AI Gateway');
    if (!response.ok) {
      throw new Error(
        gatewayErrorMessage(payload, normalizedKey) ??
          `Vercel AI Gateway model discovery failed with status ${response.status}.`,
      );
    }
    return extractVercelGatewayModels(payload);
  } catch (error) {
    if (isBrowserNetworkError(error)) {
      throw new Error(
        'Vercel AI Gateway could not be reached from this browser.',
      );
    }
    throw error;
  }
}

export async function listProviderModels(
  provider: AgentProvider,
  apiKey: string,
  signal?: AbortSignal,
  fetchModels: FetchModels = fetch,
): Promise<ProviderModel[]> {
  switch (provider) {
    case 'openai':
      return listOpenAiProviderModels(apiKey, signal, fetchModels);
    case 'anthropic':
      return listAnthropicProviderModels(apiKey, signal, fetchModels);
    case 'vercel':
      return listVercelGatewayModels(apiKey, signal, fetchModels);
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

export function preferredProviderModel(
  provider: AgentProvider,
  models: readonly ProviderModel[],
): ProviderModel | undefined {
  switch (provider) {
    case 'anthropic':
      return (
        models.find((model) => model.id.toLowerCase().includes('sonnet')) ??
        models[0]
      );
    case 'vercel':
      return (
        models.find((model) => model.id === DEFAULT_VERCEL_MODEL) ??
        models.find((model) => model.recommended) ??
        models[0]
      );
    case 'openai':
      return models.find((model) => model.id === DEFAULT_MODEL) ?? models[0];
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}
