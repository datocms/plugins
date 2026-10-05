import type { BackupCadence, LambdaBackupStatus } from '../types/types';
import { getCadenceLabel } from './backupSchedule';
import { isAbortError, isValidLambdaTimestamp } from './lambdaHttp';

type ExecuteBackupCadencesInput = {
  cadences: readonly BackupCadence[];
  /** Service status plus the cadences whose backup environment is still being created. */
  readStatus: () => Promise<{
    status: LambdaBackupStatus;
    creating: readonly BackupCadence[];
  }>;
  trigger: (cadence: BackupCadence) => Promise<unknown>;
  onProgress: (message: string) => void;
  onCadence?: (cadence: BackupCadence) => void;
  onlyMissing?: boolean;
};

export type BackupCadencesResult = {
  completed: BackupCadence[];
  failures: string[];
};

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 560)
    : 'Unknown backup service error.';

const assertRequestedSlots = (
  status: LambdaBackupStatus,
  cadences: readonly BackupCadence[],
) => {
  for (const cadence of cadences) {
    const slot = status?.slots?.[cadence];
    if (
      !slot ||
      slot.scope !== cadence ||
      slot.executionMode !== 'lambda_cron' ||
      (slot.lastBackupAt !== null && !isValidLambdaTimestamp(slot.lastBackupAt))
    ) {
      throw new Error(
        `${getCadenceLabel(cadence)}: backup status is missing or invalid. No backups were started.`,
      );
    }
  }
};

/** Run one backup per cadence, sequentially, keeping every failure. */
export const executeBackupCadences = async ({
  cadences,
  readStatus,
  trigger,
  onProgress,
  onCadence,
  onlyMissing = false,
}: ExecuteBackupCadencesInput): Promise<BackupCadencesResult> => {
  const result: BackupCadencesResult = { completed: [], failures: [] };
  const uniqueCadences = cadences.filter(
    (cadence, index) => cadences.indexOf(cadence) === index,
  );
  if (uniqueCadences.length === 0) {
    return result;
  }
  const { status, creating } = await readStatus();
  // Older deployments may omit newer cadences. Validate every requested slot
  // before treating an absent environment as a missing backup.
  assertRequestedSlots(status, uniqueCadences);
  // Do not overlap a fork that is already running, scheduled or manual.
  if (creating.length > 0) {
    result.failures.push(
      `${creating.map(getCadenceLabel).join(', ')}: a backup environment is still being created. No backups were started; try again once it is ready.`,
    );
    return result;
  }
  const pendingCadences = uniqueCadences.filter(
    (cadence) => !onlyMissing || status.slots[cadence]?.lastBackupAt === null,
  );
  for (const cadence of pendingCadences) {
    onCadence?.(cadence);
    onProgress(
      `Creating ${getCadenceLabel(cadence).toLowerCase()} backup (${result.completed.length}/${pendingCadences.length} backup cadences completed)…`,
    );
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Creating and rotating environments must not overlap between cadences.
      await trigger(cadence);
      result.completed.push(cadence);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      result.failures.push(
        `${getCadenceLabel(cadence)}: ${errorMessage(error)}`,
      );
    }
  }
  return result;
};
