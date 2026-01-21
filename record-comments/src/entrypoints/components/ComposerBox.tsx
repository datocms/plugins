import { memo } from 'react';
import type { ReactNode } from 'react';
import type { StyleWithCustomProps } from '@ctypes/styles';
import { cn } from '@/utils/cn';
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
  const style: StyleWithCustomProps | undefined = accentColor
    ? { '--composer-accent': accentColor }
    : undefined;

  return (
    <div className={cn(styles.composerBox, compact && styles.compact)} style={style}>
      {children}
    </div>
  );
});

export default ComposerBox;
