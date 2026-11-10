/**
 * AnthropicConfig.tsx
 * Configuration component for Anthropic Claude vendor settings: the API
 * key and the model, right under the vendor choice.
 */

import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import { apiKeyDocs, apiKeyHint } from '../configConstants';
import ModelSelectField, {
  type ModelList,
  modelListKeyError,
} from './ModelSelectField';

export interface AnthropicConfigProps {
  anthropicApiKey: string;
  setAnthropicApiKey: (value: string) => void;
  anthropicModel: string;
  setAnthropicModel: (value: string) => void;
  modelList: ModelList;
}

export default function AnthropicConfig({
  anthropicApiKey,
  setAnthropicApiKey,
  anthropicModel,
  setAnthropicModel,
  modelList,
}: AnthropicConfigProps) {
  return (
    <>
      <FieldWrapper
        label="API key"
        required
        hint={apiKeyHint('anthropic')}
        docs={apiKeyDocs('anthropic')}
        error={modelListKeyError(modelList.status, 'Anthropic')}
      >
        <PasswordInput
          name="anthropicApiKey"
          value={anthropicApiKey}
          onChange={(value) => setAnthropicApiKey(value ?? '')}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
        />
      </FieldWrapper>
      <ModelSelectField
        value={anthropicModel}
        onChange={setAnthropicModel}
        modelList={modelList}
      />
    </>
  );
}
