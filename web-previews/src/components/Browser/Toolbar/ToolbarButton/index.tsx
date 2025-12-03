import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../Tooltip';
import styles from './styles.module.css';

interface ToolbarButtonProps {
  icon: IconDefinition;
  onClick: () => void;
  disabled?: boolean;
  tooltip: NonNullable<ReactNode>;
}

export function ToolbarButton({
  icon,
  onClick,
  disabled,
  tooltip,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={onClick}
          disabled={disabled}
        >
          <FontAwesomeIcon icon={icon} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
