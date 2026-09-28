import { useRef } from 'react';
import type { ScanReport } from '../types';

export type SettledScan = {
  state: ScanReport['state'];
  finishedAt?: string;
};

type SettledEntry = SettledScan & { startedAt: string };

/**
 * The last settled state of the current report. A recheck publishes the report as
 * running and clears its finish time, so the summary keeps reading from here.
 */
export function useSettledScan(
  report: ScanReport | undefined,
): SettledScan | undefined {
  const settled = useRef<SettledEntry | undefined>(undefined);
  if (report && report.state !== 'running') {
    const previous = settled.current;
    if (!previous || previous.startedAt !== report.startedAt)
      settled.current = {
        startedAt: report.startedAt,
        state: report.state,
        finishedAt: report.finishedAt,
      };
    else if (previous.state !== report.state)
      // A recheck keeps the scan's own finish time.
      settled.current = { ...previous, state: report.state };
  }
  const current = settled.current;
  if (!report || !current || current.startedAt !== report.startedAt)
    return undefined;
  return { state: current.state, finishedAt: current.finishedAt };
}
