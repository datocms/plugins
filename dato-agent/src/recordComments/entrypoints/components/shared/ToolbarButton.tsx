import styles from '@styles/commentbar.module.css';
import { Tooltip, TooltipContent, TooltipTrigger } from 'datocms-react-ui';
import { memo, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

type ToolbarButtonProps = {
  /** The icon to display inside the button (typically an SVG element) */
  icon: ReactNode;
  /** Tooltip text shown on hover */
  tooltipText: string;
  /** Click handler for the button */
  onClick?: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Accessible label for the button */
  ariaLabel: string;
  /** Additional class name for the button element */
  buttonClassName?: string;
};

/**
 * Reusable toolbar button component with tooltip.
 * Used in the comment composer toolbar for mention triggers.
 */
function ToolbarButtonComponent({
  icon,
  tooltipText,
  onClick,
  disabled = false,
  ariaLabel,
  buttonClassName,
}: ToolbarButtonProps) {
  return (
    <Tooltip placement="top">
      <TooltipTrigger>
        <span className={styles.toolbarTooltipTrigger}>
          <button
            type="button"
            className={cn(
              buttonClassName,
              disabled && styles.toolbarButtonDisabled,
            )}
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            aria-label={ariaLabel}
          >
            {icon}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

const ToolbarButton = memo(ToolbarButtonComponent);
export default ToolbarButton;
