import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import styles from './WarningNote.module.css';

/**
 * A rare caveat under a control (design language forms §1, "Warning note"):
 * a 5px warning rule, a triangle and one line of text.
 */
export default function WarningNote({
  id,
  children,
}: {
  /** Lets the control it's about point at it with `aria-describedby`. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.note} role="status" id={id}>
      <Icon icon={faTriangleExclamation} className={styles.icon} />
      {children}
    </div>
  );
}
