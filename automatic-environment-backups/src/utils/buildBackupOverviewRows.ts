import {
  AutomaticBackupsScheduleState,
  BackupOverviewRow,
  LambdaBackupStatus,
  RuntimeMode,
} from "../types/types";
import { MANAGED_BACKUP_ENVIRONMENT_IDS } from "./lambdaLessBackup";

type BuildBackupOverviewRowsInput = {
  runtimeMode: RuntimeMode;
  scheduleState: AutomaticBackupsScheduleState;
  lambdaStatus?: LambdaBackupStatus;
  now?: Date;
};

const formatUtcDateTime = (value: Date | string | undefined): string => {
  if (!value) {
    return "Never";
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unavailable";
  }

  return `${parsedDate.toISOString().slice(0, 19).replace("T", " ")} UTC`;
};

const getNextUtcDayStart = (now: Date): Date => {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
};

const getNextUtcIsoWeekStart = (now: Date): Date => {
  const currentWeekday = now.getUTCDay() || 7;
  const daysUntilNextMonday = 8 - currentWeekday;
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysUntilNextMonday,
      0,
      0,
      0,
      0,
    ),
  );
};

const toUtcDateKey = (date: Date): string => date.toISOString().split("T")[0];

const toUtcIsoWeekKey = (date: Date): string => {
  const workingDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = workingDate.getUTCDay() || 7;
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((workingDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${workingDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const buildLambdalessRows = (
  scheduleState: AutomaticBackupsScheduleState,
  now: Date,
): BackupOverviewRow[] => {
  const currentDateKey = toUtcDateKey(now);
  const currentWeekKey = toUtcIsoWeekKey(now);
  const dailyIsDueNow = scheduleState.dailyLastRunDate !== currentDateKey;
  const weeklyIsDueNow = scheduleState.weeklyLastRunKey !== currentWeekKey;

  const dailyNext = dailyIsDueNow
    ? "Due now (on next dashboard login)"
    : `${formatUtcDateTime(getNextUtcDayStart(now))} (on next dashboard login)`;
  const weeklyNext = weeklyIsDueNow
    ? "Due now (on next dashboard login)"
    : `${formatUtcDateTime(getNextUtcIsoWeekStart(now))} (on next dashboard login)`;

  return [
    {
      scope: "daily",
      lastBackup: formatUtcDateTime(scheduleState.lastDailyRunAt),
      nextBackup: dailyNext,
      source: "Lambdaless on boot",
      sourceDetails: `Managed env: ${
        scheduleState.lastDailyManagedEnvironmentId ??
        MANAGED_BACKUP_ENVIRONMENT_IDS.daily
      }`,
    },
    {
      scope: "weekly",
      lastBackup: formatUtcDateTime(scheduleState.lastWeeklyRunAt),
      nextBackup: weeklyNext,
      source: "Lambdaless on boot",
      sourceDetails: `Managed env: ${
        scheduleState.lastWeeklyManagedEnvironmentId ??
        MANAGED_BACKUP_ENVIRONMENT_IDS.weekly
      }`,
    },
  ];
};

const toTitleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

const buildLambdaRows = (
  lambdaStatus: LambdaBackupStatus | undefined,
): BackupOverviewRow[] => {
  if (!lambdaStatus) {
    return [
      {
        scope: "daily",
        lastBackup: "Unavailable",
        nextBackup: "Unavailable",
        source: "Cronjobs (Lambda)",
        sourceDetails: "Connect a healthy Lambda URL to load status.",
      },
      {
        scope: "weekly",
        lastBackup: "Unavailable",
        nextBackup: "Unavailable",
        source: "Cronjobs (Lambda)",
        sourceDetails: "Connect a healthy Lambda URL to load status.",
      },
    ];
  }

  const sourceDetails = `Provider: ${toTitleCase(
    lambdaStatus.scheduler.provider,
  )} | Cadence: ${lambdaStatus.scheduler.cadence}`;

  return [
    {
      scope: "daily",
      lastBackup: lambdaStatus.slots.daily.lastBackupAt
        ? formatUtcDateTime(lambdaStatus.slots.daily.lastBackupAt)
        : "Never",
      nextBackup: lambdaStatus.slots.daily.nextBackupAt
        ? formatUtcDateTime(lambdaStatus.slots.daily.nextBackupAt)
        : "Unavailable",
      source: "Cronjobs (Lambda)",
      sourceDetails,
    },
    {
      scope: "weekly",
      lastBackup: lambdaStatus.slots.weekly.lastBackupAt
        ? formatUtcDateTime(lambdaStatus.slots.weekly.lastBackupAt)
        : "Never",
      nextBackup: lambdaStatus.slots.weekly.nextBackupAt
        ? formatUtcDateTime(lambdaStatus.slots.weekly.nextBackupAt)
        : "Unavailable",
      source: "Cronjobs (Lambda)",
      sourceDetails,
    },
  ];
};

export const buildBackupOverviewRows = ({
  runtimeMode,
  scheduleState,
  lambdaStatus,
  now = new Date(),
}: BuildBackupOverviewRowsInput): BackupOverviewRow[] => {
  if (runtimeMode === "lambda") {
    return buildLambdaRows(lambdaStatus);
  }

  return buildLambdalessRows(scheduleState, now);
};
