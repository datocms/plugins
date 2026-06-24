import {
  defaultPromptValue,
  translateFieldTypes,
} from '../../../src/entrypoints/Config/configConstants';
import { listRelevantGeminiModels } from '../../../src/utils/translation/GeminiModels';
import { listRelevantOpenAIModels } from '../../../src/utils/translation/OpenAIModels';
import type { ProviderSpec } from '../fixtures/providers';
import { cmaClient } from './cma';
import { requireEnv } from './env';

/** Entry-point URL of the dev build registered as a private plugin. */
const DEV_PLUGIN_URL = 'http://localhost:5173';

/** Display name used for the private plugin install (from package.json datoCmsPlugin.title). */
const PLUGIN_NAME = 'AI Translations';

/** Every editor type the plugin can translate (keys of the shared field-type map). */
const ALL_TRANSLATION_FIELDS = Object.keys(translateFieldTypes);

let cachedPluginId: string | undefined;

/**
 * Find the AI Translations plugin installed in `main`, installing the dev-URL
 * private plugin if it is absent. Plugin ids are stable across forked
 * environments, so the id resolved here is valid in every fork. Memoized.
 */
export const resolvePluginId = async (): Promise<string> => {
  if (cachedPluginId) return cachedPluginId;

  const client = cmaClient();
  const plugins = await client.plugins.list();
  const existing = plugins.find(
    (p) => p.name === PLUGIN_NAME || p.url?.includes('localhost:5173'),
  );
  if (existing) {
    cachedPluginId = existing.id;
    return existing.id;
  }

  const created = await client.plugins.create({
    name: PLUGIN_NAME,
    description: 'E2E dev build (auto-installed by the Playwright suite)',
    url: DEV_PLUGIN_URL,
    permissions: ['currentUserAccessToken'],
  });
  cachedPluginId = created.id;
  return created.id;
};

/** Resolve the top-ranked relevant model for a chat vendor (DeepL has none). */
const resolveModel = async (spec: ProviderSpec, env = requireEnv()): Promise<string> => {
  const key = env[spec.keyEnv] as string;
  switch (spec.vendor) {
    case 'openai':
      return (await listRelevantOpenAIModels(key))[0] ?? '';
    case 'google':
      return (await listRelevantGeminiModels(key))[0] ?? '';
    case 'deepl':
      return '';
  }
};

/** Build the vendor-specific `parameters` block written into a forked env. */
const buildParams = (spec: ProviderSpec, model: string, env = requireEnv()) => {
  const key = env[spec.keyEnv] as string;
  const base = {
    translationFields: ALL_TRANSLATION_FIELDS,
    translateWholeRecord: true,
    translateBulkRecords: true,
    prompt: defaultPromptValue,
    modelsToBeExcludedFromThisPlugin: [] as string[],
    rolesToBeExcludedFromThisPlugin: [] as string[],
    apiKeysToBeExcludedFromThisPlugin: [] as string[],
    enableDebugging: false,
  };
  switch (spec.vendor) {
    case 'openai':
      return { ...base, vendor: 'openai', apiKey: key, gptModel: model };
    case 'google':
      return {
        ...base,
        vendor: 'google',
        apiKey: '',
        gptModel: '',
        googleApiKey: key,
        geminiModel: model,
      };
    case 'deepl':
      return {
        ...base,
        vendor: 'deepl',
        apiKey: '',
        gptModel: '',
        deeplApiKey: key,
        deeplEndpoint: 'auto',
      };
  }
};

/**
 * Pin one forked environment's plugin to a provider by writing its `parameters`
 * (env-scoped update). Resolves the active model dynamically so a deprecated id
 * can never break the run.
 */
export const configureEnvForProvider = async (
  envName: string,
  spec: ProviderSpec,
): Promise<void> => {
  const pluginId = await resolvePluginId();
  const model = await resolveModel(spec);
  await cmaClient(envName).plugins.update(pluginId, { parameters: buildParams(spec, model) });
};
