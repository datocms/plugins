import { TooltipDelayGroup } from 'datocms-react-ui';
import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface ToolbarProps {
  children: ReactNode;
}

export function Toolbar({ children }: ToolbarProps) {
  return (
    <TooltipDelayGroup delay={200}>
      <div className={styles.toolbar}>{children}</div>
    </TooltipDelayGroup>
  );
}
