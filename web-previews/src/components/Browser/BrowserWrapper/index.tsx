import type { ReactNode } from 'react';
import styles from './styles.module.css';

interface BrowserWrapperProps {
  children: ReactNode;
}

export function BrowserWrapper({ children }: BrowserWrapperProps) {
  return <div className={styles.wrapper}>{children}</div>;
}
