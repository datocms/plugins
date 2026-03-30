import { memo } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from '@styles/comment.module.css';

type ComposerBoxProps = {
  compact?: boolean;
  children: ReactNode;
};

const ComposerBox = memo(function ComposerBox({
  compact = false,
  children,
}: ComposerBoxProps) {
  return (
    <div className={cn(styles.composerBox, compact && styles.composerBoxCompact)}>
      {children}
    </div>
  );
});

export default ComposerBox;
