import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import Pill from 'datocms-react-ui/Pill';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import SettingsList from 'datocms-react-ui/SettingsList';
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
    hint: string;
    apiKeyLabel: string;
    apiKeyPlaceholder: string | null;
    apiKeyUrl: string;
    modelLabel?: string;
  }
> = {
  'alttext-ai': {
    hint: 'Uses the generation settings of your AltText.ai account. Needs an AltText.ai API key.',
    apiKeyLabel: 'AltText.ai API key',
    apiKeyPlaceholder: null,
    apiKeyUrl: 'https://alttext.ai/account/api_keys',
  },
  openai: {
    hint: 'Sends each image with your prompt. Needs an OpenAI API key.',
    apiKeyLabel: 'OpenAI API key',
    apiKeyPlaceholder: 'sk-...',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    modelLabel: 'OpenAI model',
  },
  anthropic: {
    hint: 'Sends each image with your prompt. Needs an Anthropic API key.',
    apiKeyLabel: 'Anthropic API key',
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    modelLabel: 'Claude model',
  },
  gemini: {
    hint: 'Sends each image with your prompt. Needs a Gemini API key.',
    apiKeyLabel: 'Gemini API key',
    apiKeyPlaceholder: 'AIza...',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    modelLabel: 'Gemini model',
  },
};

const PROVIDER_RADIO_OPTIONS: RadioGroupOption<ProviderId>[] =
  PROVIDER_OPTIONS.map(({ value, label }) => ({
    value,
    label,
    hint: PROVIDER_DETAILS[value].hint,
  }));

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
  details: (typeof PROVIDER_DETAILS)[ProviderId],
): { apiKey?: string; model?: string; prompt?: string } {
  const directProvider = isDirectProvider(provider);

  return {
    apiKey: apiKey.trim() ? undefined : `${details.apiKeyLabel} is required.`,
    model:
      directProvider && !model.trim()
        ? `${details.modelLabel || 'Model'} is required.`
        : undefined,
    prompt:
      directProvider && !prompt.trim()
        ? 'Prompt is required for direct AI providers.'
        : undefined,
  };
}

function modelDiscoveryHint(
  apiKey: string,
  discovery: ModelDiscoveryState,
): string {
  if (!apiKey.trim()) {
    return 'Enter the API key to load the models.';
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
  validationError: string | null,
  isDirty: boolean,
): string | null {
  if (!canEdit) return READ_ONLY_REASON;
  if (hasExternalChanges) return 'Load the latest settings before you save.';
  if (validationError) return validationError;
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
  const validationError = activeProviderValidationError(configuration);
  const details = PROVIDER_DETAILS[provider];
  const controlsDisabled = !canEdit || isSaving;
  const fieldErrors = configurationFieldErrors(
    provider,
    apiKey,
    model,
    configuration.prompt,
    details,
  );
  const saveReason = saveDisabledReason(
    canEdit,
    hasExternalChanges,
    validationError,
    isDirty,
  );

  const availableModelOptions = useMemo(
    () => modelOptions(discovery.models, model),
    [discovery.models, model],
  );

  const save = async () => {
    const currentValidationError = activeProviderValidationError(configuration);
    if (currentValidationError) {
      await ctx.alert(currentValidationError);
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

  return (
    <Canvas ctx={ctx}>
      <Page>
        <Page.Content>
          {!canEdit && <Callout>{READ_ONLY_REASON}</Callout>}

          {hasExternalChanges && (
            <Page.Group
              title="Settings changed elsewhere"
              tone="warning"
              status={<Pill tone="warning">Out of date</Pill>}
            >
              <Callout tone="warning">
                Someone saved these settings while you were editing.
              </Callout>
              <SettingsList>
                <SettingsList.Row
                  title="Latest settings"
                  description="Replaces your unsaved changes."
                  action={
                    <Button
                      tone="ghost"
                      label="Load latest settings"
                      disabled={isSaving}
                      onClick={() => {
                        setConfiguration(initialConfiguration);
                        setSavedConfiguration(initialConfiguration);
                        setHasExternalChanges(false);
                      }}
                    />
                  }
                />
              </SettingsList>
            </Page.Group>
          )}

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              // The Save button stays focusable while disabled, so Enter in a
              // field can still submit the form
              if (!canEdit || !isDirty || isSaving) return;
              void save();
            }}
          >
            <Page.Group
              title="Alt text provider"
              footer={
                <Button
                  submit
                  tone="primary"
                  label="Save"
                  expand={false}
                  busy={isSaving}
                  disabled={saveReason ? { reason: saveReason } : undefined}
                />
              }
            >
              <FieldWrapper
                label="Provider"
                docs={{
                  label: 'Where to find the alt text actions',
                  to: ACTIONS_DOCUMENTATION_URL,
                }}
              >
                <RadioGroupInput
                  value={provider}
                  disabled={controlsDisabled}
                  options={PROVIDER_RADIO_OPTIONS}
                  onChange={(next) => {
                    if (next) {
                      setConfiguration((current) => ({
                        ...current,
                        provider: next,
                      }));
                    }
                  }}
                />
              </FieldWrapper>

              <FieldWrapper
                label={details.apiKeyLabel}
                required
                error={fieldErrors.apiKey}
                hint={
                  <>
                    Create one in the{' '}
                    <a
                      href={details.apiKeyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {PROVIDER_LABELS[provider]} dashboard
                    </a>
                    . It's stored in the plugin settings, and the browser sends
                    it straight to {PROVIDER_LABELS[provider]}.
                  </>
                }
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
                  label={details.modelLabel || 'Model'}
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
            </Page.Group>
          </form>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
