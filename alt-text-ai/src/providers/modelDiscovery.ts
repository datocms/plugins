import { AltTextProviderError } from './errors';
import { asRecord, fetchProviderJson, joinApiUrl } from './shared';
import type { AltTextProviderId, DirectAltTextProviderId } from './types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_LIST_PAGE_SIZE = '1000';
const MAX_MODEL_LIST_PAGES = 50;

function requireApiKey(
  provider: DirectAltTextProviderId,
  apiKey: string,
): string {
  const normalized = apiKey.trim();
  if (!normalized) {
    throw new AltTextProviderError(
      provider,
      'configuration',
      'API key is required to load models.',
    );
  }
  return normalized;
}

function uniqueSorted(models: string[]): string[] {
  return Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));
}

function extractOpenAIModelIds(payload: unknown): string[] {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.data)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of response.data) {
    const model = asRecord(entry);
    if (typeof model?.id === 'string' && model.id.trim()) {
      ids.push(model.id.trim());
    }
  }
  return ids;
}

export async function listOpenAIModels(
  apiKey: string,
  signal?: AbortSignal,
  baseUrl = OPENAI_BASE_URL,
): Promise<string[]> {
  const key = requireApiKey('openai', apiKey);
  const payload = await fetchProviderJson(
    'openai',
    joinApiUrl(baseUrl, 'models'),
    {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    },
  );

  return uniqueSorted(extractOpenAIModelIds(payload));
}

function modelListPaginationError(
  provider: 'anthropic' | 'gemini',
): AltTextProviderError {
  return new AltTextProviderError(
    provider,
    'invalid_response',
    'The provider returned invalid model-list pagination data.',
  );
}

function extractAnthropicModelIds(payload: unknown): string[] {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.data)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of response.data) {
    const model = asRecord(entry);
    if (typeof model?.id === 'string' && model.id.trim()) {
      ids.push(model.id.trim());
    }
  }
  return ids;
}

async function loadAnthropicModelPages(
  key: string,
  signal: AbortSignal | undefined,
  baseUrl: string,
  afterId?: string,
  page = 1,
): Promise<string[]> {
  if (page > MAX_MODEL_LIST_PAGES) {
    throw modelListPaginationError('anthropic');
  }

  const url = new URL(joinApiUrl(baseUrl, 'models'));
  url.searchParams.set('limit', MODEL_LIST_PAGE_SIZE);
  if (afterId) {
    url.searchParams.set('after_id', afterId);
  }

  const payload = await fetchProviderJson('anthropic', url.toString(), {
    headers: {
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-version': '2023-06-01',
      'x-api-key': key,
    },
    signal,
  });
  const models = extractAnthropicModelIds(payload);
  const response = asRecord(payload);

  if (response?.has_more !== true) {
    return models;
  }

  const lastId = response.last_id;
  if (typeof lastId !== 'string' || !lastId || lastId === afterId) {
    throw modelListPaginationError('anthropic');
  }

  const remainingModels = await loadAnthropicModelPages(
    key,
    signal,
    baseUrl,
    lastId,
    page + 1,
  );
  return [...models, ...remainingModels];
}

export async function listAnthropicModels(
  apiKey: string,
  signal?: AbortSignal,
  baseUrl = ANTHROPIC_BASE_URL,
): Promise<string[]> {
  const key = requireApiKey('anthropic', apiKey);
  return uniqueSorted(await loadAnthropicModelPages(key, signal, baseUrl));
}

function stripGeminiModelPrefix(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

function extractGeminiModelIds(payload: unknown): string[] {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.models)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of response.models) {
    const model = asRecord(entry);
    if (typeof model?.name !== 'string' || !model.name.trim()) {
      continue;
    }

    ids.push(stripGeminiModelPrefix(model.name.trim()));
  }
  return ids;
}

async function loadGeminiModelPages(
  key: string,
  signal: AbortSignal | undefined,
  baseUrl: string,
  pageToken?: string,
  page = 1,
): Promise<string[]> {
  if (page > MAX_MODEL_LIST_PAGES) {
    throw modelListPaginationError('gemini');
  }

  const url = new URL(joinApiUrl(baseUrl, 'models'));
  url.searchParams.set('pageSize', MODEL_LIST_PAGE_SIZE);
  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }

  const payload = await fetchProviderJson('gemini', url.toString(), {
    headers: { 'x-goog-api-key': key },
    signal,
  });
  const models = extractGeminiModelIds(payload);
  const response = asRecord(payload);
  const nextPageToken = response?.nextPageToken;

  if (nextPageToken === undefined || nextPageToken === null) {
    return models;
  }

  if (
    typeof nextPageToken !== 'string' ||
    !nextPageToken ||
    nextPageToken === pageToken
  ) {
    throw modelListPaginationError('gemini');
  }

  const remainingModels = await loadGeminiModelPages(
    key,
    signal,
    baseUrl,
    nextPageToken,
    page + 1,
  );
  return [...models, ...remainingModels];
}

export async function listGeminiModels(
  apiKey: string,
  signal?: AbortSignal,
  baseUrl = GEMINI_BASE_URL,
): Promise<string[]> {
  const key = requireApiKey('gemini', apiKey);
  return uniqueSorted(await loadGeminiModelPages(key, signal, baseUrl));
}

export async function listProviderModels(
  provider: DirectAltTextProviderId,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  switch (provider) {
    case 'openai':
      return listOpenAIModels(apiKey, signal);
    case 'anthropic':
      return listAnthropicModels(apiKey, signal);
    case 'gemini':
      return listGeminiModels(apiKey, signal);
  }
}

export function supportsModelDiscovery(
  provider: AltTextProviderId,
): provider is DirectAltTextProviderId {
  return provider !== 'alttext-ai';
}
