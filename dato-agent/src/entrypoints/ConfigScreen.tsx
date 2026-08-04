import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  Section,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from 'datocms-react-ui';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AgentConfig,
  type AgentProvider,
  activeApiKey,
  activeModel,
  activeReasoningEffort,
  normalizeConfig,
  providerLabel,
  type ReasoningEffort,
  serializeConfig,
  withActiveApiKey,
  withActiveModel,
  withActiveReasoningEffort,
} from '../lib/config';
import {
  listProviderModels,
  type ProviderModel,
  preferredProviderModel,
} from '../lib/providerModels';
import styles from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type ProviderOption = {
  label: string;
  value: AgentProvider;
};

type ReasoningOption = {
  label: string;
  value: ReasoningEffort;
};

type ModelOption = {
  label: string;
  value: string;
};

type ModelDiscoveryState = {
  requestKey: string;
  models: ProviderModel[];
  loading: boolean;
  loaded: boolean;
  error?: string;
};

const MODEL_DISCOVERY_DELAY_MS = 500;

const PROVIDER_OPTIONS: ProviderOption[] = [
  { label: providerLabel('openai'), value: 'openai' },
  { label: providerLabel('anthropic'), value: 'anthropic' },
];

const PROVIDER_DETAILS: Record<
  AgentProvider,
  {
    name: string;
    apiKeyLabel: string;
    apiKeyPlaceholder: string;
    modelLabel: string;
  }
> = {
  openai: {
    name: 'OpenAI',
    apiKeyLabel: 'OpenAI API key',
    apiKeyPlaceholder: 'sk-…',
    modelLabel: 'OpenAI model',
  },
  anthropic: {
    name: 'Anthropic',
    apiKeyLabel: 'Anthropic API key',
    apiKeyPlaceholder: 'sk-ant-…',
    modelLabel: 'Claude model',
  },
};

