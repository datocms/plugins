import type { ReactNode } from 'react';
import styles from './InstallationSection.module.css';

type InstallationSectionProps = {
  children: ReactNode;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

const ChevronGlyph = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={styles.chevron}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** Collapsed home for the completed installation flow. */
export const InstallationSection = ({
  children,
  isOpen,
  onOpenChange,
}: InstallationSectionProps) => (
  <details
    className={styles.section}
    open={isOpen}
    onToggle={(event) => onOpenChange(event.currentTarget.open)}
  >
    <summary className={styles.summary}>
      <span className={styles.summaryCopy}>
        <strong>Installation</strong>
        <span>Setup complete</span>
      </span>
      <ChevronGlyph />
    </summary>
    <div className={styles.body}>{children}</div>
  </details>
);
