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
