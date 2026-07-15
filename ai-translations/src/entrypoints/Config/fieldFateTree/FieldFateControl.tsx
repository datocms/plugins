/**
 * FieldFateControl.tsx
 * --------------------
 * The three-state Translate / Copy / Skip control (spec §2). A native
 * `<fieldset>` + radio group so exclusivity and keyboard/screen-reader
 * behavior come from the platform, not hand-rolled — `datocms-react-ui` has no
 * segmented control. Styled as segments via `--color--*` design tokens.
 */

import { useId } from 'react';
import type { FieldFate } from './types';
import s from './fieldFateTree.module.css';

const SEGMENTS: { fate: FieldFate; label: string }[] = [
  { fate: 'translate', label: 'Translate' },
  { fate: 'copy', label: 'Copy' },
  { fate: 'skip', label: 'Skip' },
];

interface FieldFateControlProps {
  /** Field label — the accessible legend for the radio group. */
  legend: string;
  /** Current fate; `'mixed'` (a block rollup) leaves every segment unpressed. */
  value: FieldFate | 'mixed';
  /** Required fields cannot be skipped — disables the Skip segment. */
  skipDisabled?: boolean;
  onChange: (fate: FieldFate) => void;
}

/**
 * Renders the fate segments for one field.
 */
export default function FieldFateControl({
  legend,
  value,
  skipDisabled = false,
  onChange,
}: FieldFateControlProps) {
  const groupName = useId();
  return (
    <fieldset className={s.fateControl} aria-label={legend}>
      <legend className={s.visuallyHidden}>{legend}</legend>
      {value === 'mixed' && <span className={s.mixedHint}>mixed…</span>}
      {SEGMENTS.map(({ fate, label }) => {
        const disabled = fate === 'skip' && skipDisabled;
        return (
          <label
            key={fate}
            className={s.segment}
            data-checked={value === fate}
            data-disabled={disabled}
            title={
              disabled
                ? "Required — can't be skipped; use Copy to keep the source value"
                : undefined
            }
          >
            <input
              type="radio"
              name={groupName}
              className={s.visuallyHidden}
              checked={value === fate}
              disabled={disabled}
              onChange={() => onChange(fate)}
            />
            {label}
          </label>
        );
      })}
    </fieldset>
  );
}
