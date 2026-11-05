import { traceHasProjectActivity } from './activityPresentation';
import type { ProcessTrace } from './processTrace';

export type ActivityOpenMode = 'auto' | 'manual-open' | 'manual-closed';

export const ACTIVITY_AUTO_OPEN_DELAY_MS = 2000;
export const ACTIVITY_AUTO_COLLAPSE_DELAY_MS = 1500;

/**
 * The activity opens by itself only while its turn runs: a turn that waits,
 * failed or stopped has its card or its message below, which tells it
 */
export function shouldDisplayActivityOpen(
  trace: ProcessTrace | undefined,
  mode: ActivityOpenMode | undefined,
): boolean {
  if (!trace) return false;
  return mode === 'manual-open' || mode === 'auto';
}

export function shouldAutoOpenActivity(
  trace: ProcessTrace | undefined,
  now = Date.now(),
): boolean {
  if (!trace || trace.status !== 'running') return false;
  if (traceHasProjectActivity(trace)) return true;
  return now - trace.startedAt >= ACTIVITY_AUTO_OPEN_DELAY_MS;
}
