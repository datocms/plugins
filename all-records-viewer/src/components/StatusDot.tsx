import type { PublicationStatus } from '../types';
import styles from './StatusDot.module.css';

export type StatusDotProps = {
  status: PublicationStatus | 'new';
};

export function StatusDot({ status }: StatusDotProps) {
  const modifier = status === 'new' ? 'draft' : status;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className={`${styles.dot} ${styles[modifier]}`}
    >
      <circle cx="50" cy="50" r="45" />
    </svg>
  );
}
