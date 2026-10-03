import {
  getModelLabel,
  isGoogleImageGenerationModel,
  isOpenAiImageGenerationModel,
  normalizeModelSignal,
} from './catalog';
import {
  createDiscoveryHttpClient,
  type DiscoveryHttpOptions,
} from './discoveryHttp';
import type { GoogleGenerationMethod, ProviderId, SelectOption } from './types';

export type ProviderModelOption = SelectOption<string>;

export type ModelDiscoveryResult = {
  options: ProviderModelOption[];
};

export type DiscoveryOptions = DiscoveryHttpOptions & {
  selectedModel?: string;
};

type OpenAiModel = {
  id?: unknown;
  created?: unknown;
};

type GoogleModel = {
  name?: unknown;
  baseModelId?: unknown;
  version?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportedGenerationMethods?: unknown;
};

type SortableModelOption = ProviderModelOption & {
  created?: number;
  version?: string;
};

const pinnedOpenAiModel = 'gpt-image-2';
const MAX_MODEL_PAGES = 100;
const MAX_MODEL_ENTRIES = 100_000;

type DiscoveryHttpClient = ReturnType<typeof createDiscoveryHttpClient>;

export async function loadProviderModelOptions(
  provider: ProviderId,
  apiKey: string,
  options: DiscoveryOptions = {},
): Promise<ModelDiscoveryResult> {
  const trimmedApiKey = apiKey.trim();

  if (!trimmedApiKey) {
    return { options: withSelectedFallback([], options.selectedModel) };
  }

  const client = createDiscoveryHttpClient(options);
  try {
    const discoveredOptions =
      provider === 'openai'
        ? await loadOpenAiModels(trimmedApiKey, client)
        : await loadGoogleModels(trimmedApiKey, client);

    return {
      options: withSelectedFallback(discoveredOptions, options.selectedModel),
    };
  } finally {
    client.dispose();
  }
}

async function loadOpenAiModels(
  apiKey: string,
  client: DiscoveryHttpClient,
): Promise<ProviderModelOption[]> {
  // OpenAI's list endpoint returns the complete catalog without pagination args.
  const payload = await client.readJson(
    'OpenAI',
    'https://api.openai.com/v1/models',
    {
      Authorization: `Bearer ${apiKey}`,
    },
  );
  const models = readModelList(payload, 'data', 'OpenAI');
  if (models.length > MAX_MODEL_ENTRIES) {
    throw catalogLimitError('OpenAI');
  }
  const options = models
    .map(readOpenAiModel)
    .filter((model) => isOpenAiImageGenerationModel(model.id))
    .map<SortableModelOption>((model) => ({
      value: model.id,
      label: getModelLabel(model.id),
      created: model.created,
    }));

  return prependPinnedOpenAiModel(sortModelOptions(dedupeOptions(options)));
}

async function loadGoogleModels(
  apiKey: string,
  client: DiscoveryHttpClient,
): Promise<ProviderModelOption[]> {
  const options = new Map<string, SortableModelOption>();
  const seenPageTokens = new Set<string>();
  let pages = 0;
  let entries = 0;
  let pageToken = '';

  do {
    if (pages >= MAX_MODEL_PAGES) {
      throw catalogLimitError('Google');
    }
    pages += 1;
    const url = new URL(
      'https://generativelanguage.googleapis.com/v1beta/models',
    );
    url.searchParams.set('pageSize', '1000');

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    // biome-ignore lint/performance/noAwaitInLoops: each page token comes from the preceding response.
    const payload = await client.readJson('Google', url, {
      'x-goog-api-key': apiKey,
    });
    const models = readModelList(payload, 'models', 'Google');
    entries += models.length;
    if (entries > MAX_MODEL_ENTRIES) {
      throw catalogLimitError('Google');
    }

    mergeGoogleOptions(options, models);

    pageToken = readNextPageToken(payload);
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error('Google returned a repeated model catalog page token.');
    }
    seenPageTokens.add(pageToken);
  } while (pageToken);

  return sortModelOptions(Array.from(options.values()));
}

function mergeGoogleOptions(
  options: Map<string, SortableModelOption>,
  entries: unknown[],
) {
  for (const entry of entries) {
    const model = readGoogleModel(entry);
    if (!isGoogleImageModelEntry(model)) {
      continue;
    }
    const value = stripModelResourcePrefix(model.name);
    if (options.has(value)) {
      continue;
    }
    options.set(value, {
      value,
      label: model.displayName
        ? `${model.displayName} (${value})`
        : getModelLabel(value),
      generationMethod: resolveGoogleGenerationMethod(model),
      version: model.version,
    });
  }
}

function readOpenAiModel(entry: unknown): {
  id: string;
  created?: number;
} {
  if (!entry || typeof entry !== 'object') {
    throw new Error('OpenAI returned an invalid model catalog entry.');
  }

  const model = entry as OpenAiModel;

  if (typeof model.id !== 'string' || !model.id.trim()) {
    throw new Error('OpenAI returned a model without a valid identifier.');
  }

  return {
    id: model.id.trim(),
    created: typeof model.created === 'number' ? model.created : undefined,
  };
}

