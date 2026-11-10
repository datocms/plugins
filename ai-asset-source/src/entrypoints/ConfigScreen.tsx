import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import NumberInput from 'datocms-react-ui/NumberInput';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConfigParameters, NormalizedConfigParameters } from '../types';
import {
  normalizeConfigParameters,
  sanitizeConfigParameters,
  serializeConfigParameters,
  updateProviderSettings,
} from '../utils/config';
import {
  getModelLabel,
  imageOutputFormatOptions,
  imageQualityOptions,
  providerBillingUrls,
  providerOptions,
  supportsOutputControls,
} from '../utils/imageService/catalog';
import { loadProviderModelOptions } from '../utils/imageService/modelDiscovery';
import type {
  ImageOutputFormat,
  ImageQuality,
  ProviderId,
  SelectOption,
} from '../utils/imageService/types';

type Props = {
  ctx: RenderConfigScreenCtx;
};

/** Where an admin gets an API key for each provider */
const apiKeyDocs: Record<ProviderId, { label: string; to: string }> = {
  openai: {
    label: 'Get an OpenAI API key',
    to: 'https://platform.openai.com/api-keys',
  },
  google: {
    label: 'Get a Google Gemini API key',
    to: 'https://aistudio.google.com/apikey',
  },
};

/** The start of the keys of each provider, as the placeholder of the key */
const apiKeyPlaceholders: Record<ProviderId, string> = {
  openai: 'sk-…',
  google: 'AIza…',
};

type ModelOptionsState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  options: Array<SelectOption<string>>;
  errorMessage?: string;
  /** The provider refused the key while listing its models */
  keyRejected?: boolean;
  /**
   * The account of the key is over its quota (or out of credit). The key
   * works: a callout under the Model field tells about the billing.
   */
  overQuota?: boolean;
};

const emptyModelOptionsState: ModelOptionsState = {
  status: 'idle',
  options: [],
};

