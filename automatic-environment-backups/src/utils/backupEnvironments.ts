import type { BackupCadence, LambdaBackupStatus } from '../types/types';
import { BACKUP_CADENCES, isValidLocalDateKey } from './backupSchedule';

export type BackupEnvironment = {
  id: string;
  meta: {
    primary: boolean;
    status: 'creating' | 'ready' | 'destroying';
    created_at: string;
    fork_completion_percentage?: number;
  };
};

const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

const toTimestamp = (value: string | null | undefined): number | undefined => {
  if (
    !value ||
    !TIMESTAMP_PATTERN.test(value) ||
    !isValidLocalDateKey(value.slice(0, 10)) ||
    Number(value.slice(11, 13)) > 23
  ) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const isBackupEnvironment = (
  environment: BackupEnvironment,
  cadence: BackupCadence,
): boolean =>
  !environment.meta.primary &&
  environment.id.startsWith(`backup-plugin-${cadence}-`);

/** Confirm the service timestamp against CMA metadata; never infer an ID. */
export const getReadyBackupEnvironment = (
  status: LambdaBackupStatus,
  cadence: BackupCadence,
  environments: readonly BackupEnvironment[],
): string | undefined => {
  const lastBackupTimestamp = toTimestamp(status.slots[cadence]?.lastBackupAt);
  if (lastBackupTimestamp === undefined) {
    return undefined;
  }

  const isMatchingEnvironment = (environment: BackupEnvironment): boolean =>
    isBackupEnvironment(environment, cadence) &&
    toTimestamp(environment.meta.created_at) === lastBackupTimestamp;
  const isMatchingReadyEnvironment = (
    environment: BackupEnvironment,
  ): boolean =>
    isMatchingEnvironment(environment) && environment.meta.status === 'ready';

  let matchedId: string | undefined;
  for (const environment of environments) {
    if (!isMatchingEnvironment(environment)) {
      continue;
    }
    if (environment.meta.status !== 'ready') {
      return undefined;
    }
    if (matchedId !== undefined && matchedId !== environment.id) {
      return undefined;
    }
    matchedId = environment.id;
  }

  // A duplicated, contradictory entry must not turn an unfinished fork into a
  // confirmed backup. Identical duplicates do not change the result.
  if (
    matchedId === undefined ||
    environments.some(
      (environment) =>
        environment.id === matchedId &&
        !isMatchingReadyEnvironment(environment),
    )
  ) {
    return undefined;
  }

  return matchedId;
};

const getLatestBackupTimestamp = (
  cadence: BackupCadence,
  environments: readonly BackupEnvironment[],
): number | undefined => {
  let latestTimestamp: number | undefined;
  for (const environment of environments) {
    if (!isBackupEnvironment(environment, cadence)) {
      continue;
    }
    const timestamp = toTimestamp(environment.meta.created_at);
    if (
      timestamp !== undefined &&
      (latestTimestamp === undefined || timestamp > latestTimestamp)
    ) {
      latestTimestamp = timestamp;
    }
  }
  return latestTimestamp;
};

/** CMA can reveal a cron fork that started after the service status snapshot. */
export const enrichBackupStatusWithEnvironments = (
  status: LambdaBackupStatus,
  environments: readonly BackupEnvironment[],
): LambdaBackupStatus => {
  const enrichedStatus: LambdaBackupStatus = {
    ...status,
    slots: { ...status.slots },
  };
  for (const cadence of BACKUP_CADENCES) {
    const slot = status.slots[cadence];
    if (!slot) {
      continue;
    }
    const serviceTimestamp = toTimestamp(slot.lastBackupAt);
    const latestTimestamp = getLatestBackupTimestamp(cadence, environments);
    const cmaIsNewer =
      latestTimestamp !== undefined &&
      (slot.lastBackupAt === null ||
        (serviceTimestamp !== undefined && latestTimestamp > serviceTimestamp));
    const enrichedSlot: LambdaBackupStatus['slots']['daily'] = {
      ...slot,
      lastBackupAt: cmaIsNewer
        ? new Date(latestTimestamp).toISOString()
        : slot.lastBackupAt,
      lastManagedEnvironmentId: null,
    };
    enrichedStatus.slots[cadence] = enrichedSlot;
    enrichedSlot.lastManagedEnvironmentId =
      getReadyBackupEnvironment(enrichedStatus, cadence, environments) ?? null;
  }
  return enrichedStatus;
};

export const getCreatingBackupCadences = (
  environments: readonly BackupEnvironment[],
): BackupCadence[] =>
  BACKUP_CADENCES.filter((cadence) =>
    environments.some(
      (environment) =>
        isBackupEnvironment(environment, cadence) &&
        environment.meta.status === 'creating',
    ),
  );

/** Show the least complete active fork, without inventing unknown progress. */
export const getBackupEnvironmentProgress = (
  cadence: BackupCadence,
  environments: readonly BackupEnvironment[],
): number | undefined => {
  let progress: number | undefined;
  for (const environment of environments) {
    if (
      !isBackupEnvironment(environment, cadence) ||
      environment.meta.status !== 'creating'
    ) {
      continue;
    }

    const percentage = environment.meta.fork_completion_percentage;
    if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
      return undefined;
    }

    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    progress =
      progress === undefined
        ? clampedPercentage
        : Math.min(progress, clampedPercentage);
  }
  return progress;
};
