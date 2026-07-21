/**
 * ModelSelectField.tsx
 * DRY-003: Shared model selection component for vendor configurations.
 * Extracts the common pattern used across OpenAI, Gemini, and Anthropic configs.
 *
 * Never add hard-coded model recommendations or "Recommended" hints here or
 * in callers. Provider model catalogs change too quickly for that guidance to
 * remain accurate; users should choose from the dynamically loaded model list.
 */

import { SelectField } from 'datocms-react-ui';
import { useMemo } from 'react';

export interface ModelSelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  models: string[];
  isLoading?: boolean;
}

export default function ModelSelectField({
  id,
  label,
  value,
  onChange,
  models,
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
