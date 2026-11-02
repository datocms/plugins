import { ProgressOverlay } from '@/components/ProgressOverlay';
import type {
  LongTaskProgress,
  LongTaskState,
  UseLongTaskResult,
} from '@/shared/tasks/useLongTask';

// Adapter that presents a running `useLongTask` instance inside the shared
// progress dialog used throughout the import/export flows.

type CancelOptions = {
  /** Stops the task, or asks first whether to stop it */
  onCancel: () => void | Promise<void>;
};

export type TaskProgressOverlayProps = {
  task: UseLongTaskResult;
  title: string;
  /** One line under the title, or a function of the state of the task */
  subtitle?: string | ((state: LongTaskState) => string | undefined);
  /** The name of the progress bar. The default is the title. */
  ariaLabel?: string;
  progressLabel?: (progress: LongTaskProgress, state: LongTaskState) => string;
  /** The notice of a pause in the progress. The default is for an export. */
  stallMessage?: string;
  /**
   * The cancel for the current state: the Cancel of the dialog. Return
   * undefined once a cancel is requested, and say so in the subtitle.
   */
  cancel?: (state: LongTaskState) => CancelOptions | undefined;
};

/**
 * The progress dialog of a `useLongTask`. It shows only while the task runs
 * or stops; the callbacks give the line, the label and the cancel for the
 * current state.
 */
export function TaskProgressOverlay({
  task,
  title,
  subtitle,
  ariaLabel,
  progressLabel,
  stallMessage,
  cancel,
}: TaskProgressOverlayProps) {
  if (task.state.status !== 'running' && task.state.status !== 'cancelling') {
    // The dialog shows only while the task is active; once it resolves it goes
    // away so the page can show the result.
    return null;
  }

  const state = task.state;
  const progress = state.progress;
  const resolvedSubtitle =
    typeof subtitle === 'function' ? subtitle(state) : subtitle;
  const label = progressLabel ? progressLabel(progress, state) : progress.label;

  return (
    <ProgressOverlay
      title={title}
      description={resolvedSubtitle}
      ariaLabel={ariaLabel}
      progress={{
        label,
        done: progress.done,
        total: progress.total,
      }}
      stallCurrent={progress.done}
      stallMessage={stallMessage}
      cancel={cancel?.(state)}
    />
  );
}
