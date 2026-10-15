import { SwitchInput } from 'datocms-react-ui';
import styles from './styles.module.css';

interface EditModeToggleProps {
  value: boolean;
  /** Flipped by holding Alt in the preview; reverts on release */
  temporary: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}

/** Same layout as the on-site Visual Editing toggle, in the CMS colors */
export function EditModeToggle({
  value,
  temporary,
  disabled,
  onChange,
}: EditModeToggleProps) {
  return (
    <label className={styles.root} htmlFor="clickToEditEnabled">
      <span className={styles.text}>
        <span className={styles.label}>
          Visual editing {value ? 'on' : 'off'}
        </span>
        <span className={styles.hint}>
          {temporary
            ? `Release ⌥ Alt to ${value ? 'hide' : 'show'}`
            : `Hold ⌥ Alt to ${value ? 'hide' : 'peek'}`}
        </span>
      </span>
      <SwitchInput
        name="clickToEditEnabled"
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  );
}
