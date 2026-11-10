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

/**
 * The error of the API key field when its models couldn't be listed: the key
 * is the value to fix, so the error goes on it, not on the model.
 *
 * @param status - The state of the model list of the vendor.
 * @param account - Where the key comes from ("OpenAI").
 */
export function modelListKeyError(
  status: ModelListStatus,
  account: string,
): string | undefined {
  if (status === 'error') {
    return `Couldn't load the models with this key. Check it in your ${account} account.`;
  }
  if (status === 'empty') {
    return "This key can't use any of the models that the plugin supports.";
  }
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
  const saved = value && value !== UNSET_MODEL ? value : null;
  // The key can't list the models (its error says why): the saved model
  // still shows, and the hint says it isn't one of the key's.
  const keyFailed =
    modelList.status === 'empty' || modelList.status === 'error';

  let hint: string | undefined;
  if (idle) hint = 'Add an API key to load the models.';
  else if (keyFailed && saved) {
    hint = 'Saved model. Pick another once the key works.';
  }

  return (
    <FieldWrapper label="Model" required hint={hint}>
      <SelectInput
        value={saved}
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
