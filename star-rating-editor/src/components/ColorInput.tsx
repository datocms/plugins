import { useCtx } from 'datocms-react-ui/Canvas';
import { useRovingKeyDown } from 'datocms-react-ui/hooks/useRovingKeyDown';
import InputGroup from 'datocms-react-ui/InputGroup';
import RawButton from 'datocms-react-ui/RawButton';
import { defaultStarsColor } from '../utils/globalParams';
import s from './ColorInput.module.css';

type ColorInputProps = {
  value: string | null;
  onChange: (value: string | null) => void;
};

// The swatches paint the colors themselves: they are the admin's color data,
// not a role of the interface, so no token replaces them
export default function ColorInput({ value, onChange }: ColorInputProps) {
  const { accentColor, primaryColor } = useCtx().theme;

  // The accent and primary colors of a project can be the same
  const presets = [
    ...new Set([
      accentColor,
      primaryColor,
      '#E91E63',
      '#9C27B0',
      '#673AB7',
      '#3F51B5',
      '#2196F3',
      '#03A9F4',
      '#00BCD4',
      '#009688',
      '#4CAF50',
      '#8BC34A',
      '#CDDC39',
      defaultStarsColor,
      '#FF9800',
      '#FF5722',
      '#795548',
      '#607D8B',
      '#969696',
    ]),
  ];

  // The old picker stored lowercase hex
  const checked = presets.find(
    (color) => color.toLowerCase() === value?.toLowerCase(),
  );
  const onKeyDown = useRovingKeyDown('[role="radio"]');

  return (
    <>
      <InputGroup
        code
        placeholder="#FFB400"
        value={value}
        onChange={onChange}
        pre={
          <span
            className={s.swatch}
            style={{ background: value ?? undefined }}
            aria-hidden
          />
        }
      />
      <div
        className={s.presets}
        role="radiogroup"
        aria-label="Preset colors"
        onKeyDown={onKeyDown}
      >
        {presets.map((color) => (
          <RawButton
            key={color}
            className={s.preset}
            style={{ background: color }}
            ariaLabel={color}
            radio={{ checked: color === checked }}
            // Tab goes to the checked preset, or to the first one
            tabIndex={color === (checked ?? presets[0]) ? 0 : -1}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </>
  );
}
