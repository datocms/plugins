import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeProviderValidationError,
  normalizePluginConfiguration,
  type PluginConfiguration,
  PROVIDER_LABELS,
  PROVIDER_OPTIONS,
  type ProviderId,
  serializePluginConfiguration,
} from '../config';
import { listProviderModels } from '../providers/modelDiscovery';

const MODEL_DISCOVERY_DELAY_MS = 600;
const ACTIONS_DOCUMENTATION_URL =
  'https://github.com/datocms/plugins/tree/master/alt-text-ai#where-to-generate-alt-text';
const READ_ONLY_REASON = "Your role can't change the plugin settings.";

type Props = {
  ctx: RenderConfigScreenCtx;
};

type SelectOption = {
  label: string;
  value: string;
};

type ModelDiscoveryState = {
  models: string[];
  isLoading: boolean;
  error: string | null;
};

type DirectProviderId = Exclude<ProviderId, 'alttext-ai'>;

const PROVIDER_DETAILS: Record<
  ProviderId,
  {
    /** What tells the provider apart from the others, under the field */
    hint?: string;
    apiKeyPlaceholder: string | null;
    apiKeyDocs: { label: string; to: string };
  }
> = {
  'alttext-ai': {
    hint: 'Uses the generation settings of your AltText.ai account.',
    apiKeyPlaceholder: null,
    apiKeyDocs: {
      label: 'Get an AltText.ai API key',
      to: 'https://alttext.ai/account/api_keys',
    },
  },
  openai: {
    apiKeyPlaceholder: 'sk-…',
    apiKeyDocs: {
      label: 'Get an OpenAI API key',
      to: 'https://platform.openai.com/api-keys',
    },
  },
  anthropic: {
    apiKeyPlaceholder: 'sk-ant-…',
    apiKeyDocs: {
      label: 'Get an Anthropic API key',
      to: 'https://console.anthropic.com/settings/keys',
    },
  },
  gemini: {
    apiKeyPlaceholder: 'AIza…',
    apiKeyDocs: {
      label: 'Get a Google Gemini API key',
      to: 'https://aistudio.google.com/apikey',
    },
  },
};

function isDirectProvider(provider: ProviderId): provider is DirectProviderId {
  return provider !== 'alttext-ai';
}

function getProviderApiKey(config: PluginConfiguration): string {
  switch (config.provider) {
    case 'alttext-ai':
      return config.altTextAiApiKey;
    case 'openai':
      return config.openAiApiKey;
    case 'anthropic':
      return config.anthropicApiKey;
    case 'gemini':
      return config.geminiApiKey;
  }
}

function withProviderApiKey(
  config: PluginConfiguration,
  apiKey: string,
): PluginConfiguration {
  switch (config.provider) {
    case 'alttext-ai':
      return { ...config, altTextAiApiKey: apiKey };
    case 'openai':
      return { ...config, openAiApiKey: apiKey };
    case 'anthropic':
      return { ...config, anthropicApiKey: apiKey };
    case 'gemini':
      return { ...config, geminiApiKey: apiKey };
  }
}

function getProviderModel(config: PluginConfiguration): string {
  switch (config.provider) {
    case 'openai':
      return config.openAiModel;
    case 'anthropic':
      return config.anthropicModel;
    case 'gemini':
      return config.geminiModel;
    case 'alttext-ai':
      return '';
  }
}

