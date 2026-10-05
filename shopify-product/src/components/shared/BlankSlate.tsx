import type { ReactNode } from 'react';
import styles from './BlankSlate.module.css';

type Props = {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** The tiny blank slate: a 19px ink-subtle title, a short why/what-next, an optional action. */
export default function BlankSlate({
  title,
  children,
  actions,
  className,
}: Props) {
  return (
    <div className={[styles.blankSlate, className].filter(Boolean).join(' ')}>
      <div className={styles.title}>{title}</div>
      {children && <div className={styles.description}>{children}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
