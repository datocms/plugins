import { memo } from 'react';
import type { ReactNode } from 'react';
import type { StyleWithCustomProps } from '@ctypes/styles';
import styles from '@styles/dashboard.module.css';

type ComposerBoxProps = {
  compact?: boolean;
  accentColor?: string;
  children: ReactNode;
};

/**
 * Reusable composer box wrapper component.
 * Used for both the main composer and reply/edit composers.
 *
 * Memoized because it's rendered frequently within Comment components
 * during edit mode and reply composition. The props are simple primitives
 * and ReactNode, making shallow comparison effective.
 *
 * @param compact - Use smaller sizing for inline editing (replies)
 * @param accentColor - Optional accent color for focus states
 */
const ComposerBox = memo(function ComposerBox({
  compact = false,
  accentColor,
  children,
}: ComposerBoxProps) {
  const className = compact
    ? `${styles.composerBox} ${styles.compact}`
    : styles.composerBox;

  const style: StyleWithCustomProps | undefined = accentColor
    ? { '--composer-accent': accentColor }
    : undefined;

  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
});

export default ComposerBox;
