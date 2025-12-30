import { memo } from 'react';
import type { ReactNode } from 'react';
import type { StyleWithCustomProps } from '@ctypes/styles';
import styles from '@styles/dashboard.module.css';

type ComposerBoxProps = {
  compact?: boolean;
  accentColor?: string;
  children: ReactNode;
};

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
