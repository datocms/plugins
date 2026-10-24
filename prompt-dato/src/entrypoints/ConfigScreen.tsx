import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import Pill from 'datocms-react-ui/Pill';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import SettingsList from 'datocms-react-ui/SettingsList';
import Spinner from 'datocms-react-ui/Spinner';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { derror, setDebugEnabled } from '../lib/debugLog';
import {
  buildAuthorizeFlow,
  computeRedirectUri,
  exchangeCodeForToken,
  MCP_BASE_URL,
  openBlankPopup,
  registerClient,
  revokeToken,
  waitForOAuthCallback,
} from '../lib/oauth';
import {
  DEFAULT_MAIN_MODEL_BY_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_SYSTEM_PROMPT,
  getProviderLabel,
  type ModelProvider,
  mergeParams,
  PROVIDER_CHOICES,
  PROVIDER_DEFAULT_REASONING_EFFORT,
  type PromptDatoParams,
  type ProviderValueMap,
  type ReasoningEffort,
  readParams,
} from '../lib/pluginParams';
import {
  type ChatModelOption,
  fetchProviderModels,
} from '../lib/providerRuntime';
import { clearRemovedDiagnosticsStore } from '../lib/removedDiagnostics';
import s from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type GroupProps = {
  ctx: RenderConfigScreenCtx;
  params: PromptDatoParams;
};

type ConnectStage =
  | 'idle'
  | 'registering'
  | 'awaiting-consent'
  | 'exchanging'
  | 'saving';

const STAGE_LABELS: Record<ConnectStage, string> = {
  idle: '',
  registering: 'Registering the plugin with DatoCMS…',
  'awaiting-consent': 'Waiting for your approval in the popup…',
  exchanging: 'Exchanging the authorization code…',
  saving: 'Saving the connection…',
};

type ModelsState = 'idle' | 'loading' | 'ready' | 'error';
type ReasoningEffortOption = {
  id: ReasoningEffort;
  label: string;
};

const OAUTH_CLIENT_MAX_AGE_SECONDS = 25 * 24 * 60 * 60;
const MCP_HOST = new URL(MCP_BASE_URL).host;

const REVOKE_WARNING =
  "You're disconnected here, but the token couldn't be revoked. Connect again if the access still shows elsewhere.";
const NO_CHANGES_REASON = 'There are no changes to save.';

const REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = [
  { id: PROVIDER_DEFAULT_REASONING_EFFORT, label: 'Provider default' },
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
];

const REASONING_EFFORT_SELECT_OPTIONS = REASONING_EFFORT_OPTIONS.map(
  (option) => ({ value: option.id, label: option.label }),
);

const PROVIDER_HINTS: Record<ModelProvider, string> = {
  current: 'Reads and changes the project. Each change asks for your approval.',
  google: "Reads the project. It can't make changes.",
  anthropic: "Reads the project. It can't make changes.",
};

const PROVIDER_OPTIONS: RadioGroupOption<ModelProvider>[] =
  PROVIDER_CHOICES.map((choice) => ({
    value: choice.id,
    label: choice.label,
    hint: PROVIDER_HINTS[choice.id],
  }));

type ModelSelectOption = { value: string; label: string };

// A saved model that the list doesn't have stays selectable
const acceptAnyModel = (value: string): ModelSelectOption => ({
  value,
  label: value,
});

function oauthClientIsStale(issuedAt: number | undefined): boolean {
  if (!issuedAt) return true;
  const now = Math.floor(Date.now() / 1000);
  return now - issuedAt > OAUTH_CLIENT_MAX_AGE_SECONDS;
}

function isInvalidClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('invalid_client') || message.includes('invalid client')
  );
}

function cleanProviderMap(map: ProviderValueMap): ProviderValueMap {
  const clean: ProviderValueMap = {};
  for (const choice of PROVIDER_CHOICES) {
    const value = map[choice.id]?.trim();
    if (value) clean[choice.id] = value;
  }
  return clean;
}

function providerMapsEqual(left: ProviderValueMap, right: ProviderValueMap) {
  for (const choice of PROVIDER_CHOICES) {
    if ((left[choice.id] ?? '') !== (right[choice.id] ?? '')) return false;
  }
  return true;
}

