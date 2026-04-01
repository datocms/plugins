import { formatDistanceStrict } from 'date-fns';
import type {
  BackupCadence,
  BackupOverviewRow,
  BackupScheduleConfig,
  LambdaBackupStatus,
} from '../types/types';

type BuildBackupOverviewRowsInput = {
  scheduleConfig: BackupScheduleConfig;
  lambdaStatus?: LambdaBackupStatus;
  availableEnvironmentIds?: readonly string[];
  now?: Date;
};

const formatRelativeDateTime = (
  value: Date | string | undefined,
  now: Date,
): string => {
  if (!value) {
    return 'Never';
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Unavailable';
  }

  return formatDistanceStrict(parsedDate, now, { addSuffix: true });
};

const getCadencePrefix = (cadence: BackupCadence): string => {
  if (cadence === 'daily') {
    return 'backup-plugin-daily';
  }
  if (cadence === 'weekly') {
    return 'backup-plugin-weekly';
  }
  if (cadence === 'biweekly') {
    return 'backup-plugin-biweekly';
  }
  return 'backup-plugin-monthly';
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
        lastBackup: 'Unavailable',
        nextBackup: 'Unavailable',
        environmentName: 'Not yet created',
        environmentLinked: false,
      };
    }

    return {
      scope: cadence,
      lastBackup: slot.lastBackupAt
        ? formatRelativeDateTime(slot.lastBackupAt, now)
        : 'Never',
      nextBackup: slot.nextBackupAt
        ? formatRelativeDateTime(slot.nextBackupAt, now)
        : 'Unavailable',
      environmentName: slot.lastBackupAt
        ? toLambdaEnvironmentName(cadence, slot.lastBackupAt)
        : 'Not yet created',
      environmentLinked: Boolean(slot.lastBackupAt),
    };
  });
};

const toAvailableEnvironmentIdsSet = (
  availableEnvironmentIds: readonly string[] | undefined,
): Set<string> | undefined => {
  if (!availableEnvironmentIds || availableEnvironmentIds.length === 0) {
    return undefined;
  }

  const normalizedIds = availableEnvironmentIds
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return normalizedIds.length > 0 ? new Set(normalizedIds) : undefined;
};

const annotateMissingEnvironment = (
  row: BackupOverviewRow,
  availableEnvironmentIdsSet: Set<string> | undefined,
): BackupOverviewRow => {
  if (!availableEnvironmentIdsSet || !row.environmentLinked) {
    return row;
  }

  if (availableEnvironmentIdsSet.has(row.environmentName)) {
    return row;
  }

  return {
    ...row,
    environmentLinked: false,
    environmentStatusNote:
      'Missing in current environments list (deleted or renamed).',
  };
};

export const buildBackupOverviewRows = ({
  scheduleConfig,
  lambdaStatus,
  availableEnvironmentIds,
  now = new Date(),
}: BuildBackupOverviewRowsInput): BackupOverviewRow[] => {
  const rows = buildLambdaRows(lambdaStatus, scheduleConfig, now);
  const availableEnvironmentIdsSet = toAvailableEnvironmentIdsSet(
    availableEnvironmentIds,
  );

  return rows.map((row) =>
    annotateMissingEnvironment(row, availableEnvironmentIdsSet),
  );
};
