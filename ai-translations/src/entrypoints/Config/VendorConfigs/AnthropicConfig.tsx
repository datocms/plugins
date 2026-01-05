/**
 * AnthropicConfig.tsx
 * Configuration component for Anthropic Claude vendor settings.
 */

import { TextField } from 'datocms-react-ui';
import s from '../../styles.module.css';
import ModelSelectField from './ModelSelectField';

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

      {/* Claude Model - DRY-003: Using shared component */}
      <ModelSelectField
        id="anthropicModel"
        label="Claude Model"
        value={anthropicModel}
        onChange={setAnthropicModel}
        models={listOfAnthropicModels}
        useStyledWrapper={false}
      />
    </>
  );
}
