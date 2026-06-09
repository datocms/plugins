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
 * `classNamePrefix` to pass to every chip-rendering `SelectField` so the
 * react-select internals expose stable class names (`…__single-value`,
 * `…__multi-value`). `chipOption.module.css` targets those to make the
 * single-select value render as the same chip as a multi-select value —
 * react-select only themes `multiValue` by default, leaving `singleValue`
 * flat. Keep this the single owner of the prefix string.
 */
export const CHIP_SELECT_CLASS_PREFIX = 'aitChipSelect';

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
 * Renders a chip: a friendly label plus an optional monospace code badge for
 * the machine name. This one structure is shared by every label-plus-code
 * display in the plugin (locales, models, fields) so they read consistently,
 * and its colors come entirely from the host's theme tokens.
 *
 * Kept single-argument so it drops straight into `SelectField`'s
 * `formatOptionLabel` (react-select passes a meta object as a second argument,
 * which this intentionally ignores).
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
