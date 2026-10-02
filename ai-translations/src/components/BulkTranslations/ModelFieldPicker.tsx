/**
 * ModelFieldPicker.tsx
 * --------------------
 * A model's translatable fields as a single `SelectField` — the same control
 * the locale and model selects use, so it behaves identically (menu, theming,
 * keyboard) with no custom chrome. The model name plus its inline mono
 * api_key is the field's label, an "All fields" sentinel option collapses to
 * one chip like "All other locales", and validation surfaces through the
 * field's native `error`.
 *
 * Render states, in order: fields pending (a disabled loading select), field
 * load failed (a compact danger row with "Try again"), no translatable fields
 * (a compact warning row, with "Remove model" where the model can be removed),
 * and the normal select.
 *
 * Pure presentation: the resolved selected api_keys flow in, and changes bubble
 * out via `onChange(apiKeys)` (the sentinel is resolved away before it leaves).
 * Used by the bulk page and the records-action picker modal.
 */
import { FieldWrapper, SelectField } from 'datocms-react-ui';
import { type ReactNode, useMemo } from 'react';
import { Button } from '../../ui/Button';
import type { TranslatableField } from '../../utils/translation/BulkTranslationHelpers';
import { fieldCountHint } from './bulkCopy';
import {
  type ChipOption,
  formatCodeMultiOption,
  InlineCode,
} from './chipOption';
import s from './ModelFieldPicker.module.css';

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

/** Sentinel option meaning "every translatable field on this model". */
const ALL_FIELDS_VALUE = '__all_fields__';
const ALL_FIELDS_OPTION: ChipOption = {
  label: 'All fields',
  value: ALL_FIELDS_VALUE,
};

/**
 * Light projection of the model representation used by the surrounding form.
 * `label` is the human name, `code` is the api_key, `value` is the model id.
 */
export interface ModelFieldPickerModel {
  label: string;
  value: string;
  code: string;
}

export interface ModelFieldPickerProps {
  model: ModelFieldPickerModel;
  /** `undefined` until the model's fields have loaded (treated as pending). */
  fields: TranslatableField[] | undefined;
  isLoading: boolean;
  /** The last attempt to load this model's fields failed. */
  loadFailed?: boolean;
  /** Locks the select and the row actions while the surface is busy. */
  isDisabled?: boolean;
  /** Resolved api_keys currently selected for this model. */
  selectedApiKeys: string[];
  /** Fires with the new resolved api_key set whenever the selection changes. */
  onChange: (apiKeys: string[]) => void;
  /**
   * Optional handler to drop this model from the selection. When provided, the
   * "no translatable fields" dead-end state shows a "Remove model" button.
   * Surfaces where the model can't be removed (records picker) omit it.
   */
  onRemove?: () => void;
  /** Retries a failed field load; shows "Try again" in the failure row. */
  onRetry?: () => void;
  /**
   * Opens the plugin settings. When provided, "plugin settings" in the
   * dead-end row is a link; otherwise it's plain text.
   */
  onOpenPluginSettings?: () => void;
  /**
   * Inline validation message — rendered through the field's native error so
   * the offending select gets the standard error border + message.
   */
  validationMessage?: string;
}

