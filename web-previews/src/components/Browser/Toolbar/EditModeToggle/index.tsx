import {
  HotKey,
  SwitchInput,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'datocms-react-ui';
import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface EditModeToggleProps {
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  tooltip?: ReactNode;
}

export function EditModeToggle({
  value,
  disabled,
  onChange,
  tooltip,
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
        {tooltip ?? <HotKey label="Enable edit overlay" hotkey="alt" />}
      </TooltipContent>
    </Tooltip>
  );
}
