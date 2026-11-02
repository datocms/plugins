import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Pill from 'datocms-react-ui/Pill';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { allowedKinds } from '../../lib/parameters';
import type {
  Cardinality,
  FieldParametersV1,
  FieldType,
  ShopifyKind,
  StorageFormat,
} from '../../types';
import {
  CARDINALITY_OPTIONS,
  cardinalityHint,
  FORMAT_OPTIONS,
  KIND_OPTIONS,
  kindUnavailableReason,
} from './copy';
import type { LimitTexts } from './draft';
import { fieldNotice } from './notices';

/**
 * 1. What editors pick. Kinds the format can't store are disabled, with the
 * reason as their visible hint (a tooltip would only repeat it).
 */
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
  const reason = kindUnavailableReason(params.format);
  const options: RadioGroupOption<ShopifyKind>[] = KIND_OPTIONS.map(
    (option) => {
      const enabled = available.includes(option.value);
      return {
        value: option.value,
        label: option.label,
        hint: enabled ? option.description : reason,
        disabled: !enabled,
      };
    },
  );
  return (
    <FieldWrapper id="kind" label="Editors pick" error={error}>
      <RadioGroupInput
        value={params.kind}
        options={options}
        onChange={(kind) => {
          if (kind) onChange(kind);
        }}
      />
    </FieldWrapper>
  );
}

/** 2. How the value is stored; only the formats this field type can hold. */
export function FormatField({
  fieldType,
  format,
  error,
  notice,
  onChange,
}: {
  fieldType: FieldType;
  format: StorageFormat;
  error?: string;
  /** The warning about values saved with another kind or format. */
  notice: string | null;
  onChange: (format: StorageFormat) => void;
}) {
  const options: RadioGroupOption<StorageFormat>[] = FORMAT_OPTIONS[
    fieldType
  ].map((option) => ({
    value: option.value,
    label: option.badge ? (
      <>
        {option.label} <Pill>{option.badge}</Pill>
      </>
    ) : (
      option.label
    ),
    hint: option.description,
  }));
  return (
    <FieldWrapper
      id="format"
      label="Stored value"
      error={error}
      container={fieldNotice(notice)}
    >
      <RadioGroupInput
        value={format}
        options={options}
        onChange={(next) => {
          if (next) onChange(next);
        }}
      />
    </FieldWrapper>
  );
}

/** 3. One or several items (reference documents only). */
export function CardinalityField({
  params,
  error,
  notice,
  onChange,
}: {
  params: FieldParametersV1;
  error?: string;
  /** The warning about saved values that hold several items. */
  notice: string | null;
  onChange: (cardinality: Cardinality) => void;
}) {
  const options: RadioGroupOption<Cardinality>[] = CARDINALITY_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: option.label,
      hint: cardinalityHint(option.value, params.kind),
    }),
  );
  return (
    <FieldWrapper
      id="cardinality"
      label="How many"
      error={error}
      container={fieldNotice(notice)}
    >
      <RadioGroupInput
        value={params.cardinality}
        options={options}
        onChange={(cardinality) => {
          if (cardinality) onChange(cardinality);
        }}
      />
    </FieldWrapper>
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
    <div className="form__field form__row">
      <div className="form__row__cell">
        <FieldWrapper
          id="min"
          label="Minimum items"
          hint="Below it, editors see a warning."
          error={errors.min}
        >
          <StringInput
            name="min"
            inputMode="numeric"
            autoComplete="off"
            value={limits.min}
            onChange={(min) => onChange({ min: min ?? '' })}
          />
        </FieldWrapper>
      </div>
      <div className="form__row__cell">
        <FieldWrapper
          id="max"
          label="Maximum items"
          hint="Editors can't add more items."
          error={errors.max}
        >
          <StringInput
            name="max"
            inputMode="numeric"
            autoComplete="off"
            value={limits.max}
            onChange={(max) => onChange({ max: max ?? '' })}
          />
        </FieldWrapper>
      </div>
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
  return (
    <FieldWrapper
      id="snapshot"
      hint="Also stores the title, image and price, so frontends can render without calling Shopify."
      error={error}
    >
      <SwitchInput
        name="snapshot"
        label="Include a display snapshot"
        value={value}
        onChange={(next) => onChange(Boolean(next))}
      />
    </FieldWrapper>
  );
}
