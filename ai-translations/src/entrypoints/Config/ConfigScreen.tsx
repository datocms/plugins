// ConfigScreen.tsx
// ------------------------------------------------------
// The plugin's configuration screen inside DatoCMS: one form with the AI
// vendor, its credentials and model (or its own options), the features, the
// exclusions, and the advanced settings (the translation prompt, the field
// types and the debug logging), then Save. The exclusions and the advanced
// settings open and close; each is open at first when it differs from the
// defaults.
// It renders inside the Canvas that main.tsx puts around every frame hook.
//
// PERF-003: State has been refactored into custom hooks to reduce re-renders:
// - useVendorConfig: Vendor credentials and settings
// - useFeatureToggles: Translation fields and feature flags
// - useExclusionRules: Model/role/field exclusions

import type { ApiTypes } from '@datocms/cma-client-browser';
import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { keepEnterInSelects } from '../../components/BulkTranslations/keepEnterInSelects';
import { defaultPrompt } from '../../prompts/DefaultPrompt';
import { useBusyFocus } from '../../utils/retryFocus';
import { listRelevantAnthropicModels } from '../../utils/translation/AnthropicModels';
import {
  DEEPL_DEFAULT_IGNORE_TAGS,
  DEEPL_DEFAULT_NON_SPLITTING_TAGS,
  DEEPL_DEFAULT_SPLITTING_TAGS,
} from '../../utils/translation/DeepLSettings';
import { listRelevantGeminiModels } from '../../utils/translation/GeminiModels';
import { listRelevantOpenAIModels } from '../../utils/translation/OpenAIModels';
import { getVendorIcon } from '../Sidebar/Components/vendorIcon';
import styles from './Config.module.css';
import {
  getVendorLabel,
  translateFieldTypes,
  VENDORS,
} from './configConstants';
import ExclusionRulesSection, {
  type Field,
  type Role,
  type RolesStatus,
} from './ExclusionRulesSection';
import { useExclusionRules } from './hooks/useExclusionRules';
import { useFeatureToggles } from './hooks/useFeatureToggles';
// PERF-003: Custom hooks for grouped state management
import {
  useVendorConfig,
  type VendorConfigActions,
  type VendorConfigState,
  type VendorType,
} from './hooks/useVendorConfig';
import AnthropicConfig from './VendorConfigs/AnthropicConfig';
import DeepLConfig from './VendorConfigs/DeepLConfig';
import GeminiConfig from './VendorConfigs/GeminiConfig';
import {
  FAILED_MODEL_LIST,
  IDLE_MODEL_LIST,
  LOADING_MODEL_LIST,
  type ModelList,
  type ModelListStatus,
  modelListFrom,
} from './VendorConfigs/ModelSelectField';
// Vendor configuration components
import OpenAIConfig from './VendorConfigs/OpenAIConfig';
import YandexConfig from './VendorConfigs/YandexConfig';

/**
 * The shape of the plugin parameters we store in DatoCMS.
 * These fields are updated on the plugin configuration screen
 * and used throughout the plugin for translation.
 */
export type ctxParamsType = {
  // Vendor selection and credentials
  vendor?: VendorType;
  gptModel: string; // The GPT model used for translations (OpenAI)
  apiKey: string; // The API key used to authenticate with OpenAI
  // Google (Gemini) settings
  googleApiKey?: string;
  geminiModel?: string;
  // Anthropic (Claude) settings
  anthropicApiKey?: string;
  anthropicModel?: string;
  // DeepL settings
  deeplApiKey?: string;
  deeplEndpoint?: 'auto' | 'pro' | 'free';
  deeplUseFree?: boolean;
  deeplFormality?: 'default' | 'more' | 'less';
  deeplPreserveFormatting?: boolean;
  deeplIgnoreTags?: string;
  deeplNonSplittingTags?: string;
  deeplSplittingTags?: string;
  // DeepL glossary settings
  deeplGlossaryId?: string; // default glossary id (optional)
  deeplGlossaryPairs?: string; // per-pair mapping text (optional)
  // Yandex Translate settings
  yandexApiKey?: string;
  yandexFolderId?: string;
  translationFields: string[]; // List of field editor types that can be translated
  translateWholeRecord: boolean; // Whether to allow entire record translation
  translateBulkRecords: boolean; // Whether to allow bulk records translation in tabular view
  prompt: string; // The prompt template used by the translation logic
  modelsToBeExcludedFromThisPlugin: string[]; // List of model API keys to exclude from translation
  rolesToBeExcludedFromThisPlugin: string[]; // List of role IDs to exclude from translation
  apiKeysToBeExcludedFromThisPlugin: string[]; // List of API keys to exclude from translation
  enableDebugging: boolean; // Whether to enable detailed console logging for debugging
};

/**
 * Valid vendor identifiers for the plugin.
 */
const VALID_VENDORS = [
  'openai',
  'google',
  'anthropic',
  'deepl',
  'yandex',
] as const;

/**
 * Type guard to validate plugin parameters at runtime.
 * Ensures the parameters object conforms to ctxParamsType shape.
 *
 * This should be used when extracting plugin parameters from the SDK context
 * to ensure type safety without using unsafe casts.
 *
 * @param obj - Unknown object to validate
 * @returns True if obj conforms to ctxParamsType
 */
export function isValidCtxParams(obj: unknown): obj is ctxParamsType {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;

  // Required string fields
  if (typeof p.gptModel !== 'string') return false;
  if (typeof p.apiKey !== 'string') return false;
  if (typeof p.prompt !== 'string') return false;

  // Required boolean fields
  if (typeof p.translateWholeRecord !== 'boolean') return false;
  if (typeof p.enableDebugging !== 'boolean') return false;

  // Required array fields
  if (!Array.isArray(p.translationFields)) return false;
  if (!Array.isArray(p.modelsToBeExcludedFromThisPlugin)) return false;
  if (!Array.isArray(p.rolesToBeExcludedFromThisPlugin)) return false;
  if (!Array.isArray(p.apiKeysToBeExcludedFromThisPlugin)) return false;

  // Vendor must be valid if present
  if (
    p.vendor !== undefined &&
    !VALID_VENDORS.includes(p.vendor as (typeof VALID_VENDORS)[number])
  ) {
    return false;
  }

  return true;
}

