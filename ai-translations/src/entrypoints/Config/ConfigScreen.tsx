// ConfigScreen.tsx
// ------------------------------------------------------
// This component defines the plugin's configuration screen inside DatoCMS.
// It allows the user to set the OpenAI API Key, select a GPT model, and choose
// which field types can be translated.
//
// PERF-003: State has been refactored into custom hooks to reduce re-renders:
// - useVendorConfig: Vendor credentials and settings
// - useFeatureToggles: Translation fields and feature flags
// - useExclusionRules: Model/role/field exclusions

import { buildClient} from '@datocms/cma-client-browser';
import type {ApiTypes} from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  Section,
  SelectField,
  Spinner,
  SwitchField,
} from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactTextareaAutosize from 'react-textarea-autosize';
import { defaultPrompt } from '../../prompts/DefaultPrompt';
import { listRelevantAnthropicModels } from '../../utils/translation/AnthropicModels';
import { listRelevantGeminiModels } from '../../utils/translation/GeminiModels';
import { listRelevantOpenAIModels } from '../../utils/translation/OpenAIModels';
import s from '../styles.module.css';
import { translateFieldTypes } from './configConstants';
import ExclusionRulesSection from './ExclusionRulesSection';
import { useExclusionRules } from './hooks/useExclusionRules';
import { useFeatureToggles } from './hooks/useFeatureToggles';
// PERF-003: Custom hooks for grouped state management
import { useVendorConfig } from './hooks/useVendorConfig';
import AnthropicConfig from './VendorConfigs/AnthropicConfig';
import DeepLConfig from './VendorConfigs/DeepLConfig';
import GeminiConfig from './VendorConfigs/GeminiConfig';
// Vendor configuration components
import OpenAIConfig from './VendorConfigs/OpenAIConfig';

/**
 * The shape of the plugin parameters we store in DatoCMS.
 * These fields are updated on the plugin configuration screen
 * and used throughout the plugin for translation.
 */
