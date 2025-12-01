import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface ToolbarProps {
  children: ReactNode;
}

export function Toolbar({ children }: ToolbarProps) {
  return <div className={styles.toolbar}>{children}</div>;
}
