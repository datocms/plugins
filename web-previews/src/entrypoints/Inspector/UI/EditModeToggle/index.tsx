import { SwitchInput } from 'datocms-react-ui';
import styles from './styles.module.css';

interface EditModeToggleProps {
  value: boolean;
  disabled: boolean;
  onChange: () => void;
}

export function EditModeToggle({
  value,
  disabled,
  onChange,
}: EditModeToggleProps) {
  return (
    <label className={styles.label} htmlFor="clickToEditEnabled">
      <SwitchInput
        name="clickToEditEnabled"
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
      <span className={styles.text}>Edit mode</span>
    </label>
  );
}
