/**
 * OpenAIConfig.tsx
 * Configuration component for OpenAI vendor settings.
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

import { TextField } from 'datocms-react-ui';
import s from '../../styles.module.css';
import ModelSelectField from './ModelSelectField';

export interface OpenAIConfigProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  gptModel: string;
  setGptModel: (value: string) => void;
  listOfModels: string[];
}

export default function OpenAIConfig({
  apiKey,
  setApiKey,
  gptModel,
  setGptModel,
  listOfModels,
}: OpenAIConfigProps) {
  return (
    <>
      {/* OpenAI API Key */}
      <div className={s.fieldSpacing}>
        <TextField
          required
          name="openAIAPIKey"
          id="openAIAPIKey"
          label="OpenAI API Key"
          value={apiKey}
          onChange={(newValue) => setApiKey(newValue)}
          placeholder="sk-..."
        />
      </div>

      {/* GPT Model select - DRY-003: Using shared component */}
      <ModelSelectField
        id="gptModel"
        label="GPT Model"
        value={gptModel}
        onChange={setGptModel}
        models={listOfModels}
      />
    </>
  );
}
