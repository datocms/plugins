/**
 * chipOption.tsx
 * --------------
 * Shared SelectField option shape and renderers. Options render as a friendly
 * label followed by a code-formatted machine identifier (locale code or
 * `api_key`).
 *
 * - `renderChipOption` (with `CHIP_SELECT_CLASS_PREFIX`) draws a chip with a
 *   code badge; the sidebar, confirm and progress surfaces use it.
 * - `formatCodeOption` / `formatCodeMultiOption` / `InlineCode` draw the code
 *   as inline mono text, leaving react-select's multi-value as the only chip;
 *   the bulk page and the records-action picker modal use them.
 */
import type { ReactNode } from 'react';
import s from './chipOption.module.css';
import c from './codeOption.module.css';

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
 * the machine name. This one structure is shared by the label-plus-code
 * displays of the sidebar, confirm and progress surfaces (locales, models,
 * fields) so they read consistently, and its colors come entirely from the
 * host's theme tokens.
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

/**
 * Structural subset of react-select's `FormatOptionLabelMeta`, so these
 * renderers drop into `formatOptionLabel` without importing react-select.
 */
type OptionLabelMeta = {
  context: 'menu' | 'value';
  selectValue: readonly ChipOption[];
};

/**
 * A machine identifier (locale code, `api_key`) as inline mono text, one
 * notch smaller. `ink-subtle` on neutral surfaces; with `inherit` it takes
 * the surrounding ink (inside a value chip or a selected menu row).
 */
export function InlineCode({
  children,
  inherit = false,
}: {
  children: ReactNode;
  inherit?: boolean;
}) {
  return (
    <code className={inherit ? `${c.code} ${c.inherit}` : c.code}>
      {children}
    </code>
  );
}

function renderCodeOption(option: ChipOption, inheritCode: boolean): ReactNode {
  // Sentinels ("All other locales", "All fields") have no code: label only.
  if (!option.code) return option.label;
  return (
    <span className={c.option}>
      <span className={c.label}>{option.label}</span>
      <InlineCode inherit={inheritCode}>{option.code}</InlineCode>
    </span>
  );
}

const isSelected = (option: ChipOption, meta: OptionLabelMeta) =>
  meta.selectValue.some((v) => v.value === option.value);

/**
 * `formatOptionLabel` for single selects: plain value text with an
 * `ink-subtle` code; in the menu, the selected row's code inherits the
 * selected ink.
 */
export const formatCodeOption = (option: ChipOption, meta: OptionLabelMeta) =>
  renderCodeOption(option, meta.context === 'menu' && isSelected(option, meta));

/**
 * `formatOptionLabel` for multi selects: inside the kit's primary-soft value
 * chip the code inherits the chip ink (one chip layer, no solid brand).
 */
export const formatCodeMultiOption = (
  option: ChipOption,
  meta: OptionLabelMeta,
) =>
  renderCodeOption(
    option,
    meta.context === 'value' || isSelected(option, meta),
  );
