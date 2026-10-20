import { buildClient } from '@datocms/cma-client-browser';
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
  activeFastMode,
  activeModel,
  activeReasoningEffort,
  normalizeConfig,
  providerLabel,
  type ReasoningEffort,
  serializeConfig,
  withActiveApiKey,
  withActiveFastMode,
  withActiveModel,
  withActiveReasoningEffort,
} from '../lib/config';
import { ACCOUNT_ROLE_ID } from '../lib/permissions';
import {
  listProviderModels,
  type ProviderModel,
  preferredProviderModel,
  providerModelSupportsFastMode,
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

type ModelOptionGroup = {
  label?: string;
  options: ModelOption[];
};

type RoleOption = {
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

type ProjectRole = {
  id: string;
  name: string;
};

type RoleDiscoveryState = {
  requestKey: string;
  roles: ProjectRole[];
  loading: boolean;
  loaded: boolean;
  error?: string;
};

const MODEL_DISCOVERY_DELAY_MS = 500;

const PROVIDER_OPTIONS: ProviderOption[] = [
  { label: providerLabel('openai'), value: 'openai' },
  { label: providerLabel('anthropic'), value: 'anthropic' },
  { label: providerLabel('vercel'), value: 'vercel' },
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
  vercel: {
    name: 'Vercel AI Gateway',
    apiKeyLabel: 'AI Gateway API key',
    apiKeyPlaceholder: 'vck_…',
    modelLabel: 'Model',
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

function toModelOption(model: ProviderModel): ModelOption {
  return { label: model.label, value: model.id };
}

function modelSelectGroups(
  config: AgentConfig,
  models: readonly ProviderModel[],
  currentModel: string,
): ModelOptionGroup[] {
  if (config.provider !== 'vercel') {
    return [
      {
        options:
          models.length > 0
            ? models.map(toModelOption)
            : currentModel
              ? [{ label: currentModel, value: currentModel }]
              : [],
      },
    ];
  }

  const recommended = models.filter((model) => model.recommended);
  const others = models.filter((model) => !model.recommended);
  const groups: ModelOptionGroup[] = [];
  if (recommended.length > 0) {
    groups.push({
      label: 'Recommended',
      options: recommended.map(toModelOption),
    });
  }
  if (config.vercelShowAllModels && others.length > 0) {
    groups.push({
      label: 'All tool-capable models',
      options: others.map(toModelOption),
    });
  }

  const visibleIds = new Set(
    groups.flatMap((group) => group.options.map((option) => option.value)),
  );
  if (currentModel && !visibleIds.has(currentModel)) {
    const current = models.find((model) => model.id === currentModel);
    groups.push({
      label: 'Current model',
      options: [{ label: current?.label ?? currentModel, value: currentModel }],
    });
  }

  return groups.length > 0 ? groups : [{ options: [] }];
}

function flattenModelOptions(
  groups: readonly ModelOptionGroup[],
): ModelOption[] {
  return groups.flatMap((group) => [...group.options]);
}

function configFingerprint(config: AgentConfig): string {
  return JSON.stringify(config);
}

function providerConfigurationFingerprint(config: AgentConfig): string {
  switch (config.provider) {
    case 'openai':
      return JSON.stringify({
        provider: config.provider,
        apiKey: config.openAiApiKey,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        fastMode: config.openAiFastMode,
      });
    case 'anthropic':
      return JSON.stringify({
        provider: config.provider,
        apiKey: config.anthropicApiKey,
        model: config.anthropicModel,
        modelMaxOutputTokens: config.anthropicModelMaxOutputTokens,
        reasoningEffort: config.anthropicReasoningEffort,
        fastMode: config.anthropicFastMode,
      });
    case 'vercel':
      return JSON.stringify({
        provider: config.provider,
        apiKey: config.vercelApiKey,
        model: config.vercelModel,
        modelMaxOutputTokens: config.vercelModelMaxOutputTokens,
        modelReasoningEfforts: config.vercelModelReasoningEfforts,
        reasoningEffort: config.vercelReasoningEffort,
        fastMode: config.vercelFastMode,
        showAllModels: config.vercelShowAllModels,
      });
    default: {
      const unreachable: never = config.provider;
      return unreachable;
    }
  }
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

function emptyRoleDiscoveryState(requestKey: string): RoleDiscoveryState {
  return {
    requestKey,
    roles: [],
    loading: false,
    loaded: false,
  };
}

function roleDiscoveryRequestKey(
  canManageUsers: boolean,
  apiToken: string | undefined,
  environment: string,
  baseUrl: string,
  retryAttempt: number,
): string {
  return JSON.stringify([
    canManageUsers,
    Boolean(apiToken),
    environment,
    baseUrl,
    retryAttempt,
  ]);
}

function useProjectRoles(
  canManageUsers: boolean,
  apiToken: string | undefined,
  environment: string,
  baseUrl: string,
  retryAttempt: number,
): RoleDiscoveryState {
  const requestKey = roleDiscoveryRequestKey(
    canManageUsers,
    apiToken,
    environment,
    baseUrl,
    retryAttempt,
  );
  const [state, setState] = useState<RoleDiscoveryState>(() =>
    emptyRoleDiscoveryState(requestKey),
  );

  useEffect(() => {
    if (!canManageUsers) {
      setState(emptyRoleDiscoveryState(requestKey));
      return;
    }

    if (!apiToken) {
      setState({
        ...emptyRoleDiscoveryState(requestKey),
        error: 'The current user access token is unavailable.',
      });
      return;
    }

    let cancelled = false;
    setState({
      ...emptyRoleDiscoveryState(requestKey),
      loading: true,
    });

    void (async () => {
      try {
        const client = buildClient({
          apiToken,
          environment,
          baseUrl,
        });
        const roles = await client.roles.list();

        if (cancelled) {
          return;
        }

        setState({
          requestKey,
          roles: roles
            .filter((role) => role.id !== ACCOUNT_ROLE_ID)
            .map((role) => ({ id: role.id, name: role.name || role.id }))
            .sort(
              (left, right) =>
                left.name.localeCompare(right.name) ||
                left.id.localeCompare(right.id),
            ),
          loading: false,
          loaded: true,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            ...emptyRoleDiscoveryState(requestKey),
            error: errorMessage(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiToken, baseUrl, canManageUsers, environment, requestKey]);

  return state.requestKey === requestKey
    ? state
    : emptyRoleDiscoveryState(requestKey);
}

function normalizedRoleIds(roleIds: readonly string[]): string[] {
  return [
    ...new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

function roleOptionsForSelection(
  roleIds: readonly string[],
  availableOptions: readonly RoleOption[],
): RoleOption[] {
  const optionsById = new Map(
    availableOptions.map((option) => [option.value, option]),
  );

  return roleIds.map(
    (roleId) =>
      optionsById.get(roleId) ?? {
        label: `Unavailable role (${roleId})`,
        value: roleId,
      },
  );
}

type RoleSelectionState = {
  implicitRoleDraftIds: string[];
  selectedRoleOptions: RoleOption[];
  hasUnsavedRoleSnapshot: boolean;
};

function buildRoleSelectionState(
  allowedRoleIds: AgentConfig['allowedRoleIds'],
  canManageUsers: boolean,
  roleDiscovery: RoleDiscoveryState,
  availableOptions: readonly RoleOption[],
): RoleSelectionState {
  const implicitRoleDraftIds = normalizedRoleIds(
    roleDiscovery.roles.map((role) => role.id),
  );
  const hasUnsavedRoleSnapshot =
    allowedRoleIds === null && canManageUsers && roleDiscovery.loaded;
  const displayedAllowedRoleIds = hasUnsavedRoleSnapshot
    ? implicitRoleDraftIds
    : (allowedRoleIds ?? []);

  return {
    implicitRoleDraftIds,
    selectedRoleOptions: roleOptionsForSelection(
      displayedAllowedRoleIds,
      availableOptions,
    ),
    hasUnsavedRoleSnapshot,
  };
}

function configIsDirty(
  config: AgentConfig,
  savedFingerprint: string,
  hasUnsavedRoleSnapshot: boolean,
): boolean {
  return (
    configFingerprint(config) !== savedFingerprint || hasUnsavedRoleSnapshot
  );
}

function configWithRoleSnapshot(
  config: AgentConfig,
  canManageUsers: boolean,
  roleDiscovery: RoleDiscoveryState,
  implicitRoleDraftIds: string[],
): AgentConfig {
  if (
    config.allowedRoleIds !== null ||
    !canManageUsers ||
    !roleDiscovery.loaded
  ) {
    return config;
  }

  return { ...config, allowedRoleIds: implicitRoleDraftIds };
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
  refreshDisabled: boolean,
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
  const count = discovery.models.length;
  const summary =
    provider === 'vercel'
      ? `${discovery.models.filter((model) => model.recommended).length} recommended models, ${count} tool-capable model${count === 1 ? '' : 's'} available.`
      : count === 0
        ? 'No compatible agent models are available for this API key.'
        : `${count} compatible model${count === 1 ? '' : 's'} available.`;
  return (
    <>
      {summary}{' '}
      <Button
        buttonSize="xxs"
        disabled={refreshDisabled}
        onClick={retry}
        type="button"
      >
        Refresh models
      </Button>
    </>
  );
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
  if (
    selectedModel.reasoningEfforts.length > 0 &&
    !selectedModel.reasoningEfforts.includes(activeReasoningEffort(config))
  ) {
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

function fallbackReasoningEfforts(config: AgentConfig): ReasoningEffort[] {
  switch (config.provider) {
    case 'openai':
      return REASONING_OPTIONS.map((option) => option.value);
    case 'anthropic':
      return REASONING_OPTIONS.flatMap((option) =>
        option.value === 'none' ? [] : [option.value],
      );
    case 'vercel':
      return config.vercelModelReasoningEfforts;
    default: {
      const unreachable: never = config.provider;
      return unreachable;
    }
  }
}

function reasoningOptions(
  config: AgentConfig,
  selectedModel: ProviderModel | undefined,
): ReasoningOption[] {
  const recommendedEffort: ReasoningEffort =
    config.provider === 'openai' ? 'medium' : 'high';
  const supportedEfforts =
    selectedModel?.reasoningEfforts ?? fallbackReasoningEfforts(config);

  return REASONING_OPTIONS.filter(
    (option) =>
      (config.provider !== 'anthropic' || option.value !== 'none') &&
      supportedEfforts.includes(option.value),
  ).map((option) =>
    option.value === recommendedEffort
      ? { ...option, label: `${option.label} (Recommended)` }
      : option,
  );
}

function preferredReasoningEffort(
  provider: AgentProvider,
  options: readonly ReasoningOption[],
): ReasoningEffort | undefined {
  const high = options.find((option) => option.value === 'high')?.value;
  if (high) {
    return high;
  }
  if (provider === 'vercel') {
    return options.at(-1)?.value;
  }
  return (
    options.find((option) => option.value === 'medium')?.value ??
    options[0]?.value
  );
}

function configWithSelectedModel(
  config: AgentConfig,
  selectedModel: ProviderModel,
): AgentConfig {
  let withModel = withActiveModel(
    config,
    selectedModel.id,
    selectedModel.maxOutputTokens,
    config.provider === 'vercel' ? selectedModel.reasoningEfforts : undefined,
  );
  if (
    activeFastMode(withModel) &&
    !providerModelSupportsFastMode(config.provider, selectedModel.id, [
      selectedModel,
    ])
  ) {
    withModel = withActiveFastMode(withModel, false);
  }
  const availableOptions = reasoningOptions(config, selectedModel);
  if (
    availableOptions.some(
      (option) => option.value === activeReasoningEffort(withModel),
    )
  ) {
    return withModel;
  }

  const fallback = preferredReasoningEffort(config.provider, availableOptions);
  return fallback ? withActiveReasoningEffort(withModel, fallback) : withModel;
}

type ProviderConfigurationFieldsProps = {
  apiKey: string;
  attemptedSave: boolean;
  availableModelGroups: ModelOptionGroup[];
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

function reasoningEffortHint(
  config: AgentConfig,
  selectedModel: ProviderModel | undefined,
): string {
  switch (config.provider) {
    case 'anthropic':
      return 'Options supported by the selected Claude model.';
    case 'vercel':
      return selectedModel && selectedModel.reasoningEfforts.length === 0
        ? 'This model does not expose reasoning controls.'
        : 'Options reported by the Vercel AI Gateway catalog for this model.';
    case 'openai':
      return 'Availability depends on the selected model.';
    default: {
      const unreachable: never = config.provider;
      return unreachable;
    }
  }
}

function fastModeHintFor(
  provider: AgentProvider,
  fastModeSupported: boolean,
): string {
  if (fastModeSupported) {
    return provider === 'vercel'
      ? 'Switches this model to its faster gateway variant. That variant costs more per token.'
      : 'Uses premium processing for every model request, including tool steps, and can significantly increase API costs.';
  }
  switch (provider) {
    case 'anthropic':
      return 'Not available for this Claude model. Anthropic Fast mode currently requires a supported Opus model and preview access.';
    case 'vercel':
      return 'Not available for this model. The gateway catalog has no faster variant.';
    case 'openai':
      return 'Not available for the selected OpenAI model.';
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

function ProviderConfigurationFields({
  apiKey,
  attemptedSave,
  availableModelGroups,
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
  const fastMode = activeFastMode(config);
  const fastModeSupported = selectedModel
    ? providerModelSupportsFastMode(config.provider, selectedModel.id, [
        selectedModel,
      ])
    : false;
  const modelOptions = flattenModelOptions(availableModelGroups);
  const reasoningHint = reasoningEffortHint(config, selectedModel);
  const fastModeHint = fastModeHintFor(config.provider, fastModeSupported);

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
          hint={
            config.provider === 'vercel'
              ? 'Create this key under Vercel → AI Gateway → API keys. Requests are billed to the team’s AI Gateway credits, or to bring-your-own provider keys configured there.'
              : 'Shared across this project. Each editor connects DatoCMS separately in the agent.'
          }
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
        <SelectField<ModelOption, false, ModelOptionGroup>
          id="model"
          name="model"
          label={details.modelLabel}
          required
          value={modelOptions.find((option) => option.value === model) ?? null}
          error={modelFieldError(attemptedSave, config, discovery)}
          hint={modelDiscoveryHint(
            config.provider,
            apiKey,
            discovery,
            retryModelDiscovery,
            saving,
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
            options: availableModelGroups,
            isDisabled: modelSelectDisabled,
            isLoading: discovery.loading,
            required: true,
          }}
        />
        {config.provider === 'vercel' && (
          <SwitchField
            id="vercel-show-all-models"
            name="vercel-show-all-models"
            label="Show all tool-capable models"
            hint="Recommended models are the closest fit for editing DatoCMS content. The full list is every gateway language model that can call tools."
            value={config.vercelShowAllModels}
            onChange={(value) =>
              setConfig((current) =>
                current.provider === 'vercel'
                  ? { ...current, vercelShowAllModels: value }
                  : current,
              )
            }
            switchInputProps={{
              name: 'vercel-show-all-models',
              value: config.vercelShowAllModels,
              disabled: !canEditSchema || saving,
            }}
          />
        )}
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
          hint={reasoningHint}
          selectInputProps={{
            options: availableReasoningOptions,
            isDisabled:
              !canEditSchema ||
              saving ||
              availableReasoningOptions.length === 0 ||
              (config.provider === 'anthropic' && !selectedModel),
          }}
        />
        <SwitchField
          id="fast-mode"
          name="fast-mode"
          label="Fast mode"
          hint={fastModeHint}
          value={fastMode}
          onChange={(value) =>
            setConfig((current) => withActiveFastMode(current, value))
          }
          switchInputProps={{
            name: 'fast-mode',
            value: fastMode,
            disabled: !canEditSchema || saving || !fastModeSupported,
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
  const savedConfigRef = useRef(incomingConfig);
  const [config, setConfig] = useState<AgentConfig>(() => incomingConfig);
  const [savedConfigFingerprint, setSavedConfigFingerprint] = useState(() =>
    configFingerprint(incomingConfig),
  );
  const savedConfigFingerprintRef = useRef(configFingerprint(incomingConfig));
  const [modelRetryAttempt, setModelRetryAttempt] = useState(0);
  const [roleRetryAttempt, setRoleRetryAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const canEditSchema = ctx.currentRole.meta.final_permissions.can_edit_schema;
  const canManageUsers =
    ctx.currentRole.meta.final_permissions.can_manage_users;
  const apiKey = activeApiKey(config);
  const model = activeModel(config);
  const modelDiscovery = useProviderModels(
    config.provider,
    apiKey,
    modelRetryAttempt,
  );
  const roleDiscovery = useProjectRoles(
    canManageUsers,
    ctx.currentUserAccessToken,
    ctx.environment,
    ctx.cmaBaseUrl,
    roleRetryAttempt,
  );
  const roleOptions = useMemo<RoleOption[]>(
    () =>
      roleDiscovery.roles.map((role) => ({
        label: role.name,
        value: role.id,
      })),
    [roleDiscovery.roles],
  );
  const roleSelection = useMemo(
    () =>
      buildRoleSelectionState(
        config.allowedRoleIds,
        canManageUsers,
        roleDiscovery,
        roleOptions,
      ),
    [config.allowedRoleIds, canManageUsers, roleDiscovery, roleOptions],
  );
  const isDirty = configIsDirty(
    config,
    savedConfigFingerprint,
    roleSelection.hasUnsavedRoleSnapshot,
  );

  useEffect(() => {
    const previousSavedFingerprint = savedConfigFingerprintRef.current;

    setConfig((current) =>
      configFingerprint(current) === previousSavedFingerprint
        ? incomingConfigRef.current
        : current,
    );
    savedConfigFingerprintRef.current = incomingConfigFingerprint;
    savedConfigRef.current = incomingConfigRef.current;
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
  const availableReasoningOptions = reasoningOptions(config, selectedModel);
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

  const availableModelGroups = useMemo(
    () => modelSelectGroups(config, modelDiscovery.models, model),
    [config, model, modelDiscovery.models],
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
    (providerConfigurationFingerprint(config) !==
      providerConfigurationFingerprint(savedConfigRef.current) &&
      (modelDiscovery.loading ||
        Boolean(apiKey.trim() && !modelDiscovery.loaded)));
  const retryModelDiscovery = () =>
    setModelRetryAttempt((attempt) => attempt + 1);
  const retryRoleDiscovery = () =>
    setRoleRetryAttempt((attempt) => attempt + 1);

  const update = <Key extends keyof AgentConfig>(
    key: Key,
    value: AgentConfig[Key],
  ) => setConfig((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!canEditSchema) {
      return;
    }

    setAttemptedSave(true);
    const providerConfigurationChanged =
      providerConfigurationFingerprint(config) !==
      providerConfigurationFingerprint(savedConfigRef.current);
    const selectedModelForSave = providerConfigurationChanged
      ? modelDiscovery.models.find(
          (candidate) => candidate.id === activeModel(config),
        )
      : undefined;
    const providerConfigForSave = selectedModelForSave
      ? configWithSelectedModel(config, selectedModelForSave)
      : config;
    const configForSave = configWithRoleSnapshot(
      providerConfigForSave,
      canManageUsers,
      roleDiscovery,
      roleSelection.implicitRoleDraftIds,
    );
    const validationError = providerConfigurationChanged
      ? configurationValidationError(configForSave, modelDiscovery)
      : undefined;
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
      savedConfigRef.current = normalizedConfig;
      setSavedConfigFingerprint(nextFingerprint);
      setConfig(normalizedConfig);
      setAttemptedSave(false);
      void ctx.notice('Dato Agent (Beta) settings saved').catch(() => {
        // The settings are already persisted. A delayed or failed toast must
        // not keep the form in its saving state.
      });
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
            availableModelGroups={availableModelGroups}
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

          <Section title="Permissions">
            <FieldGroup>
              <SwitchField
                id="read-only"
                name="read-only"
                label="Read Only"
                hint="Allows inspection and planning, but prevents the agent from changing project content or creating assets."
                value={config.readOnly}
                onChange={(value) => update('readOnly', value)}
                switchInputProps={{
                  name: 'read-only',
                  value: config.readOnly,
                  disabled: !canEditSchema || saving,
                }}
              />
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
              <SelectField<RoleOption, true, never>
                id="allowed-role-ids"
                name="allowed-role-ids"
                label="All roles that can use DatoAgent"
                hint={
                  <>
                    Project owners always have access. New roles must be added
                    manually.
                    {!canManageUsers && (
                      <>
                        {' '}
                        Only users who can manage collaborators can change this
                        list.
                      </>
                    )}
                  </>
                }
                error={
                  canManageUsers && roleDiscovery.error ? (
                    <>
                      Could not load project roles: {roleDiscovery.error}{' '}
                      <button
                        className={styles.retryButton}
                        onClick={retryRoleDiscovery}
                        type="button"
                      >
                        Retry
                      </button>
                    </>
                  ) : undefined
                }
                placeholder="No collaborator roles selected"
                value={roleSelection.selectedRoleOptions}
                selectInputProps={{
                  inputId: 'allowed-role-ids-input',
                  'aria-label': 'All roles that can use DatoAgent',
                  isMulti: true,
                  options: roleOptions,
                  isLoading: roleDiscovery.loading,
                  isDisabled:
                    !canEditSchema ||
                    !canManageUsers ||
                    saving ||
                    roleDiscovery.loading ||
                    !roleDiscovery.loaded ||
                    Boolean(roleDiscovery.error),
                }}
                onChange={(options) =>
                  update(
                    'allowedRoleIds',
                    normalizedRoleIds(options.map((option) => option.value)),
                  )
                }
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
