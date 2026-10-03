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

function uniqueSorted(models: Iterable<string>): string[] {
  return Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));
}

function extractOpenAIModelIds(payload: unknown): string[] {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.data)) {
    throw modelListPaginationError('openai');
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
  provider: DirectAltTextProviderId,
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
    throw modelListPaginationError('anthropic');
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
): Promise<string[]> {
  const models = new Set<string>();
  const seenCursors = new Set<string>();
  let afterId: string | undefined;
  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    const url = new URL(joinApiUrl(baseUrl, 'models'));
    url.searchParams.set('limit', MODEL_LIST_PAGE_SIZE);
    if (afterId) {
      url.searchParams.set('after_id', afterId);
    }
    // biome-ignore lint/performance/noAwaitInLoops: The next page cursor is returned by the preceding page.
    const payload = await fetchProviderJson('anthropic', url.toString(), {
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-version': '2023-06-01',
        'x-api-key': key,
      },
      signal,
    });
    for (const model of extractAnthropicModelIds(payload)) {
      models.add(model);
    }
    const response = asRecord(payload);
    if (response?.has_more === false) {
      return uniqueSorted(models);
    }
    const lastId = response?.last_id;
    if (
      response?.has_more !== true ||
      typeof lastId !== 'string' ||
      !lastId ||
      seenCursors.has(lastId)
    ) {
      throw modelListPaginationError('anthropic');
    }
    seenCursors.add(lastId);
    afterId = lastId;
  }
  throw modelListPaginationError('anthropic');
}

export async function listAnthropicModels(
  apiKey: string,
  signal?: AbortSignal,
  baseUrl = ANTHROPIC_BASE_URL,
): Promise<string[]> {
  const key = requireApiKey('anthropic', apiKey);
  return loadAnthropicModelPages(key, signal, baseUrl);
}

function stripGeminiModelPrefix(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

function extractGeminiModelIds(payload: unknown): string[] {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.models)) {
    throw modelListPaginationError('gemini');
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
): Promise<string[]> {
  const models = new Set<string>();
  const seenCursors = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    const url = new URL(joinApiUrl(baseUrl, 'models'));
    url.searchParams.set('pageSize', MODEL_LIST_PAGE_SIZE);
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    // biome-ignore lint/performance/noAwaitInLoops: The next page cursor is returned by the preceding page.
    const payload = await fetchProviderJson('gemini', url.toString(), {
      headers: { 'x-goog-api-key': key },
      signal,
    });
    for (const model of extractGeminiModelIds(payload)) {
      models.add(model);
    }
    const nextPageToken = asRecord(payload)?.nextPageToken;
    if (
      nextPageToken === undefined ||
      nextPageToken === null ||
      nextPageToken === ''
    ) {
      return uniqueSorted(models);
    }
    if (typeof nextPageToken !== 'string' || seenCursors.has(nextPageToken)) {
      throw modelListPaginationError('gemini');
    }
    seenCursors.add(nextPageToken);
    pageToken = nextPageToken;
  }
  throw modelListPaginationError('gemini');
}

export async function listGeminiModels(
  apiKey: string,
  signal?: AbortSignal,
  baseUrl = GEMINI_BASE_URL,
): Promise<string[]> {
  const key = requireApiKey('gemini', apiKey);
  return loadGeminiModelPages(key, signal, baseUrl);
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
