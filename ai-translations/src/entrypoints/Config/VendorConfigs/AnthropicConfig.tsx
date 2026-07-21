/**
 * AnthropicConfig.tsx
 * Configuration component for Anthropic Claude vendor settings.
 */

import { FieldGroup, TextField } from 'datocms-react-ui';
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
    <FieldGroup>
      <TextField
        required
        name="anthropicApiKey"
        id="anthropicApiKey"
        label="Anthropic API Key"
        value={anthropicApiKey}
        onChange={(v) => setAnthropicApiKey(v)}
        placeholder="sk-ant-..."
      />
      <ModelSelectField
        id="anthropicModel"
        label="Claude Model"
        value={anthropicModel}
        onChange={setAnthropicModel}
        models={listOfAnthropicModels}
      />
    </FieldGroup>
  );
}