function LoadFailedRow({
  id,
  isDisabled,
  onRetry,
}: {
  id: string;
  isDisabled?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      id={id}
      className="dl-callout dl-callout--danger dl-callout--compact dl-callout--flush dl-callout--with-action"
    >
      <div>Couldn't load the fields of this model</div>
      {onRetry && (
        <Button buttonSize="xs" disabled={isDisabled} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// A model with zero translatable fields can never be satisfied by "select a
// field", so name the problem and offer a way out instead of an empty select.
function NoTranslatableFieldsRow({
  id,
  isDisabled,
  onRemove,
  onOpenPluginSettings,
}: {
  id: string;
  isDisabled?: boolean;
  onRemove?: () => void;
  onOpenPluginSettings?: () => void;
}) {
  const settings = onOpenPluginSettings ? (
    <button
      type="button"
      className={s.calloutLink}
      disabled={isDisabled}
      onClick={onOpenPluginSettings}
    >
      plugin settings
    </button>
  ) : (
    'plugin settings'
  );

  return (
    <div
      id={id}
      className={`dl-callout dl-callout--warning dl-callout--compact dl-callout--flush${
        onRemove ? ' dl-callout--with-action' : ''
      }`}
    >
      <div>
        This model has no fields the plugin can translate. Allow more field
        types in the {settings},{' '}
        {onRemove
          ? 'or remove the model.'
          : 'or leave its records out of the selection.'}
      </div>
      {onRemove && (
        <Button buttonSize="xs" disabled={isDisabled} onClick={onRemove}>
          Remove model
        </Button>
      )}
    </div>
  );
}

export function ModelFieldPicker({
  model,
  fields,
  isLoading,
  loadFailed = false,
  isDisabled = false,
  selectedApiKeys,
  onChange,
  onRemove,
  onRetry,
  onOpenPluginSettings,
  validationMessage,
}: ModelFieldPickerProps) {
  const selectedSet = useMemo(
    () => new Set(selectedApiKeys),
    [selectedApiKeys],
  );

  const fieldOptions = useMemo<ChipOption[]>(
    () =>
      (fields ?? []).map((f) => ({
        label: f.label,
        value: f.apiKey,
        code: f.apiKey,
      })),
    [fields],
  );

  const options = useMemo<ChipOption[]>(
    () => [ALL_FIELDS_OPTION, ...fieldOptions],
    [fieldOptions],
  );

  const totalCount = fields?.length ?? 0;
  const selectedCount = fieldOptions.filter((o) =>
    selectedSet.has(o.value),
  ).length;

  // When every field is selected, collapse the chips to a single "All fields"
  // — mirroring how the locale select shows "All other locales".
  const allSelected =
    !!fields &&
    fields.length > 0 &&
    fields.every((f) => selectedSet.has(f.apiKey));
  const value: ChipOption[] = allSelected
    ? [ALL_FIELDS_OPTION]
    : fieldOptions.filter((o) => selectedSet.has(o.value));

  const handleChange = (
    newValue: SingleValue<ChipOption> | MultiValue<ChipOption>,
  ) => {
    const next: ChipOption[] = Array.isArray(newValue)
      ? [...newValue]
      : newValue
        ? [newValue]
        : [];
    const hasAll = next.some((o) => o.value === ALL_FIELDS_VALUE);

    // Picking "All fields" selects everything. Otherwise drop the sentinel and
    // take the concrete picks — which also covers picking a specific field
    // while "All fields" was active (it narrows to just that field).
    if (!allSelected && hasAll) {
      onChange((fields ?? []).map((f) => f.apiKey));
      return;
    }
    onChange(
      next.filter((o) => o.value !== ALL_FIELDS_VALUE).map((o) => o.value),
    );
  };

  const id = `fields-${model.value}`;
  // The code follows the kit label ink: ink-subtle at rest, ink-danger on error.
  const label: ReactNode = (
    <>
      {model.label} <InlineCode inherit>{model.code}</InlineCode>
    </>
  );

  // Not fetched yet counts as pending, so the dead end never flashes before
  // the first fetch resolves.
  if (isLoading || (fields === undefined && !loadFailed)) {
    return (
      <SelectField
        id={id}
        name={id}
        label={label}
        placeholder="Loading fields…"
        value={[]}
        onChange={handleChange}
        selectInputProps={{
          isMulti: true,
          options: [],
          isLoading: true,
          isDisabled: true,
        }}
      />
    );
  }

  if (loadFailed || fields === undefined) {
    return (
      <FieldWrapper id={id} label={label}>
        <LoadFailedRow id={id} isDisabled={isDisabled} onRetry={onRetry} />
      </FieldWrapper>
    );
  }

  if (fields.length === 0) {
    return (
      <FieldWrapper id={id} label={label}>
        <NoTranslatableFieldsRow
          id={id}
          isDisabled={isDisabled}
          onRemove={onRemove}
          onOpenPluginSettings={onOpenPluginSettings}
        />
      </FieldWrapper>
    );
  }

  return (
    <SelectField
      id={id}
      name={id}
      label={label}
      placeholder="Select fields…"
      hint={
        validationMessage
          ? undefined
          : fieldCountHint(selectedCount, totalCount)
      }
      error={validationMessage}
      value={value}
      onChange={handleChange}
      selectInputProps={{
        isMulti: true,
        options,
        formatOptionLabel: formatCodeMultiOption,
        noOptionsMessage: () => 'No fields found',
        isDisabled,
      }}
    />
  );
}
