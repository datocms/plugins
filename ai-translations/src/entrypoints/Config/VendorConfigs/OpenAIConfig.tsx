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

import { FieldGroup, TextField } from 'datocms-react-ui';
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
    <FieldGroup>
      <TextField
        required
        name="openAIAPIKey"
        id="openAIAPIKey"
        label="OpenAI API Key"
        value={apiKey}
        onChange={(newValue) => setApiKey(newValue)}
        placeholder="sk-..."
      />
      <ModelSelectField
        id="gptModel"
        label="GPT Model"
        hint="Recommended: gpt-5.4-mini"
        value={gptModel}
        onChange={setGptModel}
        models={listOfModels}
      />
    </FieldGroup>
  );
}
