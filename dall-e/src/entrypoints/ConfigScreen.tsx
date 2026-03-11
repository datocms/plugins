import { useMemo, useState } from 'react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField, TextField } from 'datocms-react-ui';
import type { ConfigParameters, NormalizedConfigParameters } from '../types';
import { normalizeConfigParameters } from '../utils/config';
import {
  getModelOptions,
  providerOptions,
  type ProviderId,
  type SupportedImageModel,
} from '../utils/imageService';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
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
  const [editingProvider, setEditingProvider] = useState<ProviderId>(
    initialValues.defaultProvider,
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const modelOptions = useMemo(
    () => getModelOptions(editingProvider, 'generate'),
    [editingProvider],
  );
  const isDirty = serializeConfig(values) !== serializeConfig(savedValues);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextValues = normalizeForSave(values);
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
  }

  return (
    <Canvas ctx={ctx}>
      <div className={s.settings}>
        <form className={s.settingsForm} onSubmit={handleSubmit}>
          <div className={s.settingsSection}>
            <div className={s.settingsGrid}>
              <div className={s.fieldBlock}>
                <SelectField
                  id="provider"
                  name="provider"
                  label="Provider"
                  value={
                    providerOptions.find(
                      (option) => option.value === editingProvider,
                    ) || null
                  }
                  onChange={(selectedOption) => {
                    if (selectedOption) {
                      const nextProvider = (selectedOption as { value: ProviderId }).value;
                      setEditingProvider(nextProvider);
                      setValues((current) => ({
                        ...current,
                        defaultProvider: nextProvider,
                      }));
                    }
                  }}
                  selectInputProps={{
                    options: providerOptions,
                    getOptionLabel: (option) => option.label,
                    getOptionValue: (option) => option.value,
                  }}
                />
              </div>

              <div className={s.fieldBlock}>
                <TextField
                  id={`${editingProvider}ApiKey`}
                  name={`${editingProvider}ApiKey`}
                  label="API key"
                  placeholder={editingProvider === 'openai' ? 'sk-...' : 'AIza...'}
                  value={values.providers[editingProvider].apiKey}
                  onChange={(value) => {
                    setValues((current) => ({
                      ...current,
                      providers: {
                        ...current.providers,
                        [editingProvider]: {
                          ...current.providers[editingProvider],
                          apiKey: value.trim(),
                        },
                      },
                    }));
                  }}
                  textInputProps={{ type: 'password', autoComplete: 'off' }}
                />
              </div>

              <div className={s.fieldBlock}>
                <SelectField
                  id={`${editingProvider}DefaultModel`}
                  name={`${editingProvider}DefaultModel`}
                  label="Model"
                  value={
                    modelOptions.find(
                      (option) =>
                        option.value === values.providers[editingProvider].defaultModel,
                    ) || null
                  }
                  onChange={(selectedOption) => {
                    if (selectedOption) {
                      setValues((current) => ({
                        ...current,
                        providers: {
                          ...current.providers,
                          [editingProvider]: {
                            ...current.providers[editingProvider],
                            defaultModel: (selectedOption as { value: SupportedImageModel }).value,
                          },
                        },
                      }));
                    }
                  }}
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
    </Canvas>
  );
}

function normalizeForSave(
  values: NormalizedConfigParameters,
): NormalizedConfigParameters {
  return {
    defaultProvider: values.defaultProvider,
    providers: {
      openai: {
        apiKey: values.providers.openai.apiKey.trim(),
        defaultModel: values.providers.openai.defaultModel,
      },
      google: {
        apiKey: values.providers.google.apiKey.trim(),
        defaultModel: values.providers.google.defaultModel,
      },
    },
  };
}

function serializeConfig(values: NormalizedConfigParameters) {
  return JSON.stringify(normalizeForSave(values));
}
