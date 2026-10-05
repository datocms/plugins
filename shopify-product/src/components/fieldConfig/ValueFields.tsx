import { FieldHint, SwitchField, TextField } from 'datocms-react-ui';
import { allowedKinds } from '../../lib/parameters';
import type {
  Cardinality,
  FieldParametersV1,
  FieldType,
  ShopifyKind,
  StorageFormat,
} from '../../types';
import ChoiceFieldset from './ChoiceFieldset';
import {
  CARDINALITY_OPTIONS,
  cardinalityHint,
  FORMAT_OPTIONS,
  KIND_OPTIONS,
  kindUnavailableReason,
} from './copy';
import { describe, describedBy } from './describe';
import type { LimitTexts } from './draft';
import OptionCards from './OptionCards';
import Segmented from './Segmented';
import styles from './ValueFields.module.css';

/** 1. What editors pick. Kinds the format can't store are disabled with the reason. */
export function KindField({
  params,
  error,
  onChange,
}: {
  params: FieldParametersV1;
  error?: string;
  onChange: (kind: ShopifyKind) => void;
}) {
  const available = allowedKinds(params.format);
  const options = KIND_OPTIONS.map((option) => ({
    ...option,
    disabledReason: available.includes(option.value)
      ? undefined
      : kindUnavailableReason(params.format),
  }));
  return (
    <ChoiceFieldset id="kind" legend="Editors pick" error={error}>
      {(description) => (
        <OptionCards
          name="kind"
          options={options}
          value={params.kind}
          onChange={onChange}
          {...description}
        />
      )}
    </ChoiceFieldset>
  );
}

/** 2. How the value is stored; only the formats this field type can hold. */
export function FormatField({
  fieldType,
  format,
  error,
  onChange,
}: {
  fieldType: FieldType;
  format: StorageFormat;
  error?: string;
  onChange: (format: StorageFormat) => void;
}) {
  return (
    <ChoiceFieldset id="format" legend="Stored value" error={error}>
      {(description) => (
        <OptionCards
          name="format"
          options={FORMAT_OPTIONS[fieldType]}
          value={format}
          onChange={onChange}
          {...description}
        />
      )}
    </ChoiceFieldset>
  );
}

/** 3. One or several items (reference documents only). */
export function CardinalityField({
  params,
  error,
  onChange,
}: {
  params: FieldParametersV1;
  error?: string;
  onChange: (cardinality: Cardinality) => void;
}) {
  return (
    <ChoiceFieldset
      id="cardinality"
      legend="How many"
      error={error}
      hint={cardinalityHint(params.cardinality, params.kind)}
    >
      {({ describedBy }) => (
        <Segmented
          options={CARDINALITY_OPTIONS}
          value={params.cardinality}
          onChange={onChange}
          describedBy={describedBy}
        />
      )}
    </ChoiceFieldset>
  );
}

const LIMITS_HINT_ID = 'limits-hint';

/** One limit input: described by its error, then by the pair's shared hint. */
function LimitField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: 'min' | 'max';
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <TextField
        id={id}
        name={id}
        label={label}
        value={value}
        error={error ? <span id={errorId}>{error}</span> : undefined}
        onChange={onChange}
        textInputProps={{
          inputMode: 'numeric',
          autoComplete: 'off',
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy(error && errorId, LIMITS_HINT_ID),
        }}
      />
    </div>
  );
}

/** Optional min and max, side by side, written as typed so the validator can flag them. */
export function LimitsFields({
  limits,
  errors,
  onChange,
}: {
  limits: LimitTexts;
  errors: { min?: string; max?: string };
  onChange: (patch: Partial<LimitTexts>) => void;
}) {
  return (
    <div>
      <div className={styles.pair}>
        <LimitField
          id="min"
          label="Minimum items"
          value={limits.min}
          error={errors.min}
          onChange={(min) => onChange({ min })}
        />
        <LimitField
          id="max"
          label="Maximum items"
          value={limits.max}
          error={errors.max}
          onChange={(max) => onChange({ max })}
        />
      </div>
      <FieldHint>
        <span id={LIMITS_HINT_ID}>
          Optional. Editors can't add more than the maximum, and see a warning
          below the minimum.
        </span>
      </FieldHint>
    </div>
  );
}

/** 4. Display snapshot (reference documents only). */
export function SnapshotField({
  value,
  error,
  onChange,
}: {
  value: boolean;
  error?: string;
  onChange: (value: boolean) => void;
}) {
  const described = describe(
    'snapshot',
    'If enabled, each reference also stores the title, image and price captured at selection time, so frontends can render without calling Shopify. Shopify stays the source of truth.',
    error,
  );
  return (
    <div>
      <SwitchField
        id="snapshot"
        name="snapshot"
        label="Include a display snapshot?"
        hint={described.hint}
        value={value}
        error={described.error}
        onChange={onChange}
        switchInputProps={{
          name: 'snapshot',
          value,
          'aria-invalid': described.invalid,
          'aria-describedby': described.ids,
        }}
      />
    </div>
  );
}
