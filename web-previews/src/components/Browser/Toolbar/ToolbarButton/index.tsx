import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import styles from './styles.module.css';

interface ToolbarButtonProps {
  icon: IconDefinition;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ToolbarButton({
  icon,
  title,
  onClick,
  disabled,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={styles.toolbarButton}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}
