import {
  getModelLabel,
  hasImageFamilySignal,
  isGoogleImageGenerationModel,
  isGooglePredictImageModel,
  isOpenAiImageGenerationModel,
  normalizeModelSignal,
} from './catalog';
import type {
  GoogleGenerationMethod,
  ProviderId,
  SelectOption,
} from './types';

export type ProviderModelOption = SelectOption<string>;

export type ModelDiscoveryResult = {
  options: ProviderModelOption[];
};

type DiscoveryOptions = {
  signal?: AbortSignal;
  selectedModel?: string;
};

type OpenAiModel = {
  id?: unknown;
  created?: unknown;
};

type OpenAiModelsResponse = {
  data?: unknown;
};

type GoogleModel = {
  name?: unknown;
  baseModelId?: unknown;
  version?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportedGenerationMethods?: unknown;
};

type GoogleModelsResponse = {
  models?: unknown;
  nextPageToken?: unknown;
};

type SortableModelOption = ProviderModelOption & {
  created?: number;
  version?: string;
};

const pinnedOpenAiModel = 'gpt-image-2';

export async function loadProviderModelOptions(
  provider: ProviderId,
  apiKey: string,
  options: DiscoveryOptions = {},
): Promise<ModelDiscoveryResult> {
  const trimmedApiKey = apiKey.trim();

  if (!trimmedApiKey) {
    return { options: withSelectedFallback([], options.selectedModel) };
  }

  const discoveredOptions =
    provider === 'openai'
      ? await loadOpenAiModels(trimmedApiKey, options.signal)
      : await loadGoogleModels(trimmedApiKey, options.signal);

  return {
    options: withSelectedFallback(discoveredOptions, options.selectedModel),
  };
}

async function loadOpenAiModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProviderModelOption[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
  });

  const payload = (await readJsonResponse(response)) as OpenAiModelsResponse;

  if (!response.ok) {
    throw createDiscoveryError('OpenAI', response, payload);
  }

  const models = Array.isArray(payload.data) ? payload.data : [];
  const options = models
    .map(readOpenAiModel)
    .filter(isDefined)
    .filter((model) => isOpenAiImageGenerationModel(model.id))
    .map<SortableModelOption>((model) => ({
      value: model.id,
      label: getModelLabel(model.id),
      created: model.created,
    }));

  return prependPinnedOpenAiModel(sortModelOptions(options));
}

async function loadGoogleModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ProviderModelOption[]> {
  const options: SortableModelOption[] = [];
  let pageToken = '';

  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '1000');

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url, { signal });
    const payload = (await readJsonResponse(response)) as GoogleModelsResponse;

    if (!response.ok) {
      throw createDiscoveryError('Google', response, payload);
    }

    const models = Array.isArray(payload.models) ? payload.models : [];

    for (const entry of models) {
      const model = readGoogleModel(entry);

      if (!model || !isGoogleImageModelEntry(model)) {
        continue;
      }

      const value = stripModelResourcePrefix(model.name);
      const label = model.displayName
        ? `${model.displayName} (${value})`
        : getModelLabel(value);

      options.push({
        value,
        label,
        generationMethod: resolveGoogleGenerationMethod(model),
        version: model.version,
      });
    }

    pageToken =
      typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
  } while (pageToken);

  return sortModelOptions(dedupeOptions(options));
}

function readOpenAiModel(entry: unknown):
  | {
      id: string;
      created?: number;
    }
  | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const model = entry as OpenAiModel;

  if (typeof model.id !== 'string') {
    return undefined;
  }

  return {
    id: model.id,
    created: typeof model.created === 'number' ? model.created : undefined,
  };
}

function readGoogleModel(entry: unknown):
  | {
      name: string;
      baseModelId?: string;
      version?: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods: string[];
    }
  | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const model = entry as GoogleModel;

  if (typeof model.name !== 'string') {
    return undefined;
  }

  return {
    name: model.name,
    baseModelId:
      typeof model.baseModelId === 'string' ? model.baseModelId : undefined,
    version: typeof model.version === 'string' ? model.version : undefined,
    displayName:
      typeof model.displayName === 'string' ? model.displayName : undefined,
    description:
      typeof model.description === 'string' ? model.description : undefined,
    supportedGenerationMethods: Array.isArray(model.supportedGenerationMethods)
      ? model.supportedGenerationMethods.filter(
          (method): method is string => typeof method === 'string',
        )
      : [],
  };
}

function isGoogleImageModelEntry(model: {
  name: string;
  baseModelId?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods: string[];
}): boolean {
  const method = resolveGoogleGenerationMethod(model);

  if (!method) {
    return false;
  }

  const modelIdentifierText = [model.name, model.baseModelId]
    .filter(isDefined)
    .join(' ');
  const modelDescriptionText = [model.displayName, model.description]
    .filter(isDefined)
    .join(' ');

  return (
    isGoogleImageGenerationModel(modelIdentifierText) ||
    hasImageFamilySignal(modelDescriptionText)
  );
}

function resolveGoogleGenerationMethod(model: {
  name: string;
  supportedGenerationMethods: string[];
}): GoogleGenerationMethod | undefined {
  if (
    model.supportedGenerationMethods.includes('predict') &&
    isGooglePredictImageModel(model.name)
  ) {
    return 'predict';
  }

  if (model.supportedGenerationMethods.includes('generateContent')) {
    return 'generateContent';
  }

  if (model.supportedGenerationMethods.includes('predict')) {
    return 'predict';
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
  return [
    {
      value: pinnedOpenAiModel,
      label: getModelLabel(pinnedOpenAiModel),
    },
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

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function createDiscoveryError(
  providerLabel: string,
  response: Response,
  payload: unknown,
): Error {
  const message = readProviderErrorMessage(payload);
  const error = new Error(
    message || `${providerLabel} returned ${response.status}.`,
  ) as Error & { status?: number };

  error.status = response.status;

  return error;
}

function readProviderErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const error = (payload as { error?: unknown }).error;

  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const message = (error as { message?: unknown }).message;

  return typeof message === 'string' ? message : undefined;
}

function stripModelResourcePrefix(model: string): string {
  return model.replace(/^models\//, '');
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
