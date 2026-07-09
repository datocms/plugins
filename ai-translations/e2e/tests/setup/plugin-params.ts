import {
  defaultPromptValue,
  translateFieldTypes,
} from '../../../src/entrypoints/Config/configConstants';
import { listRelevantAnthropicModels } from '../../../src/utils/translation/AnthropicModels';
import { listRelevantGeminiModels } from '../../../src/utils/translation/GeminiModels';
import { listRelevantOpenAIModels } from '../../../src/utils/translation/OpenAIModels';
import type { ProviderSpec } from '../fixtures/providers';
import { cmaClient } from './cma';
import { requireEnv } from './env';
import { note, phase } from './log';

/** Entry-point URL of the dev build registered as a private plugin. */
const DEV_PLUGIN_URL = 'http://localhost:5173';

/** Display name used for the private plugin install (from package.json datoCmsPlugin.title). */
const PLUGIN_NAME = 'AI Translations';

/**
 * Editors the suite translates. On the chat lanes we drop `structured_text` and
 * `rich_text`: each expands into many sequential per-node/per-block provider
 * calls, which a rate-limited free-tier provider (Gemini) can't finish within a
 * sane test budget. The retained set still covers the QC paths — placeholders
 * live in json/text/markdown, plus slug + SEO.
 *
 * The DeepL lane keeps EVERY editor: DeepL's batch API is fast and deterministic,
 * so it is the one lane that can prove structured_text / rich_text / single_block
 * (which `isFieldTranslatable` unlocks via `rich_text`) translate end-to-end —
 * the audit's "assert translated editors, not just presence" gap.
 */
const HEAVY_EDITORS = new Set(['structured_text', 'rich_text']);
const ALL_TRANSLATION_FIELDS = Object.keys(translateFieldTypes).filter(
  (editor) => !HEAVY_EDITORS.has(editor),
);
const DEEPL_TRANSLATION_FIELDS = Object.keys(translateFieldTypes);

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
  phase(`installed dev-URL plugin in main (id ${created.id})`);
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
    case 'anthropic':
      return (await listRelevantAnthropicModels(key))[0] ?? '';
    case 'deepl':
      return '';
  }
};

/** Build the vendor-specific `parameters` block written into a forked env. */
const buildParams = (spec: ProviderSpec, model: string, env = requireEnv()) => {
  const key = env[spec.keyEnv] as string;
  const base = {
    translationFields:
      spec.vendor === 'deepl' ? DEEPL_TRANSLATION_FIELDS : ALL_TRANSLATION_FIELDS,
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
    case 'anthropic':
      return {
        ...base,
        vendor: 'anthropic',
        apiKey: '',
        gptModel: '',
        anthropicApiKey: key,
        anthropicModel: model,
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
  note(spec.vendor, 'resolving the active model…');
  const model = await resolveModel(spec);
  await cmaClient(envName).plugins.update(pluginId, { parameters: buildParams(spec, model) });
  note(spec.vendor, `configured ${envName} → ${model || '(DeepL — no model)'}`);
};
