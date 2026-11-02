import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import type { CheckStatus } from '../types';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

type StatusMeta = {
  label: string;
  tone: StatusTone;
};

/**
 * Each result as a word with the tone of its dot: red for what is broken,
 * amber for what couldn't be verified, green for a working link, grey for
 * what wasn't checked or needs no check.
 */
export const STATUS_META: Record<CheckStatus, StatusMeta> = {
  broken: { label: 'Broken', tone: 'danger' },
  invalid: { label: 'Invalid', tone: 'danger' },
  unverified: { label: 'Unverified', tone: 'warning' },
  cancelled: { label: 'Not checked', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'neutral' },
  checking: { label: 'Checking', tone: 'neutral' },
  queued: { label: 'Pending', tone: 'neutral' },
  reachable: { label: 'Working', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

/** A check result: the dot and its word (the dot never stands alone). */
export function LogStatus({ status }: { status: CheckStatus }) {
  const { label, tone } = STATUS_META[status];
  return (
    <span>
      <FeedbackDot tone={tone} /> {label}
    </span>
  );
}
