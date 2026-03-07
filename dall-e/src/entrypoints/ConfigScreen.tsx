import { useMemo, useState } from 'react';
import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField, TextField } from 'datocms-react-ui';
import type { ConfigParameters } from '../types';
import {
  getConfiguredModel,
  modelOptions,
  type SupportedImageModel,
} from '../utils/openaiImages';
import s from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const initialValues = useMemo(() => {
    const parameters = (ctx.plugin.attributes.parameters || {}) as ConfigParameters;

    return {
      apiKey: parameters.apiKey?.trim() || '',
      model: getConfiguredModel(parameters.model),
    };
  }, [ctx.plugin.attributes.parameters]);

  const [apiKey, setApiKey] = useState(initialValues.apiKey);
  const [model, setModel] = useState<SupportedImageModel>(initialValues.model);
  const [savedValues, setSavedValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedApiKey = apiKey.trim();
  const isDirty =
    trimmedApiKey !== savedValues.apiKey || model !== savedValues.model;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedApiKey) {
      setErrorMessage('Add an OpenAI API key before saving.');
      return;
    }

    const nextValues = {
      apiKey: trimmedApiKey,
      model,
    };

    setSaving(true);
    setErrorMessage(null);

    try {
      await ctx.updatePluginParameters(nextValues);
      setApiKey(nextValues.apiKey);
      setSavedValues(nextValues);
      ctx.notice('Settings updated successfully!');
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
          <div className={s.fieldBlock}>
            <TextField
              id="apiKey"
              name="apiKey"
              label="OpenAI API key"
              placeholder="sk-..."
              value={apiKey}
              onChange={(value) => setApiKey(value)}
              required={true}
              textInputProps={{ type: 'password', autoComplete: 'off' }}
            />
          </div>

          <div className={s.fieldBlock}>
            <SelectField
              id="model"
              name="model"
              label="Generation model"
              value={
                modelOptions.find((option) => option.value === model) || null
              }
              onChange={(selectedOption) => {
                if (selectedOption) {
                  setModel((selectedOption as typeof modelOptions[number]).value);
                }
              }}
              selectInputProps={{
                options: modelOptions,
                getOptionLabel: (option) => option.label,
                getOptionValue: (option) => option.value,
              }}
            />
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
