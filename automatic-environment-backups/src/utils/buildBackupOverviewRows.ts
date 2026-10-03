import { formatDistanceStrict } from 'date-fns/formatDistanceStrict';
import type {
  BackupCadence,
  BackupOverviewRow,
  BackupScheduleConfig,
  LambdaBackupStatus,
  LambdaBackupStatusSlot,
} from '../types/types';
import { isValidBackupTimestamp } from './backupSchedule';

type BuildBackupOverviewRowsInput = {
  scheduleConfig: BackupScheduleConfig;
  lambdaStatus?: LambdaBackupStatus;
  /** Only environments whose CMA status is ready; undefined means the read failed. */
  availableEnvironmentIds?: readonly string[];
  now?: Date;
};

const formatRelativeDateTime = (
  value: Date | string | undefined,
  now: Date,
): string => {
  if (value === undefined) {
    return 'Never';
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  if (
    (typeof value === 'string' && !isValidBackupTimestamp(value)) ||
    !Number.isFinite(parsedDate.getTime())
  ) {
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

const buildEnvironmentDetails = (
  cadence: BackupCadence,
  slot: LambdaBackupStatusSlot,
): Pick<
  BackupOverviewRow,
  'environmentName' | 'environmentLinked' | 'environmentStatusNote'
> => {
  if (slot.lastBackupAt === null) {
    return { environmentName: 'Not yet created', environmentLinked: false };
  }

  if (!isValidBackupTimestamp(slot.lastBackupAt)) {
    return { environmentName: 'Unavailable', environmentLinked: false };
  }

  if (slot.lastManagedEnvironmentId === null) {
    return {
      environmentName: 'Not confirmed ready',
      environmentLinked: false,
      environmentStatusNote: 'Backup environment is not confirmed ready.',
    };
  }

  return {
    environmentName:
      slot.lastManagedEnvironmentId?.trim() ||
      toLambdaEnvironmentName(cadence, slot.lastBackupAt),
    environmentLinked: true,
  };
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
      lastBackup:
        slot.lastBackupAt !== null
          ? formatRelativeDateTime(slot.lastBackupAt, now)
          : 'Never',
      nextBackup: slot.dueNow
        ? 'Due now'
        : slot.nextBackupAt
          ? formatRelativeDateTime(slot.nextBackupAt, now)
          : 'Unavailable',
      ...buildEnvironmentDetails(cadence, slot),
    };
  });
};

const toAvailableEnvironmentIdsSet = (
  availableEnvironmentIds: readonly string[] | undefined,
): Set<string> | undefined => {
  if (availableEnvironmentIds === undefined) {
    return undefined;
  }

  const normalizedIds = new Set<string>();
  for (const value of availableEnvironmentIds) {
    const normalized = value.trim();
    if (normalized) {
      normalizedIds.add(normalized);
    }
  }
  return normalizedIds;
};

const annotateMissingEnvironment = (
  row: BackupOverviewRow,
  availableEnvironmentIdsSet: Set<string> | undefined,
): BackupOverviewRow => {
  if (!row.environmentLinked) {
    return row;
  }

  if (!availableEnvironmentIdsSet) {
    return {
      ...row,
      environmentLinked: false,
      environmentStatusNote:
        'Could not verify against the current environments list.',
    };
  }

  if (availableEnvironmentIdsSet.has(row.environmentName)) {
    return row;
  }

  return {
    ...row,
    environmentLinked: false,
    environmentStatusNote:
      'Not found among ready environments (still creating, deleted or renamed).',
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
