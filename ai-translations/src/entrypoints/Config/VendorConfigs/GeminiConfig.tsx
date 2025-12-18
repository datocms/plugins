/**
 * GeminiConfig.tsx
 * Configuration component for Google Gemini vendor settings.
 */

import { SelectField, TextField } from 'datocms-react-ui';
import s from '../../styles.module.css';

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

      {/* Gemini model select */}
      <div className={s.dropdownLabel}>
        <span className={s.label}>Gemini Model*</span>
        <div className={s.modelSelect}>
          <SelectField
            name="geminiModel"
            id="geminiModel"
            label=""
            value={{ label: geminiModel, value: geminiModel }}
            selectInputProps={{
              options: listOfGeminiModels.map((m) => ({ label: m, value: m })),
            }}
            onChange={(newValue) => {
              if (!Array.isArray(newValue)) {
                const selected = newValue as { value: string } | null;
                setGeminiModel(selected?.value || geminiModel);
              }
            }}
          />
        </div>
      </div>
    </>
  );
}


