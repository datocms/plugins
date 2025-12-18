/**
 * OpenAIConfig.tsx
 * Configuration component for OpenAI vendor settings.
 */

import { SelectField, TextField } from 'datocms-react-ui';
import s from '../../styles.module.css';

export interface OpenAIConfigProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  gptModel: string;
  setGptModel: (value: string) => void;
  listOfModels: string[];
}

export default function OpenAIConfig({
  apiKey,
  setApiKey,
  gptModel,
  setGptModel,
  listOfModels,
}: OpenAIConfigProps) {
  return (
    <>
      {/* OpenAI API Key */}
      <div className={s.fieldSpacing}>
        <TextField
          required
          name="openAIAPIKey"
          id="openAIAPIKey"
          label="OpenAI API Key"
          value={apiKey}
          onChange={(newValue) => setApiKey(newValue)}
          placeholder="sk-..."
        />
      </div>

      {/* GPT Model select */}
      <div className={s.dropdownLabel}>
        <span className={s.label}>GPT Model*</span>
        <div className={s.modelSelect}>
          <SelectField
            name="gptModel"
            id="gptModel"
            label=""
            value={{ label: gptModel, value: gptModel }}
            selectInputProps={{
              options: listOfModels.map((m) => ({ label: m, value: m })),
            }}
            onChange={(newValue) => {
              if (!Array.isArray(newValue)) {
                const selected = newValue as { value: string } | null;
                setGptModel(selected?.value || gptModel);
              }
            }}
          />
        </div>
      </div>
    </>
  );
}


