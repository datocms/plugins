import { useCallback, useEffect, useState } from 'react';
import {
  ACTIVITY_AUTO_COLLAPSE_DELAY_MS,
  ACTIVITY_AUTO_OPEN_DELAY_MS,
  shouldAutoOpenActivity,
  shouldDisplayActivityOpen,
  shouldForceOpenActivity,
  type ActivityOpenMode,
} from '../lib/activityOpenState';
import type { ProcessTrace } from '../lib/processTrace';

type ActivityMessage = {
  id: string;
  process?: ProcessTrace;
};

export function useActivityTimeline(messages: ActivityMessage[]) {
  const [openModes, setOpenModes] = useState<Record<string, ActivityOpenMode>>(
    {},
  );

  useEffect(() => {
    const activeIds = new Set(messages.map((message) => message.id));

    setOpenModes((previous) => {
      let next = previous;
      const setNext = (id: string, mode: ActivityOpenMode | undefined) => {
        if (mode === undefined) {
          if (!(id in next)) return;
          next = { ...next };
          delete next[id];
          return;
        }
        if (next[id] === mode) return;
        next = { ...next, [id]: mode };
      };

      for (const id of Object.keys(previous)) {
        if (!activeIds.has(id)) setNext(id, undefined);
      }

      for (const message of messages) {
        const mode = next[message.id];
        if (mode === 'manual-open' || mode === 'manual-closed') continue;
        if (
          shouldForceOpenActivity(message.process) ||
          shouldAutoOpenActivity(message.process)
        ) {
          setNext(message.id, 'auto');
        }
      }

      return next;
    });
  }, [messages]);

  useEffect(() => {
    const timers: number[] = [];
    const now = Date.now();

    for (const message of messages) {
      const trace = message.process;
      if (!trace) continue;
      const mode = openModes[message.id];

      if (trace.status === 'running' && mode === undefined) {
        const delay = Math.max(0, trace.startedAt + ACTIVITY_AUTO_OPEN_DELAY_MS - now);
        timers.push(
          window.setTimeout(() => {
            setOpenModes((previous) => {
              if (previous[message.id] !== undefined) return previous;
              return { ...previous, [message.id]: 'auto' };
            });
          }, delay),
        );
      }

      if (trace.status === 'completed' && mode === 'auto') {
        timers.push(
          window.setTimeout(() => {
            setOpenModes((previous) => {
              if (previous[message.id] !== 'auto') return previous;
              const next = { ...previous };
              delete next[message.id];
              return next;
            });
          }, ACTIVITY_AUTO_COLLAPSE_DELAY_MS),
        );
      }
    }

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [messages, openModes]);

  const isActivityOpen = useCallback(
    (messageId: string, trace?: ProcessTrace) =>
      shouldDisplayActivityOpen(trace, openModes[messageId]),
    [openModes],
  );

  const toggleActivity = useCallback(
    (messageId: string, trace?: ProcessTrace) => {
      setOpenModes((previous) => {
        const open = shouldDisplayActivityOpen(trace, previous[messageId]);
        return {
          ...previous,
          [messageId]: open ? 'manual-closed' : 'manual-open',
        };
      });
    },
    [],
  );

  return { isActivityOpen, toggleActivity };
}
