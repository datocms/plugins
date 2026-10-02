import { useEffect, useState } from 'react';

/**
 * Follows `flag`, but turns on only after `delayMs` and off instantly. Used
 * to lock secondary controls during short busy phases without flicker: a
 * phase that ends before the delay never disables them.
 */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!flag) {
      setDelayed(false);
      return;
    }
    const timeout = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [flag, delayMs]);

  return flag && delayed;
}
