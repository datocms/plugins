import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  CreatableSelectField,
  FieldGroup,
  Form,
  Section,
  SelectField,
  Spinner,
  TextareaField,
  TextField,
} from 'datocms-react-ui';
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
import s from './styles.module.css';

const MODEL_DISCOVERY_DELAY_MS = 600;
const ACTIONS_DOCUMENTATION_URL =
  'https://github.com/datocms/plugins/tree/master/alt-text-ai#where-to-generate-alt-text';

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
    apiKeyLabel: string;
    apiKeyPlaceholder: string;
    apiKeyUrl: string;
    modelLabel?: string;
  }
> = {
  'alttext-ai': {
    apiKeyLabel: 'AltText.ai API key',
    apiKeyPlaceholder: 'Paste your AltText.ai API key',
    apiKeyUrl: 'https://alttext.ai/account/api_keys',
  },
  openai: {
    apiKeyLabel: 'OpenAI API key',
    apiKeyPlaceholder: 'sk-...',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    modelLabel: 'OpenAI model',
  },
  anthropic: {
    apiKeyLabel: 'Anthropic API key',
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    modelLabel: 'Claude model',
  },
  gemini: {
    apiKeyLabel: 'Gemini API key',
    apiKeyPlaceholder: 'AIza...',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    modelLabel: 'Gemini model',
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

function optionValue(value: unknown): string | null {
  if (
    value &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    'value' in value &&
    typeof value.value === 'string'
  ) {
    return value.value;
  }

  return null;
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

function providerOption(value: unknown): ProviderId | null {
  const selectedValue = optionValue(value);
  return PROVIDER_OPTIONS.some((option) => option.value === selectedValue)
    ? (selectedValue as ProviderId)
    : null;
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
    return 'Enter an API key to load models directly from the provider.';
  }
  if (discovery.isLoading) {
    return 'Loading models directly from the provider…';
  }
  if (discovery.error) {
    return discovery.error;
  }
  if (discovery.models.length === 0) {
    return 'The provider returned no models. You can enter a model ID manually.';
  }

  const count = discovery.models.length;
  return `${count} model${count === 1 ? '' : 's'} loaded directly from the provider. Select one that accepts image input and returns text, or enter a model ID manually.`;
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
  const apiKey = getProviderApiKey(configuration);
  const model = getProviderModel(configuration);
  const discovery = useProviderModels(configuration.provider, apiKey);
  const validationError = activeProviderValidationError(configuration);
  const details = PROVIDER_DETAILS[configuration.provider];
  const controlsDisabled = !canEdit || isSaving;
  const fieldErrors = configurationFieldErrors(
    configuration.provider,
    apiKey,
    model,
    configuration.prompt,
    details,
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

  const modelHint = modelDiscoveryHint(apiKey, discovery);

  return (
    <Canvas ctx={ctx}>
      <p className={s.intro}>
        Choose the service that will inspect your images and generate localized
        alt text. API requests run directly from the DatoCMS dashboard.
      </p>

      <p className={s.documentationHint}>
        Not sure where to find the alt text actions?{' '}
        <a
          href={ACTIONS_DOCUMENTATION_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="See where the alt text actions appear in the documentation (opens in a new tab)"
        >
          See the illustrated usage guide ↗
        </a>
      </p>

      {!canEdit && (
        <div className={s.readOnlyNotice}>
          Your role can view these settings but cannot change plugin
          configuration.
        </div>
      )}

      {hasExternalChanges && (
        <div className={s.externalChangeNotice}>
          <span>
            Plugin settings changed elsewhere while you were editing. Load the
            latest settings to avoid overwriting them.
          </span>
          <Button
            buttonType="muted"
            buttonSize="s"
            disabled={isSaving}
            onClick={() => {
              setConfiguration(initialConfiguration);
              setSavedConfiguration(initialConfiguration);
              setHasExternalChanges(false);
            }}
          >
            Load latest settings
          </Button>
        </div>
      )}

      <Form onSubmit={() => void save()}>
        <Section title="Provider">
          <FieldGroup>
            <SelectField
              id="provider"
              name="provider"
              label="Alt text provider"
              value={PROVIDER_OPTIONS.find(
                (option) => option.value === configuration.provider,
              )}
              selectInputProps={{
                isDisabled: controlsDisabled,
                options: PROVIDER_OPTIONS,
              }}
              onChange={(value) => {
                const provider = providerOption(value);
                if (provider) {
                  setConfiguration((current) => ({ ...current, provider }));
                }
              }}
            />

            <div>
              <TextField
                required
                id="providerApiKey"
                name="providerApiKey"
                label={details.apiKeyLabel}
                error={fieldErrors.apiKey}
                placeholder={details.apiKeyPlaceholder}
                value={apiKey}
                textInputProps={{
                  autoComplete: 'off',
                  disabled: controlsDisabled,
                  monospaced: true,
                  type: 'password',
                }}
                onChange={(value) =>
                  setConfiguration((current) =>
                    withProviderApiKey(current, value),
                  )
                }
              />
              <p className={s.fieldHelp}>
                Create or manage keys in the{' '}
                <a href={details.apiKeyUrl} target="_blank" rel="noreferrer">
                  {PROVIDER_LABELS[configuration.provider]} dashboard
                </a>
                . The key is stored in this plugin's settings and used by
                browser requests.
              </p>
            </div>

            {isDirectProvider(configuration.provider) && (
              <CreatableSelectField
                required
                id="providerModel"
                name="providerModel"
                label={details.modelLabel || 'Model'}
                error={fieldErrors.model}
                hint={modelHint}
                value={model ? { label: model, value: model } : null}
                selectInputProps={{
                  formatCreateLabel: (inputValue) =>
                    `Use model “${inputValue}”`,
                  isDisabled: controlsDisabled,
                  isLoading: discovery.isLoading,
                  options: availableModelOptions,
                }}
                onChange={(value) => {
                  const selectedModel = optionValue(value);
                  if (selectedModel) {
                    setConfiguration((current) =>
                      withProviderModel(current, selectedModel),
                    );
                  }
                }}
              />
            )}
          </FieldGroup>
        </Section>

        <Section title="Generation instructions">
          {configuration.provider === 'alttext-ai' ? (
            <p className={s.sectionHelp}>
              AltText.ai applies the generation settings configured in your
              AltText.ai account. The prompt below is used when you select a
              direct model provider.
            </p>
          ) : (
            <p className={s.sectionHelp}>
              The prompt is sent with each image. Keep the output instruction
              strict so the response contains only usable alt text.
            </p>
          )}
          <TextareaField
            required={configuration.provider !== 'alttext-ai'}
            id="prompt"
            name="prompt"
            label="Prompt template"
            error={fieldErrors.prompt}
            hint="Available placeholders: {locale} and {filename}."
            value={configuration.prompt}
            textareaInputProps={{
              disabled: controlsDisabled,
              rows: 7,
            }}
            onChange={(prompt) =>
              setConfiguration((current) => ({ ...current, prompt }))
            }
          />
        </Section>

        {canEdit && (
          <Button
            type="submit"
            buttonType="primary"
            buttonSize="l"
            disabled={
              !isDirty ||
              isSaving ||
              hasExternalChanges ||
              validationError !== null
            }
            fullWidth
          >
            {isSaving ? 'Saving…' : 'Save settings'}
            {isSaving && <Spinner size={24} />}
          </Button>
        )}
      </Form>
    </Canvas>
  );
}
