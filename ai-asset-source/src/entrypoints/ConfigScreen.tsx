import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, SelectField, TextField } from 'datocms-react-ui';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
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
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

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

  const activeProviderValues = values.providers[activeProvider];
  const activeProviderApiKey = activeProviderValues.apiKey.trim();
  const activeProviderModel = activeProviderValues.defaultModel.trim();
  const activeProviderHasSelectedModel = Boolean(activeProviderModel);
  const showOutputControls = supportsOutputControls(
    activeProvider,
    activeProviderModel,
  );
  const showCompressionControl =
    showOutputControls &&
    values.providers.openai.defaultOutputFormat !== 'png';
  const modelOptions = useMemo(
    () =>
      withSelectedModelOption(modelOptionsState.options, activeProviderModel),
    [activeProviderModel, modelOptionsState.options],
  );
  const hasAnyKey = Boolean(
    values.providers.openai.apiKey.trim() || values.providers.google.apiKey.trim(),
  );
  const isDirty =
    serializeConfigParameters(values) !==
    serializeConfigParameters(savedValues);
  const canSave =
    !saving && isDirty && hasAnyKey && activeProviderHasSelectedModel;

  useEffect(() => {
    if (!activeProviderApiKey) {
      setModelOptionsState(emptyModelOptionsState);
      return;
    }

    const controller = new AbortController();

    setModelOptionsState(() => ({
      status: 'loading',
      options: withSelectedModelOption([], activeProviderModel),
    }));

    loadProviderModelOptions(activeProvider, activeProviderApiKey, {
      selectedModel: activeProviderModel,
      signal: controller.signal,
    })
      .then((result) => {
        setModelOptionsState({
          status: 'loaded',
          options: result.options,
        });

        const firstAvailableOption = result.options.find(
          (option) => !option.unavailable,
        );

        if (!activeProviderModel && firstAvailableOption) {
          setValues((current) =>
            updateProviderSettings(current, activeProvider, {
              defaultModel: firstAvailableOption.value,
            }),
          );
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        setModelOptionsState({
          status: 'error',
          options: withSelectedModelOption([], activeProviderModel),
          errorMessage: readErrorMessage(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [activeProvider, activeProviderApiKey]);

  const handleProviderChange = useCallback((selectedOption: unknown) => {
    const nextProvider = getSelectOptionValue<ProviderId>(selectedOption);

    if (!nextProvider) {
      return;
    }

    setActiveProvider(nextProvider);
    setErrorMessage(null);
    setValues((current) => ({
      ...current,
      defaultProvider: nextProvider,
    }));
  }, []);

  const handleApiKeyChange = useCallback(
    (nextValue: string) => {
      setErrorMessage(null);
      setValues((current) =>
        updateProviderSettings(current, activeProvider, {
          apiKey: nextValue.trim(),
        }),
      );
    },
    [activeProvider],
  );

  const handleModelChange = useCallback(
    (selectedOption: unknown) => {
      const nextModel = getSelectOptionValue<string>(selectedOption);

      if (!nextModel) {
        return;
      }

      setErrorMessage(null);
      setValues((current) =>
        updateProviderSettings(current, activeProvider, {
          defaultModel: nextModel,
        }),
      );
    },
    [activeProvider],
  );

  const handleQualityChange = useCallback((selectedOption: unknown) => {
    const nextQuality = getSelectOptionValue<ImageQuality>(selectedOption);

    if (!nextQuality) {
      return;
    }

    setValues((current) =>
      updateProviderSettings(current, 'openai', {
        defaultQuality: nextQuality,
      }),
    );
  }, []);

  const handleOutputFormatChange = useCallback((selectedOption: unknown) => {
    const nextFormat = getSelectOptionValue<ImageOutputFormat>(selectedOption);

    if (!nextFormat) {
      return;
    }

    setValues((current) =>
      updateProviderSettings(current, 'openai', {
        defaultOutputFormat: nextFormat,
      }),
    );
  }, []);

  const handleCompressionChange = useCallback((nextValue: string) => {
    setValues((current) =>
      updateProviderSettings(current, 'openai', {
        defaultCompression: normalizeCompression(nextValue),
      }),
    );
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextValues = sanitizeConfigParameters(values);
      const selectedProviderValues = nextValues.providers[nextValues.defaultProvider];

      if (!hasAnyKey) {
        setErrorMessage('Add at least one provider key before saving.');
        return;
      }

      if (!selectedProviderValues.apiKey) {
        setErrorMessage(
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
    <div className={`image-generator-theme ${s.settings}`}>
      <form className={s.settingsForm} onSubmit={handleSubmit}>
        <div className={s.settingsSection}>
          <div className={s.settingsGrid}>
            <div className={s.fieldBlock} style={{ marginTop: 0 }}>
              <SelectField
                id="provider"
                name="provider"
                label="Provider"
                value={findSelectedOption(providerOptions, activeProvider)}
                onChange={handleProviderChange}
                selectInputProps={{
                  options: providerOptions,
                  getOptionLabel: (option) => option.label,
                  getOptionValue: (option) => option.value,
                }}
              />
            </div>

            <div className={s.fieldBlock}>
              <TextField
                id={`${activeProvider}ApiKey`}
                name={`${activeProvider}ApiKey`}
                label="API key"
                placeholder={activeProvider === 'openai' ? 'sk-...' : 'AIza...'}
                value={activeProviderValues.apiKey}
                onChange={handleApiKeyChange}
                textInputProps={{ type: 'password', autoComplete: 'off' }}
              />
            </div>

            <div className={s.fieldBlock}>
              <SelectField
                id={`${activeProvider}DefaultModel`}
                name={`${activeProvider}DefaultModel`}
                label="Model"
                hint={getModelHint(
                  activeProviderApiKey,
                  modelOptionsState,
                  activeProviderModel,
                )}
                value={findSelectedOption(modelOptions, activeProviderModel)}
                onChange={handleModelChange}
                selectInputProps={{
                  options: modelOptions,
                  getOptionLabel: (option) => option.label,
                  getOptionValue: (option) => option.value,
                  isDisabled:
                    !activeProviderApiKey ||
                    modelOptionsState.status === 'loading' ||
                    modelOptions.length === 0,
                  isOptionDisabled: (option) => Boolean(option.unavailable),
                }}
              />
            </div>

            {showOutputControls && (
              <>
                <div className={s.fieldBlock}>
                  <SelectField
                    id="openaiDefaultQuality"
                    name="openaiDefaultQuality"
                    label="Quality"
                    value={findSelectedOption(
                      imageQualityOptions,
                      values.providers.openai.defaultQuality,
                    )}
                    onChange={handleQualityChange}
                    selectInputProps={{
                      options: imageQualityOptions,
                      getOptionLabel: (option) => option.label,
                      getOptionValue: (option) => option.value,
                    }}
                  />
                </div>

                <div className={s.fieldBlock}>
                  <SelectField
                    id="openaiDefaultOutputFormat"
                    name="openaiDefaultOutputFormat"
                    label="Output format"
                    value={findSelectedOption(
                      imageOutputFormatOptions,
                      values.providers.openai.defaultOutputFormat,
                    )}
                    onChange={handleOutputFormatChange}
                    selectInputProps={{
                      options: imageOutputFormatOptions,
                      getOptionLabel: (option) => option.label,
                      getOptionValue: (option) => option.value,
                    }}
                  />
                </div>

                {showCompressionControl && (
                  <div className={s.fieldBlock}>
                    <TextField
                      id="openaiDefaultCompression"
                      name="openaiDefaultCompression"
                      label="Compression"
                      value={String(values.providers.openai.defaultCompression)}
                      onChange={handleCompressionChange}
                      textInputProps={{
                        min: 0,
                        max: 100,
                        step: 1,
                        type: 'number',
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className={s.errorMessage} role="alert">
            {errorMessage}
          </div>
        )}

        <div className={s.actions}>
          <Button
            buttonType="primary"
            fullWidth
            type="submit"
            disabled={!canSave}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
    </div>
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

function getModelHint(
  apiKey: string,
  state: ModelOptionsState,
  selectedModel: string,
): string | undefined {
  if (!apiKey) {
    return 'Add an API key to load available models.';
  }

  if (state.status === 'loading') {
    return 'Loading available models…';
  }

  if (state.status === 'error') {
    return state.errorMessage || 'Unable to load models.';
  }

  if (state.status === 'loaded' && state.options.length === 0) {
    return 'No compatible image models were returned for this key.';
  }

  if (
    selectedModel &&
    state.options.some(
      (option) => option.value === selectedModel && option.unavailable,
    )
  ) {
    return 'This saved model was not returned by the provider.';
  }

  return undefined;
}

function findSelectedOption<T extends string>(
  options: Array<SelectOption<T>>,
  value: T | string,
): SelectOption<T> | null {
  return options.find((option) => option.value === value) || null;
}

function getSelectOptionValue<T extends string>(option: unknown): T | null {
  if (!option || typeof option !== 'object') {
    return null;
  }

  const value = (option as { value?: unknown }).value;

  return typeof value === 'string' ? (value as T) : null;
}

function normalizeCompression(value: string): number {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return 100;
  }

  return Math.min(100, Math.max(0, parsedValue));
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
