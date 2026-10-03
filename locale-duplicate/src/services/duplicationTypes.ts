export interface ModelStats {
  name: string;
  success: number;
  error: number;
  total: number;
}

export interface DuplicationStats {
  totalModels: number;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  uncertainRecords: number;
  skippedRecords: number;
  publishedRecords: number;
  failedPublications: number;
  uncertainPublications: number;
  pendingPublications: number;
  modelFailures: number;
  totalToProcess: number;
  cancelled: boolean;
  modelStats: Record<string, ModelStats>;
  startTime: number;
  endTime: number;
}

export interface DuplicationProgress {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
  progress?: number;
  recordId?: string;
  modelId?: string;
  modelName?: string;
  stats?: DuplicationStats;
}

export function initialDuplicationStats(): DuplicationStats {
  return {
    totalModels: 0,
    totalRecords: 0,
    successfulRecords: 0,
    failedRecords: 0,
    uncertainRecords: 0,
    skippedRecords: 0,
    publishedRecords: 0,
    failedPublications: 0,
    uncertainPublications: 0,
    pendingPublications: 0,
    modelFailures: 0,
    totalToProcess: 0,
    cancelled: false,
    modelStats: {},
    startTime: 0,
    endTime: 0,
  };
}