// Note: translateFieldTypes and modularContentVariations are in ./configConstants
// Import them directly from that file instead of re-exporting through here.

/**
 * Fetches the list of available models from OpenAI using the provided API key.
 * It sets the state of the model list (the models, none, or a failure).
 *
 * @param apiKey - Your OpenAI API key
 * @param setModelList - Callback to set the state of the model list
 * @param setGptModel - Callback to set the selected model (auto-selects first if none set)
 * @param currentModel - The currently selected model
 */
async function fetchAvailableModels(
  apiKey: string,
  setModelList: (list: ModelList) => void,
  setGptModel: (model: string) => void,
  currentModel: string,
) {
  try {
    const models = await listRelevantOpenAIModels(apiKey);
    setModelList(modelListFrom(models));
    // Auto-select first model if none currently selected
    if (models.length > 0 && (currentModel === 'None' || !currentModel)) {
      setGptModel(models[0]);
    }
  } catch (error) {
    console.error('Error fetching OpenAI models:', error);
    setModelList(FAILED_MODEL_LIST);
    setGptModel('None');
  }
}

/**
 * Fetches available Gemini models for the Google vendor and updates state accordingly.
 * Extracted from the component's useEffect to reduce cognitive complexity of the callback.
 *
 * @param vendor - Currently selected vendor (returns early if not 'google').
 * @param googleApiKey - Google API key; if empty, the list is idle.
 * @param setGeminiModelList - State setter for the Gemini model list.
 * @param setGeminiModel - State setter to auto-select the first model when none is set.
 * @param savedGeminiModel - The geminiModel value saved in pluginParams (used to detect auto-select).
 */
async function loadGeminiModels(
  vendor: string,
  googleApiKey: string,
  setGeminiModelList: (list: ModelList) => void,
  setGeminiModel: (model: string) => void,
  savedGeminiModel: string | undefined,
): Promise<void> {
  if (vendor !== 'google') return;
  if (!googleApiKey) {
    setGeminiModelList(IDLE_MODEL_LIST);
    return;
  }
  setGeminiModelList(LOADING_MODEL_LIST);
  try {
    const models = await listRelevantGeminiModels(googleApiKey);
    setGeminiModelList(modelListFrom(models));
    if (models.length > 0 && !savedGeminiModel) {
      setGeminiModel(models[0]);
    }
  } catch (e) {
    console.error('Error fetching Gemini models:', e);
    setGeminiModelList(FAILED_MODEL_LIST);
  }
}

/**
 * Fetches available Anthropic models for the Anthropic vendor and updates state accordingly.
 * Extracted from the component's useEffect to reduce cognitive complexity of the callback.
 *
 * @param vendor - Currently selected vendor (returns early if not 'anthropic').
 * @param anthropicApiKey - Anthropic API key; if empty, the list is idle.
 * @param setAnthropicModelList - State setter for the Anthropic model list.
 * @param setAnthropicModel - State setter to auto-select the first model when none is set.
 * @param savedAnthropicModel - The anthropicModel value saved in pluginParams (used to detect auto-select).
 */
async function loadClaudeModels(
  vendor: string,
  anthropicApiKey: string,
  setAnthropicModelList: (list: ModelList) => void,
  setAnthropicModel: (model: string) => void,
  savedAnthropicModel: string | undefined,
): Promise<void> {
  if (vendor !== 'anthropic') return;
  if (!anthropicApiKey) {
    setAnthropicModelList(IDLE_MODEL_LIST);
    return;
  }
  setAnthropicModelList(LOADING_MODEL_LIST);
  try {
    const models = await listRelevantAnthropicModels(anthropicApiKey);
    setAnthropicModelList(modelListFrom(models));
    if (models.length > 0 && !savedAnthropicModel) {
      setAnthropicModel(models[0]);
    }
  } catch (e) {
    console.error('Error fetching Claude models:', e);
    setAnthropicModelList(FAILED_MODEL_LIST);
  }
}

/**
 * Merges newly loaded field definitions into the existing list without duplicates.
 * Extracted to reduce the cognitive complexity of the `useEffect` callback
 * inside `ConfigScreen` that loads item type fields.
 *
 * @param prevFields - Currently accumulated field list.
 * @param newFields - Newly fetched fields to merge in.
 * @returns The merged field list with no duplicate IDs.
 */
function mergeUniqueFields(prevFields: Field[], newFields: Field[]): Field[] {
  const existingIds = new Set(prevFields.map((field) => field.id));
  const uniqueNewFields = newFields.filter(
    (field) => !existingIds.has(field.id),
  );
  return [...prevFields, ...uniqueNewFields];
}

/**
 * Parameters for the updatePluginParams function.
 */
type UpdatePluginParamsArgs = {
  ctx: RenderConfigScreenCtx;
  params: Partial<ctxParamsType>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
};

/**
 * Persists the updated plugin parameters to DatoCMS.
 * If successful, displays a success message; otherwise, alerts the user of an error.
 *
 * @param args - Object containing ctx, params, and setIsSaving
 */
const updatePluginParams = async ({
  ctx,
  params,
  setIsSaving,
}: UpdatePluginParamsArgs) => {
  setIsSaving(true);
  try {
    await ctx.updatePluginParameters(params);
    ctx.notice('Settings saved.');
  } catch (error) {
    console.error('Error updating plugin parameters:', error);
    ctx.alert("Couldn't save the settings. Try again.");
  } finally {
    setIsSaving(false);
  }
};

