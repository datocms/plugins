import { formatDistanceStrict } from "date-fns";
import {
  AutomaticBackupsScheduleState,
  BackupCadence,
  BackupOverviewRow,
  BackupScheduleConfig,
  LambdaBackupStatus,
  RuntimeMode,
} from "../types/types";
import {
  getLastRunLocalDateForCadence,
  getNextDueLocalDate,
  isCadenceDueNow,
  toLocalDateKey,
  toUtcDateFromLocalDateKey,
} from "./backupSchedule";
import { MANAGED_BACKUP_ENVIRONMENT_IDS } from "./lambdaLessBackup";

type BuildBackupOverviewRowsInput = {
  runtimeMode: RuntimeMode;
  scheduleState: AutomaticBackupsScheduleState;
  scheduleConfig: BackupScheduleConfig;
  lambdaStatus?: LambdaBackupStatus;
  now?: Date;
};

const formatRelativeDateTime = (
  value: Date | string | undefined,
  now: Date,
): string => {
  if (!value) {
    return "Never";
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unavailable";
  }

  return formatDistanceStrict(parsedDate, now, { addSuffix: true });
};

const getCadencePrefix = (cadence: BackupCadence): string => {
  if (cadence === "daily") {
    return "backup-plugin-daily";
  }
  if (cadence === "weekly") {
    return "backup-plugin-weekly";
  }
  if (cadence === "biweekly") {
    return "backup-plugin-biweekly";
  }
  return "backup-plugin-monthly";
};

const toLambdaEnvironmentName = (
  cadence: BackupCadence,
  lastBackupAt: string | null,
): string => {
  const prefix = getCadencePrefix(cadence);
  if (!lastBackupAt) {
    return `${prefix}-*`;
  }

  const parsed = new Date(lastBackupAt);
  if (Number.isNaN(parsed.getTime())) {
    return `${prefix}-*`;
  }

  return `${prefix}-${parsed.toISOString().slice(0, 10)}`;
};

const toLastRunAtForCadence = (
  cadence: BackupCadence,
  scheduleState: AutomaticBackupsScheduleState,
): string | undefined => {
  const fromMap = scheduleState.lastRunAtByCadence?.[cadence];
  if (typeof fromMap === "string" && fromMap.trim()) {
    return fromMap;
  }

  if (cadence === "daily") {
    return scheduleState.lastDailyRunAt;
  }
  if (cadence === "weekly") {
    return scheduleState.lastWeeklyRunAt;
  }

  return undefined;
};

const toManagedEnvironmentIdForCadence = (
  cadence: BackupCadence,
  scheduleState: AutomaticBackupsScheduleState,
): string | undefined => {
  const fromMap = scheduleState.lastManagedEnvironmentIdByCadence?.[cadence];
  if (typeof fromMap === "string" && fromMap.trim()) {
    return fromMap;
  }

  if (cadence === "daily") {
    return scheduleState.lastDailyManagedEnvironmentId;
  }
  if (cadence === "weekly") {
    return scheduleState.lastWeeklyManagedEnvironmentId;
  }

  return undefined;
};

const buildLambdalessRows = (
  scheduleState: AutomaticBackupsScheduleState,
  scheduleConfig: BackupScheduleConfig,
  now: Date,
): BackupOverviewRow[] => {
  const localDateNow = toLocalDateKey(now, scheduleConfig.timezone);

  return scheduleConfig.enabledCadences.map((cadence) => {
    const lastRunAt = toLastRunAtForCadence(cadence, scheduleState);
    const lastRunLocalDate = getLastRunLocalDateForCadence({
      scheduleState,
      cadence,
      now,
    });
    const dueNow = isCadenceDueNow({
      cadence,
      anchorLocalDate: scheduleConfig.anchorLocalDate,
      currentLocalDate: localDateNow,
      lastRunLocalDate,
    });
    const nextDueLocalDate = dueNow
      ? localDateNow
      : getNextDueLocalDate({
          cadence,
          anchorLocalDate: scheduleConfig.anchorLocalDate,
          currentLocalDate: localDateNow,
          lastRunLocalDate,
        });
    const nextDueDate = toUtcDateFromLocalDateKey(nextDueLocalDate);
    const nextBackup = dueNow
      ? "Due now (on next dashboard login)"
      : nextDueDate
        ? `${formatRelativeDateTime(nextDueDate, now)} (on next dashboard login)`
        : "Unavailable";
    const managedEnvironmentId = toManagedEnvironmentIdForCadence(cadence, scheduleState);

    return {
      scope: cadence,
      lastBackup: formatRelativeDateTime(lastRunAt, now),
      nextBackup,
      environmentName: lastRunAt
        ? managedEnvironmentId ?? MANAGED_BACKUP_ENVIRONMENT_IDS[cadence]
        : "Not yet created",
      environmentLinked: Boolean(lastRunAt),
    };
  });
};

const buildLambdaRows = (
  lambdaStatus: LambdaBackupStatus | undefined,
  scheduleConfig: BackupScheduleConfig,
  now: Date,
): BackupOverviewRow[] => {
  return scheduleConfig.enabledCadences.map((cadence) => {
    const slot = lambdaStatus?.slots[cadence];
    if (!slot) {
      return {
        scope: cadence,
        lastBackup: "Unavailable",
        nextBackup: "Unavailable",
        environmentName: "Not yet created",
        environmentLinked: false,
      };
    }

    return {
      scope: cadence,
      lastBackup: slot.lastBackupAt
        ? formatRelativeDateTime(slot.lastBackupAt, now)
        : "Never",
      nextBackup: slot.nextBackupAt
        ? formatRelativeDateTime(slot.nextBackupAt, now)
        : "Unavailable",
      environmentName: slot.lastBackupAt
        ? toLambdaEnvironmentName(cadence, slot.lastBackupAt)
        : "Not yet created",
      environmentLinked: Boolean(slot.lastBackupAt),
    };
  });
};

export const buildBackupOverviewRows = ({
  runtimeMode,
  scheduleState,
  scheduleConfig,
  lambdaStatus,
  now = new Date(),
}: BuildBackupOverviewRowsInput): BackupOverviewRow[] => {
  if (runtimeMode === "lambda") {
    return buildLambdaRows(lambdaStatus, scheduleConfig, now);
  }

  return buildLambdalessRows(scheduleState, scheduleConfig, now);
};
