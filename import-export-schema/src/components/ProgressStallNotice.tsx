import Callout from 'datocms-react-ui/Callout';
import { useEffect, useRef, useState } from 'react';

type Props = {
  // Current completed unit (eg. done/finished). Pass undefined to disable.
  current: number | undefined;
  // Minimum time without progress before showing the notice.
  thresholdMs?: number;
  // The message, which names the task. The default is for an export.
  message?: string;
};

/**
 * A neutral callout when a long task shows no progress for a while, once it
 * has made some progress (the first idle period is not a stall). The pause
 * ends by itself: it is information, not a problem.
 */
export default function ProgressStallNotice({
  current,
  thresholdMs = 8000,
  message = 'DatoCMS is slowing things down for a moment. The export continues on its own.',
}: Props) {
  const [stalled, setStalled] = useState(false);
  const lastValueRef = useRef<number | undefined>(undefined);
  const lastChangeAtRef = useRef<number | undefined>(undefined);
  const hasStartedRef = useRef(false);

  // Track progress changes
  useEffect(() => {
    if (typeof current !== 'number') {
      // Reset when disabled/hidden
      lastValueRef.current = undefined;
      lastChangeAtRef.current = undefined;
      hasStartedRef.current = false;
      setStalled(false);
      return;
    }

    if (lastValueRef.current !== current) {
      lastValueRef.current = current;
      lastChangeAtRef.current = Date.now();
      if (current > 0) {
        hasStartedRef.current = true;
      }
      // Any change clears a stall
      setStalled(false);
    }
  }, [current]);

  // Timer to detect stalls
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!hasStartedRef.current) return; // don't warn before any real progress
      if (typeof lastChangeAtRef.current !== 'number') return;
      const since = Date.now() - lastChangeAtRef.current;
      if (since >= thresholdMs) {
        setStalled(true);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [thresholdMs]);

  if (!stalled) return null;

  return <Callout>{message}</Callout>;
}
