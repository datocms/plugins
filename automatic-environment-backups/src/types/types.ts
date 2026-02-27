export type LambdaConnectionStatus = "connected" | "disconnected";

export type LambdaConnectionPhase =
  | "finish_installation"
  | "config_mount"
  | "config_connect";

export type LambdaConnectionErrorCode =
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

export type ConnectionValidationMode = "health" | "legacy";

export type RuntimeMode = "lambda" | "lambdaless";

export type AutomaticBackupsScheduleState = {
  dailyLastRunDate?: string;
  weeklyLastRunKey?: string;
  lastDailyRunAt?: string;
  lastWeeklyRunAt?: string;
  lastDailyManagedEnvironmentId?: string;
  lastWeeklyManagedEnvironmentId?: string;
  lastDailyExecutionMode?: "lambdaless_on_boot";
  lastWeeklyExecutionMode?: "lambdaless_on_boot";
  lastDailyError?: string;
  lastWeeklyError?: string;
};

export type LambdaSchedulerProvider =
  | "vercel"
  | "netlify"
  | "cloudflare"
  | "unknown";

export type LambdaSchedulerCadence = "hourly" | "daily";

export type LambdaBackupStatusSlot = {
  scope: "daily" | "weekly";
  executionMode: "lambda_cron";
  lastBackupAt: string | null;
  nextBackupAt: string | null;
};

export type LambdaBackupStatus = {
  scheduler: {
    provider: LambdaSchedulerProvider;
    cadence: LambdaSchedulerCadence;
  };
  slots: {
    daily: LambdaBackupStatusSlot;
    weekly: LambdaBackupStatusSlot;
  };
  checkedAt: string;
};

export type BackupOverviewRow = {
  scope: "daily" | "weekly";
  lastBackup: string;
  nextBackup: string;
  source: string;
  sourceDetails?: string;
};
