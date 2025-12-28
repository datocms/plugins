import type { StyleWithCustomProps } from '@ctypes/styles';
import { ArrowDownIcon } from './Icons';
import styles from '@styles/dashboard.module.css';

type NewCommentsIndicatorProps = {
  /**
   * Number of new comments to display.
   */
  count: number;
  /**
   * Handler called when the indicator is clicked.
   */
  onClick: () => void;
  /**
   * Accent color for the indicator button.
   */
  accentColor: string;
};

/**
 * Floating indicator button that appears when new comments arrive
 * while the user is scrolled up in the comments list.
 *
 * Clicking scrolls to the bottom and dismisses the indicator.
 */
export function NewCommentsIndicator({ count, onClick, accentColor }: NewCommentsIndicatorProps) {
  if (count === 0) return null;

  const label = count === 1 ? 'comment' : 'comments';

  return (
    <button
      type="button"
      className={styles.newCommentsIndicator}
      onClick={onClick}
      style={{ '--accent-color': accentColor } as StyleWithCustomProps}
    >
      <ArrowDownIcon aria-label="Scroll to new comments" />
      {count} new {label}
    </button>
  );
}
