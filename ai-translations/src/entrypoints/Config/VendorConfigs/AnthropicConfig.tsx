/**
 * AnthropicConfig.tsx
 * Configuration component for Anthropic Claude vendor settings: the settings
 * group with the API key and the model.
 */

import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import StringInput from 'datocms-react-ui/StringInput';
import { vendorSettingsTitle } from '../configConstants';
import ModelSelectField, { type ModelList } from './ModelSelectField';

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
    <Page.Group title={vendorSettingsTitle('anthropic')}>
      <FieldWrapper label="API key" required>
        <StringInput
          code
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
    </Page.Group>
  );
}
