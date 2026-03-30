import { useState, useCallback, useRef } from 'react';
import type { DuplicationStats } from '../components/SummaryView';

export function useDuplicationStats() {
  const initialStats: DuplicationStats = {
    totalModels: 0,
    totalRecords: 0,
    successfulRecords: 0,
    failedRecords: 0,
    modelStats: {},
    startTime: 0,
    endTime: 0
  };

  const [stats, setStats] = useState<DuplicationStats>(initialStats);
  const statsRef = useRef<DuplicationStats>(initialStats);

  const initializeStats = useCallback(() => {
    const newStats = {
      ...initialStats,
      startTime: Date.now()
    };
    setStats(newStats);
    statsRef.current = newStats;
  }, []);

  const addSuccess = useCallback((modelId: string, modelName: string, recordId: string) => {
    const updatedStats = {
      ...statsRef.current,
      successfulRecords: statsRef.current.successfulRecords + 1,
      totalRecords: statsRef.current.totalRecords + 1,
      modelStats: {
        ...statsRef.current.modelStats,
        [modelId]: {
          ...(statsRef.current.modelStats[modelId] || { success: 0, error: 0, total: 0, name: modelName, processedRecordIds: {} }),
          success: (statsRef.current.modelStats[modelId]?.success || 0) + 1,
          total: (statsRef.current.modelStats[modelId]?.total || 0) + 1,
          processedRecordIds: {
            ...(statsRef.current.modelStats[modelId]?.processedRecordIds || {}),
            [recordId]: true
          }
        }
      }
    };
    statsRef.current = updatedStats;
    setStats(updatedStats);
  }, []);

  const addFailure = useCallback((modelId: string, modelName: string, recordId: string) => {
    const updatedStats = {
      ...statsRef.current,
      failedRecords: statsRef.current.failedRecords + 1,
      totalRecords: statsRef.current.totalRecords + 1,
      modelStats: {
        ...statsRef.current.modelStats,
        [modelId]: {
          ...(statsRef.current.modelStats[modelId] || { success: 0, error: 0, total: 0, name: modelName, processedRecordIds: {} }),
          error: (statsRef.current.modelStats[modelId]?.error || 0) + 1,
          total: (statsRef.current.modelStats[modelId]?.total || 0) + 1,
          processedRecordIds: {
            ...(statsRef.current.modelStats[modelId]?.processedRecordIds || {}),
            [recordId]: true
          }
        }
      }
    };
    statsRef.current = updatedStats;
    setStats(updatedStats);
  }, []);

  const setModelCount = useCallback((count: number) => {
    const updatedStats = {
      ...statsRef.current,
      totalModels: count
    };
    statsRef.current = updatedStats;
    setStats(updatedStats);
  }, []);

  const finalizeStats = useCallback(() => {
    const updatedStats = {
      ...statsRef.current,
      endTime: Date.now()
    };
    statsRef.current = updatedStats;
    setStats(updatedStats);
    return updatedStats;
  }, []);

  const isRecordProcessed = useCallback((modelId: string, recordId: string): boolean => {
    return statsRef.current.modelStats[modelId]?.processedRecordIds[recordId] || false;
  }, []);

  const reset = useCallback(() => {
    setStats(initialStats);
    statsRef.current = initialStats;
  }, []);

  return {
    stats,
    statsRef,
    initializeStats,
    addSuccess,
    addFailure,
    setModelCount,
    finalizeStats,
    isRecordProcessed,
    reset
  };
}