function readGoogleModel(entry: unknown): {
  name: string;
  version?: string;
  displayName?: string;
  supportedGenerationMethods: string[];
} {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Google returned an invalid model catalog entry.');
  }

  const model = entry as GoogleModel;

  if (typeof model.name !== 'string' || !model.name.trim()) {
    throw new Error('Google returned a model without a valid identifier.');
  }
  if (
    model.supportedGenerationMethods !== undefined &&
    (!Array.isArray(model.supportedGenerationMethods) ||
      model.supportedGenerationMethods.some(
        (method) => typeof method !== 'string',
      ))
  ) {
    throw new Error('Google returned invalid model generation methods.');
  }

  return {
    name: model.name.trim(),
    version: typeof model.version === 'string' ? model.version : undefined,
    displayName:
      typeof model.displayName === 'string' ? model.displayName : undefined,
    supportedGenerationMethods: Array.isArray(model.supportedGenerationMethods)
      ? model.supportedGenerationMethods.filter(
          (method): method is string => typeof method === 'string',
        )
      : [],
  };
}

function isGoogleImageModelEntry(model: {
  name: string;
  supportedGenerationMethods: string[];
}): boolean {
  return (
    isGoogleImageGenerationModel(model.name) &&
    Boolean(resolveGoogleGenerationMethod(model))
  );
}

function resolveGoogleGenerationMethod(model: {
  name: string;
  supportedGenerationMethods: string[];
}): GoogleGenerationMethod | undefined {
  if (model.supportedGenerationMethods.includes('generateContent')) {
    return 'generateContent';
  }

  return undefined;
}

function withSelectedFallback(
  options: ProviderModelOption[],
  selectedModel?: string,
): ProviderModelOption[] {
  const trimmedModel = selectedModel?.trim();

  if (!trimmedModel) {
    return options;
  }

  if (options.some((option) => option.value === trimmedModel)) {
    return options;
  }

  return [
    ...options,
    {
      value: trimmedModel,
      label: `${getModelLabel(trimmedModel)} (unavailable)`,
      unavailable: true,
    },
  ];
}

function prependPinnedOpenAiModel(
  options: ProviderModelOption[],
): ProviderModelOption[] {
  const pinnedOption = options.find(
    (option) => option.value === pinnedOpenAiModel,
  );
  if (!pinnedOption) {
    return options;
  }
  return [
    pinnedOption,
    ...options.filter((option) => option.value !== pinnedOpenAiModel),
  ];
}

function sortModelOptions<T extends SortableModelOption>(options: T[]): T[] {
  return [...options].sort((first, second) => {
    const scoreDifference =
      getSortScore(first.value) - getSortScore(second.value);

    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    if (first.created !== second.created) {
      return (second.created || 0) - (first.created || 0);
    }

    const dateDifference =
      getDateSortValue(second.value) - getDateSortValue(first.value);

    if (dateDifference !== 0) {
      return dateDifference;
    }

    return first.value.localeCompare(second.value, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function getSortScore(model: string): number {
  const normalizedModel = normalizeModelSignal(model);

  if (normalizedModel.includes('latest')) {
    return 0;
  }

  if (hasDatedSnapshot(normalizedModel)) {
    return 3;
  }

  if (
    normalizedModel.includes('preview') ||
    normalizedModel.includes('snapshot') ||
    normalizedModel.includes('experimental') ||
    normalizedModel.includes('exp')
  ) {
    return 2;
  }

  return 1;
}

function hasDatedSnapshot(model: string): boolean {
  return /(?:^|-)(?:20\d{2})-(?:0\d|1[0-2])-(?:[0-2]\d|3[01])(?:-|$)/.test(
    model,
  );
}

function getDateSortValue(model: string): number {
  const match = normalizeModelSignal(model).match(
    /(?:^|-)(20\d{2})-(0\d|1[0-2])-([0-2]\d|3[01])(?:-|$)/,
  );

  if (!match) {
    return 0;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  return year * 10000 + month * 100 + day;
}

function dedupeOptions<T extends ProviderModelOption>(options: T[]): T[] {
  const seenValues = new Set<string>();
  const dedupedOptions: T[] = [];

  for (const option of options) {
    if (seenValues.has(option.value)) {
      continue;
    }

    seenValues.add(option.value);
    dedupedOptions.push(option);
  }

  return dedupedOptions;
}

function readModelList(
  payload: unknown,
  field: 'data' | 'models',
  provider: string,
): unknown[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as Record<string, unknown>)[field])
  ) {
    throw new Error(`${provider} returned an invalid model catalog response.`);
  }
  return (payload as Record<'data' | 'models', unknown[]>)[field];
}

function readNextPageToken(payload: unknown): string {
  const token = (payload as { nextPageToken?: unknown }).nextPageToken;
  if (token === undefined || token === '') {
    return '';
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Google returned an invalid model catalog page token.');
  }
  return token;
}

function catalogLimitError(provider: string): Error {
  return new Error(
    `${provider} model catalog exceeded the safety limit of ${MAX_MODEL_PAGES} pages or ${MAX_MODEL_ENTRIES} entries.`,
  );
}

function stripModelResourcePrefix(model: string): string {
  return model.replace(/^models\//, '');
}
