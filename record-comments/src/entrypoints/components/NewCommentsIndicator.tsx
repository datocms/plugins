import type { StyleWithCustomProps } from '@ctypes/styles';
import { ArrowDownIcon } from './Icons';
import styles from '@styles/dashboard.module.css';

type NewCommentsIndicatorProps = {
  count: number;
  onClick: () => void;
  accentColor: string;
};

/** Floating indicator that appears when new comments arrive while scrolled up. */
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
