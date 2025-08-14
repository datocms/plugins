import { useEffect, useRef, useState } from 'react';

type Props = {
  // Current completed unit (eg. done/finished). Pass undefined to disable.
  current: number | undefined;
  // Minimum time without progress before showing the notice.
  thresholdMs?: number;
  // Optional custom message.
  message?: string;
};

export default function ProgressStallNotice({
  current,
  thresholdMs = 8000,
  message = 'We made too many requests in a short time. Progress may look paused and should resume automatically in a few seconds.',
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

  return (
    <div className="rate-limit-notice" role="note" aria-live="polite">
      {message}
    </div>
  );
}
