/**
 * GeminiConfig.tsx
 * Configuration component for Google Gemini vendor settings: the API
 * key and the model, right under the vendor choice.
 */

import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import { apiKeyDocs, apiKeyHint } from '../configConstants';
import ModelSelectField, {
  type ModelList,
  modelListKeyError,
} from './ModelSelectField';

export interface GeminiConfigProps {
  googleApiKey: string;
  setGoogleApiKey: (value: string) => void;
  geminiModel: string;
  setGeminiModel: (value: string) => void;
  modelList: ModelList;
}

export default function GeminiConfig({
  googleApiKey,
  setGoogleApiKey,
  geminiModel,
  setGeminiModel,
  modelList,
}: GeminiConfigProps) {
  return (
    <>
      <FieldWrapper
        label="API key"
        required
        hint={apiKeyHint('google')}
        docs={apiKeyDocs('google')}
        error={modelListKeyError(modelList.status, 'Google')}
      >
        <PasswordInput
          name="googleApiKey"
          value={googleApiKey}
          onChange={(value) => setGoogleApiKey(value ?? '')}
          placeholder="AIza…"
          autoComplete="off"
          spellCheck={false}
        />
      </FieldWrapper>
      <ModelSelectField
        value={geminiModel}
        onChange={setGeminiModel}
        modelList={modelList}
      />
    </>
  );
}
