import { FloatingDelayGroup } from '@floating-ui/react';
import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface ToolbarProps {
  children: ReactNode;
}

export function Toolbar({ children }: ToolbarProps) {
  return (
    <FloatingDelayGroup delay={200}>
      <div className={styles.toolbar}>{children}</div>
    </FloatingDelayGroup>
  );
}
