/**
 * ModelSelectField.tsx
 * DRY-003: Shared model selection component for vendor configurations.
 * Extracts the common pattern used across OpenAI, Gemini, and Anthropic configs.
 */

import { SelectField } from 'datocms-react-ui';
import { useMemo } from 'react';

export interface ModelSelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  models: string[];
  hint?: string;
  isLoading?: boolean;
}

export default function ModelSelectField({
  id,
  label,
  value,
  onChange,
  models,
  hint,
  isLoading = false,
}: ModelSelectFieldProps) {
  const options = useMemo(
    () => models.map((m) => ({ label: m, value: m })),
    [models],
  );

  const handleChange = (newValue: unknown) => {
    if (!Array.isArray(newValue)) {
      const selected = newValue as { value: string } | null;
      onChange(selected?.value || value);
    }
  };

  const selectedValue = isLoading
    ? { label: 'Loading models...', value: 'Loading models...' }
    : { label: value, value };

  return (
    <SelectField
      name={id}
      id={id}
      label={label}
      required
      hint={hint}
      placeholder={isLoading ? 'Loading models...' : undefined}
      value={selectedValue}
      selectInputProps={{
        isDisabled: isLoading,
        isLoading,
        options,
      }}
      onChange={handleChange}
    />
  );
}
