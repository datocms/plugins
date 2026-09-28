import {
  faCircleCheck,
  faCircleQuestion,
  faCircleStop,
  faHourglassHalf,
  type IconDefinition,
} from '@fortawesome/free-regular-svg-icons';
import {
  faArrowRightArrowLeft,
  faCircleExclamation,
  faCircleMinus,
  faShieldHalved,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { CheckStatus } from '../types';
import { Icon } from './Icon';

type StatusMeta = {
  label: string;
  icon: IconDefinition;
  className: string;
};

/**
 * Operational results as icon + word: only the icon carries the tone. Nothing
 * spins here: the scan summary's spinner is the page's one loading indicator.
 */
export const STATUS_META: Record<CheckStatus, StatusMeta> = {
  broken: {
    label: 'Broken',
    icon: faCircleExclamation,
    className: 'dl-log-status--failed',
  },
  invalid: {
    label: 'Invalid',
    icon: faTriangleExclamation,
    className: 'dl-log-status--failed',
  },
  unverified: {
    label: 'Unverified',
    icon: faCircleQuestion,
    className: 'blc-log-status--warning',
  },
  cancelled: {
    label: 'Not checked',
    icon: faCircleStop,
    className: 'blc-log-status--subtle',
  },
  blocked: {
    label: 'Blocked',
    icon: faShieldHalved,
    className: 'blc-log-status--subtle',
  },
  checking: {
    label: 'Checking',
    icon: faHourglassHalf,
    className: 'blc-log-status--subtle',
  },
  queued: {
    label: 'Pending',
    icon: faArrowRightArrowLeft,
    className: 'dl-log-status--pending',
  },
  reachable: {
    label: 'Reachable',
    icon: faCircleCheck,
    className: 'dl-log-status--success',
  },
  skipped: {
    label: 'Skipped',
    icon: faCircleMinus,
    className: '',
  },
};

export function LogStatus({ status }: { status: CheckStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={
        meta.className ? `dl-log-status ${meta.className}` : 'dl-log-status'
      }
    >
      <Icon icon={meta.icon} />
      {meta.label}
    </span>
  );
}
