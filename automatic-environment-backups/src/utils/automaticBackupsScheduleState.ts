import { AutomaticBackupsScheduleState, BackupCadence } from "../types/types";
import { BACKUP_CADENCES, isBackupCadence } from "./backupSchedule";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const toCadenceMap = (
  value: unknown,
): Partial<Record<BackupCadence, string>> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const next: Partial<Record<BackupCadence, string>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!BACKUP_CADENCES.includes(key as BackupCadence)) {
      continue;
    }

    const normalized = asOptionalString(entry);
    if (normalized) {
      next[key as BackupCadence] = normalized;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

export const toAutomaticBackupsScheduleState = (
  value: unknown,
): AutomaticBackupsScheduleState => {
  if (!isObject(value)) {
    return {};
  }

  return {
    ...value,
    lastRunLocalDateByCadence: toCadenceMap(value.lastRunLocalDateByCadence),
    lastRunAtByCadence: toCadenceMap(value.lastRunAtByCadence),
    lastManagedEnvironmentIdByCadence: toCadenceMap(
      value.lastManagedEnvironmentIdByCadence,
    ),
    lastExecutionModeByCadence: toCadenceMap(
      value.lastExecutionModeByCadence,
    ) as AutomaticBackupsScheduleState["lastExecutionModeByCadence"],
    lastErrorByCadence: toCadenceMap(value.lastErrorByCadence),
    dailyLastRunDate: asOptionalString(value.dailyLastRunDate),
    weeklyLastRunKey: asOptionalString(value.weeklyLastRunKey),
    lastDailyRunAt: asOptionalString(value.lastDailyRunAt),
    lastWeeklyRunAt: asOptionalString(value.lastWeeklyRunAt),
    lastDailyManagedEnvironmentId: asOptionalString(value.lastDailyManagedEnvironmentId),
    lastWeeklyManagedEnvironmentId: asOptionalString(value.lastWeeklyManagedEnvironmentId),
    lastDailyExecutionMode:
      value.lastDailyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastWeeklyExecutionMode:
      value.lastWeeklyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastDailyError: asOptionalString(value.lastDailyError),
    lastWeeklyError: asOptionalString(value.lastWeeklyError),
    executionLockRunId: asOptionalString(value.executionLockRunId),
    executionLockOwnerUserId: asOptionalString(value.executionLockOwnerUserId),
    executionLockAcquiredAt: asOptionalString(value.executionLockAcquiredAt),
    executionLockHeartbeatAt: asOptionalString(value.executionLockHeartbeatAt),
    executionLockExpiresAt: asOptionalString(value.executionLockExpiresAt),
    executionLockCadenceInFlight: isBackupCadence(value.executionLockCadenceInFlight)
      ? value.executionLockCadenceInFlight
      : undefined,
  };
};
