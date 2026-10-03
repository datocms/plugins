import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas, Form, SelectField, SwitchField } from 'datocms-react-ui';
import { useMemo, useState } from 'react';
import { ALL_SCOPE, isScope, type Scope } from '../report/scope';
import { Button } from '../ui/Button';

/** What the project page passes to `openModal`. */
export type ScopeModalParams = {
  environment: string;
  models: { id: string; name: string }[];
  locales: { code: string; label: string }[];
  scope: Scope;
};

type Option = { label: string; value: string };

function isEntryList<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, string>[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        keys.every(
          (key) => typeof (entry as Record<string, unknown>)[key] === 'string',
        ),
    )
  );
}

function isModalParams(value: unknown): value is ScopeModalParams {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.environment === 'string' &&
    isEntryList(candidate.models, ['id', 'name']) &&
    isEntryList(candidate.locales, ['code', 'label']) &&
    isScope(candidate.scope)
  );
}

/** The listed IDs that are still offered; `'all'` starts with nothing picked. */
function knownIds(ids: Scope['modelIds'], options: readonly Option[]) {
  if (ids === 'all') return [];
  const available = new Set(options.map((option) => option.value));
  return ids.filter((id) => available.has(id));
}

const REQUIRED = 'Field is required';

/**
 * The combobox input's own id. The kit gives `id` to react-select's container
 * and points the label there, so the input needs its own id and an aria-label.
 */
const inputIdFor = (id: string) => `${id}-input`;

type ScopeSelectProps = {
  id: string;
  label: string;
  placeholder: string;
  noOptions: string;
  options: Option[];
  value: string[];
  error?: string;
  onChange: (ids: string[]) => void;
};

function ScopeSelect({
  id,
  label,
  placeholder,
  noOptions,
  options,
  value,
  error,
  onChange,
}: ScopeSelectProps) {
  const byId = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const selected = value.flatMap((picked) => {
    const option = byId.get(picked);
    return option ? [option] : [];
  });
  return (
    <SelectField
      id={id}
      name={id}
      label={label}
      placeholder={placeholder}
      value={selected}
      error={error}
      onChange={(next) => onChange(next.map((option) => option.value))}
      selectInputProps={{
        'aria-label': label,
        'aria-invalid': error !== undefined,
        inputId: inputIdFor(id),
        isMulti: true,
        options,
        noOptionsMessage: () => noOptions,
        closeMenuOnSelect: false,
      }}
    />
  );
}

/** "Choose what to scan": each switch reveals its select when on; ✕ or Esc resolve nothing. */
export default function ScopeModal({ ctx }: { ctx: RenderModalCtx }) {
  const params: ScopeModalParams = isModalParams(ctx.parameters)
    ? ctx.parameters
    : {
        environment: ctx.environment,
        models: [],
        locales: [],
        scope: ALL_SCOPE,
      };
  const modelOptions = params.models.map(({ id, name }) => ({
    value: id,
    label: name,
  }));
  const localeOptions = params.locales.map(({ code, label }) => ({
    value: code,
    label,
  }));
  const multiLocale = localeOptions.length > 1;
  const [limitModels, setLimitModels] = useState(
    params.scope.modelIds !== 'all',
  );
  const [modelIds, setModelIds] = useState(() =>
    knownIds(params.scope.modelIds, modelOptions),
  );
  const [limitLocales, setLimitLocales] = useState(
    multiLocale && params.scope.localeIds !== 'all',
  );
  const [localeIds, setLocaleIds] = useState(() =>
    knownIds(params.scope.localeIds, localeOptions),
  );
  // Errors show after a submit attempt, then follow the selection.
  const [attempted, setAttempted] = useState(false);
  const modelsMissing = limitModels && modelIds.length === 0;
  const localesMissing = limitLocales && localeIds.length === 0;

  const submit = () => {
    if (modelsMissing || localesMissing) {
      setAttempted(true);
      document
        .getElementById(inputIdFor(modelsMissing ? 'models' : 'locales'))
        ?.focus();
      return;
    }
    const scope: Scope = {
      modelIds: limitModels ? modelIds : 'all',
      localeIds: limitLocales ? localeIds : 'all',
    };
    void ctx.resolve(scope);
  };

  return (
    <Canvas ctx={ctx}>
      <Form className="dl-kit-form-parity" onSubmit={submit}>
        <p className="blc-modal-intro">
          Scans the latest saved version of every record in the{' '}
          <code className="blc-code">{params.environment}</code> environment,
          drafts and invalid records included.
        </p>
        <SwitchField
          id="limit-models"
          name="limitModels"
          label="Limit to specific models?"
          hint="If enabled, only the models you select are scanned"
          value={limitModels}
          onChange={setLimitModels}
        />
        {limitModels && (
          <ScopeSelect
            id="models"
            label="Models"
            placeholder="Select models…"
            noOptions="No models found"
            options={modelOptions}
            value={modelIds}
            error={attempted && modelsMissing ? REQUIRED : undefined}
            onChange={setModelIds}
          />
        )}
        {multiLocale && (
          <SwitchField
            id="limit-locales"
            name="limitLocales"
            label="Limit to specific locales?"
            hint="If enabled, only the locales you select are scanned. Fields that aren't localized are always scanned."
            value={limitLocales}
            onChange={setLimitLocales}
          />
        )}
        {limitLocales && (
          <ScopeSelect
            id="locales"
            label="Locales"
            placeholder="Select locales…"
            noOptions="No locales found"
            options={localeOptions}
            value={localeIds}
            error={attempted && localesMissing ? REQUIRED : undefined}
            onChange={setLocaleIds}
          />
        )}
        <Button type="submit" buttonType="primary" buttonSize="xl" fullWidth>
          Scan links
        </Button>
      </Form>
    </Canvas>
  );
}
