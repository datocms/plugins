import { ProgressOverlay } from '@/components/ProgressOverlay';
import type {
  LongTaskProgress,
  LongTaskState,
  UseLongTaskResult,
} from '@/shared/tasks/useLongTask';

type CancelOptions = {
  label: string;
  onCancel: () => void | Promise<void>;
  intent?: 'negative' | 'muted';
  disabled?: boolean;
};

export type TaskProgressOverlayProps = {
  task: UseLongTaskResult;
  title: string;
  subtitle: string | ((state: LongTaskState) => string);
  ariaLabel: string;
  overlayZIndex?: number;
  progressLabel?: (progress: LongTaskProgress, state: LongTaskState) => string;
  percentOverride?: number;
  cancel?: (state: LongTaskState) => CancelOptions | undefined;
};

/**
 * Convenience wrapper over `ProgressOverlay` that wires up a `useLongTask` instance and
 * allows callers to customize messaging via small callbacks.
 */
export function TaskProgressOverlay({
  task,
  title,
  subtitle,
  ariaLabel,
  overlayZIndex,
  progressLabel,
  percentOverride,
  cancel,
}: TaskProgressOverlayProps) {
  if (task.state.status !== 'running') {
    return null;
  }

  const state = task.state;
  const progress = state.progress;
  const resolvedSubtitle =
    typeof subtitle === 'function' ? subtitle(state) : subtitle;
  const label = progressLabel ? progressLabel(progress, state) : progress.label;
  const cancelProps = cancel?.(state);

  return (
    <ProgressOverlay
      title={title}
      subtitle={resolvedSubtitle}
      ariaLabel={ariaLabel}
      overlayZIndex={overlayZIndex}
      progress={{
        label,
        done: progress.done,
        total: progress.total,
        percentOverride,
      }}
      stallCurrent={progress.done}
      cancel={cancelProps}
    />
  );
}
