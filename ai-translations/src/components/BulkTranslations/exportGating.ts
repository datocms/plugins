import type { RunStatus } from './pauseController';

/**
 * Export is offered only once the run reaches a terminal state. A paused run is
 * not a stopped run: exporting mid-pause would hand the user a CSV that looks
 * like a finished report but omits everything after the pause point.
 *
 * @param status - The run's current status.
 * @param processedCount - How many records have produced a report row.
 * @returns True when the Export button should be clickable.
 */
export const isExportEnabled = (
  status: RunStatus,
  processedCount: number,
): boolean =>
  processedCount > 0 &&
  (status.kind === 'completed' || status.kind === 'cancelled');

/**
 * Whether the Export button should be RENDERED at all. It is offered only once
 * the run is terminal — showing a greyed-out Export mid-run (the previous
 * behaviour) just clutters the footer with a dead control. Distinct from
 * {@link isExportEnabled}, which governs the clickable/disabled state of a
 * terminal-but-empty run (cancelled before any record produced a row).
 */
export const isExportVisible = (status: RunStatus): boolean =>
  status.kind === 'completed' || status.kind === 'cancelled';