const REASONING_OPTIONS: ReasoningOption[] = [
  { label: 'None — fastest, no reasoning', value: 'none' },
  { label: 'Low — faster responses', value: 'low' },
  { label: 'Medium — balanced', value: 'medium' },
  { label: 'High — deeper reasoning', value: 'high' },
  { label: 'X-high — intensive reasoning', value: 'xhigh' },
  { label: 'Max — maximum reasoning', value: 'max' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function modelOptions(
  models: readonly ProviderModel[],
  currentModel: string,
): ModelOption[] {
  if (models.length === 0) {
    return currentModel ? [{ label: currentModel, value: currentModel }] : [];
  }

  return models.map((model) => ({
    label: model.label,
    value: model.id,
  }));
}

function configFingerprint(config: AgentConfig): string {
  return JSON.stringify(config);
}

function discoveryRequestKey(
  provider: AgentProvider,
  apiKey: string,
  retryAttempt: number,
): string {
  return JSON.stringify([provider, apiKey, retryAttempt]);
}

function emptyDiscoveryState(requestKey: string): ModelDiscoveryState {
  return {
    requestKey,
    models: [],
    loading: false,
    loaded: false,
  };
}

function useProviderModels(
  provider: AgentProvider,
  apiKey: string,
  retryAttempt: number,
): ModelDiscoveryState {
  const request = useMemo(
    () => ({
      provider,
      apiKey,
      requestKey: discoveryRequestKey(provider, apiKey, retryAttempt),
    }),
    [apiKey, provider, retryAttempt],
  );
  const [state, setState] = useState<ModelDiscoveryState>(() =>
    emptyDiscoveryState(request.requestKey),
  );

  useEffect(() => {
    if (!request.apiKey.trim()) {
      setState(emptyDiscoveryState(request.requestKey));
      return;
    }

    setState(emptyDiscoveryState(request.requestKey));
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setState({
        ...emptyDiscoveryState(request.requestKey),
        loading: true,
      });

      void listProviderModels(
        request.provider,
        request.apiKey,
        abortController.signal,
      )
        .then((models) => {
          if (!abortController.signal.aborted) {
            setState({
              requestKey: request.requestKey,
              models,
              loading: false,
              loaded: true,
            });
          }
        })
        .catch((error: unknown) => {
          if (!abortController.signal.aborted) {
            setState({
              ...emptyDiscoveryState(request.requestKey),
              error: `Could not load models: ${errorMessage(error)}`,
            });
          }
        });
    }, MODEL_DISCOVERY_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [request]);

  return state.requestKey === request.requestKey
    ? state
    : emptyDiscoveryState(request.requestKey);
}

function modelDiscoveryHint(
  provider: AgentProvider,
  apiKey: string,
  discovery: ModelDiscoveryState,
  retry: () => void,
): ReactNode {
  const { name } = PROVIDER_DETAILS[provider];

  if (!apiKey.trim()) {
    return 'Enter an API key to load compatible models.';
  }
  if (discovery.loading) {
    return `Loading models from ${name}…`;
  }
  if (discovery.error) {
    return (
      <>
        {discovery.error}{' '}
        <button className={styles.retryButton} onClick={retry} type="button">
          Retry
        </button>
      </>
    );
  }
  if (!discovery.loaded) {
    return 'Waiting to load models…';
  }
  if (discovery.models.length === 0) {
    return 'No compatible agent models are available for this API key.';
  }

  const count = discovery.models.length;
  return `${count} compatible model${count === 1 ? '' : 's'} available.`;
}

function configurationValidationError(
  config: AgentConfig,
  discovery: ModelDiscoveryState,
): string | undefined {
  const details = PROVIDER_DETAILS[config.provider];
  const apiKey = activeApiKey(config);
  const model = activeModel(config);

  if (!apiKey.trim()) {
    return `${details.apiKeyLabel} is required.`;
  }
  if (!model.trim()) {
    return `${details.modelLabel} is required.`;
  }
  if (discovery.error) {
    return discovery.error;
  }
  if (!discovery.loaded) {
    return `Wait for the ${details.name} model list to finish loading.`;
  }
  const selectedModel = discovery.models.find(
    (candidate) => candidate.id === model,
  );
  if (!selectedModel) {
    return `Choose a model returned by ${details.name} for this API key.`;
  }
  if (!selectedModel.reasoningEfforts.includes(activeReasoningEffort(config))) {
    return `Choose a reasoning effort supported by the selected ${details.name} model.`;
  }

  return undefined;
}

function modelFieldError(
  attemptedSave: boolean,
  config: AgentConfig,
  discovery: ModelDiscoveryState,
): string | undefined {
  if (!attemptedSave) {
    return undefined;
  }

  const details = PROVIDER_DETAILS[config.provider];
  const model = activeModel(config);
  if (!model.trim()) {
    return `${details.modelLabel} is required.`;
  }
  if (
    discovery.loaded &&
    !discovery.models.some((candidate) => candidate.id === model)
  ) {
    return `Choose a model returned by ${details.name}.`;
  }

  return undefined;
}

function reasoningOptions(
  provider: AgentProvider,
  selectedModel: ProviderModel | undefined,
): ReasoningOption[] {
  const recommendedEffort: ReasoningEffort =
    provider === 'openai' ? 'medium' : 'high';
  const supportedEfforts =
    selectedModel?.reasoningEfforts ??
    (provider === 'openai'
      ? REASONING_OPTIONS.map((option) => option.value)
      : REASONING_OPTIONS.flatMap((option) =>
          option.value === 'none' ? [] : [option.value],
        ));

  return REASONING_OPTIONS.filter(
    (option) =>
      (provider === 'openai' || option.value !== 'none') &&
      supportedEfforts.includes(option.value),
  ).map((option) =>
    option.value === recommendedEffort
      ? { ...option, label: `${option.label} (Recommended)` }
      : option,
  );
}

function preferredReasoningEffort(
  options: readonly ReasoningOption[],
): ReasoningEffort | undefined {
  return (
    options.find((option) => option.value === 'high')?.value ??
    options.find((option) => option.value === 'medium')?.value ??
    options[0]?.value
  );
}

function configWithSelectedModel(
  config: AgentConfig,
  selectedModel: ProviderModel,
): AgentConfig {
  const withModel = withActiveModel(
    config,
    selectedModel.id,
    selectedModel.maxOutputTokens,
  );
  const availableOptions = reasoningOptions(config.provider, selectedModel);
  if (
    availableOptions.some(
      (option) => option.value === activeReasoningEffort(withModel),
    )
  ) {
    return withModel;
  }

  const fallback = preferredReasoningEffort(availableOptions);
  return fallback ? withActiveReasoningEffort(withModel, fallback) : withModel;
}

type ProviderConfigurationFieldsProps = {
  apiKey: string;
  attemptedSave: boolean;
  availableModelOptions: ModelOption[];
  availableReasoningOptions: ReasoningOption[];
  canEditSchema: boolean;
  config: AgentConfig;
  discovery: ModelDiscoveryState;
  model: string;
  modelSelectDisabled: boolean;
  reasoningEffort: ReasoningEffort;
  retryModelDiscovery: () => void;
  saving: boolean;
  selectedModel?: ProviderModel;
  setAttemptedSave: Dispatch<SetStateAction<boolean>>;
  setConfig: Dispatch<SetStateAction<AgentConfig>>;
};

function ProviderConfigurationFields({
  apiKey,
  attemptedSave,
  availableModelOptions,
  availableReasoningOptions,
  canEditSchema,
  config,
  discovery,
  model,
  modelSelectDisabled,
  reasoningEffort,
  retryModelDiscovery,
  saving,
  selectedModel,
  setAttemptedSave,
  setConfig,
}: ProviderConfigurationFieldsProps) {
  const details = PROVIDER_DETAILS[config.provider];

  return (
    <Section title="AI provider">
      <FieldGroup>
        <SelectField<ProviderOption, false, never>
          id="provider"
          name="provider"
          label="Vendor"
          value={
            PROVIDER_OPTIONS.find(
              (option) => option.value === config.provider,
            ) ?? PROVIDER_OPTIONS[0]
          }
          onChange={(option) => {
            if (option) {
              setAttemptedSave(false);
              setConfig((current) => ({
                ...current,
                provider: option.value,
              }));
            }
          }}
          selectInputProps={{
            options: PROVIDER_OPTIONS,
            isDisabled: !canEditSchema || saving,
          }}
        />
        <TextField
          id="provider-api-key"
          name="provider-api-key"
          label={details.apiKeyLabel}
          required
          value={apiKey}
          placeholder={details.apiKeyPlaceholder}
          error={
            attemptedSave && !apiKey.trim()
              ? `${details.apiKeyLabel} is required.`
              : undefined
          }
          hint="Shared across this project. Each editor connects DatoCMS separately in the agent."
          onChange={(value) =>
            setConfig((current) => withActiveApiKey(current, value))
          }
          textInputProps={{
            'aria-required': true,
            autoComplete: 'off',
            disabled: !canEditSchema || saving,
            monospaced: true,
            spellCheck: false,
            type: 'password',
          }}
        />
        <SelectField<ModelOption, false, never>
          id="model"
          name="model"
          label={details.modelLabel}
          required
          value={
            availableModelOptions.find((option) => option.value === model) ??
            null
          }
          error={modelFieldError(attemptedSave, config, discovery)}
          hint={modelDiscoveryHint(
            config.provider,
            apiKey,
            discovery,
            retryModelDiscovery,
          )}
          onChange={(option) => {
            if (option) {
              const nextModel = discovery.models.find(
                (candidate) => candidate.id === option.value,
              );
              setConfig((current) =>
                nextModel
                  ? configWithSelectedModel(current, nextModel)
                  : withActiveModel(current, option.value),
              );
            }
          }}
          selectInputProps={{
            options: availableModelOptions,
            isDisabled: modelSelectDisabled,
            isLoading: discovery.loading,
            required: true,
          }}
        />
        <SelectField<ReasoningOption, false, never>
          id="reasoning-effort"
          name="reasoning-effort"
          label="Reasoning effort"
          value={
            availableReasoningOptions.find(
              (option) => option.value === reasoningEffort,
            ) ??
            availableReasoningOptions[0] ??
            null
          }
          onChange={(option) => {
            if (option) {
              setConfig((current) =>
                withActiveReasoningEffort(current, option.value),
              );
            }
          }}
          hint={
            config.provider === 'anthropic'
              ? 'Options supported by the selected Claude model.'
              : 'Availability depends on the selected model.'
          }
          selectInputProps={{
            options: availableReasoningOptions,
            isDisabled:
              !canEditSchema ||
              saving ||
              (config.provider === 'anthropic' && !selectedModel),
          }}
        />
      </FieldGroup>
    </Section>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  const incomingConfig = useMemo(
    () => normalizeConfig(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters],
  );
  const incomingConfigFingerprint = useMemo(
    () => configFingerprint(incomingConfig),
    [incomingConfig],
  );
  const incomingConfigRef = useRef(incomingConfig);
  incomingConfigRef.current = incomingConfig;
  const [config, setConfig] = useState<AgentConfig>(() => incomingConfig);
  const [savedConfigFingerprint, setSavedConfigFingerprint] = useState(() =>
    configFingerprint(incomingConfig),
  );
  const savedConfigFingerprintRef = useRef(configFingerprint(incomingConfig));
  const [modelRetryAttempt, setModelRetryAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const canEditSchema = ctx.currentRole.meta.final_permissions.can_edit_schema;
  const apiKey = activeApiKey(config);
  const model = activeModel(config);
  const modelDiscovery = useProviderModels(
    config.provider,
    apiKey,
    modelRetryAttempt,
  );
  const isDirty = configFingerprint(config) !== savedConfigFingerprint;

  useEffect(() => {
    const previousSavedFingerprint = savedConfigFingerprintRef.current;

    setConfig((current) =>
      configFingerprint(current) === previousSavedFingerprint
        ? incomingConfigRef.current
        : current,
    );
    savedConfigFingerprintRef.current = incomingConfigFingerprint;
    setSavedConfigFingerprint(incomingConfigFingerprint);
  }, [incomingConfigFingerprint]);

  useEffect(() => {
    if (!modelDiscovery.loaded || model || modelDiscovery.models.length === 0) {
      return;
    }

    const preferred = preferredProviderModel(
      config.provider,
      modelDiscovery.models,
    );
    if (!preferred) {
      return;
    }

    setConfig((current) =>
      current.provider === config.provider && !activeModel(current)
        ? configWithSelectedModel(current, preferred)
        : current,
    );
  }, [config.provider, model, modelDiscovery.loaded, modelDiscovery.models]);

  const selectedModel = modelDiscovery.models.find(
    (candidate) => candidate.id === model,
  );
  const availableReasoningOptions = reasoningOptions(
    config.provider,
    selectedModel,
  );
  const reasoningEffort = activeReasoningEffort(config);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    setConfig((current) => {
      if (
        current.provider !== config.provider ||
        activeModel(current) !== selectedModel.id
      ) {
        return current;
      }

      const synchronized = configWithSelectedModel(current, selectedModel);
      return configFingerprint(synchronized) === configFingerprint(current)
        ? current
        : synchronized;
    });
  }, [config.provider, selectedModel]);

  const availableModelOptions = useMemo(
    () => modelOptions(modelDiscovery.models, model),
    [model, modelDiscovery.models],
  );
  const modelSelectDisabled =
    !canEditSchema ||
    saving ||
    !apiKey.trim() ||
    modelDiscovery.loading ||
    !modelDiscovery.loaded ||
    Boolean(modelDiscovery.error);
  const saveDisabled =
    saving ||
    !isDirty ||
    modelDiscovery.loading ||
    Boolean(apiKey.trim() && !modelDiscovery.loaded);
  const retryModelDiscovery = () =>
    setModelRetryAttempt((attempt) => attempt + 1);

  const update = <Key extends keyof AgentConfig>(
    key: Key,
    value: AgentConfig[Key],
  ) => setConfig((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!canEditSchema) {
      return;
    }

    setAttemptedSave(true);
    const selectedModelForSave = modelDiscovery.models.find(
      (candidate) => candidate.id === activeModel(config),
    );
    const configForSave = selectedModelForSave
      ? configWithSelectedModel(config, selectedModelForSave)
      : config;
    const validationError = configurationValidationError(
      configForSave,
      modelDiscovery,
    );
    if (validationError) {
      return;
    }

    setSaving(true);
    try {
      const normalizedConfig = normalizeConfig(configForSave);
      await ctx.updatePluginParameters(
        serializeConfig(ctx.plugin.attributes.parameters, normalizedConfig),
      );
      const nextFingerprint = configFingerprint(normalizedConfig);
      savedConfigFingerprintRef.current = nextFingerprint;
      setSavedConfigFingerprint(nextFingerprint);
      setConfig(normalizedConfig);
      setAttemptedSave(false);
      await ctx.notice('Dato Agent (Beta) settings saved');
    } catch (error) {
      await ctx.alert(`Could not save settings: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div>
        {!canEditSchema && (
          <div className={styles.permissionNotice} role="status">
            You can view these settings, but only roles allowed to edit the
            schema can change them.
          </div>
        )}

        <Form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ProviderConfigurationFields
            apiKey={apiKey}
            attemptedSave={attemptedSave}
            availableModelOptions={availableModelOptions}
            availableReasoningOptions={availableReasoningOptions}
            canEditSchema={canEditSchema}
            config={config}
            discovery={modelDiscovery}
            model={model}
            modelSelectDisabled={modelSelectDisabled}
            reasoningEffort={reasoningEffort}
            retryModelDiscovery={retryModelDiscovery}
            saving={saving}
            selectedModel={selectedModel}
            setAttemptedSave={setAttemptedSave}
            setConfig={setConfig}
          />

          <Section title="Agent behavior">
            <FieldGroup>
              <TextareaField
                id="additional-instructions"
                name="additional-instructions"
                label="Additional instructions"
                value={config.additionalInstructions}
                placeholder="For example: Always use British English for public copy."
                hint="Added to the built-in project and safety instructions."
                onChange={(value) => update('additionalInstructions', value)}
                textareaInputProps={{
                  disabled: !canEditSchema || saving,
                  rows: 5,
                }}
              />
            </FieldGroup>
          </Section>

          <Section title="Record sidebar">
            <FieldGroup>
              <SwitchField
                id="enable-record-sidebar"
                name="enable-record-sidebar"
                label="Show Dato Agent (Beta) in record sidebars"
                hint="Adds contextual chat beside individual records."
                value={config.enableRecordSidebar}
                onChange={(value) => update('enableRecordSidebar', value)}
                switchInputProps={{
                  name: 'enable-record-sidebar',
                  value: config.enableRecordSidebar,
                  disabled: !canEditSchema || saving,
                }}
              />
            </FieldGroup>
          </Section>

          {canEditSchema && (
            <Button
              type="submit"
              buttonType="primary"
              disabled={saveDisabled}
              fullWidth
            >
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          )}
        </Form>
      </div>
    </Canvas>
  );
}
