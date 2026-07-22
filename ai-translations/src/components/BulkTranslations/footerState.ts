import type { RunStatus } from './pauseController';

export interface FooterPrimary {
  /** Whether the primary (Close) button should be rendered. */
  isVisible: boolean;
  /** The button label. */
  label: string;
  /** Whether the button is disabled. */
  isDisabled: boolean;
}

/**
 * Resolves the footer's primary (Close) button for a given run status. The
 * button is hidden entirely while the run is in progress: a disabled
 * "Please wait…" duplicates the Cancel affordance and reads as a dead control.
 * It appears — always labelled "Close" — only once the run is terminal
 * (completed or cancelled), and is disabled while a post-run publish is
 * in flight.
 */
export function footerPrimary(
  status: RunStatus,
  opts: { isPublishing: boolean },
): FooterPrimary {
  const isProcessing = status.kind === 'running' || status.kind === 'paused';
  return {
    isVisible: !isProcessing,
    label: 'Close',
    isDisabled: opts.isPublishing,
  };
}
