import { ProgressOverlay } from '@/components/ProgressOverlay';
import type {
  LongTaskProgress,
  LongTaskState,
  UseLongTaskResult,
} from '@/shared/tasks/useLongTask';

// Adapter that presents a running `useLongTask` instance inside the shared modal overlay UI
// used throughout the import/export flows.

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
 * Convenience wrapper over the shared modal overlay component so long-running imports and
 * exports surface consistent progress UI. Callers pass their `useLongTask` handle plus
 * lightweight callbacks for dynamic subtitles, labels, or cancel behavior.
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
    // The overlay only renders while the task is active; once it resolves the modal
    // disappears so the page can show completion state instead.
    return null;
  }

  const state = task.state;
  const progress = state.progress;
  // Subtitle/label hooks let the overlay speak to the current step (eg "Fetching records")
  // without duplicating formatting logic where the task is started.
  const resolvedSubtitle =
    typeof subtitle === 'function' ? subtitle(state) : subtitle;
  const label = progressLabel ? progressLabel(progress, state) : progress.label;
  const cancelProps = cancel?.(state);

  return (
    <ProgressOverlay
      // Renders a blocking modal overlay with title/subtitle and animated progress bar so
      // users see the live status for long-running exports/imports.
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