/**
 * Determines whether the vendor-specific credentials are incomplete,
 * which would prevent saving the configuration.
 *
 * @param credentials - Currently selected vendor and its credential fields.
 * @returns True if credentials are missing for the current vendor.
 */
export function isVendorCredentialsMissing(credentials: {
  vendor: VendorType;
  apiKey: string;
  gptModel: string;
  googleApiKey: string;
  geminiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  deeplApiKey: string;
  yandexApiKey: string;
}): boolean {
  const {
    vendor,
    apiKey,
    gptModel,
    googleApiKey,
    geminiModel,
    anthropicApiKey,
    anthropicModel,
    deeplApiKey,
    yandexApiKey,
  } = credentials;

  if (vendor === 'openai') return gptModel === 'None' || !apiKey;
  if (vendor === 'google') return !googleApiKey || !geminiModel;
  if (vendor === 'anthropic') return !anthropicApiKey || !anthropicModel;
  if (vendor === 'deepl') return !deeplApiKey;
  if (vendor === 'yandex') return !yandexApiKey.trim();
  return false;
}

/** Returns true for vendors that translate through a native API, not a prompt. */
export function isNativeTranslationVendor(vendor: VendorType): boolean {
  return vendor === 'deepl' || vendor === 'yandex';
}

/**
 * Determines whether the form is in the default (all-defaults) configuration.
 * Used to disable "Restore defaults" when the settings already use them.
 *
 * @param translationFields - Currently selected translation field types.
 * @param translateWholeRecord - Whether whole-record translation is enabled.
 * @param translateBulkRecords - Whether bulk-records translation is enabled.
 * @param prompt - Current translation prompt.
 * @param modelsToBeExcluded - Currently excluded model API keys.
 * @param rolesToBeExcluded - Currently excluded role IDs.
 * @param apiKeysToBeExcluded - Currently excluded field API keys.
 * @returns True if all settings are at their default values.
 */
function isDefaultConfiguration(
  translationFields: string[],
  translateWholeRecord: boolean,
  translateBulkRecords: boolean,
  prompt: string,
  modelsToBeExcluded: string[],
  rolesToBeExcluded: string[],
  apiKeysToBeExcluded: string[],
): boolean {
  return (
    [...translationFields].sort().join(',') ===
      Object.keys(translateFieldTypes).sort().join(',') &&
    translateWholeRecord === true &&
    translateBulkRecords === true &&
    prompt === defaultPrompt &&
    modelsToBeExcluded.length === 0 &&
    rolesToBeExcluded.length === 0 &&
    apiKeysToBeExcluded.length === 0
  );
}

type VendorCredentials = Parameters<typeof isVendorCredentialsMissing>[0];

const API_KEY_REASONS: Record<VendorType, string> = {
  openai: 'Enter the OpenAI API key.',
  google: 'Enter the Google API key.',
  anthropic: 'Enter the Anthropic API key.',
  deepl: 'Enter the DeepL API key.',
  yandex: 'Enter the Yandex API key.',
};

/**
 * Why no model can be picked when the list of models has none: the same
 * problem that the model field shows, said as what to do.
 */
const NO_MODEL_REASONS: Partial<Record<ModelListStatus, string>> = {
  error: "Check the API key: the models couldn't be loaded.",
  empty: 'Use an API key that can use one of the supported models.',
};

/**
 * Why the selected vendor can't be saved yet: its API key, or else its model.
 * It gives a reason exactly when `isVendorCredentialsMissing` is true. The
 * model reason follows the state of the vendor's model list: "Pick a model"
 * only when there are models (or they are loading), since a failed or empty
 * list has nothing to pick.
 *
 * @param credentials - Currently selected vendor and its credential fields.
 * @param modelListStatus - The state of the selected vendor's model list,
 *   for the vendors that have one.
 * @returns The reason, as a full sentence, or undefined.
 */
function missingCredentialReason(
  credentials: VendorCredentials,
  modelListStatus?: ModelListStatus,
): string | undefined {
  if (!isVendorCredentialsMissing(credentials)) return undefined;
  const apiKeys: Record<VendorType, string> = {
    openai: credentials.apiKey,
    google: credentials.googleApiKey,
    anthropic: credentials.anthropicApiKey,
    deepl: credentials.deeplApiKey,
    yandex: credentials.yandexApiKey.trim(),
  };
  if (!apiKeys[credentials.vendor]) return API_KEY_REASONS[credentials.vendor];
  return (
    (modelListStatus && NO_MODEL_REASONS[modelListStatus]) ?? 'Pick a model.'
  );
}

/**
 * Why Save is off: a missing credential first (it says what to do), then no
 * change. Nothing while it saves (the button is busy instead).
 */
function saveDisabledReason(
  credentialReason: string | undefined,
  isFormDirty: boolean,
): { reason: string } | undefined {
  if (credentialReason) return { reason: credentialReason };
  if (!isFormDirty) return { reason: 'There are no changes to save.' };
  return undefined;
}

/**
 * Arguments for the checkFormDirty function.
 * Groups all current config state and saved params needed to detect changes.
 */
type CheckFormDirtyArgs = {
  vendor: VendorType;
  apiKey: string;
  googleApiKey: string;
  geminiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  gptModel: string;
  deeplUseFree: boolean;
  deeplFormality: string;
  deeplPreserveFormatting: boolean;
  deeplIgnoreTags: string;
  deeplNonSplittingTags: string;
  deeplSplittingTags: string;
  deeplApiKey: string;
  deeplGlossaryId: string;
  deeplGlossaryPairs: string;
  yandexApiKey: string;
  yandexFolderId: string;
  translationFields: string[];
  translateWholeRecord: boolean;
  translateBulkRecords: boolean;
  prompt: string;
  enableDebugging: boolean;
  modelsToBeExcluded: string[];
  rolesToBeExcluded: string[];
  apiKeysToBeExcluded: string[];
  pluginParams: ctxParamsType;
  normalizeList: (list?: string[]) => string;
};

