/**
 * ModelFieldPicker.tsx
 * --------------------
 * The translatable fields of one model, as a field of the form: the model
 * name with its API key is the label, and a multi-select holds the fields.
 * An "All fields" sentinel option collapses a full selection to one pill,
 * like "All other locales" in the target locale select, and the validation
 * message is the field's error.
 *
 * Render states, in order: fields pending (a disabled loading select), field
 * load failed (an error blank slate with "Try again", under the label), no
 * translatable fields (an empty slot with the way out in the hint, plus a
 * "Remove model" button after it where the model can be removed), and the
 * normal select. A blank slate or an empty slot isn't an input, so a group
 * element takes the field's name and description for it (FieldWrapper,
 * "Composite inputs").
 *
 * Pure presentation: the resolved selected api_keys flow in, and changes bubble
 * out via `onChange(apiKeys)` (the sentinel is resolved away before it leaves).
 * Used by the bulk page and the records-action picker modal.
 */
import ApiKey from 'datocms-react-ui/ApiKey';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import FieldWrapper, { useFieldInput } from 'datocms-react-ui/FieldWrapper';
import Link from 'datocms-react-ui/Link';
import SelectInput from 'datocms-react-ui/SelectInput';
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useId,
  useMemo,
  useRef,
} from 'react';
import { CircleExclamationIcon } from '../../icons';
import { useRetryFocus } from '../../utils/retryFocus';
import type { TranslatableField } from '../../utils/translation/BulkTranslationHelpers';
import { fieldCountHint } from './bulkCopy';
import { type ChipOption, formatApiKeyOptionLabel } from './chipOption';
import s from './ModelFieldPicker.module.css';
import {
  boundedSelectHint,
  useBoundedChipSelect,
} from './useBoundedChipSelect';

/** Sentinel option meaning "every translatable field on this model". */
const ALL_FIELDS_VALUE = '__all_fields__';
const ALL_FIELDS_OPTION: ChipOption = {
  label: 'All fields',
  value: ALL_FIELDS_VALUE,
};

/** Why the row actions don't respond while the run is starting. */
const LOCKED_REASON = 'Wait for the translation to start.';

/** The render states of the picker. */
type PickerPhase = 'pending' | 'failed' | 'empty' | 'ready';

/**
 * The state that the picker shows, in this order: fields pending (not
 * fetched yet counts as pending, so the dead end never flashes before the
 * first fetch resolves), load failed, no translatable fields, the select.
 */
function pickerPhase(
  fields: TranslatableField[] | undefined,
  isLoading: boolean,
  loadFailed: boolean,
): PickerPhase {
  if (isLoading || (fields === undefined && !loadFailed)) return 'pending';
  if (loadFailed || fields === undefined) return 'failed';
  return fields.length === 0 ? 'empty' : 'ready';
}

const noFieldsFound = () => 'No fields found';

/**
 * The element of the field when it holds a blank slate or an empty slot
 * instead of a select: a group that takes the field's id, name (the label)
 * and description (the hint), as a composite input does, with the content
 * and its buttons inside a boundary so they don't take the field's id.
 */
function SlotGroup({ children }: { children: ReactNode }) {
  // A group has no invalid or required state: only the name and the
  // description.
  const field = useFieldInput({});
  return (
    <div
      role="group"
      id={field.id}
      aria-labelledby={field['aria-labelledby']}
      aria-describedby={field['aria-describedby']}
    >
      <FieldWrapper.Boundary>{children}</FieldWrapper.Boundary>
    </div>
  );
}

/** The parts of the field that every state of the picker shares. */
interface PickerFieldProps {
  /** The model name with its API key. */
  label: ReactElement;
  /** Why the buttons don't respond while the run is starting, if they don't. */
  locked: { reason: string } | undefined;
  /** The box of the field, in every state: it holds the focus of a retry. */
  fieldRef: RefObject<HTMLDivElement | null>;
}

/**
 * The fields of the model couldn't be loaded. A failed load is an error, not
 * an empty field: an error blank slate under the label (BlankSlate, the
 * `section` placement), with "Try again" always in view. Its title says what
 * failed, so the field has no error of its own that would repeat it.
 */
function FailedFields({
  label,
  locked,
  fieldRef,
  retryId,
  onRetry,
}: PickerFieldProps & {
  /** The id of "Try again", which takes the focus after another failure. */
  retryId: string;
  onRetry?: () => void;
}) {
  return (
    <FieldWrapper ref={fieldRef} label={label}>
      <SlotGroup>
        <BlankSlate
          placement="section"
          small
          error
          icon={<CircleExclamationIcon />}
          title="Couldn't load the fields of this model"
          actions={
            onRetry && (
              <Button
                id={retryId}
                label="Try again"
                disabled={locked}
                onClick={onRetry}
              />
            )
          }
        />
      </SlotGroup>
    </FieldWrapper>
  );
}

/**
 * A model with zero translatable fields can never be satisfied by "pick a
 * field", so the field names the problem and the way out instead of showing
 * an empty select. "Remove model" doesn't fill the field, so it isn't an
 * action of the slot: it follows the hint, always in view.
 */
