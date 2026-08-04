import {
  isCompatibleOpenAiAgentModel,
  listOpenAiProviderModels,
} from './providerModels';

type FetchModels = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Compatibility exports for callers built against the original OpenAI-only
 * model discovery module.
 */
export const isCompatibleAgentModel = isCompatibleOpenAiAgentModel;

export async function listOpenAiModels(
  apiKey: string,
  signal?: AbortSignal,
  fetchModels: FetchModels = fetch,
): Promise<string[]> {
  const models = await listOpenAiProviderModels(apiKey, signal, fetchModels);
  return models.map((model) => model.id);
}
