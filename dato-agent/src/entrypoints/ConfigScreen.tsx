import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper, { useFieldInput } from 'datocms-react-ui/FieldWrapper';
import type { Message } from 'datocms-react-ui/Message';
import { Page } from 'datocms-react-ui/Page';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput, {
  closeSelectMenu,
  SelectMenuAction,
} from 'datocms-react-ui/SelectInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RetryIcon } from '../icons';
import {
  type AgentConfig,
  type AgentProvider,
  activeApiKey,
  activeFastMode,
  activeModel,
  activeModelMaxOutputTokens,
  activeReasoningEffort,
  normalizeConfig,
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
import { TEXTS } from '../texts';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type ProviderOption = {
  label: string;
  value: AgentProvider;
};

type ReasoningOption = {
  /** The name of the level, "High" */
  label: string;
  /** What the level trades, "More careful, slower" */
  hint: string;
  value: ReasoningEffort;
  /** The level that the provider recommends */
  recommended?: boolean;
};

type ModelOption = {
  label: string;
  value: string;
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

const PROVIDER_DETAILS: Record<
  AgentProvider,
  {
    name: string;
    apiKeyPlaceholder: string;
    apiKeyDocs: { label: string; to: string };
  }
> = {
  openai: {
    name: 'OpenAI',
    apiKeyPlaceholder: 'sk-…',
    apiKeyDocs: {
      label: 'Get an OpenAI API key',
      to: 'https://platform.openai.com/api-keys',
    },
  },
  anthropic: {
    name: 'Anthropic',
    apiKeyPlaceholder: 'sk-ant-…',
    apiKeyDocs: {
      label: 'Get an Anthropic API key',
      to: 'https://console.anthropic.com/settings/keys',
    },
  },
};

const PROVIDER_OPTIONS: ProviderOption[] = (
  ['openai', 'anthropic'] as const
).map((value) => ({
  label: PROVIDER_DETAILS[value].name,
  value,
}));

const REASONING_OPTIONS: ReasoningOption[] = [
  { label: 'None', hint: 'Fastest answers', value: 'none' },
  { label: 'Low', hint: 'Faster answers', value: 'low' },
  { label: 'Medium', hint: 'Balanced', value: 'medium' },
  { label: 'High', hint: 'More careful, slower', value: 'high' },
  { label: 'X-high', hint: 'Slower, higher cost', value: 'xhigh' },
  { label: 'Max', hint: 'Slowest, highest cost', value: 'max' },
];

/**
 * The levels of the selected model are radios when there are two to five
 * of them to compare, and a select when there are more (choice inputs). A
 * model with a single level is no choice: the field shows it as text.
 */
const MAX_REASONING_RADIOS = 5;

const RECOMMENDED_SUFFIX = ' (Recommended)';

/** A level as a radio: its name, and what it does under it */
function reasoningRadioOption(option: ReasoningOption) {
  return {
    value: option.value,
    label: option.recommended
      ? `${option.label}${RECOMMENDED_SUFFIX}`
      : option.label,
    hint: option.hint,
  };
}

/** A level as an option of a select, on one line: "High — more careful, slower" */
function reasoningSelectOption(option: ReasoningOption) {
  const hint = `${option.hint.charAt(0).toLowerCase()}${option.hint.slice(1)}`;

  return {
    value: option.value,
    label: `${option.label} — ${hint}${option.recommended ? RECOMMENDED_SUFFIX : ''}`,
  };
}

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

function providerConfigurationFingerprint(config: AgentConfig): string {
  return JSON.stringify(
    config.provider === 'openai'
      ? {
          provider: config.provider,
          apiKey: config.openAiApiKey,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          fastMode: config.openAiFastMode,
        }
      : {
          provider: config.provider,
          apiKey: config.anthropicApiKey,
          model: config.anthropicModel,
          modelMaxOutputTokens: config.anthropicModelMaxOutputTokens,
          reasoningEffort: config.anthropicReasoningEffort,
          fastMode: config.anthropicFastMode,
        },
  );
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

/**
 * A saved role that the list does not have. It is unavailable only when the
 * roles loaded: else its name is just unknown here, and its ID shows.
 */
function missingRoleOption(roleId: string, rolesLoaded: boolean): RoleOption {
  return {
    label: rolesLoaded ? `Unavailable role (${roleId})` : roleId,
    value: roleId,
  };
}

function roleOptionsForSelection(
  roleIds: readonly string[],
  availableOptions: readonly RoleOption[],
  rolesLoaded: boolean,
): RoleOption[] {
  const optionsById = new Map(
    availableOptions.map((option) => [option.value, option]),
  );

  return roleIds.map(
    (roleId) =>
      optionsById.get(roleId) ?? missingRoleOption(roleId, rolesLoaded),
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
      roleDiscovery.loaded,
    ),
    hasUnsavedRoleSnapshot,
  };
}

/**
 * The groups of the page. Each one is a form with its own Save, which saves
 * only its own keys: together, they hold every key of the configuration.
 */
type SettingsGroup = 'provider' | 'behavior' | 'access';

const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  'provider',
  'behavior',
  'access',
];

const SETTINGS_GROUP_KEYS: Record<
  SettingsGroup,
  readonly (keyof AgentConfig)[]
> = {
  provider: [
    'provider',
    'openAiApiKey',
    'model',
    'reasoningEffort',
    'openAiFastMode',
    'anthropicApiKey',
    'anthropicModel',
    'anthropicModelMaxOutputTokens',
    'anthropicReasoningEffort',
    'anthropicFastMode',
  ],
  behavior: ['additionalInstructions'],
  access: ['readOnly', 'enableRecordSidebar', 'allowedRoleIds'],
};

function groupFingerprint(config: AgentConfig, group: SettingsGroup): string {
  return JSON.stringify(SETTINGS_GROUP_KEYS[group].map((key) => config[key]));
}

function copyConfigValue<Key extends keyof AgentConfig>(
  target: AgentConfig,
  source: AgentConfig,
  key: Key,
) {
  target[key] = source[key];
}

/** The base configuration with the values of one group taken from another */
function configWithGroupValues(
  base: AgentConfig,
  source: AgentConfig,
  group: SettingsGroup,
): AgentConfig {
  const next = { ...base };
  for (const key of SETTINGS_GROUP_KEYS[group]) {
    copyConfigValue(next, source, key);
  }
  return next;
}

/**
 * The parameters saved somewhere else reach each group that has no local
 * edits; a group with edits keeps them
 */
function configWithExternalValues(
  current: AgentConfig,
  previousSaved: AgentConfig,
  incoming: AgentConfig,
): AgentConfig {
  let next = current;
  for (const group of SETTINGS_GROUPS) {
    if (
      groupFingerprint(current, group) ===
      groupFingerprint(previousSaved, group)
    ) {
      next = configWithGroupValues(next, incoming, group);
    }
  }
  return configFingerprint(next) === configFingerprint(current)
    ? current
    : next;
}

function groupIsDirty(
  config: AgentConfig,
  savedConfig: AgentConfig,
  group: SettingsGroup,
  hasUnsavedRoleSnapshot: boolean,
): boolean {
  return (
    groupFingerprint(config, group) !== groupFingerprint(savedConfig, group) ||
    (group === 'access' && hasUnsavedRoleSnapshot)
  );
}

/**
 * The configuration to save with the first-run selection of every role, while
 * the roles field shows it and nothing is saved for the roles yet
 */
function configWithRoleSnapshot(
  config: AgentConfig,
  hasUnsavedRoleSnapshot: boolean,
  implicitRoleDraftIds: string[],
): AgentConfig {
  if (!hasUnsavedRoleSnapshot || config.allowedRoleIds !== null) {
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
              error: `Couldn’t load models with this API key: ${errorMessage(
                error,
              )}`,
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

// The state of the model list, under the model select, while it is not
// there yet or empty. A failed load is the error of the API key, which must
// change.
function modelDiscoveryHint(
  apiKey: string,
  discovery: ModelDiscoveryState,
): Message | undefined {
  if (!apiKey.trim()) {
    return 'Add an API key to load the models.';
  }
  if (discovery.loading) {
    return 'Loading the models…';
  }
  if (discovery.error) {
    return undefined;
  }
  if (!discovery.loaded) {
    return 'Waiting to load models…';
  }
  return discovery.models.length === 0
    ? 'No compatible models for this API key.'
    : undefined;
}

function configurationValidationError(
  config: AgentConfig,
  discovery: ModelDiscoveryState,
): string | undefined {
  const details = PROVIDER_DETAILS[config.provider];
  const apiKey = activeApiKey(config);
  const model = activeModel(config);

  if (!apiKey.trim()) {
    return 'Enter an API key.';
  }
  if (!model.trim()) {
    return 'Select a model.';
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

// A model can't be picked without a key or a list of models: the error is
// then on the API key, and the hint of the model tells the rest
function modelFieldError(
  attemptedSave: boolean,
  config: AgentConfig,
  discovery: ModelDiscoveryState,
): string | undefined {
  if (!attemptedSave || !activeApiKey(config).trim() || discovery.error) {
    return undefined;
  }

  const details = PROVIDER_DETAILS[config.provider];
  const model = activeModel(config);
  if (!model.trim()) {
    return 'Select a model.';
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
      ? { ...option, recommended: true }
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
  let withModel = withActiveModel(
    config,
    selectedModel.id,
    selectedModel.maxOutputTokens,
  );
  if (
    activeFastMode(withModel) &&
    !providerModelSupportsFastMode(config.provider, selectedModel.id)
  ) {
    withModel = withActiveFastMode(withModel, false);
  }
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

/** What fast mode does, else the real reason why it is off */
function fastModeHint(
  provider: AgentProvider,
  apiKey: string,
  selectedModel: ProviderModel | undefined,
): string {
  if (!apiKey.trim()) {
    return 'Enter an API key first.';
  }
  if (!selectedModel) {
    return 'Pick a model first.';
  }
  if (providerModelSupportsFastMode(provider, selectedModel.id)) {
    return 'Faster answers at a higher cost from the provider.';
  }
  return provider === 'anthropic'
    ? 'Not available for the selected Claude model.'
    : 'Not available for the selected OpenAI model.';
}

function configWithPickedModel(
  config: AgentConfig,
  modelId: string,
  models: readonly ProviderModel[],
): AgentConfig {
  const nextModel = models.find((candidate) => candidate.id === modelId);
  return nextModel
    ? configWithSelectedModel(config, nextModel)
    : withActiveModel(config, modelId);
}

type ModelFieldProps = {
  apiKey: string;
  attemptedSave: boolean;
  availableModelOptions: ModelOption[];
  config: AgentConfig;
  discovery: ModelDiscoveryState;
  model: string;
  modelSelectDisabled: boolean;
  retryModelDiscovery: () => void;
  setConfig: Dispatch<SetStateAction<AgentConfig>>;
};

function ModelField({
  apiKey,
  attemptedSave,
  availableModelOptions,
  config,
  discovery,
  model,
  modelSelectDisabled,
  retryModelDiscovery,
  setConfig,
}: ModelFieldProps) {
  const shownModel = availableModelOptions.some(
    (option) => option.value === model,
  )
    ? model
    : null;

  return (
    <FieldWrapper
      label="Model"
      required
      hint={modelDiscoveryHint(apiKey, discovery)}
      error={modelFieldError(attemptedSave, config, discovery)}
    >
      <SelectInput
        value={shownModel}
        options={availableModelOptions}
        clearable={false}
        loading={discovery.loading}
        disabled={modelSelectDisabled}
        // Loading the options again is a secondary action of the select: it
        // is in the footer of its menu, once the list loaded or failed
        menuFooter={
          discovery.loaded || discovery.error ? (
            <SelectMenuAction
              icon={<RetryIcon />}
              label={discovery.error ? 'Retry' : 'Refresh models'}
              onPick={() => {
                // The options change: the menu closes first
                closeSelectMenu();
                retryModelDiscovery();
              }}
            />
          ) : undefined
        }
        onChange={(value) => {
          // After a failed load the only option is the current model: picking
          // it again changes nothing
          if (value && value !== model) {
            setConfig((current) =>
              configWithPickedModel(current, value, discovery.models),
            );
          }
        }}
      />
    </FieldWrapper>
  );
}

type ReasoningEffortFieldProps = {
  availableReasoningOptions: ReasoningOption[];
  disabled: boolean;
  reasoningEffort: ReasoningEffort;
  setConfig: Dispatch<SetStateAction<AgentConfig>>;
};

function ReasoningEffortField({
  availableReasoningOptions,
  disabled,
  reasoningEffort,
  setConfig,
}: ReasoningEffortFieldProps) {
  const selectedOption =
    availableReasoningOptions.find(
      (option) => option.value === reasoningEffort,
    ) ?? availableReasoningOptions[0];
  const pick = (value: string | null) => {
    const effort = availableReasoningOptions.find(
      (option) => option.value === value,
    )?.value;
    if (effort) {
      setConfig((current) => withActiveReasoningEffort(current, effort));
    }
  };
  const count = availableReasoningOptions.length;

  // The options are the ones of the selected model: only a single level
  // needs a word
  return (
    <FieldWrapper
      label="Reasoning effort"
      hint={
        count === 1 ? 'The selected model supports only this level.' : undefined
      }
    >
      {count <= 1 ? (
        <FixedReasoningEffort option={selectedOption} />
      ) : count <= MAX_REASONING_RADIOS ? (
        <RadioGroupInput
          value={selectedOption?.value ?? null}
          options={availableReasoningOptions.map(reasoningRadioOption)}
          disabled={disabled}
          onChange={pick}
        />
      ) : (
        <SelectInput
          value={selectedOption?.value ?? null}
          options={availableReasoningOptions.map(reasoningSelectOption)}
          clearable={false}
          disabled={disabled}
          onChange={pick}
        />
      )}
    </FieldWrapper>
  );
}

/**
 * The one level of a model that supports a single level: plain text, named
 * by the label of the field and described by its hint
 */
function FixedReasoningEffort({ option }: { option?: ReasoningOption }) {
  const fieldProps = useFieldInput({});

  return (
    <output
      id={fieldProps.id}
      aria-describedby={fieldProps['aria-describedby']}
    >
      {option ? reasoningSelectOption(option).label : 'Not available'}
    </output>
  );
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
  const fastModeSupported = selectedModel
    ? providerModelSupportsFastMode(config.provider, selectedModel.id)
    : false;
  const fieldsDisabled = !canEditSchema || saving;

  return (
    <>
      <FieldWrapper label="Provider">
        <SelectInput
          value={config.provider}
          options={PROVIDER_OPTIONS}
          disabled={fieldsDisabled}
          clearable={false}
          isSearchable={false}
          onChange={(_next, option) => {
            if (option) {
              const provider = option.value;
              setAttemptedSave(false);
              setConfig((current) => ({ ...current, provider }));
            }
          }}
        />
      </FieldWrapper>
      <FieldWrapper
        label="API key"
        required
        hint={`Saved in the plugin settings. This browser sends it straight to ${details.name}.`}
        docs={details.apiKeyDocs}
        error={
          attemptedSave && !apiKey.trim()
            ? 'Enter an API key.'
            : discovery.error
        }
      >
        <PasswordInput
          value={apiKey}
          placeholder={details.apiKeyPlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={fieldsDisabled}
          onChange={(value) =>
            setConfig((current) => withActiveApiKey(current, value ?? ''))
          }
        />
      </FieldWrapper>
      <ModelField
        apiKey={apiKey}
        attemptedSave={attemptedSave}
        availableModelOptions={availableModelOptions}
        config={config}
        discovery={discovery}
        model={model}
        modelSelectDisabled={modelSelectDisabled}
        retryModelDiscovery={retryModelDiscovery}
        setConfig={setConfig}
      />
      {/* The levels of a Claude model come from the model: they show once
          one is selected */}
      {(config.provider !== 'anthropic' || selectedModel) && (
        <ReasoningEffortField
          availableReasoningOptions={availableReasoningOptions}
          disabled={fieldsDisabled}
          reasoningEffort={reasoningEffort}
          setConfig={setConfig}
        />
      )}
      <FieldWrapper hint={fastModeHint(config.provider, apiKey, selectedModel)}>
        <SwitchInput
          label="Fast mode"
          value={activeFastMode(config)}
          disabled={fieldsDisabled || !fastModeSupported}
          onChange={(value) =>
            setConfig((current) => withActiveFastMode(current, value ?? false))
          }
        />
      </FieldWrapper>
    </>
  );
}

function saveDisabledReason(
  isDirty: boolean,
  waitingForModelDiscovery: boolean,
  discovery: ModelDiscoveryState,
): string | undefined {
  if (!isDirty) {
    return 'There are no changes to save.';
  }
  if (!waitingForModelDiscovery) {
    return undefined;
  }
  return discovery.error
    ? 'The model list didn’t load. Retry it first.'
    : 'Wait for the model list to load.';
}

type SettingsFormProps = {
  /** The name of the form, and the title of its section */
  title: string;
  /**
   * The first topic shows no title: the host draws "Plugin settings" above
   * the frame
   */
  untitled?: boolean;
  /** Without the right to edit the schema, the form has no Save */
  canSave: boolean;
  /** This form saves now */
  busy: boolean;
  /** Why Save can't run now, or undefined when it can */
  blockedReason?: string;
  onSave: () => void;
  children: ReactNode;
};

/**
 * A topic of the settings: a form with the Save of its own values after its
 * last field. After the first topic, each one is a section under its title
 */
function SettingsForm({
  title,
  untitled,
  canSave,
  busy,
  blockedReason,
  onSave,
  children,
}: SettingsFormProps) {
  const form = (
    <form
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        // Enter in a field submits the form too: save only when the Save
        // button would
        if (canSave && !busy && !blockedReason) {
          onSave();
        }
      }}
    >
      {children}
      {canSave && (
        <Button
          submit
          tone="primary"
          label="Save"
          busy={busy}
          disabled={!busy && blockedReason ? { reason: blockedReason } : false}
        />
      )}
    </form>
  );

  if (untitled) {
    return form;
  }

  return (
    <Page.Section>
      <Page.SectionTitle>{title}</Page.SectionTitle>
      {form}
    </Page.Section>
  );
}

type UpdateConfig = <Key extends keyof AgentConfig>(
  key: Key,
  value: AgentConfig[Key],
) => void;

type AccessFieldsProps = {
  allowedRoleOptions: RoleOption[];
  canManageUsers: boolean;
  config: AgentConfig;
  fieldsDisabled: boolean;
  /** The roles show the first-run selection, which is not saved yet */
  hasUnsavedRoleSnapshot: boolean;
  retryRoleDiscovery: () => void;
  roleDiscovery: RoleDiscoveryState;
  roleOptions: RoleOption[];
  update: UpdateConfig;
};

function AccessFields({
  allowedRoleOptions,
  canManageUsers,
  config,
  fieldsDisabled,
  hasUnsavedRoleSnapshot,
  retryRoleDiscovery,
  roleDiscovery,
  roleOptions,
  update,
}: AccessFieldsProps) {
  // The response of the API helps nobody here: Retry is the next step
  const roleError = roleDiscovery.error
    ? 'Couldn’t load the project roles.'
    : undefined;
  const rolesHint = hasUnsavedRoleSnapshot
    ? 'Project owners always have access. These roles aren’t saved yet: save to confirm them.'
    : 'Project owners always have access. Roles you create later must be added here.';

  return (
    <>
      <FieldWrapper hint="The agent can read content and suggest changes, but can’t change content or add assets.">
        <SwitchInput
          label="Read-only mode"
          value={config.readOnly}
          disabled={fieldsDisabled}
          onChange={(value) => update('readOnly', value ?? false)}
        />
      </FieldWrapper>
      <FieldWrapper hint="Adds the agent next to each record.">
        <SwitchInput
          label="Show in record sidebars"
          value={config.enableRecordSidebar}
          disabled={fieldsDisabled}
          onChange={(value) => update('enableRecordSidebar', value ?? false)}
        />
      </FieldWrapper>
      {/* Without user management the role names can't load: the list
          would show bare IDs. The saved roles stay as they are. */}
      {canManageUsers && (
        <FieldWrapper
          label="Roles that can use Dato Agent"
          hint={rolesHint}
          error={roleError}
          container={{
            trailing: roleError && (
              <Button tone="ghost" label="Retry" onClick={retryRoleDiscovery} />
            ),
          }}
        >
          <SelectInput
            multiple
            value={allowedRoleOptions.map((option) => option.value)}
            options={roleOptions}
            acceptValueNotIncludedInOptions={(roleId) =>
              missingRoleOption(roleId, roleDiscovery.loaded)
            }
            placeholder="Pick roles"
            loading={roleDiscovery.loading}
            // Without the loaded roles every saved role would show as
            // unavailable: the select stays locked until they load
            disabled={fieldsDisabled || !roleDiscovery.loaded}
            onChange={(roleIds) =>
              update('allowedRoleIds', normalizedRoleIds(roleIds ?? []))
            }
          />
        </FieldWrapper>
      )}
    </>
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
  // The saved parameters: the state renders the groups with changes, the
  // ref is the base of the next save
  const savedConfigRef = useRef(incomingConfig);
  const [savedConfig, setSavedConfig] = useState<AgentConfig>(
    () => incomingConfig,
  );
  const [config, setConfig] = useState<AgentConfig>(() => incomingConfig);
  const [modelRetryAttempt, setModelRetryAttempt] = useState(0);
  const [roleRetryAttempt, setRoleRetryAttempt] = useState(0);
  // The group that saves now. One save at a time: each save starts from the
  // parameters that the one before saved.
  const [savingGroup, setSavingGroup] = useState<SettingsGroup | null>(null);
  const saving = savingGroup !== null;
  // A save of the model provider was attempted: its fields show their errors
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
  // The output limit of the saved model, which the page fills in by itself
  // once the models load when none is saved, is no change of the admin. A
  // value that the page corrects (a level the model lacks) stays a change.
  const savedModel =
    savedConfig.provider === config.provider &&
    activeApiKey(savedConfig) === apiKey &&
    activeModelMaxOutputTokens(savedConfig) === undefined
      ? modelDiscovery.models.find(
          (candidate) => candidate.id === activeModel(savedConfig),
        )
      : undefined;
  const comparedSavedConfig = savedModel
    ? withActiveModel(savedConfig, savedModel.id, savedModel.maxOutputTokens)
    : savedConfig;
  const isDirty = (group: SettingsGroup) =>
    groupIsDirty(
      config,
      comparedSavedConfig,
      group,
      roleSelection.hasUnsavedRoleSnapshot,
    );

  // New parameters from the host: after a save of this page (already in
  // place), or saved somewhere else
  useEffect(() => {
    const previousSaved = savedConfigRef.current;
    if (configFingerprint(previousSaved) === incomingConfigFingerprint) {
      return;
    }
    const incoming = incomingConfigRef.current;

    setConfig((current) =>
      configWithExternalValues(current, previousSaved, incoming),
    );
    savedConfigRef.current = incoming;
    setSavedConfig(incoming);
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
    // A failed load keeps the select open to its Retry
    (!modelDiscovery.loaded && !modelDiscovery.error);
  const waitingForModelDiscovery =
    providerConfigurationFingerprint(config) !==
      providerConfigurationFingerprint(savedConfig) &&
    (modelDiscovery.loading ||
      Boolean(apiKey.trim() && !modelDiscovery.loaded));
  // Why the Save of a group can't run now: one save runs at a time, and the
  // model provider waits for the model list before it saves a change of the
  // provider, the key or the model
  const saveBlockedReason = (group: SettingsGroup): string | undefined => {
    if (saving) {
      return 'Wait for the settings to save.';
    }
    return group === 'provider'
      ? saveDisabledReason(
          isDirty(group),
          waitingForModelDiscovery,
          modelDiscovery,
        )
      : saveDisabledReason(isDirty(group), false, modelDiscovery);
  };
  const retryModelDiscovery = () =>
    setModelRetryAttempt((attempt) => attempt + 1);
  const retryRoleDiscovery = () =>
    setRoleRetryAttempt((attempt) => attempt + 1);

  const update = <Key extends keyof AgentConfig>(
    key: Key,
    value: AgentConfig[Key],
  ) => setConfig((current) => ({ ...current, [key]: value }));

  /** The values of a group as they are saved, or undefined when invalid */
  const groupValuesForSave = (
    group: SettingsGroup,
  ): AgentConfig | undefined => {
    if (group !== 'provider') {
      return config;
    }

    // The provider settings are checked only when they changed: the key,
    // the model and the level must be the ones that the provider offers
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
    const validationError = providerConfigurationChanged
      ? configurationValidationError(providerConfigForSave, modelDiscovery)
      : undefined;
    return validationError ? undefined : providerConfigForSave;
  };

  const save = async (group: SettingsGroup) => {
    if (!canEditSchema || saving) {
      return;
    }

    const groupValues = groupValuesForSave(group);
    if (!groupValues) {
      return;
    }
    // Only the values of this group change: the other groups keep what is
    // saved, and their edits stay on the page. The roles show the first-run
    // selection of every role as allowed: the first save of any group saves
    // it.
    const savesRoleSnapshot = roleSelection.hasUnsavedRoleSnapshot;
    const configForSave = configWithRoleSnapshot(
      configWithGroupValues(savedConfigRef.current, groupValues, group),
      savesRoleSnapshot,
      roleSelection.implicitRoleDraftIds,
    );

    setSavingGroup(group);
    try {
      const normalizedConfig = normalizeConfig(configForSave);
      await ctx.updatePluginParameters(
        serializeConfig(ctx.plugin.attributes.parameters, normalizedConfig),
      );
      savedConfigRef.current = normalizedConfig;
      setSavedConfig(normalizedConfig);
      setConfig((current) => {
        const next = configWithGroupValues(current, normalizedConfig, group);
        // The saved selection is the one the roles field shows
        return savesRoleSnapshot && next.allowedRoleIds === null
          ? { ...next, allowedRoleIds: normalizedConfig.allowedRoleIds }
          : next;
      });
      if (group === 'provider') {
        setAttemptedSave(false);
      }
      void ctx.notice('Settings saved.').catch(() => {
        // The settings are already persisted. A delayed or failed toast must
        // not keep the form in its saving state.
      });
    } catch (error) {
      await ctx.alert(`The settings couldn’t be saved: ${errorMessage(error)}`);
    } finally {
      setSavingGroup(null);
    }
  };

  const formProps = (group: SettingsGroup) => ({
    canSave: canEditSchema,
    busy: savingGroup === group,
    blockedReason: saveBlockedReason(group),
    onSave: () => {
      void save(group);
    },
  });

  return (
    // The host gives the frame its width and its padding, and draws the
    // "Plugin settings" title above it: the forms start the frame, with no
    // Page around them
    <Canvas ctx={ctx} texts={TEXTS}>
      {!canEditSchema && (
        <Callout title="You can only view these settings">
          Ask a project admin if something needs to change.
        </Callout>
      )}

      <SettingsForm title="Model provider" untitled {...formProps('provider')}>
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
      </SettingsForm>

      <SettingsForm title="Agent behavior" {...formProps('behavior')}>
        <FieldWrapper
          label="Additional instructions"
          hint="Added to the built-in project and safety instructions."
        >
          {/* A viewer can still select and copy the instructions */}
          <TextareaInput
            value={config.additionalInstructions}
            // An example only helps someone who can type
            placeholder={
              canEditSchema
                ? 'Always use British English for public copy.'
                : null
            }
            rows={5}
            readOnly={!canEditSchema}
            disabled={saving}
            onChange={(value) => update('additionalInstructions', value ?? '')}
          />
        </FieldWrapper>
      </SettingsForm>

      <SettingsForm title="Access" {...formProps('access')}>
        <AccessFields
          allowedRoleOptions={roleSelection.selectedRoleOptions}
          canManageUsers={canManageUsers}
          config={config}
          fieldsDisabled={!canEditSchema || saving}
          hasUnsavedRoleSnapshot={roleSelection.hasUnsavedRoleSnapshot}
          retryRoleDiscovery={retryRoleDiscovery}
          roleDiscovery={roleDiscovery}
          roleOptions={roleOptions}
          update={update}
        />
      </SettingsForm>
    </Canvas>
  );
}
