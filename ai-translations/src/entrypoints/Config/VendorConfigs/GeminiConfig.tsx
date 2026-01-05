/**
 * GeminiConfig.tsx
 * Configuration component for Google Gemini vendor settings.
 */

import { TextField } from 'datocms-react-ui';
import s from '../../styles.module.css';
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
    <>
      {/* Google API Key */}
      <div className={s.fieldSpacing}>
        <TextField
          required
          name="googleApiKey"
          id="googleApiKey"
          label="Google API Key"
          value={googleApiKey}
          onChange={(newValue) => setGoogleApiKey(newValue)}
          placeholder="AIza..."
        />
      </div>

      {/* Gemini Model select - DRY-003: Using shared component */}
      <ModelSelectField
        id="geminiModel"
        label="Gemini Model"
        value={geminiModel}
        onChange={setGeminiModel}
        models={listOfGeminiModels}
      />
    </>
  );
}
