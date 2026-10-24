/**
 * ModelSelectField.tsx
 * DRY-003: Shared model selection component for vendor configurations.
 * Extracts the common pattern used across OpenAI, Gemini, and Anthropic configs.
 *
 * The config screen loads the models of the vendor with its API key and owns
 * the state of that list (`ModelList`): this field only shows it.
 *
 * Never add hard-coded model recommendations or "Recommended" hints here or
 * in callers. Provider model catalogs change too quickly for that guidance to
 * remain accurate; users should choose from the dynamically loaded model list.
 */

import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import { useMemo } from 'react';

/**
 * The state of the model list of a vendor: `idle` without an API key,
 * `loading` while the request runs, `ready` with models, `empty` when the key
 * gives no compatible model, `error` when the request failed.
 */
export type ModelListStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface ModelList {
  status: ModelListStatus;
  /** The loaded models; empty unless `status` is `ready`. */
  models: string[];
}

export const IDLE_MODEL_LIST: ModelList = { status: 'idle', models: [] };
export const LOADING_MODEL_LIST: ModelList = { status: 'loading', models: [] };
export const EMPTY_MODEL_LIST: ModelList = { status: 'empty', models: [] };
export const FAILED_MODEL_LIST: ModelList = { status: 'error', models: [] };

/**
 * The list state for the models a request returned.
 *
 * @param models - The models of the vendor.
 * @returns `ready` with the models, or `empty` when there are none.
 */
export function modelListFrom(models: string[]): ModelList {
  return models.length > 0 ? { status: 'ready', models } : EMPTY_MODEL_LIST;
}

/** The stored `gptModel` of an OpenAI configuration with no model. */
const UNSET_MODEL = 'None';

const noModels = () => 'No models';

function modelError(status: ModelListStatus): string | undefined {
  if (status === 'error') return "Couldn't load the models. Check the API key.";
  if (status === 'empty') return 'No compatible models for this key.';
  return undefined;
}

/** A saved model that the loaded list doesn't have still shows its name. */
function savedModelOption(model: string) {
  return { label: model, value: model };
}

export interface ModelSelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  modelList: ModelList;
}

export default function ModelSelectField({
  value,
  onChange,
  modelList,
}: ModelSelectFieldProps) {
  const options = useMemo(
    () => modelList.models.map((model) => ({ label: model, value: model })),
    [modelList.models],
  );

  const idle = modelList.status === 'idle';

  return (
    <FieldWrapper
      label="Model"
      required
      hint={idle ? 'Enter the API key to load the models.' : undefined}
      error={modelError(modelList.status)}
    >
      <SelectInput
        value={value && value !== UNSET_MODEL ? value : null}
        onChange={(next) => {
          if (next) onChange(next);
        }}
        options={options}
        clearable={false}
        disabled={idle}
        loading={modelList.status === 'loading'}
        placeholder="Pick a model"
        noOptionsMessage={noModels}
        acceptValueNotIncludedInOptions={savedModelOption}
      />
    </FieldWrapper>
  );
}