/**
 * Determines whether the config form has unsaved changes by comparing all
 * current state values against the persisted plugin parameters.
 * Extracted as a module-level function to keep `isFormDirty` useMemo
 * under the cognitive complexity threshold.
 *
 * @param args - All current state and saved params needed for comparison.
 * @returns True if any config value differs from what is saved.
 */
function checkFormDirty(args: CheckFormDirtyArgs): boolean {
  const {
    vendor,
    apiKey,
    googleApiKey,
    geminiModel,
    anthropicApiKey,
    anthropicModel,
    gptModel,
    deeplUseFree,
    deeplFormality,
    deeplPreserveFormatting,
    deeplIgnoreTags,
    deeplNonSplittingTags,
    deeplSplittingTags,
    deeplApiKey,
    deeplGlossaryId,
    deeplGlossaryPairs,
    yandexApiKey,
    yandexFolderId,
    translationFields,
    translateWholeRecord,
    translateBulkRecords,
    prompt,
    enableDebugging,
    modelsToBeExcluded,
    rolesToBeExcluded,
    apiKeysToBeExcluded,
    pluginParams,
    normalizeList,
  } = args;

  const sortedSelectedFields = [...translationFields].sort().join(',');
  const sortedConfiguredFields = pluginParams.translationFields
    ? [...pluginParams.translationFields].sort().join(',')
    : Object.keys(translateFieldTypes).sort().join(',');

  const isVendorDirty = checkVendorCredentialsDirty(
    {
      vendor,
      apiKey,
      googleApiKey,
      geminiModel,
      anthropicApiKey,
      anthropicModel,
      gptModel,
      yandexApiKey,
      yandexFolderId,
    },
    pluginParams,
  );
  const isDeepLDirty = checkDeepLConfigDirty(
    {
      deeplUseFree,
      deeplFormality,
      deeplPreserveFormatting,
      deeplIgnoreTags,
      deeplNonSplittingTags,
      deeplSplittingTags,
      deeplApiKey,
      deeplGlossaryId,
      deeplGlossaryPairs,
    },
    pluginParams,
  );
  const isFeaturesDirty =
    sortedSelectedFields !== sortedConfiguredFields ||
    translateWholeRecord !== (pluginParams.translateWholeRecord ?? true) ||
    translateBulkRecords !== (pluginParams.translateBulkRecords ?? true) ||
    prompt !== (pluginParams.prompt ?? defaultPrompt) ||
    enableDebugging !== (pluginParams.enableDebugging ?? false);
  const isExclusionsDirty =
    [...modelsToBeExcluded].sort().join(',') !==
      normalizeList(pluginParams.modelsToBeExcludedFromThisPlugin) ||
    [...rolesToBeExcluded].sort().join(',') !==
      normalizeList(pluginParams.rolesToBeExcludedFromThisPlugin) ||
    [...apiKeysToBeExcluded].sort().join(',') !==
      normalizeList(pluginParams.apiKeysToBeExcludedFromThisPlugin);

  return isVendorDirty || isDeepLDirty || isFeaturesDirty || isExclusionsDirty;
}

function checkVendorCredentialsDirty(
  current: {
    vendor: VendorType;
    apiKey: string;
    googleApiKey: string;
    geminiModel: string;
    anthropicApiKey: string;
    anthropicModel: string;
    gptModel: string;
    yandexApiKey: string;
    yandexFolderId: string;
  },
  saved: ctxParamsType,
): boolean {
  return (
    current.vendor !== (saved.vendor ?? 'openai') ||
    current.apiKey !== (saved.apiKey ?? '') ||
    current.googleApiKey !== (saved.googleApiKey ?? '') ||
    current.geminiModel !== (saved.geminiModel ?? 'gemini-2.5-flash') ||
    current.anthropicApiKey !== (saved.anthropicApiKey ?? '') ||
    current.anthropicModel !==
      (saved.anthropicModel ?? 'claude-haiku-4-5-latest') ||
    current.gptModel !== (saved.gptModel ?? 'None') ||
    current.yandexApiKey !== (saved.yandexApiKey ?? '') ||
    current.yandexFolderId.trim() !== (saved.yandexFolderId?.trim() ?? '')
  );
}

function checkDeepLConfigDirty(
  current: {
    deeplUseFree: boolean;
    deeplFormality: string;
    deeplPreserveFormatting: boolean;
    deeplIgnoreTags: string;
    deeplNonSplittingTags: string;
    deeplSplittingTags: string;
    deeplApiKey: string;
    deeplGlossaryId: string;
    deeplGlossaryPairs: string;
  },
  saved: ctxParamsType,
): boolean {
  return (
    current.deeplUseFree !== (saved.deeplUseFree ?? false) ||
    current.deeplFormality !== (saved.deeplFormality ?? 'default') ||
    current.deeplPreserveFormatting !==
      (saved.deeplPreserveFormatting ?? true) ||
    current.deeplIgnoreTags !==
      (saved.deeplIgnoreTags ?? DEEPL_DEFAULT_IGNORE_TAGS) ||
    current.deeplNonSplittingTags !==
      (saved.deeplNonSplittingTags ?? DEEPL_DEFAULT_NON_SPLITTING_TAGS) ||
    current.deeplSplittingTags !==
      (saved.deeplSplittingTags ?? DEEPL_DEFAULT_SPLITTING_TAGS) ||
    current.deeplApiKey !== (saved.deeplApiKey ?? '') ||
    current.deeplGlossaryId !== (saved.deeplGlossaryId ?? '') ||
    current.deeplGlossaryPairs !== (saved.deeplGlossaryPairs ?? '')
  );
}

