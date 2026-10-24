import type { RenderModalCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import IdText from 'datocms-react-ui/IdText';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import { type FormEvent, useState } from 'react';
import { ALL_SCOPE, isScope, type Scope } from '../report/scope';
import { useFrameSizedToContent } from '../ui/useFrameSizedToContent';
import styles from './ScopeModal.module.css';

/** What the project page passes to `openModal`. */
export type ScopeModalParams = {
  environment: string;
  models: { id: string; name: string }[];
  locales: { code: string; label: string }[];
  scope: Scope;
};

/**
 * The `initialHeight` of the dialog: its content height (the host adds the
 * 20px body padding) before it measures itself, so the frame doesn't jump.
 * The locale field shows only on multi-locale sites. Measured in a browser on
 * the dialog as it opens on the whole project ("All models", "All locales"),
 * at the 600px width of `width: 's'`.
 */
export function scopeModalHeight(multiLocale: boolean): number {
  return multiLocale ? 392 : 234;
}

type Option = { label: string; value: string };

type Extent = 'all' | 'some';

const MODEL_EXTENTS = [
  { value: 'all', label: 'All models' },
  { value: 'some', label: 'Only some models' },
] as const;

const LOCALE_EXTENTS = [
  { value: 'all', label: 'All locales' },
  { value: 'some', label: 'Only some locales' },
] as const;

/** The input ids, for the focus after a failed submit. */
const MODELS_INPUT_ID = 'scope-models';
const LOCALES_INPUT_ID = 'scope-locales';

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

const asExtent = (value: string | null): Extent =>
  value === 'some' ? 'some' : 'all';

/** "Choose what to scan": ✕ or Esc resolve nothing. */
export default function ScopeModal({ ctx }: { ctx: RenderModalCtx }) {
  useFrameSizedToContent();
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
  const [modelExtent, setModelExtent] = useState<Extent>(
    params.scope.modelIds === 'all' ? 'all' : 'some',
  );
  const [modelIds, setModelIds] = useState(() =>
    knownIds(params.scope.modelIds, modelOptions),
  );
  const [localeExtent, setLocaleExtent] = useState<Extent>(
    multiLocale && params.scope.localeIds !== 'all' ? 'some' : 'all',
  );
  const [localeIds, setLocaleIds] = useState(() =>
    knownIds(params.scope.localeIds, localeOptions),
  );
  // Errors show after a submit attempt, then follow the selection.
  const [attempted, setAttempted] = useState(false);
  const limitModels = modelExtent === 'some';
  const limitLocales = multiLocale && localeExtent === 'some';
  const modelsMissing = limitModels && modelIds.length === 0;
  const localesMissing = limitLocales && localeIds.length === 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (modelsMissing || localesMissing) {
      setAttempted(true);
      document
        .getElementById(modelsMissing ? MODELS_INPUT_ID : LOCALES_INPUT_ID)
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
      <form onSubmit={submit} noValidate>
        <p className={styles.intro}>
          Scans the latest saved version of every record in the{' '}
          <IdText id={params.environment} /> environment, drafts and invalid
          records included.
        </p>
        <FieldWrapper label="Models">
          <RadioGroupInput
            value={modelExtent}
            onChange={(value) => setModelExtent(asExtent(value))}
            options={MODEL_EXTENTS}
          />
        </FieldWrapper>
        {limitModels && (
          <FieldWrapper
            id={MODELS_INPUT_ID}
            label="Models to scan"
            required
            error={
              attempted && modelsMissing
                ? 'Pick at least one model.'
                : undefined
            }
          >
            <SelectInput
              multiple
              value={modelIds}
              onChange={(ids) => setModelIds(ids ?? [])}
              options={modelOptions}
              placeholder="Select models…"
              noOptionsMessage={() => 'No models found'}
              closeMenuOnSelect={false}
            />
          </FieldWrapper>
        )}
        {multiLocale && (
          <FieldWrapper
            label="Locales"
            hint="Fields that aren't localized are always scanned."
          >
            <RadioGroupInput
              value={localeExtent}
              onChange={(value) => setLocaleExtent(asExtent(value))}
              options={LOCALE_EXTENTS}
            />
          </FieldWrapper>
        )}
        {limitLocales && (
          <FieldWrapper
            id={LOCALES_INPUT_ID}
            label="Locales to scan"
            required
            error={
              attempted && localesMissing
                ? 'Pick at least one locale.'
                : undefined
            }
          >
            <SelectInput
              multiple
              value={localeIds}
              onChange={(ids) => setLocaleIds(ids ?? [])}
              options={localeOptions}
              placeholder="Select locales…"
              noOptionsMessage={() => 'No locales found'}
              closeMenuOnSelect={false}
            />
          </FieldWrapper>
        )}
        <div className={styles.actions}>
          <Button tone="primary" submit label="Scan links" />
        </div>
      </form>
    </Canvas>
  );
}
