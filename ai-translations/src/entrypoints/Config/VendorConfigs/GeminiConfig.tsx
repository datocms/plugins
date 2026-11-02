/**
 * GeminiConfig.tsx
 * Configuration component for Google Gemini vendor settings: the settings
 * group with the API key and the model.
 */

import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import StringInput from 'datocms-react-ui/StringInput';
import { vendorSettingsTitle } from '../configConstants';
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
    <Page.Group title={vendorSettingsTitle('google')}>
      <FieldWrapper
        label="API key"
        required
        error={modelListKeyError(modelList.status, 'Google')}
      >
        <StringInput
          code
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
    </Page.Group>
  );
}
