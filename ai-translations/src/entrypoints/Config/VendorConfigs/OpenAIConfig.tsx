/**
 * OpenAIConfig.tsx
 * Configuration component for OpenAI vendor settings: the API key and the
 * model, right under the vendor choice.
 *
 * DESIGN DECISION: OpenAI, Gemini, and Anthropic configs are kept as separate
 * components despite their structural similarity. This approach was chosen because:
 *
 * 1. Each vendor may need vendor-specific features in the future (e.g., OpenAI
 *    organization ID, Anthropic beta features, Gemini safety settings)
 * 2. The ModelSelectField component already abstracts the shared dropdown logic
 * 3. Prop naming conventions differ per vendor (apiKey vs googleApiKey vs anthropicApiKey)
 * 4. A generic component would require complex prop mapping that reduces readability
 * 5. The current duplication is minimal (~40 lines) and easy to maintain
 *
 * If significant shared behavior emerges, consider extracting a generic component.
 */

import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import { apiKeyDocs, apiKeyHint } from '../configConstants';
import ModelSelectField, {
  type ModelList,
  modelListKeyError,
} from './ModelSelectField';

export interface OpenAIConfigProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  gptModel: string;
  setGptModel: (value: string) => void;
  modelList: ModelList;
}

export default function OpenAIConfig({
  apiKey,
  setApiKey,
  gptModel,
  setGptModel,
  modelList,
}: OpenAIConfigProps) {
  return (
    <>
      <FieldWrapper
        label="API key"
        required
        hint={apiKeyHint('openai')}
        docs={apiKeyDocs('openai')}
        error={modelListKeyError(modelList.status, 'OpenAI')}
      >
        <PasswordInput
          name="openAIAPIKey"
          value={apiKey}
          onChange={(value) => setApiKey(value ?? '')}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
        />
      </FieldWrapper>
      <ModelSelectField
        value={gptModel}
        onChange={setGptModel}
        modelList={modelList}
      />
    </>
  );
}
