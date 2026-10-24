import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import StringInput from 'datocms-react-ui/StringInput';
import { useEffect, useRef, useState } from 'react';
import type { OptimizationSettings } from '../../utils/optimizationUtils';

export type NumberSettingKey = keyof Pick<
  OptimizationSettings,
  | 'largeAssetThreshold'
  | 'veryLargeAssetThreshold'
  | 'qualityLarge'
  | 'qualityVeryLarge'
  | 'resizeDimensionLarge'
  | 'resizeDimensionVeryLarge'
  | 'minimumReduction'
>;

type NumberKind = 'percentage' | 'threshold' | 'dimension';

function kindOf(name: NumberSettingKey): NumberKind {
  if (name === 'largeAssetThreshold' || name === 'veryLargeAssetThreshold')
    return 'threshold';
  if (name === 'resizeDimensionLarge' || name === 'resizeDimensionVeryLarge')
    return 'dimension';
  return 'percentage';
}

/** The range of each number setting: the value that the settings keep */
export function validateNumberSettingValue(
  name: NumberSettingKey,
  value: number,
): number {
  switch (kindOf(name)) {
    case 'percentage':
      return Math.min(Math.max(0, value), 100);
    case 'threshold':
      return Math.max(0.1, value);
    case 'dimension':
      return Math.max(1, value);
  }
}

const RANGE_ERRORS: Record<NumberKind, string> = {
  percentage: 'Enter a number from 0 to 100.',
  threshold: 'Enter 0.1 or more.',
  dimension: 'Enter 1 or more.',
};

/** The error of a text that the user types, or undefined when it is valid */
function draftError(name: NumberSettingKey, draft: string) {
  const parsed = Number.parseFloat(draft);
  if (!Number.isFinite(parsed)) return 'Enter a number.';
  if (validateNumberSettingValue(name, parsed) !== parsed)
    return RANGE_ERRORS[kindOf(name)];
  return undefined;
}

type NumberSettingProps = {
  name: NumberSettingKey;
  label: string;
  hint: string;
  docs?: { label: string; to: string };
  /** The unit after the input. Without it, the input has no addon. */
  unit?: 'MB' | '%' | 'px';
  value: number;
  onChange: (name: NumberSettingKey, value: number) => void;
};

/**
 * A number of the settings. The input keeps the text that the user types, and
 * the settings get only a number, in the range of the setting.
 */
export default function NumberSetting({
  name,
  label,
  hint,
  docs,
  unit,
  value,
  onChange,
}: NumberSettingProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [error, setError] = useState<string | undefined>(undefined);
  const focused = useRef(false);

  // A new value from elsewhere (restore defaults, a saved change) shows in
  // the input, unless the user is typing in it
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const handleChange = (text: string | null) => {
    const next = text ?? '';
    setDraft(next);
    setError(draftError(name, next));
    const parsed = Number.parseFloat(next);
    if (Number.isFinite(parsed))
      onChange(name, validateNumberSettingValue(name, parsed));
  };

  const handleFocus = () => {
    focused.current = true;
  };

  const handleBlur = () => {
    focused.current = false;
    setDraft(String(value));
    setError(undefined);
  };

  const inputProps = {
    value: draft,
    onChange: handleChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    autoComplete: 'off',
    inputMode: unit === 'px' || !unit ? 'numeric' : 'decimal',
  } as const;

  return (
    <FieldWrapper label={label} hint={hint} docs={docs} error={error}>
      {unit ? (
        <InputGroup {...inputProps} post={unit} />
      ) : (
        <StringInput {...inputProps} />
      )}
    </FieldWrapper>
  );
}
