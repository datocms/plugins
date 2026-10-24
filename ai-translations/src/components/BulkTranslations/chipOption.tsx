/**
 * chipOption.tsx
 * --------------
 * The option shape of the bulk translation selects (locales, models, fields)
 * and the one label renderer that shows a model or a field with its API key.
 * Locale options need no renderer: their label is the canonical
 * `formatLocaleWithCode` text ("English [en]").
 */
import ApiKey from 'datocms-react-ui/ApiKey';
import type { ReactNode } from 'react';

/**
 * An option of a bulk translation select: a friendly label, the value the
 * select stores, and, for models and fields, the API key shown after the
 * label. Sentinels ("All other locales", "All fields") have no `code`.
 */
export type ChipOption = {
  label: string;
  value: string;
  code?: string;
};

/**
 * `formatOptionLabel` of the model and field selects: the name, then its API
 * key. A sentinel, which has no code, shows its label alone.
 *
 * Single-argument, so it fits `formatOptionLabel` (react-select passes a meta
 * object as the second argument, which this ignores).
 *
 * @param option - The option to render.
 * @returns The label, followed by the API key when the option has one.
 */
export function formatApiKeyOptionLabel(option: ChipOption): ReactNode {
  if (!option.code) return option.label;
  return (
    <>
      {option.label} <ApiKey>{option.code}</ApiKey>
    </>
  );
}
