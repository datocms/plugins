import { Button } from 'datocms-react-ui';
import type { PropsWithChildren } from 'react';
import ProgressStallNotice from './ProgressStallNotice';

type CancelProps = {
  label: string;
  intent?: 'negative' | 'muted';
  disabled?: boolean;
  onCancel: () => void;
  size?: 's' | 'm';
};

type ProgressData = {
  label?: string;
  done?: number;
  total?: number;
  percentOverride?: number;
};

type Props = {
  title: string;
  subtitle?: string;
  progress: ProgressData;
  stallCurrent?: number | undefined;
  ariaLabel: string;
  cancel?: CancelProps;
  overlayZIndex?: number;
};

// Ensure the progress bar always renders with a minimal width when progress is unknown.
function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.1;
  return Math.min(1, Math.max(0, value));
}

function resolvePercent(progress: ProgressData): number {
  if (typeof progress.percentOverride === 'number') {
    return clampPercent(progress.percentOverride);
  }
  if (
    typeof progress.done === 'number' &&
    typeof progress.total === 'number' &&
    progress.total > 0
  ) {
    return clampPercent(progress.done / progress.total);
  }
  return 0.1;
}

/**
 * Fullscreen overlay that shows a determinate progress bar, optional stall warning,
 * and cancel affordance while long-running tasks execute.
 */
export function ProgressOverlay({
  title,
  subtitle,
  progress,
  stallCurrent,
  ariaLabel,
  cancel,
  overlayZIndex = 9999,
}: PropsWithChildren<Props>) {
  const percent = resolvePercent(progress);
  const totalText =
    typeof progress.total === 'number' && progress.total > 0
      ? `${progress.done ?? 0} / ${progress.total}`
      : '';

  return (
    <div
      className="progress-overlay"
      style={{ zIndex: overlayZIndex }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="export-overlay__card">
        <div className="export-overlay__title">{title}</div>
        {subtitle ? (
          <div className="export-overlay__subtitle">{subtitle}</div>
        ) : null}

        <div
          className="export-overlay__bar"
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={
            typeof progress.total === 'number' && progress.total > 0
              ? progress.total
              : undefined
          }
          aria-valuenow={
            typeof progress.total === 'number' && progress.total > 0
              ? progress.done
              : undefined
          }
        >
          <div
            className="export-overlay__bar__fill"
            style={{ width: `${Math.round(percent * 100)}%` }}
          />
        </div>
        <div className="export-overlay__meta">
          <div>{progress.label ?? ''}</div>
          <div>{totalText}</div>
        </div>
        <ProgressStallNotice current={stallCurrent} />
        {cancel ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginTop: 12,
            }}
          >
            <Button
              buttonSize={cancel.size ?? 's'}
              buttonType={cancel.intent ?? 'negative'}
              disabled={cancel.disabled}
              onClick={cancel.onCancel}
            >
              {cancel.label}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
