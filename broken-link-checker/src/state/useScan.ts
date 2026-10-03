import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckQueue } from '../checking/queue';
import type { LinkGroup, ScanReport } from '../types';
import { updateGroup } from './group';
import { errorMessage, ScanSession } from './session';

export type ScanProducer = (
  session: ScanSession,
  signal: AbortSignal,
) => Promise<void>;

/** Let cancellation finish the UI even if an SDK request cannot be aborted. */
async function produceUntilCancelled(
  producer: ScanProducer,
  session: ScanSession,
  signal: AbortSignal,
): Promise<void> {
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<void>((resolve) => {
    onAbort = resolve;
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) resolve();
  });
  try {
    await Promise.race([
      Promise.resolve().then(() => {
        if (!signal.aborted) return producer(session, signal);
      }),
      cancelled,
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function recheckState(
  report: ScanReport,
  originalState: ScanReport['state'],
  cancelled: boolean,
): ScanReport['state'] {
  if (cancelled || originalState === 'cancelled') return 'cancelled';
  if (
    originalState !== 'complete' ||
    report.warnings.length > 0 ||
    report.groups.some((group) => group.result.status === 'cancelled')
  )
    return 'partial';
  return 'complete';
}

export function useScan(contextKey: string) {
  const [report, setReport] = useState<ScanReport>();
  const currentReport = useRef<ScanReport | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const activeSession = useRef<ScanSession | undefined>(undefined);
  const generation = useRef(0);
  const staleRecords = useRef(new Set<string>());
  const allStale = useRef(false);
  const originalState = useRef<ScanReport['state']>('running');

  const publish = useCallback((next: ScanReport | undefined) => {
    currentReport.current = next;
    setReport(next);
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = undefined;
    activeSession.current?.dispose();
    activeSession.current = undefined;
  }, []);

  // An environment or identity change must not retain another context's report.
  useEffect(() => {
    void contextKey;
    invalidate();
    staleRecords.current.clear();
    allStale.current = false;
    originalState.current = 'running';
    publish(undefined);
    return invalidate;
  }, [contextKey, invalidate, publish]);

  const start = useCallback(
    async (scope: string, producer: ScanProducer) => {
      invalidate();
      const run = generation.current;
      const abort = new AbortController();
      controller.current = abort;
      staleRecords.current.clear();
      allStale.current = false;
      originalState.current = 'running';
      const session = new ScanSession(scope, abort.signal, (next) => {
        if (run !== generation.current) return;
        if (next.state !== 'running') originalState.current = next.state;
        publish({
          ...next,
          stale: allStale.current || staleRecords.current.size > 0,
        });
      });
      activeSession.current = session;
      session.flush();
      try {
        await produceUntilCancelled(producer, session, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) session.warn(errorMessage(error));
      } finally {
        await session.finish();
        session.dispose();
        if (activeSession.current === session)
          activeSession.current = undefined;
        if (controller.current === abort) controller.current = undefined;
      }
    },
    [invalidate, publish],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  const markStale = useCallback(
    (recordId?: string) => {
      if (recordId) staleRecords.current.add(recordId);
      else allStale.current = true;
      if (activeSession.current) {
        activeSession.current.markStale(recordId);
        return;
      }
      const previous = currentReport.current;
      if (!previous) return;
      publish({
        ...previous,
        stale: true,
        groups: previous.groups.map((group) => {
          const stale =
            group.stale ||
            !recordId ||
            group.occurrences.some(
              (occurrence) => occurrence.recordId === recordId,
            );
          return stale === group.stale ? group : updateGroup(group, { stale });
        }),
      });
    },
    [publish],
  );

  const recheck = useCallback(
    async (group: LinkGroup) => {
      const previous = currentReport.current;
      const target = previous?.groups.find((entry) => entry.key === group.key);
      if (
        !previous ||
        previous.state === 'running' ||
        target?.prepared.status !== 'queued'
      )
        return;
      invalidate();
      const run = generation.current;
      const abort = new AbortController();
      controller.current = abort;
      const completion = originalState.current;
      publish({
        ...previous,
        state: 'running',
        discovering: false,
        finishedAt: undefined,
      });
      const queue = new CheckQueue({
        signal: abort.signal,
        onResult: (result) => {
          const current = currentReport.current;
          if (run !== generation.current || !current) return;
          publish({
            ...current,
            groups: current.groups.map((entry) =>
              entry.key === target.key ? updateGroup(entry, { result }) : entry,
            ),
          });
        },
      });
      queue.enqueue(target.prepared);
      await queue.drain();
      const current = currentReport.current;
      if (run !== generation.current || !current) return;
      publish({
        ...current,
        state: recheckState(current, completion, abort.signal.aborted),
        finishedAt: new Date().toISOString(),
      });
      if (controller.current === abort) controller.current = undefined;
    },
    [invalidate, publish],
  );

  return {
    report,
    running: report?.state === 'running',
    start,
    cancel,
    markStale,
    recheck,
  };
}
