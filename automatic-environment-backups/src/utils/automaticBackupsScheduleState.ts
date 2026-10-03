import type {
  AutomaticBackupsScheduleState,
  BackupCadence,
} from '../types/types';
import {
  BACKUP_CADENCES,
  isValidBackupTimestamp,
  isValidLocalDateKey,
} from './backupSchedule';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asOptionalTimestamp = (value: unknown): string | undefined => {
  const normalized = asOptionalString(value);
  return normalized && isValidBackupTimestamp(normalized)
    ? normalized
    : undefined;
};

const asOptionalLocalDate = (value: unknown): string | undefined => {
  const normalized = asOptionalString(value);
  return normalized && isValidLocalDateKey(normalized) ? normalized : undefined;
};

const asOptionalExecutionMode = (value: unknown): 'lambda_cron' | undefined =>
  asOptionalString(value) === 'lambda_cron' ? 'lambda_cron' : undefined;

const toCadenceMap = <T extends string>(
  value: unknown,
  normalize: (entry: unknown) => T | undefined,
): Partial<Record<BackupCadence, T>> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const next: Partial<Record<BackupCadence, T>> = {};
  for (const cadence of BACKUP_CADENCES) {
    const normalized = normalize(value[cadence]);
    if (normalized) {
      next[cadence] = normalized;
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
    lastRunLocalDateByCadence: toCadenceMap(
      value.lastRunLocalDateByCadence,
      asOptionalLocalDate,
    ),
    lastRunAtByCadence: toCadenceMap(
      value.lastRunAtByCadence,
      asOptionalTimestamp,
    ),
    lastManagedEnvironmentIdByCadence: toCadenceMap(
      value.lastManagedEnvironmentIdByCadence,
      asOptionalString,
    ),
    lastExecutionModeByCadence: toCadenceMap(
      value.lastExecutionModeByCadence,
      asOptionalExecutionMode,
    ),
    lastErrorByCadence: toCadenceMap(
      value.lastErrorByCadence,
      asOptionalString,
    ),
    dailyLastRunDate: asOptionalLocalDate(value.dailyLastRunDate),
    weeklyLastRunKey: asOptionalString(value.weeklyLastRunKey),
    lastDailyRunAt: asOptionalTimestamp(value.lastDailyRunAt),
    lastWeeklyRunAt: asOptionalTimestamp(value.lastWeeklyRunAt),
    lastDailyManagedEnvironmentId: asOptionalString(
      value.lastDailyManagedEnvironmentId,
    ),
    lastWeeklyManagedEnvironmentId: asOptionalString(
      value.lastWeeklyManagedEnvironmentId,
    ),
    lastDailyError: asOptionalString(value.lastDailyError),
    lastWeeklyError: asOptionalString(value.lastWeeklyError),
  };
};
