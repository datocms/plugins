import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  Form,
  SelectField,
  Spinner,
  SwitchField,
  TextField,
  TextareaField,
} from 'datocms-react-ui';
import { useEffect, useRef, useState } from 'react';
import { derror, setDebugEnabled } from '../lib/debugLog';
import {
  buildAuthorizeFlow,
  computeRedirectUri,
  exchangeCodeForToken,
  openBlankPopup,
  registerClient,
  revokeToken,
  waitForOAuthCallback,
} from '../lib/oauth';
import { type ChatModelOption, fetchProviderModels } from '../lib/providerRuntime';
import {
  DEFAULT_MAIN_MODEL_BY_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_SYSTEM_PROMPT,
  getProviderLabel,
  mergeParams,
  PROVIDER_CHOICES,
  PROVIDER_DEFAULT_REASONING_EFFORT,
  readParams,
  type ModelProvider,
  type ProviderChoice,
  type ProviderValueMap,
  type ReasoningEffort,
} from '../lib/pluginParams';
import { clearRemovedDiagnosticsStore } from '../lib/removedDiagnostics';
import s from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type ConnectStage =
  | 'idle'
  | 'registering'
  | 'awaiting-consent'
  | 'exchanging'
  | 'saving';

const STAGE_LABELS: Record<ConnectStage, string> = {
  idle: '',
  registering: 'Registering plugin with DatoCMS…',
  'awaiting-consent': 'Waiting for you to approve in the popup…',
  exchanging: 'Exchanging authorization code…',
  saving: 'Saving connection…',
};

type ModelsState = 'idle' | 'loading' | 'ready' | 'error';
type ReasoningEffortOption = {
  id: ReasoningEffort;
  label: string;
};

const OAUTH_CLIENT_MAX_AGE_SECONDS = 25 * 24 * 60 * 60;

const REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = [
  { id: PROVIDER_DEFAULT_REASONING_EFFORT, label: 'Provider default' },
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
];

function modelFieldHint(
  provider: ModelProvider,
  modelsState: ModelsState,
  modelsError: string | null,
  modelsCount: number,
): string {
  const providerLabel = getProviderLabel(provider);
  if (modelsState === 'idle') {
    return `Enter a valid ${providerLabel} key above to load the model list.`;
  }
  if (modelsState === 'loading') return 'Fetching available models…';
  if (modelsState === 'error') {
    return modelsError ?? 'Failed to load models with the provided key.';
  }
  if (modelsCount === 0) {
    return 'No compatible models were returned for this account.';
  }
  return 'Used by chat.';
}

function selectPlaceholder(
  modelsState: ModelsState,
  hasPlausibleKey: boolean,
): string {
  if (modelsState === 'loading') return 'Loading models…';
  if (!hasPlausibleKey) return 'Enter a valid key first';
  if (modelsState === 'error') return 'Could not load models';
  return 'Pick the main model';
}

function oauthClientIsStale(issuedAt: number | undefined): boolean {
  if (!issuedAt) return true;
  const now = Math.floor(Date.now() / 1000);
  return now - issuedAt > OAUTH_CLIENT_MAX_AGE_SECONDS;
}

function isInvalidClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('invalid_client') || message.includes('invalid client');
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