function setMapValue(
  map: ProviderValueMap,
  provider: ModelProvider,
  value: string,
): ProviderValueMap {
  return { ...map, [provider]: value };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// The OAuth flow after the popup opened: register a client when needed,
// send the popup to the consent page, wait for the code and store the token.
// A client that the server no longer knows is registered again, once.
async function runConnectFlow(
  ctx: RenderConfigScreenCtx,
  popup: Window,
  setStage: (stage: ConnectStage) => void,
) {
  const redirectUri = computeRedirectUri();
  const current = readParams(ctx);

  const registerAndSave = async () => {
    const registered = await registerClient(redirectUri);
    await mergeParams(ctx, {
      oauthClientId: registered.clientId,
      oauthClientIssuedAt: registered.clientIdIssuedAt,
      oauthRedirectUri: registered.redirectUri,
    });
    return registered.clientId;
  };

  let clientId = current.oauthClientId ?? '';
  if (
    !clientId ||
    current.oauthRedirectUri !== redirectUri ||
    oauthClientIsStale(current.oauthClientIssuedAt)
  ) {
    clientId = await registerAndSave();
  }

  const authorize = async (id: string) => {
    const flow = await buildAuthorizeFlow({ clientId: id, redirectUri });
    popup.location.href = flow.authorizeUrl;
    setStage('awaiting-consent');

    const callback = await waitForOAuthCallback(popup, flow.state);
    setStage('exchanging');

    const { accessToken } = await exchangeCodeForToken({
      code: callback.code,
      state: callback.state,
      clientId: id,
    });

    setStage('saving');
    await mergeParams(ctx, { datoAccessToken: accessToken });
    ctx.notice('Connected to DatoCMS.');
  };

  try {
    await authorize(clientId);
  } catch (error) {
    if (!isInvalidClientError(error)) throw error;
    setStage('registering');
    await authorize(await registerAndSave());
  }
}

// Revokes the stored token. A failure doesn't block the disconnection: it
// returns true, so the screen can tell the user.
async function revokeStoredToken(params: PromptDatoParams): Promise<boolean> {
  if (!params.datoAccessToken || !params.oauthClientId) return false;
  try {
    await revokeToken({
      token: params.datoAccessToken,
      clientId: params.oauthClientId,
    });
    return false;
  } catch (error) {
    derror('OAuth', 'revoke_token:nonblocking_failure', error);
    return true;
  }
}

function ConnectionValue({
  stage,
  disconnecting,
}: {
  stage: ConnectStage;
  disconnecting: boolean;
}) {
  if (stage !== 'idle' || disconnecting) {
    return (
      <span role="status">
        <Spinner inline label={false} />{' '}
        {disconnecting ? 'Revoking the access…' : STAGE_LABELS[stage]}
      </span>
    );
  }
  return <>{MCP_HOST}</>;
}

function connectionStatus(isConnected: boolean, connecting: boolean) {
  if (isConnected) return <Pill tone="success">Connected</Pill>;
  if (connecting) return undefined;
  return <Pill tone="warning">Not connected</Pill>;
}

function ConnectionGroup({ ctx, params }: GroupProps) {
  const [connectStage, setConnectStage] = useState<ConnectStage>('idle');
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectWarning, setConnectWarning] = useState<string | null>(null);

  const connecting = connectStage !== 'idle';
  const isConnected = Boolean(params.datoAccessToken);
  const needsConnection = !isConnected && !connecting;

  // Synchronous: the popup must open inside the click, or the browser
  // blocks it
  const handleConnect = () => {
    setConnectError(null);
    setConnectWarning(null);

    let popup: Window;
    try {
      popup = openBlankPopup();
    } catch (error) {
      setConnectError(errorMessage(error, "The popup couldn't be opened."));
      return;
    }

    setConnectStage('registering');

    (async () => {
      try {
        await runConnectFlow(ctx, popup, setConnectStage);
      } catch (error) {
        if (!popup.closed) popup.close();
        setConnectError(errorMessage(error, 'The connection failed.'));
      } finally {
        setConnectStage('idle');
      }
    })();
  };

  const handleDisconnect = async () => {
    setConnectError(null);
    setConnectWarning(null);
    setDisconnecting(true);
    try {
      const revokeFailed = await revokeStoredToken(readParams(ctx));
      await mergeParams(ctx, { datoAccessToken: undefined });
      ctx.notice('Disconnected from DatoCMS.');
      if (revokeFailed) {
        setConnectWarning(REVOKE_WARNING);
      }
    } catch (error) {
      setConnectError(errorMessage(error, "The disconnection didn't work."));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Page.Group
      title="DatoCMS connection"
      tone={needsConnection ? 'warning' : undefined}
      status={connectionStatus(isConnected, connecting)}
    >
      {needsConnection && (
        <Callout tone="warning">
          Chat needs this connection to read and change the project.
        </Callout>
      )}
      <SettingsList>
        <SettingsList.Row
          title="DatoCMS MCP server"
          description="Chat signs in with your DatoCMS account through OAuth, so there's no API token to copy."
          value={
            <ConnectionValue
              stage={connectStage}
              disconnecting={disconnecting}
            />
          }
          action={
            isConnected ? (
              <Button
                tone="ghost"
                label="Disconnect"
                onClick={handleDisconnect}
                disabled={
                  connecting
                    ? { reason: 'Wait for the connection to finish.' }
                    : undefined
                }
              />
            ) : (
              <Button
                tone="ghost"
                label="Connect"
                onClick={handleConnect}
                busy={connecting}
              />
            )
          }
        />
      </SettingsList>
      {connectError && (
        <Callout tone="danger" className={s.afterList}>
          {connectError}
        </Callout>
      )}
      {connectWarning && (
        <Callout tone="warning" className={s.afterList}>
          {connectWarning}
        </Callout>
      )}
    </Page.Group>
  );
}

function modelHint(provider: ModelProvider, modelsState: ModelsState) {
  if (modelsState === 'idle' || modelsState === 'error') {
    return `Enter a valid ${getProviderLabel(provider)} key to load the models.`;
  }
  return 'The model that answers in the chat.';
}

function modelError(
  modelsState: ModelsState,
  modelsError: string | null,
  modelsCount: number,
) {
  if (modelsState === 'error') {
    return modelsError ?? "The models couldn't be loaded.";
  }
  if (modelsState === 'ready' && modelsCount === 0) {
    return 'This key returns no compatible models.';
  }
  return undefined;
}

type ModelFieldProps = {
  provider: ModelProvider;
  value: string;
  models: ChatModelOption[];
  modelsState: ModelsState;
  modelsError: string | null;
  onChange: (model: string) => void;
};

function ModelField({
  provider,
  value,
  models,
  modelsState,
  modelsError,
  onChange,
}: ModelFieldProps) {
  const options = useMemo<ModelSelectOption[]>(
    () => models.map((model) => ({ value: model.id, label: model.id })),
    [models],
  );

  return (
    <FieldWrapper
      label="Model"
      required
      hint={modelHint(provider, modelsState)}
      error={modelError(modelsState, modelsError, models.length)}
    >
      <SelectInput
        value={value}
        onChange={(next) => {
          if (next) onChange(next);
        }}
        options={options}
        placeholder="Pick a model"
        clearable={false}
        loading={modelsState === 'loading'}
        disabled={modelsState !== 'ready' || models.length === 0}
        acceptValueNotIncludedInOptions={acceptAnyModel}
      />
    </FieldWrapper>
  );
}

function ProviderForm({ ctx, params }: GroupProps) {
  const [provider, setProvider] = useState<ModelProvider>(
    params.provider ?? 'current',
  );
  const [providerApiKeys, setProviderApiKeys] = useState<ProviderValueMap>(
    params.providerApiKeys ?? {},
  );
  const [providerMainModels, setProviderMainModels] =
    useState<ProviderValueMap>(params.providerMainModels ?? {});
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    params.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  );
  const [savingProvider, setSavingProvider] = useState(false);

  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [modelsState, setModelsState] = useState<ModelsState>('idle');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelsAbortRef = useRef<AbortController | null>(null);

  const providerLabel = getProviderLabel(provider);
  const selectedApiKey = providerApiKeys[provider] ?? '';
  const selectedMainModel =
    providerMainModels[provider] ?? DEFAULT_MAIN_MODEL_BY_PROVIDER[provider];
  const trimmedKey = selectedApiKey.trim();
  const hasPlausibleKey = trimmedKey.length >= 8;

  const providerDirty =
    provider !== (params.provider ?? 'current') ||
    !providerMapsEqual(
      cleanProviderMap(providerApiKeys),
      cleanProviderMap(params.providerApiKeys ?? {}),
    ) ||
    !providerMapsEqual(
      cleanProviderMap(providerMainModels),
      cleanProviderMap(params.providerMainModels ?? {}),
    ) ||
    reasoningEffort !== (params.reasoningEffort ?? DEFAULT_REASONING_EFFORT);

  // The list follows the provider and the key only: picking a model doesn't
  // load it again
  useEffect(() => {
    modelsAbortRef.current?.abort();
    modelsAbortRef.current = null;

    if (!hasPlausibleKey) {
      setModels([]);
      setModelsState('idle');
      setModelsError(null);
      return;
    }

    setModelsState('loading');
    setModelsError(null);

    const controller = new AbortController();
    modelsAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      try {
        const list = await fetchProviderModels(
          provider,
          trimmedKey,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setModels(list);
        setModelsState('ready');
        // The first model, only when this provider has none yet
        const first = list[0];
        if (first) {
          setProviderMainModels((current) =>
            current[provider]
              ? current
              : setMapValue(current, provider, first.id),
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setModels([]);
        setModelsState('error');
        setModelsError(errorMessage(error, "The models couldn't be loaded."));
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [provider, trimmedKey, hasPlausibleKey]);

  const reasoningEffortValue = REASONING_EFFORT_OPTIONS.some(
    (option) => option.id === reasoningEffort,
  )
    ? reasoningEffort
    : DEFAULT_REASONING_EFFORT;

  const handleSaveProvider = async () => {
    setSavingProvider(true);
    try {
      const trimmedMain =
        selectedMainModel.trim() || DEFAULT_MAIN_MODEL_BY_PROVIDER[provider];
      const nextKeys = cleanProviderMap(
        setMapValue(providerApiKeys, provider, selectedApiKey.trim()),
      );
      const nextModels = cleanProviderMap(
        setMapValue(providerMainModels, provider, trimmedMain),
      );
      await mergeParams(ctx, {
        provider,
        providerApiKeys: nextKeys,
        providerMainModels: nextModels,
        reasoningEffort,
      });
      setProviderApiKeys(nextKeys);
      setProviderMainModels(nextModels);
      ctx.notice('Chat provider saved.');
    } catch (error) {
      ctx.alert(errorMessage(error, "The chat provider couldn't be saved."));
    } finally {
      setSavingProvider(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!providerDirty || savingProvider) return;
    await handleSaveProvider();
  };

  return (
    <form onSubmit={handleSubmit}>
      <Page.Group
        title="Chat provider"
        footer={
          <Button
            submit
            tone="primary"
            expand={false}
            label="Save"
            busy={savingProvider}
            disabled={providerDirty ? undefined : { reason: NO_CHANGES_REASON }}
          />
        }
      >
        <FieldWrapper label="Provider">
          <RadioGroupInput
            value={provider}
            onChange={(next) => {
              if (next) setProvider(next);
            }}
            options={PROVIDER_OPTIONS}
          />
        </FieldWrapper>
        <FieldWrapper
          label={`${providerLabel} API key`}
          required
          hint={`Saved in the plugin settings. This browser sends it straight to ${providerLabel}.`}
        >
          <PasswordInput
            value={selectedApiKey}
            onChange={(next) => {
              setProviderApiKeys((current) =>
                setMapValue(current, provider, next ?? ''),
              );
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </FieldWrapper>
        <ModelField
          provider={provider}
          value={selectedMainModel}
          models={models}
          modelsState={modelsState}
          modelsError={modelsError}
          onChange={(model) => {
            setProviderMainModels((current) =>
              setMapValue(current, provider, model),
            );
          }}
        />
        {provider === 'current' && (
          <FieldWrapper
            label="Reasoning effort"
            hint="How much the model works before it answers. Higher settings take longer."
          >
            <SelectInput
              value={reasoningEffortValue}
              onChange={(_next, option) => {
                if (option) setReasoningEffort(option.value);
              }}
              options={REASONING_EFFORT_SELECT_OPTIONS}
              clearable={false}
            />
          </FieldWrapper>
        )}
      </Page.Group>
    </form>
  );
}

function resetPromptDisabled(promptIsDefault: boolean, savingPrompt: boolean) {
  if (promptIsDefault) return { reason: 'The prompt is already the default.' };
  if (savingPrompt) return { reason: 'Wait for the prompt to save.' };
  return undefined;
}

function SystemPromptForm({ ctx, params }: GroupProps) {
  const [systemPrompt, setSystemPrompt] = useState(
    params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  );
  const [savingPrompt, setSavingPrompt] = useState(false);

  const promptDirty =
    systemPrompt !== (params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const promptIsDefault = systemPrompt === DEFAULT_SYSTEM_PROMPT;

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    try {
      const trimmed = systemPrompt.trim();
      // The default is stored as no value, so a new bundled default applies
      const storeValue =
        trimmed.length === 0 || trimmed === DEFAULT_SYSTEM_PROMPT
          ? undefined
          : trimmed;
      await mergeParams(ctx, { systemPrompt: storeValue });
      ctx.notice('System prompt saved.');
    } catch (error) {
      ctx.alert(errorMessage(error, "The system prompt couldn't be saved."));
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleResetPrompt = () => {
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!promptDirty || savingPrompt) return;
    await handleSavePrompt();
  };

  return (
    <form onSubmit={handleSubmit}>
      <Page.Group
        title="System prompt"
        status={<Pill>{promptIsDefault ? 'Default' : 'Custom'}</Pill>}
        footer={
          <div className={s.footerActions}>
            <Button
              submit
              tone="primary"
              expand={false}
              label="Save"
              busy={savingPrompt}
              disabled={promptDirty ? undefined : { reason: NO_CHANGES_REASON }}
            />
            <Button
              tone="ghost"
              label="Reset to default"
              onClick={handleResetPrompt}
              disabled={resetPromptDisabled(promptIsDefault, savingPrompt)}
            />
          </div>
        }
      >
        <FieldWrapper
          label="Base prompt"
          hint="Sent at the start of every turn. The project, the current record and the fields added to the context are appended after it."
        >
          <TextareaInput
            rows={12}
            maxRows={24}
            value={systemPrompt}
            onChange={(next) => setSystemPrompt(next ?? '')}
          />
        </FieldWrapper>
      </Page.Group>
    </form>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  const params = readParams(ctx);

  const [debugMode, setDebugMode] = useState(params.debugMode === true);

  setDebugEnabled(debugMode);

  useEffect(() => {
    clearRemovedDiagnosticsStore({
      pluginId: ctx.plugin.id,
      siteId: ctx.site.id,
      environment: ctx.environment,
    });
  }, [ctx.environment, ctx.plugin.id, ctx.site.id]);

  // Optimistic: the switch and the console follow at once, and go back when
  // the save fails
  const handleToggleDebug = async (next: boolean) => {
    setDebugMode(next);
    setDebugEnabled(next);
    try {
      await mergeParams(ctx, { debugMode: next });
    } catch (error) {
      setDebugMode(!next);
      setDebugEnabled(!next);
      ctx.alert(errorMessage(error, "The setting couldn't be saved."));
    }
  };

  return (
    <Page>
      <Page.Content>
        <ConnectionGroup ctx={ctx} params={params} />
        <ProviderForm ctx={ctx} params={params} />
        <SystemPromptForm ctx={ctx} params={params} />
        <Page.Group title="Developer">
          <SwitchList>
            <FieldWrapper hint="Prints chat turns and DatoCMS actions in the browser console. Credentials, tokens and OAuth codes are redacted. Errors are always logged.">
              <SwitchInput
                label="Debug logging"
                value={debugMode}
                onChange={(next) => handleToggleDebug(next === true)}
              />
            </FieldWrapper>
          </SwitchList>
        </Page.Group>
      </Page.Content>
    </Page>
  );
}