export default function ConfigScreen({ ctx }: Props) {
  const initialValues = useMemo(
    () =>
      normalizeConfigParameters(
        (ctx.plugin.attributes.parameters || {}) as ConfigParameters,
      ),
    [ctx.plugin.attributes.parameters],
  );

  const [values, setValues] =
    useState<NormalizedConfigParameters>(initialValues);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [savedValues, setSavedValues] =
    useState<NormalizedConfigParameters>(initialValues);
  const [activeProvider, setActiveProvider] = useState<ProviderId>(
    initialValues.defaultProvider,
  );
  const [modelOptionsState, setModelOptionsState] = useState<ModelOptionsState>(
    emptyModelOptionsState,
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const activeProviderValues = values.providers[activeProvider];
  const activeProviderApiKey = activeProviderValues.apiKey.trim();
  const activeProviderModel = activeProviderValues.defaultModel.trim();
  const activeProviderHasSelectedModel = Boolean(activeProviderModel);
  const showOutputControls = supportsOutputControls(
    activeProvider,
    activeProviderModel,
  );
  const showCompressionControl =
    showOutputControls && values.providers.openai.defaultOutputFormat !== 'png';
  const modelOptions = useMemo(
    () =>
      withSelectedModelOption(modelOptionsState.options, activeProviderModel),
    [activeProviderModel, modelOptionsState.options],
  );
  const providerLabel =
    providerOptions.find((option) => option.value === activeProvider)?.label ??
    activeProvider;
  const apiKeyFieldError =
    apiKeyError ?? getApiKeyStatus(modelOptionsState, providerLabel);
  // While the API key field shows its error, the Model field says nothing
  // more about the key.
  const model = apiKeyFieldError
    ? {}
    : getModelStatus(
        activeProviderApiKey,
        modelOptionsState,
        activeProviderModel,
        providerLabel,
      );
  const hasAnyKey = Boolean(
    values.providers.openai.apiKey.trim() ||
      values.providers.google.apiKey.trim(),
  );
  const isDirty =
    serializeConfigParameters(values) !==
    serializeConfigParameters(savedValues);
  const saveReason = saving
    ? null
    : getSaveReason(
        Boolean(activeProviderApiKey),
        activeProviderHasSelectedModel,
        isDirty,
      );

  useEffect(() => {
    if (!activeProviderApiKey) {
      setModelOptionsState(emptyModelOptionsState);
      return;
    }

    const controller = new AbortController();
    const selectedModel =
      valuesRef.current.providers[activeProvider].defaultModel;

    setModelOptionsState(() => ({
      status: 'loading',
      options: withSelectedModelOption([], selectedModel),
    }));

    loadProviderModelOptions(activeProvider, activeProviderApiKey, {
      selectedModel: selectedModel,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setModelOptionsState({
          status: 'loaded',
          options: result.options,
        });

        const firstAvailableOption = result.options.find(
          (option) => !option.unavailable,
        );

        if (!selectedModel && firstAvailableOption) {
          setValues((current) =>
            current.providers[activeProvider].defaultModel
              ? current
              : updateProviderSettings(current, activeProvider, {
                  defaultModel: firstAvailableOption.value,
                }),
          );
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }

        const errorMessage = readErrorMessage(error);
        setModelOptionsState({
          status: 'error',
          options: withSelectedModelOption([], selectedModel),
          errorMessage,
          keyRejected: isKeyRejection(error),
          overQuota: isOverQuota(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [activeProvider, activeProviderApiKey]);

  const handleProviderChange = useCallback((nextProvider: ProviderId) => {
    setActiveProvider(nextProvider);
    setErrorMessage(null);
    setApiKeyError(null);
    setValues((current) => ({
      ...current,
      defaultProvider: nextProvider,
    }));
  }, []);

  const handleApiKeyChange = useCallback(
    (nextValue: string) => {
      setErrorMessage(null);
      setApiKeyError(null);
      setValues((current) =>
        updateProviderSettings(current, activeProvider, {
          apiKey: nextValue.trim(),
        }),
      );
    },
    [activeProvider],
  );

  const handleModelChange = useCallback(
    (nextModel: string) => {
      setErrorMessage(null);
      setValues((current) =>
        updateProviderSettings(current, activeProvider, {
          defaultModel: nextModel,
        }),
      );
    },
    [activeProvider],
  );

  const handleQualityChange = useCallback((nextQuality: ImageQuality) => {
    setValues((current) =>
      updateProviderSettings(current, 'openai', {
        defaultQuality: nextQuality,
      }),
    );
  }, []);

  const handleOutputFormatChange = useCallback(
    (nextFormat: ImageOutputFormat) => {
      setValues((current) =>
        updateProviderSettings(current, 'openai', {
          defaultOutputFormat: nextFormat,
        }),
      );
    },
    [],
  );

  const handleCompressionChange = useCallback((defaultCompression: number) => {
    setValues((current) =>
      updateProviderSettings(current, 'openai', { defaultCompression }),
    );
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextValues = sanitizeConfigParameters(values);
      const selectedProviderValues =
        nextValues.providers[nextValues.defaultProvider];

      if (!hasAnyKey || !selectedProviderValues.apiKey) {
        setApiKeyError('Enter an API key.');
        return;
      }

      if (!selectedProviderValues.defaultModel) {
        setErrorMessage('Select a model before saving.');
        return;
      }

      setSaving(true);
      setErrorMessage(null);

      try {
        await ctx.updatePluginParameters(nextValues);
        setValues(nextValues);
        setSavedValues(nextValues);
        ctx.notice('Settings saved.');
      } catch (error) {
        console.error('Image Generator plugin', error);
        setErrorMessage(
          "The settings weren't saved. Check your connection and try again.",
        );
      } finally {
        setSaving(false);
      }
    },
    [ctx, hasAnyKey, values],
  );

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the fields start the frame, with no
  // Page around them
  return (
    <form onSubmit={handleSubmit}>
      <FieldWrapper label="Provider">
        <SelectInput
          value={activeProvider}
          options={providerOptions}
          clearable={false}
          isSearchable={false}
          onChange={(_next, option) =>
            option && handleProviderChange(option.value)
          }
        />
      </FieldWrapper>

      <FieldWrapper
        label="API key"
        required
        hint={`Saved in the plugin settings. This browser sends it straight to ${providerLabel}.`}
        docs={apiKeyDocs[activeProvider]}
        error={apiKeyFieldError ?? undefined}
      >
        <PasswordInput
          value={activeProviderValues.apiKey}
          onChange={(next) => handleApiKeyChange(next ?? '')}
          placeholder={apiKeyPlaceholders[activeProvider]}
          autoComplete="off"
          spellCheck={false}
        />
      </FieldWrapper>

      <FieldWrapper
        label="Model"
        required
        hint={model.hint}
        error={model.error}
      >
        <SelectInput
          value={activeProviderModel || null}
          onChange={(next) => next && handleModelChange(next)}
          options={modelOptions}
          placeholder="Pick a model"
          clearable={false}
          loading={modelOptionsState.status === 'loading'}
          disabled={
            !activeProviderApiKey ||
            modelOptionsState.status === 'loading' ||
            modelOptions.length === 0
          }
          isOptionDisabled={(option) => Boolean(option.unavailable)}
        />
      </FieldWrapper>

      {modelOptionsState.overQuota && (
        <Callout tone="danger">
          This {providerLabel} account is over its quota.{' '}
          <a
            href={providerBillingUrls[activeProvider]}
            target="_blank"
            rel="noreferrer"
          >
            Check its billing
          </a>
          , then reload this page.
        </Callout>
      )}

      {showOutputControls && (
        <div className="form__field form__row">
          <div className="form__row__cell">
            <FieldWrapper
              label="Quality"
              hint="Higher quality takes longer and costs more per image."
            >
              <RadioGroupInput
                small
                value={values.providers.openai.defaultQuality}
                onChange={(next) => next && handleQualityChange(next)}
                options={imageQualityOptions}
              />
            </FieldWrapper>
          </div>
          <div className="form__row__cell">
            <FieldWrapper label="Output format">
              <RadioGroupInput
                small
                value={values.providers.openai.defaultOutputFormat}
                onChange={(next) => next && handleOutputFormatChange(next)}
                options={imageOutputFormatOptions}
              />
            </FieldWrapper>
          </div>
        </div>
      )}

      {showCompressionControl && (
        <FieldWrapper
          label="Compression"
          hint="Lower numbers make smaller files with less detail. 100 gives the best quality."
        >
          <NumberInput
            value={values.providers.openai.defaultCompression}
            onChange={(next) => handleCompressionChange(next ?? 100)}
            onBlur={(next) =>
              handleCompressionChange(normalizeCompression(next))
            }
            placeholder="100"
            inputMode="numeric"
            autoComplete="off"
          />
        </FieldWrapper>
      )}

      {errorMessage && <Callout tone="danger">{errorMessage}</Callout>}

      <Button
        submit
        tone="primary"
        label="Save"
        busy={saving}
        disabled={saveReason ? { reason: saveReason } : undefined}
      />
    </form>
  );
}

function withSelectedModelOption(
  options: Array<SelectOption<string>>,
  value: string,
): Array<SelectOption<string>> {
  if (!value || options.some((option) => option.value === value)) {
    return options;
  }

  return [
    ...options,
    {
      value,
      label: getModelLabel(value),
    },
  ];
}

/** The error of the API key field when the models can't load because of it */
function getApiKeyStatus(
  state: ModelOptionsState,
  providerLabel: string,
): string | null {
  return state.keyRejected
    ? `${providerLabel} didn't accept this key. Check that you copied the whole key.`
    : null;
}

function getModelStatus(
  apiKey: string,
  state: ModelOptionsState,
  selectedModel: string,
  providerLabel: string,
): { hint?: string; error?: string } {
  if (!apiKey) {
    return { hint: 'Add an API key to load the models.' };
  }

  // While the models load, the select shows its spinner
  if (state.status === 'loading') {
    return {};
  }

  // The quota callout under the field tells why the list didn't load
  if (state.status === 'error' && state.overQuota) {
    return {};
  }

  if (state.status === 'error') {
    return {
      error: state.errorMessage
        ? `${providerLabel} couldn't list the models: ${asSentence(state.errorMessage)} Reload this page to try again.`
        : `${providerLabel} couldn't list the models. Check your connection, then reload this page.`,
    };
  }

  if (state.status === 'loaded' && state.options.length === 0) {
    return {
      error:
        "This key can't make images. Use a key from an account with image models.",
    };
  }

  if (
    selectedModel &&
    state.options.some(
      (option) => option.value === selectedModel && option.unavailable,
    )
  ) {
    // The value already reads "(unavailable)": the error is the step alone
    return { error: 'Pick another model.' };
  }

  return {};
}

function getSaveReason(
  hasApiKey: boolean,
  hasSelectedModel: boolean,
  isDirty: boolean,
): string | null {
  if (!hasApiKey) {
    return 'Enter an API key before saving.';
  }

  if (!hasSelectedModel) {
    return 'Select a model before saving.';
  }

  if (!isDirty) {
    return 'There are no changes to save.';
  }

  return null;
}

function normalizeCompression(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return 100;
  }

  return Math.min(100, Math.max(0, Math.trunc(value)));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * The provider refused the key while listing its models: OpenAI answers 401,
 * Google 400 "API key not valid". Other 400 and 403 errors (a region the
 * provider doesn't serve, an API that is off) keep the provider's message.
 */
function isKeyRejection(error: unknown): boolean {
  const status = readErrorStatus(error);

  return (
    status === 401 ||
    ((status === 400 || status === 403) &&
      /api.?key/i.test(readErrorMessage(error) ?? ''))
  );
}

/** The account of a key that works is over its quota, or out of credit */
function isOverQuota(error: unknown): boolean {
  return (
    !isKeyRejection(error) &&
    (readErrorStatus(error) === 429 ||
      /quota|billing/i.test(readErrorMessage(error) ?? ''))
  );
}

function readErrorStatus(error: unknown): unknown {
  return error && typeof error === 'object' && 'status' in error
    ? error.status
    : undefined;
}

/**
 * The message of the provider. A network error has none: it has no status,
 * and its message ("Failed to fetch") says nothing to an admin.
 */
function readErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message) {
    return undefined;
  }

  if (
    readErrorStatus(error) === undefined &&
    /fetch|network|connect/i.test(error.message)
  ) {
    return undefined;
  }

  return error.message;
}

/** A message of the provider as a sentence, with its final period */
function asSentence(message: string): string {
  const trimmed = message.trim();

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
