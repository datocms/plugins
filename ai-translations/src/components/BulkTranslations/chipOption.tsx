/**
 * chipOption.tsx
 * --------------
 * Shared SelectField option shape + renderer used by the bulk translations
 * surfaces (the standalone settings page and the records-action picker
 * modal). Both surfaces render locale and model options as a friendly label
 * followed by a code-formatted machine identifier (locale code or
 * `api_key`), with the same styling.
 */
import type { ReactNode } from 'react';
import s from './chipOption.module.css';

/**
 * Common shape for chip-rendered SelectField options: a friendly label
 * plus a small, code-formatted machine identifier rendered alongside it.
 * `code` is optional so synthetic options (like "All other locales") can
 * opt out of the code badge.
 */
export type ChipOption = {
  label: string;
  value: string;
  code?: string;
};

/**
 * Renderer passed to `SelectField`'s `selectInputProps.formatOptionLabel`.
 * react-select calls this for both the dropdown menu and the selected
 * chips, so one implementation keeps the two render sites visually
 * identical.
 */
export function renderChipOption(option: ChipOption): ReactNode {
  return (
    <span className={s.chipOption}>
      <span>{option.label}</span>
      {option.code ? (
        <code className={s.chipOptionCode}>{option.code}</code>
      ) : null}
    </span>
  );
}
