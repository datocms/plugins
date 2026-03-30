import { useCallback, useMemo, useState } from 'react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, SelectField, TextField } from 'datocms-react-ui';
import type { ConfigParameters, NormalizedConfigParameters } from '../types';
import {
  normalizeConfigParameters,
  sanitizeConfigParameters,
  serializeConfigParameters,
  updateProviderSettings,
} from '../utils/config';
import {
  getModelOptions,
  providerOptions,
  type ProviderId,
  type SelectOption,
  type SupportedImageModel,
} from '../utils/imageService';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  // Settings still support older parameter keys, so normalize them once at the boundary.
  const initialValues = useMemo(
    () =>
      normalizeConfigParameters(
        (ctx.plugin.attributes.parameters || {}) as ConfigParameters,
      ),
    [ctx.plugin.attributes.parameters],
  );

  const [values, setValues] = useState<NormalizedConfigParameters>(initialValues);
  const [savedValues, setSavedValues] = useState<NormalizedConfigParameters>(
    initialValues,
  );
  const [activeProvider, setActiveProvider] = useState<ProviderId>(
    initialValues.defaultProvider,
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeProviderValues = values.providers[activeProvider];
  const modelOptions = useMemo(
    () => getModelOptions(activeProvider),
    [activeProvider],
  );
  const isDirty =
    serializeConfigParameters(values) !== serializeConfigParameters(savedValues);

  const handleProviderChange = useCallback((selectedOption: unknown) => {
    const nextProvider = getSelectOptionValue<ProviderId>(selectedOption);

    if (!nextProvider) {
      return;
    }

    setActiveProvider(nextProvider);
    setValues((current) => ({
      ...current,
      defaultProvider: nextProvider,
    }));
  }, []);

  const handleApiKeyChange = useCallback(
    (nextValue: string) => {
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
      const nextModel = getSelectOptionValue<SupportedImageModel>(selectedOption);

      if (!nextModel) {
        return;
      }

      setValues((current) =>
        updateProviderSettings(current, activeProvider, {
          defaultModel: nextModel,
        }),
      );
    },
    [activeProvider],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextValues = sanitizeConfigParameters(values);
      const hasAnyKey = Boolean(
        nextValues.providers.openai.apiKey || nextValues.providers.google.apiKey,
      );

      if (!hasAnyKey) {
        setErrorMessage('Add at least one provider key before saving.');
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
    [ctx, values],
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
                value={findSelectedOption(
                  modelOptions,
                  activeProviderValues.defaultModel,
                )}
                onChange={handleModelChange}
                selectInputProps={{
                  options: modelOptions,
                  getOptionLabel: (option) => option.label,
                  getOptionValue: (option) => option.value,
                }}
              />
            </div>
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
            disabled={saving || !isDirty}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function findSelectedOption<T extends string>(
  options: Array<SelectOption<T>>,
  value: T,
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
