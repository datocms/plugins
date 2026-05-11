import { traceHasProjectActivity } from './activityPresentation';
import type { ProcessTrace } from './processTrace';

export type ActivityOpenMode = 'auto' | 'manual-open' | 'manual-closed';

export const ACTIVITY_AUTO_OPEN_DELAY_MS = 2000;
export const ACTIVITY_AUTO_COLLAPSE_DELAY_MS = 1500;

export function shouldDisplayActivityOpen(
  trace: ProcessTrace | undefined,
  mode: ActivityOpenMode | undefined,
): boolean {
  if (!trace) return false;
  if (mode === 'manual-open' || mode === 'auto') return true;
  if (mode === 'manual-closed') return false;
  return trace.status === 'waiting' || trace.status === 'failed' || trace.status === 'interrupted';
}

export function shouldAutoOpenActivity(
  trace: ProcessTrace | undefined,
  now = Date.now(),
): boolean {
  if (!trace || trace.status !== 'running') return false;
  if (traceHasProjectActivity(trace)) return true;
  return now - trace.startedAt >= ACTIVITY_AUTO_OPEN_DELAY_MS;
}

export function shouldForceOpenActivity(trace: ProcessTrace | undefined): boolean {
  return Boolean(
    trace &&
      (trace.status === 'waiting' ||
        trace.status === 'failed' ||
        trace.status === 'interrupted'),
  );
}
