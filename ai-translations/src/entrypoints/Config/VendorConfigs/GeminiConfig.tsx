/**
 * GeminiConfig.tsx
 * Configuration component for Google Gemini vendor settings.
 */

import { FieldGroup, TextField } from 'datocms-react-ui';
import ModelSelectField from './ModelSelectField';

export interface GeminiConfigProps {
  googleApiKey: string;
  setGoogleApiKey: (value: string) => void;
  geminiModel: string;
  setGeminiModel: (value: string) => void;
  listOfGeminiModels: string[];
}

export default function GeminiConfig({
  googleApiKey,
  setGoogleApiKey,
  geminiModel,
  setGeminiModel,
  listOfGeminiModels,
}: GeminiConfigProps) {
  return (
    <FieldGroup>
      <TextField
        required
        name="googleApiKey"
        id="googleApiKey"
        label="Google API Key"
        value={googleApiKey}
        onChange={(newValue) => setGoogleApiKey(newValue)}
        placeholder="AIza..."
      />
      <ModelSelectField
        id="geminiModel"
        label="Gemini Model"
        hint="Recommended: gemini-2.5-flash"
        value={geminiModel}
        onChange={setGeminiModel}
        models={listOfGeminiModels}
      />
    </FieldGroup>
  );
}
