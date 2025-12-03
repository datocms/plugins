import {
  HotKey,
  SwitchInput,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'datocms-react-ui';
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
    <Tooltip>
      <TooltipTrigger>
        <label className={styles.label} htmlFor="clickToEditEnabled">
          <SwitchInput
            name="clickToEditEnabled"
            value={value}
            disabled={disabled}
            onChange={onChange}
          />
          <span className={styles.text}>Edit mode</span>
        </label>
      </TooltipTrigger>
      <TooltipContent>
        <HotKey label="Enable edit overlay" hotkey="alt" />
      </TooltipContent>
    </Tooltip>
  );
}