function withProviderModel(
  config: PluginConfiguration,
  model: string,
): PluginConfiguration {
  switch (config.provider) {
    case 'openai':
      return { ...config, openAiModel: model };
    case 'anthropic':
      return { ...config, anthropicModel: model };
    case 'gemini':
      return { ...config, geminiModel: model };
    case 'alttext-ai':
      return config;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function useProviderModels(
  provider: ProviderId,
  apiKey: string,
): ModelDiscoveryState {
  const [state, setState] = useState<ModelDiscoveryState>({
    models: [],
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (!isDirectProvider(provider) || !apiKey.trim()) {
      setState({ models: [], isLoading: false, error: null });
      return;
    }

    setState({ models: [], isLoading: false, error: null });
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setState({ models: [], isLoading: true, error: null });

      void listProviderModels(provider, apiKey.trim(), abortController.signal)
        .then((models) => {
          if (!abortController.signal.aborted) {
            setState({ models, isLoading: false, error: null });
          }
        })
        .catch((error: unknown) => {
          if (!abortController.signal.aborted) {
            setState({
              models: [],
              isLoading: false,
              error: `Could not load models: ${getErrorMessage(error)}`,
            });
          }
        });
    }, MODEL_DISCOVERY_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [apiKey, provider]);

  return state;
}

function modelOptions(models: string[], currentModel: string): SelectOption[] {
  return Array.from(new Set([currentModel, ...models].filter(Boolean))).map(
    (model) => ({ label: model, value: model }),
  );
}

function configurationFieldErrors(
  provider: ProviderId,
  apiKey: string,
  model: string,
  prompt: string,
): { apiKey?: string; model?: string; prompt?: string } {
  const directProvider = isDirectProvider(provider);

  return {
    apiKey: apiKey.trim() ? undefined : 'Enter an API key.',
    model: directProvider && !model.trim() ? 'Select a model.' : undefined,
    prompt: directProvider && !prompt.trim() ? 'Enter a prompt.' : undefined,
  };
}

function modelDiscoveryHint(
  apiKey: string,
  discovery: ModelDiscoveryState,
): string {
  if (!apiKey.trim()) {
    return 'Add an API key to load the models.';
  }
  if (discovery.isLoading) {
    return 'Loading the models…';
  }
  if (discovery.error) {
    return discovery.error;
  }
  if (discovery.models.length === 0) {
    return 'The provider returned no models. Type a model ID instead.';
  }

  const count = discovery.models.length;
  return `${count} model${count === 1 ? '' : 's'} from the provider. Pick one that reads images and returns text, or type a model ID.`;
}

function saveDisabledReason(
  canEdit: boolean,
  hasExternalChanges: boolean,
  missing: ReturnType<typeof configurationFieldErrors>,
  isDirty: boolean,
): string | null {
  if (!canEdit) return READ_ONLY_REASON;
  if (hasExternalChanges) return 'Load the latest settings before you save.';
  if (missing.apiKey) return 'Enter an API key before saving.';
  if (missing.model) return 'Select a model before saving.';
  if (missing.prompt) return 'Enter a prompt before saving.';
  if (!isDirty) return 'There are no changes to save.';
  return null;
}

export default function ConfigScreen({ ctx }: Props) {
  const initialConfiguration = useMemo(
    () => normalizePluginConfiguration(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters],
  );
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [savedConfiguration, setSavedConfiguration] =
    useState(initialConfiguration);
  const [isSaving, setIsSaving] = useState(false);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const externalConfigurationFingerprint = JSON.stringify(
    serializePluginConfiguration(initialConfiguration),
  );
  const configurationFingerprint = JSON.stringify(
    serializePluginConfiguration(configuration),
  );
  const savedConfigurationFingerprint = JSON.stringify(
    serializePluginConfiguration(savedConfiguration),
  );
  const lastObservedExternalFingerprint = useRef(
    externalConfigurationFingerprint,
  );
  const isDirty = configurationFingerprint !== savedConfigurationFingerprint;

  useEffect(() => {
    if (
      externalConfigurationFingerprint ===
      lastObservedExternalFingerprint.current
    ) {
      return;
    }

    lastObservedExternalFingerprint.current = externalConfigurationFingerprint;
    if (isDirty) {
      setHasExternalChanges(true);
      return;
    }

    setConfiguration(initialConfiguration);
    setSavedConfiguration(initialConfiguration);
    setHasExternalChanges(false);
  }, [externalConfigurationFingerprint, initialConfiguration, isDirty]);

  const canEdit =
    ctx.currentRole.meta.final_permissions.can_edit_schema === true;
  const provider = configuration.provider;
  const apiKey = getProviderApiKey(configuration);
  const model = getProviderModel(configuration);
  const discovery = useProviderModels(provider, apiKey);
  const details = PROVIDER_DETAILS[provider];
  const controlsDisabled = !canEdit || isSaving;
  const missingValues = configurationFieldErrors(
    provider,
    apiKey,
    model,
    configuration.prompt,
  );
  // The fields show their errors once a save was attempted
  const fieldErrors = attemptedSave ? missingValues : {};
  const saveReason = saveDisabledReason(
    canEdit,
    hasExternalChanges,
    missingValues,
    isDirty,
  );

  const availableModelOptions = useMemo(
    () => modelOptions(discovery.models, model),
    [discovery.models, model],
  );

  const save = async () => {
    // The fields show what is missing
    if (activeProviderValidationError(configuration)) {
      return;
    }
    if (hasExternalChanges) {
      await ctx.alert(
        'Plugin settings changed elsewhere. Load the latest settings before saving.',
      );
      return;
    }

    setIsSaving(true);
    try {
      const serialized = serializePluginConfiguration(configuration);
      await ctx.updatePluginParameters(serialized);
      const normalized = normalizePluginConfiguration(serialized);
      setConfiguration(normalized);
      setSavedConfiguration(normalized);
      setHasExternalChanges(false);
      void ctx.notice('Alt text provider settings saved.');
    } catch (error) {
      void ctx.alert(
        `Could not save plugin settings: ${getErrorMessage(error)}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the fields start the frame, with no
  // Page around them
  return (
    <Canvas ctx={ctx}>
      {!canEdit && <Callout>{READ_ONLY_REASON}</Callout>}

      {hasExternalChanges && (
        <>
          <Callout tone="warning" title="Settings changed elsewhere">
            Someone saved these settings while you were editing.
          </Callout>
          <Page.Section>
            <Page.SectionDescription>
              Replaces your unsaved changes.
            </Page.SectionDescription>
            <Button
              label="Load latest settings"
              disabled={isSaving}
              onClick={() => {
                setConfiguration(initialConfiguration);
                setSavedConfiguration(initialConfiguration);
                setHasExternalChanges(false);
              }}
            />
          </Page.Section>
        </>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttemptedSave(true);
          // The Save button stays focusable while disabled, so Enter in a
          // field can still submit the form
          if (!canEdit || !isDirty || isSaving) return;
          void save();
        }}
      >
        <FieldWrapper
          label="Provider"
          hint={details.hint}
          docs={{
            label: 'Where to find the alt text actions',
            to: ACTIONS_DOCUMENTATION_URL,
          }}
        >
          <SelectInput
            value={provider}
            disabled={controlsDisabled}
            options={PROVIDER_OPTIONS}
            clearable={false}
            isSearchable={false}
            onChange={(_next, option) => {
              if (option) {
                setAttemptedSave(false);
                setConfiguration((current) => ({
                  ...current,
                  provider: option.value,
                }));
              }
            }}
          />
        </FieldWrapper>

        <FieldWrapper
          label="API key"
          required
          error={fieldErrors.apiKey}
          hint={`Saved in the plugin settings. This browser sends it straight to ${PROVIDER_LABELS[provider]}.`}
          docs={details.apiKeyDocs}
        >
          <PasswordInput
            value={apiKey}
            placeholder={details.apiKeyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            disabled={controlsDisabled}
            onChange={(value) =>
              setConfiguration((current) =>
                withProviderApiKey(current, value ?? ''),
              )
            }
          />
        </FieldWrapper>

        {isDirectProvider(provider) && (
          <FieldWrapper
            label="Model"
            required
            error={fieldErrors.model}
            hint={modelDiscoveryHint(apiKey, discovery)}
          >
            <SelectInput
              value={model || null}
              options={availableModelOptions}
              placeholder="Pick a model"
              clearable={false}
              loading={discovery.isLoading}
              disabled={controlsDisabled}
              creatable={{
                onCreate: (value) =>
                  setConfiguration((current) =>
                    withProviderModel(current, value),
                  ),
                formatLabel: (value) => `Use model “${value}”`,
              }}
              onChange={(next) => {
                if (next) {
                  setConfiguration((current) =>
                    withProviderModel(current, next),
                  );
                }
              }}
            />
          </FieldWrapper>
        )}

        {isDirectProvider(provider) && (
          <FieldWrapper
            label="Prompt"
            required
            error={fieldErrors.prompt}
            hint="Sent with each image. {locale} and {filename} stand for the locale and the file name. Ask for the alt text alone."
          >
            <TextareaInput
              value={configuration.prompt}
              disabled={controlsDisabled}
              onChange={(prompt) =>
                setConfiguration((current) => ({
                  ...current,
                  prompt: prompt ?? '',
                }))
              }
            />
          </FieldWrapper>
        )}
        <Button
          submit
          tone="primary"
          label="Save"
          busy={isSaving}
          disabled={saveReason ? { reason: saveReason } : undefined}
        />
      </form>
    </Canvas>
  );
}