export default function ConfigScreen({ ctx }: Props) {
  const params = readParams(ctx);

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
  const [systemPrompt, setSystemPrompt] = useState(
    params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  );
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [debugMode, setDebugMode] = useState(params.debugMode === true);
  const [savingDebug, setSavingDebug] = useState(false);

  setDebugEnabled(debugMode);

  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [modelsState, setModelsState] = useState<ModelsState>('idle');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelsAbortRef = useRef<AbortController | null>(null);

  const [connectStage, setConnectStage] = useState<ConnectStage>('idle');
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const connecting = connectStage !== 'idle';
  const stageLabel = STAGE_LABELS[connectStage];
  const isConnected = Boolean(params.datoAccessToken);
  const selectedProviderOption =
    PROVIDER_CHOICES.find((choice) => choice.id === provider) ??
    PROVIDER_CHOICES[0];
  const selectedApiKey = providerApiKeys[provider] ?? '';
  const selectedMainModel =
    providerMainModels[provider] ?? DEFAULT_MAIN_MODEL_BY_PROVIDER[provider];
  const trimmedKey = selectedApiKey.trim();
  const hasPlausibleKey = trimmedKey.length >= 8;

  useEffect(() => {
    clearRemovedDiagnosticsStore({
      pluginId: ctx.plugin.id,
      siteId: ctx.site.id,
      environment: ctx.environment,
    });
  }, [ctx.environment, ctx.plugin.id, ctx.site.id]);

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

  const promptDirty =
    systemPrompt !== (params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const promptIsDefault = systemPrompt === DEFAULT_SYSTEM_PROMPT;

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
        if (!providerMainModels[provider] && list[0]) {
          setProviderMainModels((current) =>
            setMapValue(current, provider, list[0].id),
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : 'Failed to load models';
        setModels([]);
        setModelsState('error');
        setModelsError(message);
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [provider, trimmedKey, hasPlausibleKey, providerMainModels]);

  const modelOptions = (() => {
    const ids = new Set(models.map((m) => m.id));
    const extras: ChatModelOption[] = [];
    if (selectedMainModel && !ids.has(selectedMainModel)) {
      extras.push({ id: selectedMainModel });
      ids.add(selectedMainModel);
    }
    return extras.length > 0 ? [...extras, ...models] : models;
  })();

  const selectedMainModelOption =
    modelOptions.find((m) => m.id === selectedMainModel) ?? null;
  const selectedReasoningEffortOption =
    REASONING_EFFORT_OPTIONS.find((option) => option.id === reasoningEffort) ??
    REASONING_EFFORT_OPTIONS.find(
      (option) => option.id === DEFAULT_REASONING_EFFORT,
    ) ??
    null;

  const handleConnect = () => {
    setConnectError(null);

    let popup: Window;
    try {
      popup = openBlankPopup();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to open popup';
      setConnectError(message);
      return;
    }

    setConnectStage('registering');

    (async () => {
      try {
        const redirectUri = computeRedirectUri();
        const current = readParams(ctx);

        let clientId = current.oauthClientId ?? '';
        const registerAndSave = async () => {
          const registered = await registerClient(redirectUri);
          await mergeParams(ctx, {
            oauthClientId: registered.clientId,
            oauthClientIssuedAt: registered.clientIdIssuedAt,
            oauthRedirectUri: registered.redirectUri,
          });
          return registered.clientId;
        };

        if (
          !clientId ||
          current.oauthRedirectUri !== redirectUri ||
          oauthClientIsStale(current.oauthClientIssuedAt)
        ) {
          clientId = await registerAndSave();
        }

        let retriedInvalidClient = false;
        while (true) {
          try {
            const flow = await buildAuthorizeFlow({ clientId, redirectUri });
            popup.location.href = flow.authorizeUrl;
            setConnectStage('awaiting-consent');

            const callback = await waitForOAuthCallback(popup, flow.state);
            setConnectStage('exchanging');

            const { accessToken } = await exchangeCodeForToken({
              code: callback.code,
              state: callback.state,
              clientId,
            });

            setConnectStage('saving');
            await mergeParams(ctx, { datoAccessToken: accessToken });
            ctx.notice('Connected to DatoCMS MCP');
            break;
          } catch (error) {
            if (!retriedInvalidClient && isInvalidClientError(error)) {
              retriedInvalidClient = true;
              setConnectStage('registering');
              clientId = await registerAndSave();
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        if (!popup.closed) popup.close();
        const message =
          error instanceof Error ? error.message : 'OAuth flow failed';
        setConnectError(message);
      } finally {
        setConnectStage('idle');
      }
    })();
  };

  const handleDisconnect = async () => {
    setConnectError(null);
    setDisconnecting(true);
    let revokeFailed = false;
    try {
      const current = readParams(ctx);
      if (current.datoAccessToken && current.oauthClientId) {
        try {
          await revokeToken({
            token: current.datoAccessToken,
            clientId: current.oauthClientId,
          });
        } catch (error) {
          revokeFailed = true;
          derror('OAuth', 'revoke_token:nonblocking_failure', error);
        }
      }
      await mergeParams(ctx, { datoAccessToken: undefined });
      ctx.notice('Disconnected from DatoCMS MCP');
      if (revokeFailed) {
        setConnectError(
          'Disconnected locally. Token revocation failed; reconnect if access still appears active elsewhere.',
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Disconnect failed';
      setConnectError(message);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    try {
      const trimmed = systemPrompt.trim();
      const storeValue =
        trimmed.length === 0 || trimmed === DEFAULT_SYSTEM_PROMPT
          ? undefined
          : trimmed;
      await mergeParams(ctx, { systemPrompt: storeValue });
      ctx.notice('System prompt saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      ctx.alert(message);
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleResetPrompt = () => {
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
  };

  const handleToggleDebug = async (next: boolean) => {
    setDebugMode(next);
    setDebugEnabled(next);
    setSavingDebug(true);
    try {
      await mergeParams(ctx, { debugMode: next });
    } catch (error) {
      setDebugMode(!next);
      setDebugEnabled(!next);
      const message = error instanceof Error ? error.message : 'Save failed';
      ctx.alert(message);
    } finally {
      setSavingDebug(false);
    }
  };

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
      ctx.notice('Provider settings saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      ctx.alert(message);
    } finally {
      setSavingProvider(false);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s.section}>
        <h3 className={s.sectionTitle}>DatoCMS connection</h3>
        <p className={s.sectionHint}>
          Chat talks to your DatoCMS project through the hosted MCP server at{' '}
          <code>mcp.datocms.com</code>. Authentication uses OAuth — no API
          tokens to copy or rotate.
        </p>

        <div className={s.connectionRow}>
          <span
            className={`${s.statusDot} ${
              isConnected ? s.connected : s.disconnected
            }`}
            aria-hidden="true"
          />
          <div className={s.statusText}>
            <strong>
              {connecting
                ? 'Authenticating…'
                : disconnecting
                  ? 'Disconnecting…'
                  : isConnected
                    ? 'Connected to DatoCMS MCP'
                    : 'Not connected'}
            </strong>
            <small>
              {connecting
                ? stageLabel
                : disconnecting
                  ? 'Revoking the access token…'
                  : isConnected
                    ? 'Chat can read this project through your account.'
                    : 'Connect to enable chat.'}
            </small>
          </div>
          {connecting || disconnecting ? <Spinner size={20} /> : null}
        </div>

        <div className={s.buttonRow}>
          {isConnected ? (
            <Button
              type="button"
              buttonType="muted"
              onClick={handleDisconnect}
              disabled={disconnecting || connecting}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              type="button"
              buttonType="primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? stageLabel || 'Connecting…' : 'Connect to DatoCMS'}
            </Button>
          )}
        </div>

        {connectError ? <div className={s.error}>{connectError}</div> : null}
      </div>

      <div className={s.section}>
        <h3 className={s.sectionTitle}>Chat provider</h3>
        <p className={s.sectionHint}>
          Choose which provider handles chat. Each provider keeps its own key and
          main model.
        </p>

        <Form onSubmit={handleSaveProvider}>
          <FieldGroup>
            <SelectField
              id="chat-provider"
              name="chat-provider"
              label="Provider"
              required
              value={selectedProviderOption}
              onChange={(option) => {
                if (option && !Array.isArray(option) && 'id' in option) {
                  setProvider(option.id);
                }
              }}
              selectInputProps={{
                options: PROVIDER_CHOICES,
                getOptionLabel: (option: ProviderChoice) => option.label,
                getOptionValue: (option: ProviderChoice) => option.id,
                placeholder: 'Pick a provider',
              }}
            />
            <TextField
              id="provider-api-key"
              name="provider-api-key"
              label={`${getProviderLabel(provider)} API key`}
              hint="Stored in plugin parameters and sent directly from this browser."
              required
              value={selectedApiKey}
              onChange={(value) => {
                setProviderApiKeys((current) =>
                  setMapValue(current, provider, value),
                );
              }}
              textInputProps={{
                autoComplete: 'off',
                monospaced: true,
                type: 'password',
              }}
              placeholder="Paste key"
            />
            <SelectField
              id="provider-main-model"
              name="provider-main-model"
              label="Main model"
              hint={modelFieldHint(
                provider,
                modelsState,
                modelsError,
                models.length,
              )}
              error={
                modelsState === 'error' ? (modelsError ?? undefined) : undefined
              }
              required
              value={selectedMainModelOption}
              onChange={(option) => {
                if (option && !Array.isArray(option) && 'id' in option) {
                  setProviderMainModels((current) =>
                    setMapValue(current, provider, option.id),
                  );
                }
              }}
              selectInputProps={{
                isDisabled: modelsState !== 'ready' || models.length === 0,
                isLoading: modelsState === 'loading',
                options: modelOptions,
                getOptionLabel: (option) => option.id,
                getOptionValue: (option) => option.id,
                placeholder: selectPlaceholder(modelsState, hasPlausibleKey),
              }}
            />
            {provider === 'current' ? (
              <SelectField
                id="reasoning-effort"
                name="reasoning-effort"
                label="Reasoning effort"
                hint="Controls how much work the main model does before responding. Higher settings can take longer."
                required
                value={selectedReasoningEffortOption}
                onChange={(option) => {
                  if (option && !Array.isArray(option) && 'id' in option) {
                    setReasoningEffort(option.id);
                  }
                }}
                selectInputProps={{
                  options: REASONING_EFFORT_OPTIONS,
                  getOptionLabel: (option) => option.label,
                  getOptionValue: (option) => option.id,
                  placeholder: 'Pick the reasoning effort',
                }}
              />
            ) : null}
          </FieldGroup>
          <Button
            type="submit"
            buttonType="primary"
            disabled={savingProvider || !providerDirty}
          >
            {savingProvider ? 'Saving…' : 'Save provider settings'}
          </Button>
        </Form>
      </div>

      <div className={s.section}>
        <h3 className={s.sectionTitle}>System prompt</h3>
        <p className={s.sectionHint}>
          The base instructions sent on every turn. A strong default is bundled
          with the plugin; tweak it here if you want to change tone, enforce
          workflows, or lock behavior down further. The project pin, current
          record snapshot, and scoped-field emphasis are appended automatically
          after whatever you put here.
        </p>

        <Form onSubmit={handleSavePrompt}>
          <FieldGroup>
            <TextareaField
              id="system-prompt"
              name="system-prompt"
              label="Base system prompt"
              hint={
                promptIsDefault
                  ? 'Currently using the bundled default.'
                  : 'Custom prompt active. Click "Reset to default" to revert.'
              }
              required
              value={systemPrompt}
              onChange={setSystemPrompt}
              textareaInputProps={{
                monospaced: true,
                rows: 18,
              }}
            />
          </FieldGroup>
          <div className={s.buttonRow}>
            <Button
              type="submit"
              buttonType="primary"
              disabled={savingPrompt || !promptDirty}
            >
              {savingPrompt ? 'Saving…' : 'Save system prompt'}
            </Button>
            <Button
              type="button"
              buttonType="muted"
              onClick={handleResetPrompt}
              disabled={promptIsDefault || savingPrompt}
            >
              Reset to default
            </Button>
          </div>
        </Form>
      </div>

      <div className={s.section}>
        <h3 className={s.sectionTitle}>Developer</h3>
        <p className={s.sectionHint}>
          Print compact console output for chat turns and DatoCMS actions.
          Credentials, tokens, and OAuth codes are redacted automatically.
          Errors keep logging even when this is off.
        </p>
        <SwitchField
          id="debug-mode"
          name="debug-mode"
          label={savingDebug ? 'Debug logging (saving…)' : 'Debug logging'}
          hint="Open the browser console to see the output."
          value={debugMode}
          onChange={(next: boolean) => handleToggleDebug(next)}
        />
      </div>
    </Canvas>
  );
}
