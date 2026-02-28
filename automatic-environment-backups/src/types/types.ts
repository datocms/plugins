export type LambdaConnectionStatus = "connected" | "disconnected";

export type LambdaConnectionPhase =
  | "finish_installation"
  | "config_mount"
  | "config_connect";

export type LambdaConnectionErrorCode =
  | "MISSING_AUTH_SECRET"
  | "INVALID_URL"
  | "NETWORK"
  | "TIMEOUT"
  | "HTTP"
  | "INVALID_JSON"
  | "UNEXPECTED_RESPONSE";

export type LambdaConnectionState = {
  status: LambdaConnectionStatus;
  endpoint: string;
  lastCheckedAt: string;
  lastCheckPhase: LambdaConnectionPhase;
  errorCode?: LambdaConnectionErrorCode;
  errorMessage?: string;
  httpStatus?: number;
  responseSnippet?: string;
};

export type ConnectionValidationMode = "health";

export type BackupCadence = "daily" | "weekly" | "biweekly" | "monthly";

export type BackupExecutionMode = "lambda_cron";

export type BackupScheduleConfig = {
  version: 1;
  enabledCadences: BackupCadence[];
  timezone: string;
  anchorLocalDate: string;
  updatedAt: string;
};

export type AutomaticBackupsScheduleState = {
  lastRunLocalDateByCadence?: Partial<Record<BackupCadence, string>>;
  lastRunAtByCadence?: Partial<Record<BackupCadence, string>>;
  lastManagedEnvironmentIdByCadence?: Partial<Record<BackupCadence, string>>;
  lastExecutionModeByCadence?: Partial<Record<BackupCadence, BackupExecutionMode>>;
  lastErrorByCadence?: Partial<Record<BackupCadence, string>>;
  dailyLastRunDate?: string;
  weeklyLastRunKey?: string;
  lastDailyRunAt?: string;
  lastWeeklyRunAt?: string;
  lastDailyManagedEnvironmentId?: string;
  lastWeeklyManagedEnvironmentId?: string;
  lastDailyError?: string;
  lastWeeklyError?: string;
} & Record<string, unknown>;

export type LambdaSchedulerProvider =
  | "vercel"
  | "netlify"
  | "cloudflare"
  | "unknown";

export type LambdaSchedulerCadence = "hourly" | "daily";

export type LambdaBackupStatusSlot = {
  scope: BackupCadence;
  executionMode: "lambda_cron";
  lastBackupAt: string | null;
  nextBackupAt: string | null;
};

export type LambdaBackupStatus = {
  scheduler: {
    provider: LambdaSchedulerProvider;
    cadence: LambdaSchedulerCadence;
  };
  slots: Partial<Record<BackupCadence, LambdaBackupStatusSlot>> & {
    daily: LambdaBackupStatusSlot;
    weekly: LambdaBackupStatusSlot;
  };
  checkedAt: string;
};

export type BackupOverviewRow = {
  scope: BackupCadence;
  lastBackup: string;
  nextBackup: string;
  environmentName: string;
  environmentLinked: boolean;
  environmentStatusNote?: string;
};
