import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import NumberInput from 'datocms-react-ui/NumberInput';
import { Page } from 'datocms-react-ui/Page';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { GoogleIcon, OpenAiIcon } from '../icons';
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

const providerDetails: Record<ProviderId, { hint: string; icon: ReactNode }> = {
  openai: { hint: 'Needs an OpenAI API key.', icon: <OpenAiIcon /> },
  google: { hint: 'Needs a Google AI Studio API key.', icon: <GoogleIcon /> },
};

const providerRadioOptions = providerOptions.map(({ value, label }) => ({
  value,
  label,
  ...providerDetails[value],
}));

type ModelOptionsState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  options: Array<SelectOption<string>>;
  errorMessage?: string;
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
  const model = getModelStatus(
    activeProviderApiKey,
    modelOptionsState,
    activeProviderModel,
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
    : getSaveReason(hasAnyKey, activeProviderHasSelectedModel, isDirty);

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

        setModelOptionsState({
          status: 'error',
          options: withSelectedModelOption([], selectedModel),
          errorMessage: readErrorMessage(error),
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

      if (!hasAnyKey) {
        setApiKeyError('Add at least one provider key before saving.');
        return;
      }

      if (!selectedProviderValues.apiKey) {
        setApiKeyError(
          'Add an API key for the selected provider before saving.',
        );
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
        ctx.notice('Settings updated successfully.');
      } catch (error) {
        console.error('Image Generator plugin', error);
        setErrorMessage('Unable to save settings right now.');
      } finally {
        setSaving(false);
      }
    },
    [ctx, hasAnyKey, values],
  );

  return (
    <Page>
      <Page.Content>
        <form onSubmit={handleSubmit}>
          <Page.Group
            title="Image provider"
            footer={
              <Button
                submit
                tone="primary"
                label="Save"
                expand={false}
                busy={saving}
                disabled={saveReason ? { reason: saveReason } : undefined}
              />
            }
          >
            <FieldWrapper label="Provider">
              <RadioGroupInput
                value={activeProvider}
                onChange={(next) => next && handleProviderChange(next)}
                options={providerRadioOptions}
              />
            </FieldWrapper>

            <FieldWrapper
              label="API key"
              required
              error={apiKeyError ?? undefined}
            >
              <PasswordInput
                value={activeProviderValues.apiKey}
                onChange={(next) => handleApiKeyChange(next ?? '')}
                placeholder={activeProvider === 'openai' ? 'sk-...' : 'AIza...'}
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

            {showOutputControls && (
              <div className="form__field form__row">
                <div className="form__row__cell">
                  <FieldWrapper label="Quality">
                    <RadioGroupInput
                      value={values.providers.openai.defaultQuality}
                      onChange={(next) => next && handleQualityChange(next)}
                      options={imageQualityOptions}
                    />
                  </FieldWrapper>
                </div>
                <div className="form__row__cell">
                  <FieldWrapper label="Output format">
                    <RadioGroupInput
                      value={values.providers.openai.defaultOutputFormat}
                      onChange={(next) =>
                        next && handleOutputFormatChange(next)
                      }
                      options={imageOutputFormatOptions}
                    />
                  </FieldWrapper>
                </div>
              </div>
            )}

            {showCompressionControl && (
              <FieldWrapper label="Compression" hint="From 0 to 100.">
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
          </Page.Group>
        </form>
      </Page.Content>
    </Page>
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

function getModelStatus(
  apiKey: string,
  state: ModelOptionsState,
  selectedModel: string,
): { hint?: string; error?: string } {
  if (!apiKey) {
    return { hint: 'Add an API key to load available models.' };
  }

  if (state.status === 'loading') {
    return { hint: 'Loading available models…' };
  }

  if (state.status === 'error') {
    return { error: state.errorMessage || 'Unable to load models.' };
  }

  if (state.status === 'loaded' && state.options.length === 0) {
    return { error: 'No compatible image models were returned for this key.' };
  }

  if (
    selectedModel &&
    state.options.some(
      (option) => option.value === selectedModel && option.unavailable,
    )
  ) {
    return { error: 'This saved model was not returned by the provider.' };
  }

  return {};
}

function getSaveReason(
  hasAnyKey: boolean,
  hasSelectedModel: boolean,
  isDirty: boolean,
): string | null {
  if (!hasAnyKey) {
    return 'Add at least one provider key before saving.';
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

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load models.';
}
