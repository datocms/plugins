import type { ReactNode } from 'react';
import styles from './TableLayout.module.css';

export type TableLayoutProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function TableLayout({
  title,
  subtitle,
  toolbar,
  children,
  footer,
}: TableLayoutProps) {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.toolbar}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          <div className={styles.space} />
          {toolbar}
        </div>
      </header>
      <main className={styles.content}>{children}</main>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

export type TableStateProps = {
  title?: ReactNode;
  children?: ReactNode;
};

export function LoadingTableShell({
  title = 'Loading records…',
}: Pick<TableStateProps, 'title'>) {
  return (
    <div className={styles.state} role="status">
      <div className={styles.stateContent}>
        <div className={styles.spinner} aria-hidden="true" />
        <h2 className={styles.stateTitle}>{title}</h2>
      </div>
    </div>
  );
}

export function EmptyTableShell({
  title = 'No records found',
  children,
}: TableStateProps) {
  return (
    <div className={styles.state}>
      <div className={styles.stateContent}>
        <h2 className={styles.stateTitle}>{title}</h2>
        {children && <div className={styles.stateBody}>{children}</div>}
      </div>
    </div>
  );
}
