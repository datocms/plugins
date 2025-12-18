// ConfigScreen.tsx
// ------------------------------------------------------
// This component defines the plugin's configuration screen inside DatoCMS.
// It allows the user to set the OpenAI API Key, select a GPT model, and choose
// which field types can be translated.

import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  SelectField,
  Spinner,
  SwitchField,
} from 'datocms-react-ui';
import s from '../styles.module.css';
import { useEffect, useState, useMemo, useCallback } from 'react';
import ReactTextareaAutosize from 'react-textarea-autosize';
import { defaultPrompt } from '../../prompts/DefaultPrompt';
import { buildClient } from '@datocms/cma-client-browser';
import { listRelevantOpenAIModels } from '../../utils/translation/OpenAIModels';
import { listRelevantGeminiModels } from '../../utils/translation/GeminiModels';
import { listRelevantAnthropicModels } from '../../utils/translation/AnthropicModels';

// Vendor configuration components
import OpenAIConfig from './VendorConfigs/OpenAIConfig';
import GeminiConfig from './VendorConfigs/GeminiConfig';
import AnthropicConfig from './VendorConfigs/AnthropicConfig';
import DeepLConfig from './VendorConfigs/DeepLConfig';
import ExclusionRulesSection from './ExclusionRulesSection';

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
  deeplEndpoint?: 'auto'|'pro'|'free';
  deeplUseFree?: boolean;
  deeplFormality?: 'default'|'more'|'less';
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
 * A mapping from field editor types to their user-friendly labels.
 * Used to present a friendly multi-select of possible translatable fields.
 */
export const translateFieldTypes = {
  single_line: 'Single line string',
  markdown: 'Markdown',
  wysiwyg: 'HTML Editor',
  textarea: 'Textarea',
  slug: 'Slug',
  json: 'JSON',
  seo: 'SEO',
  structured_text: 'Structured Text',
  rich_text: 'Modular Content',
  file: 'Media Fields',
};

export const modularContentVariations = ['framed_single_block'];

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
  setOptions: React.Dispatch<React.SetStateAction<string[]>>,
  setGptModel: React.Dispatch<React.SetStateAction<string>>,
  currentModel: string
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
    ctx.notice('Plugin options updated successfully!');
  } catch (error) {
    console.error('Error updating plugin parameters:', error);
    ctx.alert('Failed to update plugin options. Please try again.');
  } finally {
    setIsLoading(false);
  }
};

