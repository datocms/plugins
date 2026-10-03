import { useCallback, useState } from 'react';
import {
  type DuplicationStats,
  initialDuplicationStats,
} from '../services/duplicationTypes';

export function useDuplicationStats() {
  const [stats, setStats] = useState<DuplicationStats>(initialDuplicationStats);
  const reset = useCallback(() => setStats(initialDuplicationStats()), []);
  return { stats, updateStats: setStats, reset };
}
