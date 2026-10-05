import { useEffect, useMemo, useState } from 'react';
import { arrangeByKeys } from '../../lib/fieldValue';

/**
 * Shows a new order right after a drag, before the host sends the saved
 * value back. The optimistic order is dropped once the saved order matches it
 * (or the entries changed underneath), and `setOrder(null)` rolls it back.
 */
export function useOptimisticOrder<T extends { key: string }>(
  saved: readonly T[],
): { ordered: readonly T[]; setOrder: (keys: string[] | null) => void } {
  const [keys, setOrder] = useState<string[] | null>(null);
  const arranged = useMemo(() => arrangeByKeys(saved, keys), [saved, keys]);
  const savedOrder = saved.map((entry) => entry.key).join('\n');

  useEffect(() => {
    if (!keys) return;
    if (!arranged || savedOrder === keys.join('\n')) {
      setOrder(null);
    }
  }, [arranged, keys, savedOrder]);

  return { ordered: arranged ?? saved, setOrder };
}
