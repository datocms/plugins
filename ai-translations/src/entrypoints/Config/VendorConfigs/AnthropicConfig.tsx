/**
 * AnthropicConfig.tsx
 * Configuration component for Anthropic Claude vendor settings.
 */

import { SelectField, TextField } from 'datocms-react-ui';
import s from '../../styles.module.css';

export interface AnthropicConfigProps {
  anthropicApiKey: string;
  setAnthropicApiKey: (value: string) => void;
  anthropicModel: string;
  setAnthropicModel: (value: string) => void;
  listOfAnthropicModels: string[];
}

export default function AnthropicConfig({
  anthropicApiKey,
  setAnthropicApiKey,
  anthropicModel,
  setAnthropicModel,
  listOfAnthropicModels,
}: AnthropicConfigProps) {
  return (
    <>
      {/* Anthropic API Key */}
      <div className={s.fieldSpacing}>
        <TextField
          required
          name="anthropicApiKey"
          id="anthropicApiKey"
          label="Anthropic API Key"
          value={anthropicApiKey}
          onChange={(v) => setAnthropicApiKey(v)}
          placeholder="sk-ant-..."
        />
      </div>

      {/* Claude Model */}
      <SelectField
        name="anthropicModel"
        id="anthropicModel"
        label="Claude Model"
        value={{ label: anthropicModel, value: anthropicModel }}
        selectInputProps={{
          options: listOfAnthropicModels.map((m) => ({ label: m, value: m })),
        }}
        onChange={(newValue) => {
          if (!Array.isArray(newValue)) {
            const selected = newValue as { value: string } | null;
            setAnthropicModel(selected?.value || anthropicModel);
          }
        }}
      />
    </>
  );
}


