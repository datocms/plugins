import {
  faCircleExclamation,
  faCircleInfo,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import styles from './Callout.module.css';

export type CalloutTone = 'info' | 'warning' | 'danger' | 'neutral';

const ICONS = {
  info: faCircleInfo,
  neutral: faCircleInfo,
  warning: faTriangleExclamation,
  danger: faCircleExclamation,
};

type Props = {
  tone: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Small soft buttons at the right (stacked under the text when narrow). */
  actions?: ReactNode;
  /** `alert` for errors the user must notice; `status` for passive notices. */
  role?: 'alert' | 'status';
  className?: string;
};

/**
 * A compact soft-tone callout (design language "Soft-tone callouts", tightened
 * for field editors and modals): one tone context for surface, border and ink.
 */
export default function Callout({
  tone,
  title,
  children,
  actions,
  role,
  className,
}: Props) {
  return (
    <div
      className={[styles.callout, styles[tone], className]
        .filter(Boolean)
        .join(' ')}
      role={role}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon icon={ICONS[tone]} className="dl-icon--current" />
      </span>
      <div className={styles.body}>
        {title && <div className={styles.title}>{title}</div>}
        {children}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