/** What each vendor is and needs, under its name in the vendor choice. */
const VENDOR_HINTS: Record<VendorType, string> = {
  openai: 'GPT models with an editable prompt. Needs an OpenAI API key.',
  google: 'Gemini models with an editable prompt. Needs a Google API key.',
  anthropic:
    'Claude models with an editable prompt. Needs an Anthropic API key.',
  deepl:
    'Machine translation with formality and glossaries. Needs a DeepL API key.',
  yandex: 'Machine translation. Needs a Yandex Cloud API key.',
};

/** The logo of a vendor, at the end of its option. */
function VendorLogo({ vendor }: { vendor: VendorType }) {
  const Logo = getVendorIcon(vendor);
  return <Logo />;
}

const VENDOR_OPTIONS: RadioGroupOption<VendorType>[] = VENDORS.map(
  (vendor) => ({
    value: vendor,
    label: getVendorLabel(vendor),
    hint: VENDOR_HINTS[vendor],
    icon: <VendorLogo vendor={vendor} />,
  }),
);

const FIELD_TYPE_OPTIONS = Object.entries(translateFieldTypes).map(
  ([value, label]) => ({ value, label }),
);

/** A saved field type that the plugin no longer lists shows as its key. */
function savedFieldTypeOption(value: string) {
  return { value, label: value };
}

const noFieldTypes = () => 'No field types';

/** The default prompt is long: past this height, the prompt scrolls. */
const PROMPT_MAX_ROWS = 20;

/**
 * The prompt isn't required: an empty prompt translates with the default one
 * (translateArray falls back to it, and onBoot fills it in again), so the
 * hint says so instead of the field claiming a rule it never reports.
 */
const PROMPT_HINT =
  'Use {fieldValue}, {fromLocale} and {toLocale} for the content and the languages, or leave it empty for the default prompt. A change can break translations, so edit it with care.';

type VendorSettingsProps = {
  vendorConfig: VendorConfigState;
  vendorActions: VendorConfigActions;
  modelLists: Record<'openai' | 'google' | 'anthropic', ModelList>;
  siteLocales: ApiTypes.Site['locales'];
  /** The toast of a finished action, such as a passed credentials test. */
  notice: RenderConfigScreenCtx['notice'];
};

/** The settings section of the selected vendor. */
function VendorSettings({
  vendorConfig,
  vendorActions,
  modelLists,
  siteLocales,
  notice,
}: VendorSettingsProps) {
  switch (vendorConfig.vendor) {
    case 'openai':
      return (
        <OpenAIConfig
          apiKey={vendorConfig.apiKey}
          setApiKey={vendorActions.setApiKey}
          gptModel={vendorConfig.gptModel}
          setGptModel={vendorActions.setGptModel}
          modelList={modelLists.openai}
        />
      );
    case 'google':
      return (
        <GeminiConfig
          googleApiKey={vendorConfig.googleApiKey}
          setGoogleApiKey={vendorActions.setGoogleApiKey}
          geminiModel={vendorConfig.geminiModel}
          setGeminiModel={vendorActions.setGeminiModel}
          modelList={modelLists.google}
        />
      );
    case 'anthropic':
      return (
        <AnthropicConfig
          anthropicApiKey={vendorConfig.anthropicApiKey}
          setAnthropicApiKey={vendorActions.setAnthropicApiKey}
          anthropicModel={vendorConfig.anthropicModel}
          setAnthropicModel={vendorActions.setAnthropicModel}
          modelList={modelLists.anthropic}
        />
      );
    case 'deepl':
      return (
        <DeepLConfig
          deeplApiKey={vendorConfig.deeplApiKey}
          setDeeplApiKey={vendorActions.setDeeplApiKey}
          deeplUseFree={vendorConfig.deeplUseFree}
          setDeeplUseFree={vendorActions.setDeeplUseFree}
          deeplFormality={vendorConfig.deeplFormality}
          setDeeplFormality={vendorActions.setDeeplFormality}
          deeplPreserveFormatting={vendorConfig.deeplPreserveFormatting}
          setDeeplPreserveFormatting={vendorActions.setDeeplPreserveFormatting}
          deeplIgnoreTags={vendorConfig.deeplIgnoreTags}
          setDeeplIgnoreTags={vendorActions.setDeeplIgnoreTags}
          deeplNonSplittingTags={vendorConfig.deeplNonSplittingTags}
          setDeeplNonSplittingTags={vendorActions.setDeeplNonSplittingTags}
          deeplSplittingTags={vendorConfig.deeplSplittingTags}
          setDeeplSplittingTags={vendorActions.setDeeplSplittingTags}
          deeplGlossaryId={vendorConfig.deeplGlossaryId}
          setDeeplGlossaryId={vendorActions.setDeeplGlossaryId}
          deeplGlossaryPairs={vendorConfig.deeplGlossaryPairs}
          setDeeplGlossaryPairs={vendorActions.setDeeplGlossaryPairs}
          siteLocales={siteLocales}
          notice={notice}
        />
      );
    default:
      return (
        <YandexConfig
          yandexApiKey={vendorConfig.yandexApiKey}
          setYandexApiKey={vendorActions.setYandexApiKey}
          yandexFolderId={vendorConfig.yandexFolderId}
          setYandexFolderId={vendorActions.setYandexFolderId}
          notice={notice}
        />
      );
  }
}

/**
 * Whether the saved advanced settings differ from the defaults: a prompt of
 * their own, other field types, or the debug logging. Then the "Advanced"
 * section is open at first.
 */
function hasCustomAdvancedSettings(pluginParams: ctxParamsType): boolean {
  const fields = Array.isArray(pluginParams.translationFields)
    ? pluginParams.translationFields
    : Object.keys(translateFieldTypes);
  return (
    (!!pluginParams.prompt && pluginParams.prompt !== defaultPrompt) ||
    [...fields].sort().join(',') !==
      Object.keys(translateFieldTypes).sort().join(',') ||
    pluginParams.enableDebugging === true
  );
}

