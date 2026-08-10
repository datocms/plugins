import {
  type AgentProvider,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from './config';

const OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
const ANTHROPIC_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_API_VERSION = '2023-06-01';
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactApiKey(message: string, apiKey: string): string {
  const normalizedKey = apiKey.trim();
  const withoutKnownKey = normalizedKey
    ? message.split(normalizedKey).join('[redacted]')
    : message;

  return withoutKnownKey.replace(
    /\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/g,
    '[redacted]',
  );
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

/**
 * Dato Agent uses Responses streaming, reasoning controls, function tools, and
 * hosted MCP. Keep the OpenAI picker to models matching that complete stack.
 */
export function isCompatibleOpenAiAgentModel(modelId: string): boolean {
  return /^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-\d{4}-\d{2}-\d{2})?$/.test(
    modelId.toLowerCase(),
  );
}

export function providerModelSupportsFastMode(
  provider: AgentProvider,
  modelId: string,
): boolean {
  const normalizedModelId = modelId.trim().toLowerCase();

  switch (provider) {
    case 'openai':
      return isCompatibleOpenAiAgentModel(normalizedModelId);
    case 'anthropic':
      return /^(?:claude-opus-5|claude-opus-4-8)(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(
        normalizedModelId,
      );
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
      reasoningEfforts: [...REASONING_EFFORTS],
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
  }
}

export function preferredProviderModel(
  provider: AgentProvider,
  models: readonly ProviderModel[],
): ProviderModel | undefined {
  if (provider === 'anthropic') {
    return (
      models.find((model) => model.id.toLowerCase().includes('sonnet')) ??
      models[0]
    );
  }

  return models[0];
}
