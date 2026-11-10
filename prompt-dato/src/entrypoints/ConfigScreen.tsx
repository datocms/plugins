import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { derror, setDebugEnabled } from '../lib/debugLog';
import {
  buildAuthorizeFlow,
  computeRedirectUri,
  exchangeCodeForToken,
  OAUTH_POPUP_CLOSED_MESSAGE,
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

type SectionProps = {
  ctx: RenderConfigScreenCtx;
  params: PromptDatoParams;
};

type ConnectStage =
  | 'idle'
  | 'registering'
  | 'awaiting-consent'
  | 'exchanging'
  | 'saving';

type ModelsState = 'idle' | 'loading' | 'ready' | 'error';
type ReasoningEffortOption = {
  id: ReasoningEffort;
  label: string;
};

const OAUTH_CLIENT_MAX_AGE_SECONDS = 25 * 24 * 60 * 60;

const POPUP_BLOCKED =
  'The browser blocked the sign-in window. Allow pop-ups for this page, then connect again.';
const POPUP_CLOSED =
  'The sign-in window closed before you approved. Connect again to finish.';
const REVOKE_WARNING =
  "You're disconnected, but DatoCMS may still list this access. Remove it under Authorized applications in your DatoCMS account.";
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

/** Where to get the API key of each provider */
const API_KEY_DOCS: Record<ModelProvider, { label: string; to: string }> = {
  current: {
    label: 'Get an OpenAI API key',
    to: 'https://platform.openai.com/api-keys',
  },
  google: {
    label: 'Get a Google Gemini API key',
    to: 'https://aistudio.google.com/apikey',
  },
  anthropic: {
    label: 'Get an Anthropic API key',
    to: 'https://console.anthropic.com/settings/keys',
  },
};

/** The start of the keys of each provider, as the placeholder of the key */
const API_KEY_PLACEHOLDERS: Record<ModelProvider, string> = {
  current: 'sk-…',
  google: 'AIza…',
  anthropic: 'sk-ant-…',
};

// What sets the providers apart is said once, under the label of the field,
// rather than repeated under two of the options
const PROVIDER_FIELD_HINT =
  'With OpenAI the chat can also change the project, and each change asks for your approval. The other providers can only read it.';

const PROVIDER_OPTIONS = PROVIDER_CHOICES.map((choice) => ({
  value: choice.id,
  label: choice.label,
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

/** What failed, then why: "The setting couldn't be saved. You are offline." */
function failureMessage(what: string, error: unknown): string {
  const reason = error instanceof Error ? error.message.trim() : '';
  return reason ? `${what} ${reason}` : what;
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

function ConnectionSection({ ctx, params }: SectionProps) {
  const [connectStage, setConnectStage] = useState<ConnectStage>('idle');
  const [disconnecting, setDisconnecting] = useState(false);

  const connecting = connectStage !== 'idle';
  const isConnected = Boolean(params.datoAccessToken);

  // Synchronous: the popup must open inside the click, or the browser
  // blocks it
  const handleConnect = () => {
    let popup: Window;
    try {
      popup = openBlankPopup();
    } catch {
      ctx.alert(POPUP_BLOCKED);
      return;
    }

    setConnectStage('registering');

    (async () => {
      try {
        await runConnectFlow(ctx, popup, setConnectStage);
      } catch (error) {
        if (!popup.closed) popup.close();
        if (
          error instanceof Error &&
          error.message === OAUTH_POPUP_CLOSED_MESSAGE
        ) {
          void ctx.customToast({ type: 'warning', message: POPUP_CLOSED });
        } else {
          ctx.alert(failureMessage("DatoCMS couldn't be connected.", error));
        }
      } finally {
        setConnectStage('idle');
      }
    })();
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const revokeFailed = await revokeStoredToken(readParams(ctx));
      await mergeParams(ctx, { datoAccessToken: undefined });
      if (revokeFailed) {
        void ctx.customToast({ type: 'warning', message: REVOKE_WARNING });
      } else {
        ctx.notice('Disconnected from DatoCMS.');
      }
    } catch (error) {
      ctx.alert(failureMessage("DatoCMS couldn't be disconnected.", error));
    } finally {
      setDisconnecting(false);
    }
  };

  // The first part of the screen has no title: the host draws "Plugin
  // settings" above it, so the description names the account
  return (
    <Page.Section>
      <Page.SectionDescription>
        {/* The busy button tells that the sign-in runs: the description only
            tells where to go on, while the sign-in window waits */}
        <span role="status">
          {connectStage === 'awaiting-consent'
            ? 'Approve the access in the sign-in window.'
            : "Everyone's chats use your DatoCMS account and its permissions."}
        </span>
      </Page.SectionDescription>
      {!isConnected && (
        <Callout tone="warning">
          Chat needs this connection to read and change the project.
        </Callout>
      )}
      {isConnected ? (
        <Button
          label="Disconnect"
          onClick={handleDisconnect}
          busy={disconnecting}
          disabled={
            connecting
              ? { reason: 'Wait for the connection to finish.' }
              : undefined
          }
        />
      ) : (
        <Button label="Connect" onClick={handleConnect} busy={connecting} />
      )}
    </Page.Section>
  );
}

// After an error, the error of the key or of the list tells why the field
// is off
function modelHint(modelsState: ModelsState) {
  if (modelsState === 'loading') return 'Loading the models…';
  if (modelsState === 'idle') return 'Add an API key to load the models.';
  return undefined;
}

/**
 * Why Save of the provider can't run: there is nothing to save, or a switch
 * to a provider without a key would leave the chat not set up. The key of
 * the saved provider can still be cleared.
 */
function providerSaveReason(
  dirty: boolean,
  switchesProvider: boolean,
  key: string,
): string | undefined {
  if (!dirty) return NO_CHANGES_REASON;
  if (switchesProvider && !key) return 'Enter an API key before saving.';
  return undefined;
}

/** The provider refused the key itself (see fetchProviderModels) */
function isKeyRejection(modelsError: string | null): boolean {
  return modelsError?.includes('key was rejected') ?? false;
}

/** The error of the key: the provider refused it, or it gives no models */
function apiKeyError(
  provider: ModelProvider,
  modelsState: ModelsState,
  modelsError: string | null,
  modelsCount: number,
) {
  if (modelsState === 'error' && isKeyRejection(modelsError)) {
    return `${getProviderLabel(provider)} didn't accept this key. Check that you copied the whole key.`;
  }
  if (modelsState === 'ready' && modelsCount === 0) {
    return `This key can't use any chat model. Check its permissions at ${getProviderLabel(provider)}, or use another key.`;
  }
  return undefined;
}

/** The error of the list of models, when it fails for another reason */
function modelError(modelsState: ModelsState, modelsError: string | null) {
  if (modelsState !== 'error' || isKeyRejection(modelsError)) return undefined;
  return modelsError ?? "The models couldn't be loaded.";
}

type ModelFieldProps = {
  value: string;
  models: ChatModelOption[];
  modelsState: ModelsState;
  modelsError: string | null;
  onChange: (model: string) => void;
};

function ModelField({
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
      hint={modelHint(modelsState)}
      error={modelError(modelsState, modelsError)}
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

function ProviderForm({ ctx, params }: SectionProps) {
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
  const savedProvider = params.provider ?? 'current';

  const providerDirty =
    provider !== savedProvider ||
    !providerMapsEqual(
      cleanProviderMap(providerApiKeys),
      cleanProviderMap(params.providerApiKeys ?? {}),
    ) ||
    !providerMapsEqual(
      cleanProviderMap(providerMainModels),
      cleanProviderMap(params.providerMainModels ?? {}),
    ) ||
    reasoningEffort !== (params.reasoningEffort ?? DEFAULT_REASONING_EFFORT);

  const saveBlockedReason = providerSaveReason(
    providerDirty,
    provider !== savedProvider,
    trimmedKey,
  );

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
      ctx.alert(failureMessage("The chat provider couldn't be saved.", error));
    } finally {
      setSavingProvider(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveBlockedReason || savingProvider) return;
    await handleSaveProvider();
  };

  return (
    <Page.Section>
      <Page.SectionTitle>Chat provider</Page.SectionTitle>
      <form onSubmit={handleSubmit}>
        <FieldWrapper label="Provider" hint={PROVIDER_FIELD_HINT}>
          <SelectInput
            value={provider}
            onChange={(_next, option) => {
              if (option) setProvider(option.value);
            }}
            options={PROVIDER_OPTIONS}
            clearable={false}
            isSearchable={false}
          />
        </FieldWrapper>
        <FieldWrapper
          label="API key"
          required
          hint={`Saved in the plugin settings. This browser sends it straight to ${providerLabel}.`}
          docs={API_KEY_DOCS[provider]}
          error={apiKeyError(provider, modelsState, modelsError, models.length)}
        >
          <PasswordInput
            value={selectedApiKey}
            onChange={(next) => {
              setProviderApiKeys((current) =>
                setMapValue(current, provider, next ?? ''),
              );
            }}
            placeholder={API_KEY_PLACEHOLDERS[provider]}
            autoComplete="off"
            spellCheck={false}
          />
        </FieldWrapper>
        <ModelField
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
        <Button
          submit
          tone="primary"
          label="Save"
          busy={savingProvider}
          disabled={
            saveBlockedReason ? { reason: saveBlockedReason } : undefined
          }
        />
      </form>
    </Page.Section>
  );
}

function SystemPromptForm({ ctx, params }: SectionProps) {
  const [systemPrompt, setSystemPrompt] = useState(
    params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  );
  const [savingPrompt, setSavingPrompt] = useState(false);

  const promptDirty =
    systemPrompt !== (params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const promptIsDefault = systemPrompt === DEFAULT_SYSTEM_PROMPT;
  // Advanced: the section opens by itself only when it holds custom
  // instructions
  const [open, setOpen] = useState(!promptIsDefault);

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
      ctx.notice('Instructions saved.');
    } catch (error) {
      ctx.alert(failureMessage("The instructions couldn't be saved.", error));
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
    <Page.Section>
      <Page.SectionTitle collapse={{ open, onToggle: () => setOpen(!open) }}>
        Chat instructions
      </Page.SectionTitle>
      {open && (
        <form onSubmit={handleSubmit}>
          <FieldWrapper
            label="Instructions"
            hint="The chat follows them in every conversation."
          >
            <TextareaInput
              rows={6}
              maxRows={24}
              value={systemPrompt}
              onChange={(next) => setSystemPrompt(next ?? '')}
              placeholder="Write in a warm, plain voice. Keep titles under 60 characters."
            />
          </FieldWrapper>
          <div className={s.actions}>
            <Button
              submit
              tone="primary"
              label="Save"
              busy={savingPrompt}
              disabled={promptDirty ? undefined : { reason: NO_CHANGES_REASON }}
            />
            {/* Instructions that are the default have nothing to reset */}
            {!promptIsDefault && (
              <Button
                tone="ghost"
                label="Reset to default"
                onClick={handleResetPrompt}
                disabled={
                  savingPrompt
                    ? { reason: 'Wait for the prompt to save.' }
                    : undefined
                }
              />
            )}
          </div>
        </form>
      )}
    </Page.Section>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  const params = readParams(ctx);

  const [debugMode, setDebugMode] = useState(params.debugMode === true);
  // Advanced: the section opens by itself only while the logging is on
  const [developerOpen, setDeveloperOpen] = useState(debugMode);

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
      ctx.alert(failureMessage("Debug logging couldn't be saved.", error));
    }
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the sections start the frame, with no
  // Page around them
  return (
    <>
      <ConnectionSection ctx={ctx} params={params} />
      <ProviderForm ctx={ctx} params={params} />
      <SystemPromptForm ctx={ctx} params={params} />
      <Page.Section>
        <Page.SectionTitle
          collapse={{
            open: developerOpen,
            onToggle: () => setDeveloperOpen(!developerOpen),
          }}
        >
          Developer
        </Page.SectionTitle>
        {developerOpen && (
          <FieldWrapper hint="Prints chat turns and DatoCMS actions in the browser console.">
            <SwitchInput
              label="Debug logging"
              value={debugMode}
              onChange={(next) => handleToggleDebug(next === true)}
            />
          </FieldWrapper>
        )}
      </Page.Section>
    </>
  );
}