/**
 * Main config screen component: one form with the vendor, then the sections
 * of its settings, the features, the exclusions and the advanced settings,
 * with Save after the last section.
 *
 * @param props - Contains the RenderConfigScreenCtx from DatoCMS
 */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  // Retrieve existing plugin params or use defaults if not set
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;

  // PERF-003: Use custom hooks to group related state and reduce re-renders
  const [vendorConfig, vendorActions] = useVendorConfig(pluginParams);
  const [featureToggles, featureActions] = useFeatureToggles(
    pluginParams,
    defaultPrompt,
  );
  const [exclusionRules, exclusionActions] = useExclusionRules(pluginParams);

  // Destructure for easier access (maintains backward compatibility with rest of component)
  const {
    vendor,
    apiKey,
    gptModel,
    googleApiKey,
    geminiModel,
    anthropicApiKey,
    anthropicModel,
    deeplApiKey,
    deeplUseFree,
    deeplFormality,
    deeplPreserveFormatting,
    deeplIgnoreTags,
    deeplNonSplittingTags,
    deeplSplittingTags,
    deeplGlossaryId,
    deeplGlossaryPairs,
    yandexApiKey,
    yandexFolderId,
  } = vendorConfig;
  const { setVendor, setGptModel, setGeminiModel, setAnthropicModel } =
    vendorActions;

  const {
    translationFields,
    translateWholeRecord,
    translateBulkRecords,
    prompt,
    enableDebugging,
  } = featureToggles;
  const {
    setTranslationFields,
    setTranslateWholeRecord,
    setTranslateBulkRecords,
    setPrompt,
    setEnableDebugging,
  } = featureActions;

  const {
    modelsToBeExcluded,
    rolesToBeExcluded,
    apiKeysToBeExcluded,
    showExclusionRules,
  } = exclusionRules;
  const {
    setModelsToBeExcluded,
    setRolesToBeExcluded,
    setApiKeysToBeExcluded,
    setShowExclusionRules,
  } = exclusionActions;

  // Performance concurrency is now fully automatic; no user setting.

  // The advanced settings are rarely changed: closed unless they differ from
  // the defaults.
  const [showAdvanced, setShowAdvanced] = useState(() =>
    hasCustomAdvancedSettings(pluginParams),
  );

  // Save operation state
  const [isSaving, setIsSaving] = useState(false);
  // Save is found by its id, not a ref: while it is disabled with a reason,
  // the kit's tooltip clones it and reads `element.ref`, which React 19
  // warns about.
  const saveId = useId();
  // OpenAI model requests: only the latest one updates the state
  const modelListRequestId = useRef(0);
  const latestGptModel = useRef(gptModel);

  // The models of each LLM vendor, loaded with its API key
  const [openAIModels, setOpenAIModels] = useState<ModelList>(IDLE_MODEL_LIST);
  const [geminiModels, setGeminiModels] = useState<ModelList>(IDLE_MODEL_LIST);
  const [anthropicModels, setAnthropicModels] =
    useState<ModelList>(IDLE_MODEL_LIST);

  const [listOfFields, setListOfFields] = useState<Field[]>([]);
  // True while the field loads of the current schema are in flight, so the
  // "Excluded fields" select shows that its labels are still coming.
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const { itemTypes, loadItemTypeFields } = ctx;

  useEffect(() => {
    latestGptModel.current = gptModel;
  }, [gptModel]);

  useEffect(() => {
    let active = true;
    setListOfFields([]);

    const loads = Object.entries(itemTypes).filter(([, itemType]) =>
      Boolean(itemType),
    );
    let pendingLoads = loads.length;
    setFieldsLoading(pendingLoads > 0);
    const settleLoad = () => {
      if (!active) return;
      pendingLoads -= 1;
      if (pendingLoads === 0) setFieldsLoading(false);
    };

    for (const [itemTypeID, itemType] of loads) {
      if (!itemType) continue;

      loadItemTypeFields(itemTypeID)
        .then((fields) => {
          if (!active) return;
          const modelName = itemType.attributes.name;
          const newFields = fields.map((field) => ({
            id: field.id,
            name: field.attributes.label,
            apiKey: field.attributes.api_key,
            model: itemType.attributes.modular_block
              ? `${modelName} block`
              : modelName,
          }));
          setListOfFields((prevFields) =>
            mergeUniqueFields(prevFields, newFields),
          );
        })
        .catch((error) => {
          if (!active) return;
          console.error(
            `Failed to load fields for item type ${itemTypeID}:`,
            error,
          );
        })
        .finally(settleLoad);
    }

    return () => {
      active = false;
    };
  }, [itemTypes, loadItemTypeFields]);

  /**
   * When the user updates or removes the API key, we refetch the model list.
   * Without an API key, the list is idle and no model is selected.
   */
  useEffect(() => {
    modelListRequestId.current += 1;
    const requestId = modelListRequestId.current;
    const isLatest = () => modelListRequestId.current === requestId;

    if (vendor !== 'openai') {
      // A request that the vendor change abandoned leaves no spinner behind.
      setOpenAIModels((list) =>
        list.status === 'loading' ? IDLE_MODEL_LIST : list,
      );
      return;
    }

    if (!apiKey) {
      setOpenAIModels(IDLE_MODEL_LIST);
      setGptModel('None');
      return;
    }

    setOpenAIModels(LOADING_MODEL_LIST);

    fetchAvailableModels(
      apiKey,
      (list) => {
        if (isLatest()) setOpenAIModels(list);
      },
      (model) => {
        if (isLatest()) setGptModel(model);
      },
      latestGptModel.current,
    ).catch(console.error);
  }, [apiKey, vendor, setGptModel]);

  // Load Gemini models dynamically when Google vendor + key
  useEffect(() => {
    let active = true;
    loadGeminiModels(
      vendor,
      googleApiKey,
      (list) => {
        if (active) setGeminiModels(list);
      },
      (model) => {
        if (active) setGeminiModel(model);
      },
      pluginParams.geminiModel,
    ).catch(console.error);
    return () => {
      active = false;
    };
  }, [vendor, googleApiKey, pluginParams.geminiModel, setGeminiModel]);

  // Load Anthropic models dynamically when Anthropic vendor + key
  useEffect(() => {
    let active = true;
    loadClaudeModels(
      vendor,
      anthropicApiKey,
      (list) => {
        if (active) setAnthropicModels(list);
      },
      (model) => {
        if (active) setAnthropicModel(model);
      },
      pluginParams.anthropicModel,
    ).catch(console.error);
    return () => {
      active = false;
    };
  }, [vendor, anthropicApiKey, pluginParams.anthropicModel, setAnthropicModel]);

  const normalizeList = useCallback((list?: string[]) => {
    return Array.isArray(list) ? [...list].sort().join(',') : '';
  }, []);

  /**
   * Checks if the user has changed any of the config fields,
   * so we can enable or disable the "Save" button accordingly.
   *
   * DESIGN DECISION: This useMemo has a large dependency array (~45 items)
   * which is intentional. Breaking this into smaller memos was considered but rejected:
   *
   * 1. Each field comparison depends on both current state AND saved pluginParams
   * 2. Splitting would require passing partial dirty states between memos
   * 3. The performance impact is negligible (simple value comparisons, not expensive ops)
   * 4. Having all dirty checks in one place improves maintainability
   * 5. React's dependency tracking handles this efficiently
   *
   * If this becomes a maintenance burden, consider extracting comparison logic into
   * a utility function that takes (currentState, savedParams) and returns boolean.
   */
  const isFormDirty = useMemo(
    () =>
      checkFormDirty({
        vendor,
        apiKey,
        googleApiKey,
        geminiModel,
        anthropicApiKey,
        anthropicModel,
        gptModel,
        deeplUseFree,
        deeplFormality,
        deeplPreserveFormatting,
        deeplIgnoreTags,
        deeplNonSplittingTags,
        deeplSplittingTags,
        deeplApiKey,
        deeplGlossaryId,
        deeplGlossaryPairs,
        yandexApiKey,
        yandexFolderId,
        translationFields,
        translateWholeRecord,
        translateBulkRecords,
        prompt,
        enableDebugging,
        modelsToBeExcluded,
        rolesToBeExcluded,
        apiKeysToBeExcluded,
        pluginParams,
        normalizeList,
      }),
    [
      vendor,
      apiKey,
      googleApiKey,
      geminiModel,
      anthropicApiKey,
      anthropicModel,
      gptModel,
      translationFields,
      translateWholeRecord,
      translateBulkRecords,
      prompt,
      deeplUseFree,
      deeplFormality,
      deeplPreserveFormatting,
      deeplIgnoreTags,
      deeplNonSplittingTags,
      deeplSplittingTags,
      deeplApiKey,
      deeplGlossaryId,
      deeplGlossaryPairs,
      yandexApiKey,
      yandexFolderId,
      modelsToBeExcluded,
      rolesToBeExcluded,
      apiKeysToBeExcluded,
      enableDebugging,
      normalizeList,
      pluginParams,
    ],
  );

  const availableModels = useMemo(() => {
    return Object.entries(ctx.itemTypes)
      .map(([_key, value]) => {
        return {
          apiKey: value?.attributes.api_key,
          name: value?.attributes.name,
          isBlock: value?.attributes.modular_block,
        };
      })
      .filter((item) => !item.isBlock);
  }, [ctx.itemTypes]);

  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesStatus, setRolesStatus] = useState<RolesStatus>('loading');
  const [siteLocales] = useState<ApiTypes.Site['locales']>(
    ctx.site.attributes.locales,
  );

  useEffect(() => {
    let active = true;
    setRolesStatus('loading');
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken as string,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
    client.roles
      .list()
      .then((roles) => {
        if (!active) return;
        setRoles(roles.map((role) => ({ id: role.id, name: role.name })));
        setRolesStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load the roles:', error);
        setRolesStatus('error');
      });
    return () => {
      active = false;
    };
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

  const modelListStatuses: Partial<Record<VendorType, ModelListStatus>> = {
    openai: openAIModels.status,
    google: geminiModels.status,
    anthropic: anthropicModels.status,
  };
  const credentialReason = missingCredentialReason(
    {
      vendor,
      apiKey,
      gptModel,
      googleApiKey,
      geminiModel,
      anthropicApiKey,
      anthropicModel,
      deeplApiKey,
      yandexApiKey,
    },
    modelListStatuses[vendor],
  );
  const saveDisabled = saveDisabledReason(credentialReason, isFormDirty);
  // While Save is busy it is disabled, which drops its focus: once the save
  // ends, Save takes it back. After a failure (the host's alert) it is
  // enabled again; after a success it is disabled with a reason, which keeps
  // the focus and tells why. A save never fails on a field (the errors of
  // the fields don't block it), so no field takes the focus instead. Enter
  // in a field submits too, and leaves the focus in that field.
  const followSave = useBusyFocus(
    isSaving,
    () => document.getElementById(saveId),
    saveDisabled?.reason,
  );
  const isRestoreDefaultsButtonDisabled = isDefaultConfiguration(
    translationFields,
    translateWholeRecord,
    translateBulkRecords,
    prompt,
    modelsToBeExcluded,
    rolesToBeExcluded,
    apiKeysToBeExcluded,
  );

  // Changes the form only: Save applies the defaults.
  const restoreDefaults = () => {
    setVendor('openai');
    // The first loaded OpenAI model, or no model
    setGptModel(
      openAIModels.status === 'ready'
        ? (openAIModels.models[0] ?? 'None')
        : 'None',
    );
    setTranslationFields(Object.keys(translateFieldTypes));
    setTranslateWholeRecord(true);
    setTranslateBulkRecords(true);
    setPrompt(defaultPrompt);
    setModelsToBeExcluded([]);
    setRolesToBeExcluded([]);
    setApiKeysToBeExcluded([]);
    ctx.notice('Defaults restored. Save to apply them.');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Enter in a field submits the form too.
    if (saveDisabled || isSaving) return;
    followSave();
    updatePluginParams({
      ctx,
      params: {
        vendor,
        apiKey,
        gptModel,
        googleApiKey,
        geminiModel,
        anthropicApiKey,
        anthropicModel,
        deeplApiKey,
        deeplEndpoint: pluginParams.deeplEndpoint ?? 'auto',
        deeplUseFree,
        deeplFormality,
        deeplPreserveFormatting,
        deeplIgnoreTags,
        deeplNonSplittingTags,
        deeplSplittingTags,
        deeplGlossaryId,
        deeplGlossaryPairs,
        yandexApiKey,
        yandexFolderId: yandexFolderId.trim(),
        translationFields,
        translateWholeRecord,
        translateBulkRecords,
        prompt,
        modelsToBeExcludedFromThisPlugin: modelsToBeExcluded,
        rolesToBeExcludedFromThisPlugin: rolesToBeExcluded,
        apiKeysToBeExcludedFromThisPlugin: apiKeysToBeExcluded,
        enableDebugging,
      },
      setIsSaving,
    });
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the vendor starts the frame, with no
  // Page around it. One form spans every section, so Save follows the last
  // one. Enter in a select never saves it.
  return (
    <form onSubmit={handleSubmit} onKeyDown={keepEnterInSelects} noValidate>
      <FieldWrapper label="AI vendor">
        <RadioGroupInput
          name="vendor"
          value={vendor}
          onChange={(next) => {
            if (next) setVendor(next);
          }}
          options={VENDOR_OPTIONS}
        />
      </FieldWrapper>

      <VendorSettings
        vendorConfig={vendorConfig}
        vendorActions={vendorActions}
        modelLists={{
          openai: openAIModels,
          google: geminiModels,
          anthropic: anthropicModels,
        }}
        siteLocales={siteLocales}
        notice={ctx.notice}
      />

      <Page.Section>
        <Page.SectionTitle>Features</Page.SectionTitle>
        <SwitchList>
          <SwitchInput
            name="translateWholeRecord"
            label="Whole-record translation in the sidebar"
            value={translateWholeRecord}
            onChange={(next) => setTranslateWholeRecord(next === true)}
          />
          <FieldWrapper hint="Adds “Translate with AI” to the actions of the records selected in a table.">
            <SwitchInput
              name="translateBulkRecords"
              label="Bulk translation of selected records"
              value={translateBulkRecords}
              onChange={(next) => setTranslateBulkRecords(next === true)}
            />
          </FieldWrapper>
        </SwitchList>
      </Page.Section>

      <ExclusionRulesSection
        showExclusionRules={showExclusionRules}
        setShowExclusionRules={setShowExclusionRules}
        modelsToBeExcluded={modelsToBeExcluded}
        setModelsToBeExcluded={setModelsToBeExcluded}
        rolesToBeExcluded={rolesToBeExcluded}
        setRolesToBeExcluded={setRolesToBeExcluded}
        apiKeysToBeExcluded={apiKeysToBeExcluded}
        setApiKeysToBeExcluded={setApiKeysToBeExcluded}
        availableModels={availableModels}
        roles={roles}
        rolesStatus={rolesStatus}
        listOfFields={listOfFields}
        fieldsLoading={fieldsLoading}
      />

      {/* The last section: Save follows it */}
      <Page.Section className={styles.lastSection}>
        <Page.SectionTitle
          collapse={{
            open: showAdvanced,
            onToggle: () => setShowAdvanced((open) => !open),
          }}
        >
          Advanced
        </Page.SectionTitle>
        {showAdvanced && (
          <>
            {/* Prompt input is not applicable to native translation providers. */}
            {!isNativeTranslationVendor(vendor) && (
              <FieldWrapper label="Translation prompt" hint={PROMPT_HINT}>
                <TextareaInput
                  name="prompt"
                  value={prompt}
                  onChange={(next) => setPrompt(next ?? '')}
                  maxRows={PROMPT_MAX_ROWS}
                />
              </FieldWrapper>
            )}
            <FieldWrapper label="Translatable field types">
              <SelectInput
                multiple
                name="translationFields"
                value={translationFields}
                onChange={(next) => setTranslationFields(next ?? [])}
                options={FIELD_TYPE_OPTIONS}
                acceptValueNotIncludedInOptions={savedFieldTypeOption}
                noOptionsMessage={noFieldTypes}
                placeholder="Pick field types"
              />
            </FieldWrapper>
            {/* One switch, not a list: a field of its own. */}
            <FieldWrapper hint="Logs translation requests and responses in the browser console.">
              <SwitchInput
                name="enableDebugging"
                label="Debug logging"
                value={enableDebugging}
                onChange={(next) => setEnableDebugging(next === true)}
              />
            </FieldWrapper>
          </>
        )}
      </Page.Section>

      {/* Restore defaults is a rare reset: quiet, so Save stays the one
          weighted action. */}
      <div className={styles.actions}>
        <Button
          id={saveId}
          submit
          tone="primary"
          label="Save"
          busy={isSaving}
          disabled={saveDisabled}
        />
        <Button
          tone="ghost"
          label="Restore defaults"
          disabled={
            isRestoreDefaultsButtonDisabled
              ? { reason: 'The settings already use the defaults.' }
              : undefined
          }
          onClick={restoreDefaults}
        />
      </div>
    </form>
  );
}