/**
 * Main config screen component. Users interact with these fields
 * to adjust plugin behavior and integration with OpenAI.
 *
 * @param props - Contains the RenderConfigScreenCtx from DatoCMS
 */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  // Retrieve existing plugin params or use defaults if not set
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;

  // Local state for the API key
  const [vendor, setVendor] = useState<'openai' | 'google' | 'anthropic' | 'deepl'>(pluginParams.vendor ?? 'openai');
  const [apiKey, setApiKey] = useState(pluginParams.apiKey ?? '');
  const [googleApiKey, setGoogleApiKey] = useState(pluginParams.googleApiKey ?? '');

  // Local state for the selected GPT model
  const [gptModel, setGptModel] = useState(
    pluginParams.gptModel ?? 'None'
  );
  const [geminiModel, setGeminiModel] = useState(pluginParams.geminiModel ?? 'gemini-1.5-flash');
  const [anthropicApiKey, setAnthropicApiKey] = useState(pluginParams.anthropicApiKey ?? '');
  const [anthropicModel, setAnthropicModel] = useState(pluginParams.anthropicModel ?? 'claude-3.5-haiku-latest');
  const [deeplUseFree, setDeeplUseFree] = useState<boolean>(pluginParams.deeplUseFree ?? false);
  const [deeplFormality, setDeeplFormality] = useState<'default'|'more'|'less'>(pluginParams.deeplFormality ?? 'default');
  const [deeplPreserveFormatting, setDeeplPreserveFormatting] = useState<boolean>(pluginParams.deeplPreserveFormatting ?? true);
  const [deeplIgnoreTags, setDeeplIgnoreTags] = useState<string>(pluginParams.deeplIgnoreTags ?? 'notranslate,ph');
  const [deeplNonSplittingTags, setDeeplNonSplittingTags] = useState<string>(pluginParams.deeplNonSplittingTags ?? 'a,code,pre,strong,em,ph,notranslate');
  const [deeplSplittingTags, setDeeplSplittingTags] = useState<string>(pluginParams.deeplSplittingTags ?? '');
  const [deeplApiKey, setDeeplApiKey] = useState<string>(pluginParams.deeplApiKey ?? '');
  const [deeplGlossaryId, setDeeplGlossaryId] = useState<string>(pluginParams.deeplGlossaryId ?? '');
  const [deeplGlossaryPairs, setDeeplGlossaryPairs] = useState<string>(pluginParams.deeplGlossaryPairs ?? '');

  // Local state for which field types can be translated
  const [translationFields, setTranslationFields] = useState<string[]>(
    Array.isArray(pluginParams.translationFields)
      ? pluginParams.translationFields
      : Object.keys(translateFieldTypes)
  );

  // Local state for models to be excluded from translation
  const [modelsToBeExcluded, setModelsToBeExcluded] = useState<string[]>(
    pluginParams.modelsToBeExcludedFromThisPlugin ?? []
  );

  // Local state for roles to be excluded from translation
  const [rolesToBeExcluded, setRolesToBeExcluded] = useState<string[]>(
    pluginParams.rolesToBeExcludedFromThisPlugin ?? []
  );

  // Local state for API keys to be excluded from translation
  const [apiKeysToBeExcluded, setApiKeysToBeExcluded] = useState<string[]>(
    pluginParams.apiKeysToBeExcludedFromThisPlugin ?? []
  );

  // Local state to allow entire record translation
  const [translateWholeRecord, setTranslateWholeRecord] = useState<boolean>(
    typeof pluginParams.translateWholeRecord === 'boolean'
      ? pluginParams.translateWholeRecord
      : true
  );

  // Local state to allow bulk records translation
  const [translateBulkRecords, setTranslateBulkRecords] = useState<boolean>(
    typeof pluginParams.translateBulkRecords === 'boolean'
      ? pluginParams.translateBulkRecords
      : true
  );

  // Local state for the translation prompt (includes placeholders like {fieldValue})
  const [prompt, setPrompt] = useState(pluginParams.prompt ?? defaultPrompt);

  // Local state for debugging
  const [enableDebugging, setEnableDebugging] = useState<boolean>(
    typeof pluginParams.enableDebugging === 'boolean'
      ? pluginParams.enableDebugging
      : false
  );

  // Performance concurrency is now fully automatic; no user setting.

  // A loading state to indicate asynchronous operations (like saving or model fetching)
  const [isLoading, setIsLoading] = useState(false);

  // Holds all possible GPT models fetched from the OpenAI API
  const [listOfModels, setListOfModels] = useState<string[]>([
    'Insert a valid OpenAI API Key',
  ]);

  const [listOfGeminiModels, setListOfGeminiModels] = useState<string[]>(['Insert a valid Google API Key']);
  const [listOfAnthropicModels, setListOfAnthropicModels] = useState<string[]>(['Insert a valid Anthropic API Key']);

  const [listOfFields, setListOfFields] = useState<
    {
      id: string;
      name: string;
      model: string;
    }[]
  >([]);

  // Add state for exclusion rules visibility
  const [showExclusionRules, setShowExclusionRules] = useState<boolean>(false);

  // Calculate if any exclusion rules are set
  const hasExclusionRules = useMemo(() => {
    return (
      modelsToBeExcluded.length > 0 ||
      rolesToBeExcluded.length > 0 ||
      apiKeysToBeExcluded.length > 0
    );
  }, [modelsToBeExcluded, rolesToBeExcluded, apiKeysToBeExcluded]);

  useEffect(() => {
    // Force show exclusion rules if any are set
    if (hasExclusionRules) {
      setShowExclusionRules(true);
    }
  }, [hasExclusionRules]);

  /**
   * When the user updates or removes the API key, we refetch the model list.
   * If there's no API key provided, we show a placeholder message.
   */

  useEffect(() => {
    if (vendor === 'openai' && apiKey) {
      // Process all item types, including modular blocks
      for (const itemTypeID in ctx.itemTypes) {
        ctx.loadItemTypeFields(itemTypeID).then((fields) => {
          setListOfFields((prevFields) => {
            const itemType = ctx.itemTypes[itemTypeID];
            const isBlock = itemType?.attributes.modular_block;
            const modelName = itemType?.attributes.name;

            const newFields = fields.map((field) => ({
              id: field.id,
              name: field.attributes.label,
              model: isBlock ? `${modelName} block` : modelName ?? '',
            }));

            // Create a Set of existing IDs for O(1) lookup
            const existingIds = new Set(prevFields.map((field) => field.id));

            // Only add fields that don't already exist
            const uniqueNewFields = newFields.filter(
              (field) => !existingIds.has(field.id)
            );

            return [...prevFields, ...uniqueNewFields];
          });
        });
      }
    }
  }, [ctx.itemTypes, apiKey, ctx.loadItemTypeFields, vendor]);

  useEffect(() => {
    if (vendor === 'openai' && apiKey) {
      fetchAvailableModels(
        apiKey,
        setListOfModels,
        setGptModel,
        gptModel
      ).catch(console.error);
    } else {
      if (vendor === 'openai') {
        setListOfModels(['Insert a valid OpenAI API Key']);
        setGptModel('None');
      }
    }
  }, [apiKey, vendor]);

  // Load Gemini models dynamically when Google vendor + key
  useEffect(() => {
    async function loadGemini() {
      if (vendor !== 'google') return;
      if (!googleApiKey) {
        setListOfGeminiModels(['Insert a valid Google API Key']);
        return;
      }
      try {
        const models = await listRelevantGeminiModels(googleApiKey);
        setListOfGeminiModels(models.length > 0 ? models : ['No compatible models found']);
        // Auto-select first model if none currently selected
        if (models.length > 0 && !pluginParams.geminiModel) {
          setGeminiModel(models[0]);
        }
      } catch (e) {
        console.error('Error fetching Gemini models:', e);
        setListOfGeminiModels(['Invalid API Key']);
      }
    }
    loadGemini();
  }, [vendor, googleApiKey, pluginParams.geminiModel]);

  // Load Anthropic models dynamically when Anthropic vendor + key
  useEffect(() => {
    async function loadClaude() {
      if (vendor !== 'anthropic') return;
      if (!anthropicApiKey) {
        setListOfAnthropicModels(['Insert a valid Anthropic API Key']);
        return;
      }
      try {
        const models = await listRelevantAnthropicModels(anthropicApiKey);
        setListOfAnthropicModels(models.length > 0 ? models : ['No compatible models found']);
        // Auto-select first model if none currently selected
        if (models.length > 0 && !pluginParams.anthropicModel) {
          setAnthropicModel(models[0]);
        }
      } catch (e) {
        console.error('Error fetching Claude models:', e);
        setListOfAnthropicModels(['Invalid API Key']);
      }
    }
    loadClaude();
  }, [vendor, anthropicApiKey, pluginParams.anthropicModel]);

  const normalizeList = useCallback((list?: string[]) => {
    return Array.isArray(list) ? [...list].sort().join(',') : '';
  }, []);

  /**
   * Checks if the user has changed any of the config fields,
   * so we can enable or disable the "Save" button accordingly.
   */
  const isFormDirty = useMemo(() => {
    const sortedSelectedFields = [...translationFields].sort().join(',');
    const sortedConfiguredFields =
      pluginParams.translationFields
        ? [...pluginParams.translationFields].sort().join(',')
        : Object.keys(translateFieldTypes).sort().join(',');
    const sortedSelectedModels = [...modelsToBeExcluded].sort().join(',');
    const sortedConfiguredModels = normalizeList(pluginParams.modelsToBeExcludedFromThisPlugin);
    const sortedSelectedRoles = [...rolesToBeExcluded].sort().join(',');
    const sortedConfiguredRoles = normalizeList(pluginParams.rolesToBeExcludedFromThisPlugin);
    const sortedSelectedApiKeys = [...apiKeysToBeExcluded].sort().join(',');
    const sortedConfiguredApiKeys = normalizeList(pluginParams.apiKeysToBeExcludedFromThisPlugin);

    return (
      apiKey !== (pluginParams.apiKey ?? '') ||
    vendor !== (pluginParams.vendor ?? 'openai') ||
    googleApiKey !== (pluginParams.googleApiKey ?? '') ||
    geminiModel !== (pluginParams.geminiModel ?? 'gemini-1.5-flash') ||
    anthropicApiKey !== (pluginParams.anthropicApiKey ?? '') ||
    anthropicModel !== (pluginParams.anthropicModel ?? 'claude-3.5-haiku-latest') ||
    deeplUseFree !== (pluginParams.deeplUseFree ?? false) ||
    deeplFormality !== (pluginParams.deeplFormality ?? 'default') ||
    deeplPreserveFormatting !== (pluginParams.deeplPreserveFormatting ?? true) ||
    deeplIgnoreTags !== (pluginParams.deeplIgnoreTags ?? 'notranslate,ph') ||
    deeplNonSplittingTags !== (pluginParams.deeplNonSplittingTags ?? 'a,code,pre,strong,em,ph,notranslate') ||
    deeplSplittingTags !== (pluginParams.deeplSplittingTags ?? '') ||
    deeplApiKey !== (pluginParams.deeplApiKey ?? '') ||
    deeplGlossaryId !== (pluginParams.deeplGlossaryId ?? '') ||
    deeplGlossaryPairs !== (pluginParams.deeplGlossaryPairs ?? '') ||
      gptModel !== (pluginParams.gptModel ?? 'None') ||
      sortedSelectedFields !== sortedConfiguredFields ||
      translateWholeRecord !== (pluginParams.translateWholeRecord ?? true) ||
      translateBulkRecords !== (pluginParams.translateBulkRecords ?? true) ||
      prompt !== (pluginParams.prompt ?? defaultPrompt) ||
      sortedSelectedModels !== sortedConfiguredModels ||
      sortedSelectedRoles !== sortedConfiguredRoles ||
      sortedSelectedApiKeys !== sortedConfiguredApiKeys ||
      enableDebugging !== (pluginParams.enableDebugging ?? false)
    );
  }, [
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
    pluginParams.vendor,
    pluginParams.apiKey,
    pluginParams.googleApiKey,
    pluginParams.geminiModel,
    pluginParams.anthropicApiKey,
    pluginParams.anthropicModel,
    pluginParams.deeplUseFree,
    pluginParams.deeplFormality,
    pluginParams.deeplPreserveFormatting,
    pluginParams.deeplIgnoreTags,
    pluginParams.deeplNonSplittingTags,
    pluginParams.deeplSplittingTags,
    pluginParams.deeplApiKey,
    pluginParams.deeplGlossaryId,
    pluginParams.deeplGlossaryPairs,
    pluginParams.gptModel,
    pluginParams.translationFields,
    pluginParams.translateWholeRecord,
    pluginParams.translateBulkRecords,
    pluginParams.prompt,
    pluginParams.modelsToBeExcludedFromThisPlugin,
    pluginParams.rolesToBeExcludedFromThisPlugin,
    pluginParams.apiKeysToBeExcludedFromThisPlugin,
    pluginParams.enableDebugging,
  ]);

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

  useEffect(() => {
    const client = buildClient({ apiToken: ctx.currentUserAccessToken as string, environment: ctx.environment });
    client.roles.list().then((roles) => {
      setRoles(roles.map((role) => ({ id: role.id, name: role.name })));
    });
  }, [ctx.currentUserAccessToken, ctx.environment]);

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
            value={{ label: vendor === 'openai' ? 'OpenAI (ChatGPT)' : vendor === 'google' ? 'Google (Gemini)' : vendor === 'anthropic' ? 'Anthropic (Claude)' : 'DeepL', value: vendor }}
            selectInputProps={{
              options: [
                { label: 'OpenAI (ChatGPT)', value: 'openai' },
                { label: 'Google (Gemini)', value: 'google' },
                { label: 'Anthropic (Claude)', value: 'anthropic' },
                { label: 'DeepL', value: 'deepl' },
              ],
            }}
            onChange={(opt) => {
            const v = Array.isArray(opt) ? (opt[0]?.value as 'openai'|'google'|'anthropic'|'deepl') : (opt as any)?.value;
            if (v) setVendor(v);
          }}
          />
        </div>

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
          />
        )}

        {/* Performance: concurrency is automatic with adaptive backoff */}

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
              })
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
              ⓘ
              <div className={`${s.tooltipText} ${s.imageTooltip}`}>
                <img 
                  src="/public/assets/sidebar-translation-example.png" 
                  alt="Sidebar translation example"
                  style={{ width: '100%', maxWidth: '420px' }}
                />
                <div style={{ marginTop: '10px', fontWeight: 'bold' }}>Sidebar Translation</div>
                <div style={{ fontSize: '12px' }}>Translate an entire record from the sidebar panel</div>
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
              ⓘ
              <div className={`${s.tooltipText} ${s.imageTooltip}`}>
                <img 
                  src="/public/assets/bulk-translation-example.png" 
                  alt="Bulk records translation example"
                  style={{ width: '100%', maxWidth: '420px' }}
                />
                <div style={{ marginTop: '10px', fontWeight: 'bold' }}>Bulk Translation</div>
                <div style={{ fontSize: '12px' }}>Translate multiple records at once in the tabular view</div>
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
                When enabled, detailed logs of translation requests and responses will be displayed in the browser console.
                This helps with troubleshooting and understanding how the plugin processes content.
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
                  &#123;toLocale&#125; in your prompt to reference the content and
                  source/target languages. Changing the prompt can break the
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

        {/* A button to save the configuration updates. It is disabled if nothing changed or if saving is in progress. */}
        <div className={s.buttons}>
          <Button
            fullWidth
            disabled={
              (vendor === 'openai' && (gptModel === 'None' || !apiKey)) ||
              (vendor === 'google' && (!googleApiKey || !geminiModel)) ||
              (vendor === 'anthropic' && (!anthropicApiKey || !anthropicModel)) ||
              (vendor === 'deepl' && (!deeplApiKey)) ||
              ([...translationFields].sort().join(',') ===
                Object.keys(translateFieldTypes).sort().join(',') &&
                translateWholeRecord === true &&
                translateBulkRecords === true &&
                prompt === defaultPrompt &&
                modelsToBeExcluded.length === 0 &&
                rolesToBeExcluded.length === 0 &&
                apiKeysToBeExcluded.length === 0)
            }
            buttonType="muted"
            onClick={() => {
              setVendor('openai');
              // Use first available model if list is loaded, otherwise fallback
              const firstModel = listOfModels[0];
              setGptModel(firstModel && firstModel !== 'Insert a valid OpenAI API Key' && firstModel !== 'Invalid API Key' ? firstModel : 'None');
              setTranslationFields(Object.keys(translateFieldTypes));
              setTranslateWholeRecord(true);
              setTranslateBulkRecords(true);
              setPrompt(defaultPrompt);
              setModelsToBeExcluded([]);
              setRolesToBeExcluded([]);
              setApiKeysToBeExcluded([]);
              ctx.notice(
                '<h1>Plugin options restored to defaults</h1>\n<p>Save to apply changes</p>'
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
