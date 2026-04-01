/**
 * ModelSelectField.tsx
 * DRY-003: Shared model selection component for vendor configurations.
 * Extracts the common pattern used across OpenAI, Gemini, and Anthropic configs.
 */

import { SelectField, SelectInput } from 'datocms-react-ui';
import { useMemo } from 'react';
import s from '../../styles.module.css';

export interface ModelSelectFieldProps {
  /** Unique identifier for the field */
  id: string;
  /** Display label for the field */
  label: string;
  /** Currently selected model */
  value: string;
  /** Callback when selection changes */
  onChange: (value: string) => void;
  /** List of available models */
  models: string[];
  /** Whether to use the styled wrapper with label */
  useStyledWrapper?: boolean;
}

/**
 * Reusable model selection dropdown used across vendor configurations.
 * PERF-004: Options are memoized to prevent recreation on every render.
 */
export default function ModelSelectField({
  id,
  label,
  value,
  onChange,
  models,
  useStyledWrapper = true,
}: ModelSelectFieldProps) {
  // PERF-004: Memoize options to prevent recreation on every render
  const options = useMemo(
    () => models.map((m) => ({ label: m, value: m })),
    [models],
  );

  const selectValue = { label: value, value };
  const handleChange = (newValue: unknown) => {
    if (!Array.isArray(newValue)) {
      const selected = newValue as { value: string } | null;
      onChange(selected?.value || value);
    }
  };

  if (useStyledWrapper) {
    return (
      <div className={s.dropdownLabel}>
        <span className={s.label} id={`${id}Label`}>
          {label}*
        </span>
        <div className={s.modelSelect}>
          <SelectInput
            id={id}
            name={id}
            value={selectValue}
            onChange={handleChange}
            options={options}
            aria-labelledby={`${id}Label`}
          />
        </div>
      </div>
    );
  }

  return (
    <SelectField
      name={id}
      id={id}
      label={label}
      value={selectValue}
      selectInputProps={{ options }}
      onChange={handleChange}
    />
  );
}