export type ctxParamsType = {
  // Vendor selection and credentials
  vendor?: 'openai' | 'google' | 'anthropic' | 'deepl';
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
const VALID_VENDORS = ['openai', 'google', 'anthropic', 'deepl'] as const;

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
 * It sets the list of model IDs or an error message in the local component state.
 *
 * @param apiKey - Your OpenAI API key
 * @param setOptions - Callback to set the retrieved models in state
 * @param setGptModel - Callback to set the selected model (auto-selects first if none set)
 * @param currentModel - The currently selected model
 */
async function fetchAvailableModels(
  apiKey: string,
  setOptions: (models: string[]) => void,
  setGptModel: (model: string) => void,
  currentModel: string,
) {
  try {
    const models = await listRelevantOpenAIModels(apiKey);
    setOptions(models.length > 0 ? models : ['No compatible models found']);
    // Auto-select first model if none currently selected
    if (models.length > 0 && (currentModel === 'None' || !currentModel)) {
      setGptModel(models[0]);
    }
  } catch (error) {
    console.error('Error fetching OpenAI models:', error);
    setOptions(['Invalid API Key']);
    setGptModel('None');
  }
}

/**
 * Fetches available Gemini models for the Google vendor and updates state accordingly.
 * Extracted from the component's useEffect to reduce cognitive complexity of the callback.
 *
 * @param vendor - Currently selected vendor (returns early if not 'google').
 * @param googleApiKey - Google API key; if empty, shows a placeholder message.
 * @param setListOfGeminiModels - State setter for the Gemini model list.
 * @param setGeminiModel - State setter to auto-select the first model when none is set.
 * @param savedGeminiModel - The geminiModel value saved in pluginParams (used to detect auto-select).
 */
async function loadGeminiModels(
  vendor: string,
  googleApiKey: string,
  setListOfGeminiModels: (models: string[]) => void,
  setGeminiModel: (model: string) => void,
  savedGeminiModel: string | undefined,
): Promise<void> {
  if (vendor !== 'google') return;
  if (!googleApiKey) {
    setListOfGeminiModels(['Insert a valid Google API Key']);
    return;
  }
  try {
    const models = await listRelevantGeminiModels(googleApiKey);
    setListOfGeminiModels(
      models.length > 0 ? models : ['No compatible models found'],
    );
    if (models.length > 0 && !savedGeminiModel) {
      setGeminiModel(models[0]);
    }
  } catch (e) {
    console.error('Error fetching Gemini models:', e);
    setListOfGeminiModels(['Invalid API Key']);
  }
}

/**
 * Fetches available Anthropic models for the Anthropic vendor and updates state accordingly.
 * Extracted from the component's useEffect to reduce cognitive complexity of the callback.
 *
 * @param vendor - Currently selected vendor (returns early if not 'anthropic').
 * @param anthropicApiKey - Anthropic API key; if empty, shows a placeholder message.
 * @param setListOfAnthropicModels - State setter for the Anthropic model list.
 * @param setAnthropicModel - State setter to auto-select the first model when none is set.
 * @param savedAnthropicModel - The anthropicModel value saved in pluginParams (used to detect auto-select).
 */
async function loadClaudeModels(
  vendor: string,
  anthropicApiKey: string,
  setListOfAnthropicModels: (models: string[]) => void,
  setAnthropicModel: (model: string) => void,
  savedAnthropicModel: string | undefined,
): Promise<void> {
  if (vendor !== 'anthropic') return;
  if (!anthropicApiKey) {
    setListOfAnthropicModels(['Insert a valid Anthropic API Key']);
    return;
  }
  try {
    const models = await listRelevantAnthropicModels(anthropicApiKey);
    setListOfAnthropicModels(
      models.length > 0 ? models : ['No compatible models found'],
    );
    if (models.length > 0 && !savedAnthropicModel) {
      setAnthropicModel(models[0]);
    }
  } catch (e) {
    console.error('Error fetching Claude models:', e);
    setListOfAnthropicModels(['Invalid API Key']);
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
function mergeUniqueFields(
  prevFields: { id: string; name: string; model: string }[],
  newFields: { id: string; name: string; model: string }[],
): { id: string; name: string; model: string }[] {
  const existingIds = new Set(prevFields.map((field) => field.id));
  const uniqueNewFields = newFields.filter(
    (field) => !existingIds.has(field.id),
  );
  return [...prevFields, ...uniqueNewFields];
}

/**
 * Loads and registers all fields from a single item type into the field list state.
 * Extracted to remove complex callback nesting from the `useEffect` loop.
 *
 * @param itemTypeID - The item type ID to load fields for.
 * @param ctx - The config screen context.
 * @param setListOfFields - React state setter for the field list.
 */
function loadFieldsForItemType(
  itemTypeID: string,
  ctx: RenderConfigScreenCtx,
  setListOfFields: React.Dispatch<
    React.SetStateAction<{ id: string; name: string; model: string }[]>
  >,
): void {
  ctx
    .loadItemTypeFields(itemTypeID)
    .then((fields) => {
      setListOfFields((prevFields) => {
        const itemType = ctx.itemTypes[itemTypeID];
        const isBlock = itemType?.attributes.modular_block;
        const modelName = itemType?.attributes.name;
        const newFields = fields.map((field) => ({
          id: field.id,
          name: field.attributes.label,
          model: isBlock ? `${modelName} block` : (modelName ?? ''),
        }));
        return mergeUniqueFields(prevFields, newFields);
      });
    })
    .catch((error) => {
      console.error(
        `Failed to load fields for item type ${itemTypeID}:`,
        error,
      );
    });
}

/**
 * Parameters for the updatePluginParams function.
 */
type UpdatePluginParamsArgs = {
  ctx: RenderConfigScreenCtx;
  params: Partial<ctxParamsType>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

/**
 * Persists the updated plugin parameters to DatoCMS.
 * If successful, displays a success message; otherwise, alerts the user of an error.
 *
 * @param args - Object containing ctx, params, and setIsLoading
 */
const updatePluginParams = async ({
  ctx,
  params,
  setIsLoading,
}: UpdatePluginParamsArgs) => {
  setIsLoading(true);
  try {
    await ctx.updatePluginParameters(params);
    ctx.notice('Plugin options updated successfully!').then();
  } catch (error) {
    console.error('Error updating plugin parameters:', error);
    ctx.alert('Failed to update plugin options. Please try again.');
  } finally {
    setIsLoading(false);
  }
};

/**
 * Determines whether the vendor-specific credentials are incomplete,
 * which would prevent saving the configuration.
 *
 * @param vendor - Currently selected vendor.
 * @param apiKey - OpenAI API key.
 * @param gptModel - Selected OpenAI model.
 * @param googleApiKey - Google API key.
 * @param geminiModel - Selected Gemini model.
 * @param anthropicApiKey - Anthropic API key.
 * @param anthropicModel - Selected Anthropic model.
 * @param deeplApiKey - DeepL API key.
 * @returns True if credentials are missing for the current vendor.
 */
function isVendorCredentialsMissing(
  vendor: string,
  apiKey: string,
  gptModel: string,
  googleApiKey: string,
  geminiModel: string,
  anthropicApiKey: string,
  anthropicModel: string,
  deeplApiKey: string,
): boolean {
  if (vendor === 'openai') return gptModel === 'None' || !apiKey;
  if (vendor === 'google') return !googleApiKey || !geminiModel;
  if (vendor === 'anthropic') return !anthropicApiKey || !anthropicModel;
  if (vendor === 'deepl') return !deeplApiKey;
  return false;
}

/**
 * Determines whether the form is in the default (all-defaults) configuration.
 * Used to disable the Save button when no changes have been made from defaults.
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

/**
 * Returns the display label for a given vendor identifier.
 *
 * @param vendor - The vendor identifier string.
 * @returns The human-readable vendor label.
 */
function getVendorLabel(vendor: string): string {
  if (vendor === 'openai') return 'OpenAI (ChatGPT)';
  if (vendor === 'google') return 'Google (Gemini)';
  if (vendor === 'anthropic') return 'Anthropic (Claude)';
  return 'DeepL';
}

/**
 * Parses a vendor identifier from a DatoCMS SelectField onChange option value.
 * Returns the vendor string if the option is valid, or undefined if not.
 *
 * @param opt - The raw option value passed to the SelectField onChange handler.
 * @returns A vendor identifier string, or undefined.
 */
function parseVendorFromSelectOption(
  opt: unknown,
): 'openai' | 'google' | 'anthropic' | 'deepl' | undefined {
  const selected = Array.isArray(opt) ? opt[0] : opt;
  if (!selected || typeof selected !== 'object' || !('value' in selected)) {
    return undefined;
  }
  const v = (selected as { value: unknown }).value;
  if (v === 'openai' || v === 'google' || v === 'anthropic' || v === 'deepl') {
    return v;
  }
  return undefined;
}

/**
 * Arguments for the checkFormDirty function.
 * Groups all current config state and saved params needed to detect changes.
 */
type CheckFormDirtyArgs = {
  vendor: string;
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
    vendor: string;
    apiKey: string;
    googleApiKey: string;
    geminiModel: string;
    anthropicApiKey: string;
    anthropicModel: string;
    gptModel: string;
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
    current.gptModel !== (saved.gptModel ?? 'None')
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
    current.deeplIgnoreTags !== (saved.deeplIgnoreTags ?? 'notranslate,ph') ||
    current.deeplNonSplittingTags !==
      (saved.deeplNonSplittingTags ?? 'a,code,pre,strong,em,ph,notranslate') ||
    current.deeplSplittingTags !== (saved.deeplSplittingTags ?? '') ||
    current.deeplApiKey !== (saved.deeplApiKey ?? '') ||
    current.deeplGlossaryId !== (saved.deeplGlossaryId ?? '') ||
    current.deeplGlossaryPairs !== (saved.deeplGlossaryPairs ?? '')
  );
}

/**
 * Main config screen component. Users interact with these fields
 * to adjust plugin behavior and integration with OpenAI.
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
  } = vendorConfig;
  const {
    setVendor,
    setApiKey,
    setGptModel,
    setGoogleApiKey,
    setGeminiModel,
    setAnthropicApiKey,
    setAnthropicModel,
    setDeeplApiKey,
    setDeeplUseFree,
    setDeeplFormality,
    setDeeplPreserveFormatting,
    setDeeplIgnoreTags,
    setDeeplNonSplittingTags,
    setDeeplSplittingTags,
    setDeeplGlossaryId,
    setDeeplGlossaryPairs,
  } = vendorActions;

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
    hasExclusionRules,
  } = exclusionRules;
  const {
    setModelsToBeExcluded,
    setRolesToBeExcluded,
    setApiKeysToBeExcluded,
    setShowExclusionRules,
  } = exclusionActions;

  // Performance concurrency is now fully automatic; no user setting.

  // A loading state to indicate asynchronous operations (like saving or model fetching)
  const [isLoading, setIsLoading] = useState(false);

  // Holds all possible GPT models fetched from the OpenAI API
  const [listOfModels, setListOfModels] = useState<string[]>([
    'Insert a valid OpenAI API Key',
  ]);

  const [listOfGeminiModels, setListOfGeminiModels] = useState<string[]>([
    'Insert a valid Google API Key',
  ]);
  const [listOfAnthropicModels, setListOfAnthropicModels] = useState<string[]>([
    'Insert a valid Anthropic API Key',
  ]);

  const [listOfFields, setListOfFields] = useState<
    {
      id: string;
      name: string;
      model: string;
    }[]
  >([]);

  /**
   * When the user updates or removes the API key, we refetch the model list.
   * If there's no API key provided, we show a placeholder message.
   */

  useEffect(() => {
    if (vendor !== 'openai' || !apiKey) return;
    for (const itemTypeID in ctx.itemTypes) {
      loadFieldsForItemType(itemTypeID, ctx, setListOfFields);
    }
  }, [ctx, apiKey, vendor]);

  useEffect(() => {
    if (vendor !== 'openai') return;
    if (apiKey) {
      fetchAvailableModels(
        apiKey,
        setListOfModels,
        setGptModel,
        gptModel,
      ).catch(console.error);
    } else {
      setListOfModels(['Insert a valid OpenAI API Key']);
      setGptModel('None');
    }
  }, [apiKey, vendor, gptModel, setGptModel]);

  // Load Gemini models dynamically when Google vendor + key
  useEffect(() => {
    loadGeminiModels(
      vendor,
      googleApiKey,
      setListOfGeminiModels,
      setGeminiModel,
      pluginParams.geminiModel,
    ).catch(console.error);
  }, [vendor, googleApiKey, pluginParams.geminiModel, setGeminiModel]);

  // Load Anthropic models dynamically when Anthropic vendor + key
  useEffect(() => {
    loadClaudeModels(
      vendor,
      anthropicApiKey,
      setListOfAnthropicModels,
      setAnthropicModel,
      pluginParams.anthropicModel,
    ).catch(console.error);
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

  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [siteLocales] = useState<ApiTypes.Site['locales']>(ctx.site.attributes.locales);

  useEffect(() => {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken as string,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
    client.roles.list().then((roles) => {
      setRoles(roles.map((role) => ({ id: role.id, name: role.name })));
    });
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

  const isSaveButtonDisabled =
    isVendorCredentialsMissing(
      vendor,
      apiKey,
      gptModel,
      googleApiKey,
      geminiModel,
      anthropicApiKey,
      anthropicModel,
      deeplApiKey,
    ) ||
    isDefaultConfiguration(
      translationFields,
      translateWholeRecord,
      translateBulkRecords,
      prompt,
      modelsToBeExcluded,
      rolesToBeExcluded,
      apiKeysToBeExcluded,
    );

  return (
    // Canvas is a Datocms React UI wrapper for consistent styling
    <Canvas ctx={ctx}>
      <div>
        {/* Vendor selection */}
        <div className={s.fieldSpacing}>
          <SelectField
            name="vendor"
            id="vendor"
            label="AI Vendor"
            value={{ label: getVendorLabel(vendor), value: vendor }}
            selectInputProps={{
              options: [
                { label: 'OpenAI (ChatGPT)', value: 'openai' },
                { label: 'Google (Gemini)', value: 'google' },
                { label: 'Anthropic (Claude)', value: 'anthropic' },
                { label: 'DeepL', value: 'deepl' },
              ],
            }}
            onChange={(opt) => {
              const newVendor = parseVendorFromSelectOption(opt);
              if (newVendor) setVendor(newVendor);
            }}
          />
        </div>

        <Section title={`Vendor-specific settings for ${getVendorLabel(vendor)}`}>
        {vendor === 'openai' ? (
          <OpenAIConfig
            apiKey={apiKey}
            setApiKey={setApiKey}
            gptModel={gptModel}
            setGptModel={setGptModel}
            listOfModels={listOfModels}
          />
        ) : vendor === 'google' ? (
          <GeminiConfig
            googleApiKey={googleApiKey}
            setGoogleApiKey={setGoogleApiKey}
            geminiModel={geminiModel}
            setGeminiModel={setGeminiModel}
            listOfGeminiModels={listOfGeminiModels}
          />
        ) : vendor === 'anthropic' ? (
          <AnthropicConfig
            anthropicApiKey={anthropicApiKey}
            setAnthropicApiKey={setAnthropicApiKey}
            anthropicModel={anthropicModel}
            setAnthropicModel={setAnthropicModel}
            listOfAnthropicModels={listOfAnthropicModels}
          />
        ) : (
          <DeepLConfig
            deeplApiKey={deeplApiKey}
            setDeeplApiKey={setDeeplApiKey}
            deeplUseFree={deeplUseFree}
            setDeeplUseFree={setDeeplUseFree}
            deeplFormality={deeplFormality}
            setDeeplFormality={setDeeplFormality}
            deeplPreserveFormatting={deeplPreserveFormatting}
            setDeeplPreserveFormatting={setDeeplPreserveFormatting}
            deeplIgnoreTags={deeplIgnoreTags}
            setDeeplIgnoreTags={setDeeplIgnoreTags}
            deeplNonSplittingTags={deeplNonSplittingTags}
            setDeeplNonSplittingTags={setDeeplNonSplittingTags}
            deeplSplittingTags={deeplSplittingTags}
            setDeeplSplittingTags={setDeeplSplittingTags}
            deeplGlossaryId={deeplGlossaryId}
            setDeeplGlossaryId={setDeeplGlossaryId}
            deeplGlossaryPairs={deeplGlossaryPairs}
            setDeeplGlossaryPairs={setDeeplGlossaryPairs}
            siteLocales={siteLocales}
            openConfirm={ctx.openConfirm}
          />
        )}
      </Section>

      <Section title="General translation settings">
        {/* Prompt input is not applicable to DeepL; hide for that vendor */}
        {vendor !== 'deepl' && (
            <div className={s.promptContainer}>
              <label
                  className={s.label}
                  style={{ display: 'flex', alignItems: 'center' }}
                  htmlFor="translation-prompt"
              >
                Translation prompt*
                <div className={s.tooltipContainer}>
                  ⓘ
                  <div className={`${s.tooltipText} ${s.leftAnchorTooltip}`}>
                    Use &#123;fieldValue&#125;, &#123;fromLocale&#125;, and
                    &#123;toLocale&#125; in your prompt to reference the content
                    and source/target languages. Changing the prompt can break the
                    plugin, so proceed with caution.
                  </div>
                </div>
              </label>
              <ReactTextareaAutosize
                  required
                  className={s.textarea}
                  placeholder="Enter your prompt here"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  id="translation-prompt"
                  aria-labelledby="translation-prompt"
              />
            </div>
        )}

        {/* A multi-select component that lets users choose which field types can be translated */}
        <SelectField
            name="fieldsWithTranslationOption"
            id="fieldsWithTranslationOption"
            label="Fields that can be translated"
            value={translationFields.map((field) => ({
              label:
                  translateFieldTypes[field as keyof typeof translateFieldTypes],
              value: field,
            }))}
            selectInputProps={{
              isMulti: true,
              options: Object.entries(translateFieldTypes).map(
                  ([value, label]) => ({
                    label,
                    value,
                  }),
              ),
            }}
            onChange={(newValue) => {
              const selectedFields = newValue.map((v) => v.value);
              setTranslationFields(selectedFields);
            }}
        />
        {/* A switch field to allow translation of the entire record from the sidebar */}
        <div className={s.switchField}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SwitchField
                name="translateWholeRecord"
                id="translateWholeRecord"
                label="Allow translation of the whole record from the sidebar"
                value={translateWholeRecord}
                onChange={(newValue) => setTranslateWholeRecord(newValue)}
            />
            {/* Tooltip container with image for sidebar translation */}
            <div className={s.tooltipContainer}>
              <span
                  role="img"
                  aria-label="Information about sidebar translation"
              >
                ⓘ
              </span>
              <div className={`${s.tooltipText} ${s.imageTooltip}`}>
                <img
                    src="/public/assets/sidebar-translation-example.png"
                    alt="Screenshot showing the sidebar translation feature with locale selection and translate button"
                    style={{ width: '100%', maxWidth: '420px' }}
                />
                <div style={{ marginTop: '10px', fontWeight: 'bold' }}>
                  Sidebar Translation
                </div>
                <div style={{ fontSize: '12px' }}>
                  Translate an entire record from the sidebar panel
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* A switch field to allow bulk records translation */}
        <div className={s.switchField}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SwitchField
                name="translateBulkRecords"
                id="translateBulkRecords"
                label="Allow bulk records translation in tabular view"
                value={translateBulkRecords}
                onChange={(newValue) => setTranslateBulkRecords(newValue)}
            />
            {/* Tooltip container with image for bulk translation */}
            <div className={s.tooltipContainer}>
              <span role="img" aria-label="Information about bulk translation">
                ⓘ
              </span>
              <div className={`${s.tooltipText} ${s.imageTooltip}`}>
                <img
                    src="/public/assets/bulk-translation-example.png"
                    alt="Screenshot showing bulk translation of multiple records in tabular view"
                    style={{ width: '100%', maxWidth: '420px' }}
                />
                <div style={{ marginTop: '10px', fontWeight: 'bold' }}>
                  Bulk Translation
                </div>
                <div style={{ fontSize: '12px' }}>
                  Translate multiple records at once in the tabular view
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* A switch field to enable debug logging */}
        <div className={s.switchField}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SwitchField
                name="enableDebugging"
                id="enableDebugging"
                label="Enable debug logging"
                value={enableDebugging}
                onChange={(newValue) => setEnableDebugging(newValue)}
            />
            {/* Tooltip container styled like the translation prompt tooltip */}
            <div className={s.tooltipContainer}>
              ⓘ
              <div className={s.tooltipText}>
                When enabled, detailed logs of translation requests and
                responses will be displayed in the browser console. This helps
                with troubleshooting and understanding how the plugin processes
                content.
              </div>
            </div>
          </div>
        </div>

        {/* Exclusion rules section */}
        <ExclusionRulesSection
            showExclusionRules={showExclusionRules}
            setShowExclusionRules={setShowExclusionRules}
            hasExclusionRules={hasExclusionRules}
            modelsToBeExcluded={modelsToBeExcluded}
            setModelsToBeExcluded={setModelsToBeExcluded}
            rolesToBeExcluded={rolesToBeExcluded}
            setRolesToBeExcluded={setRolesToBeExcluded}
            apiKeysToBeExcluded={apiKeysToBeExcluded}
            setApiKeysToBeExcluded={setApiKeysToBeExcluded}
            availableModels={availableModels}
            roles={roles}
            listOfFields={listOfFields}
        />
      </Section>


      {/* A button to save the configuration updates. It is disabled if nothing changed or if saving is in progress. */}
        <div className={s.buttons}>
          <Button
              fullWidth
              disabled={isSaveButtonDisabled}
              buttonType="muted"
              onClick={() => {
                setVendor('openai');
                // Use first available model if list is loaded, otherwise fallback
                const firstModel = listOfModels[0];
                setGptModel(
                    firstModel &&
                    firstModel !== 'Insert a valid OpenAI API Key' &&
                    firstModel !== 'Invalid API Key'
                        ? firstModel
                        : 'None',
                );
                setTranslationFields(Object.keys(translateFieldTypes));
                setTranslateWholeRecord(true);
                setTranslateBulkRecords(true);
                setPrompt(defaultPrompt);
                setModelsToBeExcluded([]);
                setRolesToBeExcluded([]);
                setApiKeysToBeExcluded([]);
                ctx.notice(
                    '<h1>Plugin options restored to defaults</h1>\n<p>Save to apply changes</p>',
                );
              }}
          >
            Restore to defaults
          </Button>
          <Button
              disabled={!isFormDirty || isLoading}
              fullWidth
              buttonType="primary"
              onClick={() =>
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
                      translationFields,
                      translateWholeRecord,
                      translateBulkRecords,
                      prompt,
                      modelsToBeExcludedFromThisPlugin: modelsToBeExcluded,
                      rolesToBeExcludedFromThisPlugin: rolesToBeExcluded,
                      apiKeysToBeExcludedFromThisPlugin: apiKeysToBeExcluded,
                      enableDebugging,
                    },
                    setIsLoading,
                  })
              }
          >
            {isLoading ? 'Saving...' : 'Save'}
            {isLoading && <Spinner size={24} />}
          </Button>

        </div>
      </div>
    </Canvas>
  );
}
