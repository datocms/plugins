import { type Glyph, Icon } from './icons';
import { Tip } from './Tip';

type IconToggleProps = {
  glyph: Glyph;
  /** Tooltip and accessible name ("Match case"). */
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onChange: (pressed: boolean) => void;
};

/** An input-group addon that toggles an option (native button, aria-pressed, tooltip). */
export function IconToggle({
  glyph,
  label,
  pressed,
  disabled = false,
  onChange,
}: IconToggleProps) {
  return (
    <Tip label={label}>
      <button
        type="button"
        className="dl-input-group__addon dl-input-group__addon--button fr-toggle"
        aria-pressed={pressed}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!pressed)}
      >
        <Icon glyph={glyph} />
      </button>
    </Tip>
  );
}