function NoTranslatableFields({
  label,
  locked,
  fieldRef,
  removeId,
  onRemove,
  pluginSettingsPath,
}: PickerFieldProps & {
  /** The id of "Remove model", which takes the focus after a retry. */
  removeId: string;
  onRemove?: () => void;
  pluginSettingsPath?: string;
}) {
  const settings = pluginSettingsPath ? (
    <Link to={pluginSettingsPath}>plugin settings</Link>
  ) : (
    'plugin settings'
  );
  return (
    <FieldWrapper
      ref={fieldRef}
      label={label}
      hint={
        <>
          Allow more field types in the {settings},{' '}
          {onRemove
            ? 'or remove the model.'
            : 'or leave its records out of the selection.'}
        </>
      }
      container={
        onRemove
          ? {
              trailing: (
                <Button
                  id={removeId}
                  label="Remove model"
                  className={s.removeModel}
                  disabled={locked}
                  onClick={onRemove}
                />
              ),
            }
          : undefined
      }
    >
      <SlotGroup>
        <EmptySlot message="No translatable fields" />
      </SlotGroup>
    </FieldWrapper>
  );
}

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
  /** Retries a failed field load; shows "Try again" in the failure state. */
  onRetry?: () => void;
  /**
   * The CMS path of the plugin settings. When provided, "plugin settings" in
   * the dead-end hint is a link to it; otherwise it's plain text.
   */
  pluginSettingsPath?: string;
  /** Inline validation message, shown as the field's error. */
  validationMessage?: string;
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
  pluginSettingsPath,
  validationMessage,
}: ModelFieldPickerProps) {
  // Counts get the separators of the language that the Canvas gives the kit.
  const { locale } = useCtx().ui;
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

  // The selected api_keys of fields that still exist, once each, in selection
  // order (the pills can be dragged to sort them).
  const selectedFieldKeys = useMemo(() => {
    const known = new Set(fieldOptions.map((o) => o.value));
    return [...new Set(selectedApiKeys)].filter((apiKey) => known.has(apiKey));
  }, [fieldOptions, selectedApiKeys]);

  const totalCount = fieldOptions.length;
  const selectedCount = selectedFieldKeys.length;

  // When every field is selected, collapse the pills to a single "All fields"
  // — mirroring how the locale select shows "All other locales".
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const value = useMemo(
    () => (allSelected ? [ALL_FIELDS_VALUE] : selectedFieldKeys),
    [allSelected, selectedFieldKeys],
  );

  const fieldSelect = useBoundedChipSelect(options, value, 'fields', {
    locale,
  });

  const handleChange = (newValue: string[] | null) => {
    const next = newValue ?? [];
    // Picking "All fields" selects everything. Otherwise drop the sentinel and
    // take the concrete picks — which also covers picking a specific field
    // while "All fields" was active (it narrows to just that field).
    if (!allSelected && next.includes(ALL_FIELDS_VALUE)) {
      onChange(fieldOptions.map((o) => o.value));
      return;
    }
    onChange(next.filter((apiKey) => apiKey !== ALL_FIELDS_VALUE));
  };

  const label = (
    <>
      {model.label} <ApiKey>{model.code}</ApiKey>
    </>
  );
  const locked = isDisabled ? { reason: LOCKED_REASON } : undefined;

  const phase = pickerPhase(fields, isLoading, loadFailed);

  // "Try again" leaves for the loading select, which drops the focus to the
  // body: the box of the field holds it until the load settles, then the
  // new "Try again", the "Remove model" of a model with no translatable
  // fields, or the field select takes it. The two buttons are found by
  // their ids, not refs: while they are disabled with a reason, the kit's
  // tooltip clones them and reads `element.ref`, which React 19 warns about.
  const fieldRef = useRef<HTMLDivElement>(null);
  const retryId = useId();
  const removeId = useId();
  const followRetry = useRetryFocus(
    phase,
    'pending',
    () => fieldRef.current,
    (settled) => {
      if (settled === 'failed') return document.getElementById(retryId);
      if (settled === 'empty') return document.getElementById(removeId);
      return (
        fieldRef.current?.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not(:disabled)',
        ) ?? null
      );
    },
  );
  const handleRetry =
    onRetry &&
    (() => {
      followRetry();
      onRetry();
    });

  if (phase === 'pending') {
    return (
      <FieldWrapper ref={fieldRef} label={label}>
        <SelectInput
          multiple
          loading
          disabled
          placeholder="Pick fields"
          value={[]}
          options={[]}
        />
      </FieldWrapper>
    );
  }

  // Without its fields the select has nothing to offer: the field shows the
  // failed load, with the action that loads them again.
  if (phase === 'failed') {
    return (
      <FailedFields
        label={label}
        locked={locked}
        fieldRef={fieldRef}
        retryId={retryId}
        onRetry={handleRetry}
      />
    );
  }

  if (phase === 'empty') {
    return (
      <NoTranslatableFields
        label={label}
        locked={locked}
        fieldRef={fieldRef}
        removeId={removeId}
        onRemove={onRemove}
        pluginSettingsPath={pluginSettingsPath}
      />
    );
  }

  return (
    <FieldWrapper
      ref={fieldRef}
      label={label}
      hint={
        validationMessage
          ? undefined
          : boundedSelectHint(
              fieldSelect.hint,
              fieldCountHint(selectedCount, totalCount, locale),
            )
      }
      error={validationMessage}
    >
      <SelectInput
        multiple
        {...fieldSelect.selectProps}
        placeholder={fieldSelect.placeholder('Pick fields')}
        value={value}
        onChange={handleChange}
        formatOptionLabel={formatApiKeyOptionLabel}
        noOptionsMessage={noFieldsFound}
        disabled={isDisabled}
      />
    </FieldWrapper>
  );
}
