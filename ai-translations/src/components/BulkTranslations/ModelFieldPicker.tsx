/**
 * ModelFieldPicker.tsx
 * --------------------
 * A model's translatable fields as a single `SelectField` — the same control
 * the locale and model selects use, so it behaves identically (menu, theming,
 * keyboard) with no custom chrome. The model identity is the field's label, an
 * "All fields" sentinel option collapses to one chip like "All other locales",
 * and validation surfaces through the field's native `error`.
 *
 * Pure presentation: the resolved selected api_keys flow in, and changes bubble
 * out via `onChange(apiKeys)` (the sentinel is resolved away before it leaves).
 * Shared by the bulk page, the records-action picker modal, and the
 * single-record sidebar.
 */
import { Button, SelectField } from 'datocms-react-ui';
import { useMemo } from 'react';
import type { TranslatableField } from '../../utils/translation/BulkTranslationHelpers';
import {
  CHIP_SELECT_CLASS_PREFIX,
  type ChipOption,
  renderChipOption,
} from './chipOption';
import s from './ModelFieldPicker.module.css';
import { ModelLabel } from './ModelLabel';

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
  fields: TranslatableField[] | undefined;
  isLoading: boolean;
  /** Resolved api_keys currently selected for this model. */
  selectedApiKeys: string[];
  /** Fires with the new resolved api_key set whenever the selection changes. */
  onChange: (apiKeys: string[]) => void;
  /**
   * Optional handler to drop this model from the selection. When provided, the
   * "no translatable fields" dead-end state shows a one-click Remove button.
   * Surfaces where the model can't be removed (sidebar, records picker) omit it.
   */
  onRemove?: () => void;
  /**
   * Inline validation message — rendered through the field's native error so
   * the offending select gets the standard error border + message.
   */
  validationMessage?: string;
}

export function ModelFieldPicker({
  model,
  fields,
  isLoading,
  selectedApiKeys,
  onChange,
  onRemove,
  validationMessage,
}: ModelFieldPickerProps) {
  const selectedSet = useMemo(() => new Set(selectedApiKeys), [selectedApiKeys]);

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
    !!fields && fields.length > 0 && fields.every((f) => selectedSet.has(f.apiKey));
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

  const isEmpty = !isLoading && (!fields || fields.length === 0);

  // Bespoke dead-end state: a model with zero translatable fields can never be
  // satisfied by "select a field", so don't show a disabled select with that
  // misleading hint — name the problem and offer a way out.
  if (isEmpty) {
    return (
      <div className={s.noFields}>
        <ModelLabel label={model.label} code={model.code} />
        <div className={s.noFieldsNotice} role="alert">
          <span className={s.noFieldsIcon} aria-hidden>
            ⚠
          </span>
          <div className={s.noFieldsBody}>
            <strong>No translatable fields.</strong> The plugin can't translate
            this model.{' '}
            {onRemove
              ? 'Remove it to continue, or '
              : 'Nothing to translate here — '}
            allow more field types in the plugin settings.
          </div>
          {onRemove ? (
            <Button
              type="button"
              buttonType="negative"
              buttonSize="xs"
              onClick={onRemove}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const hint = isLoading
    ? undefined
    : `${selectedCount} of ${totalCount} field${totalCount === 1 ? '' : 's'} selected`;

  return (
    <SelectField
      name={`fields-${model.value}`}
      id={`fields-${model.value}`}
      label={<ModelLabel label={model.label} code={model.code} />}
      hint={hint}
      error={validationMessage}
      value={value}
      selectInputProps={{
        isMulti: true,
        options,
        formatOptionLabel: renderChipOption,
        classNamePrefix: CHIP_SELECT_CLASS_PREFIX,
        placeholder: isLoading
          ? 'Loading fields…'
          : 'Select fields to translate…',
        isLoading,
        isDisabled: isLoading,
      }}
      onChange={handleChange}
    />
  );
}
