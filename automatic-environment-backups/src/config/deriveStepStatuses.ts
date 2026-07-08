import type { BackupCadence, LambdaBackupStatus } from '../types/types';
import { getCadenceLabel } from '../utils/backupSchedule';
import {
  type BackupsParameters,
  hasStoredBackupSchedule,
  isConnectionHealthy,
  isDefaultAuthSecret,
  readAuthSecret,
  readConnection,
  readDeploymentUrl,
  readEnabledCadences,
} from './pluginParams';

/** Per-step status in the gated accordion. `disabled` renders grayed (unreached). */
export type StepStatus = 'ok' | 'current' | 'error' | 'disabled';

export type SetupStepId = 'secret' | 'connect' | 'schedule';

export type StepStatuses = {
  secret: StepStatus;
  connect: StepStatus;
  schedule: StepStatus;
  /** First non-ok setup step (the one to work on), or null when all are ok. */
  currentStep: SetupStepId | null;
};

/**
 * Derive the accordion step statuses purely from the saved plugin parameters.
 * Exactly one setup step is `current`/`error` at a time; earlier steps are `ok`,
 * later steps `disabled`. When all three are `ok`, `currentStep` is null.
 */
export const deriveStepStatuses = (params: BackupsParameters): StepStatuses => {
  const secretSet = readAuthSecret(params) !== '';
  const connected = isConnectionHealthy(params);
  const urlSet = readDeploymentUrl(params) !== '';
  const hasFailedPing =
    urlSet && !connected && readConnection(params)?.status === 'disconnected';
  // A stored schedule always carries at least one cadence (the save handler
  // rejects an empty set and the normalizer defaults to daily+weekly), so
  // presence alone is the completion signal.
  const scheduleSet = hasStoredBackupSchedule(params);

  const secret: StepStatus = secretSet ? 'ok' : 'current';

  let connect: StepStatus;
  if (!secretSet) {
    connect = 'disabled';
  } else if (connected) {
    connect = 'ok';
  } else if (hasFailedPing) {
    connect = 'error';
  } else {
    connect = 'current';
  }

  let schedule: StepStatus;
  if (!connected) {
    schedule = 'disabled';
  } else if (scheduleSet) {
    schedule = 'ok';
  } else {
    schedule = 'current';
  }

  const currentStep: SetupStepId | null =
    secret !== 'ok'
      ? 'secret'
      : connect !== 'ok'
        ? 'connect'
        : schedule !== 'ok'
          ? 'schedule'
          : null;

  return { secret, connect, schedule, currentStep };
};

export type ChecklistStatus = 'ok' | 'error' | 'pending' | 'warn';

export type ChecklistItem = {
  id: 'secret' | 'connection' | 'cadence' | 'environments';
  label: string;
  status: ChecklistStatus;
  detail?: string;
};

/**
 * Build the Status-overview checklist. Deliberately redundant with per-step
 * errors so a broken setup is impossible to miss. Reads params for the first
 * three items; the environments item also needs the fetched backup status.
 */
export const buildStatusChecklist = (
  params: BackupsParameters,
  backupStatus?: LambdaBackupStatus,
): ChecklistItem[] => {
  const secret = readAuthSecret(params);
  const connection = readConnection(params);
  const connected = isConnectionHealthy(params);
  const urlSet = readDeploymentUrl(params) !== '';
  const enabledCadences = readEnabledCadences(params);
  const scheduleSet = hasStoredBackupSchedule(params);

  const secretItem: ChecklistItem =
    secret === ''
      ? { id: 'secret', label: 'Auth secret', status: 'pending', detail: 'Not set yet.' }
      : isDefaultAuthSecret(secret)
        ? {
            id: 'secret',
            label: 'Auth secret',
            status: 'warn',
            detail: 'Using the example default — regenerate a unique secret.',
          }
        : { id: 'secret', label: 'Auth secret', status: 'ok', detail: 'Set.' };

  const connectionItem: ChecklistItem = !urlSet
    ? {
        id: 'connection',
        label: 'Function reachable & authenticating',
        status: 'pending',
        detail: 'No deployment URL yet.',
      }
    : connected
      ? {
          id: 'connection',
          label: 'Function reachable & authenticating',
          status: 'ok',
          detail: 'Connected.',
        }
      : {
          id: 'connection',
          label: 'Function reachable & authenticating',
          status: 'error',
          detail:
            connection?.errorMessage ??
            'Last connection check failed. Re-test in the Connect step.',
        };

  const cadenceItem: ChecklistItem = scheduleSet
    ? {
        id: 'cadence',
        label: 'Backup cadence',
        status: 'ok',
        detail: enabledCadences.map(getCadenceLabel).join(', '),
      }
    : {
        id: 'cadence',
        label: 'Backup cadence',
        status: 'pending',
        detail: 'Not configured yet.',
      };

  const environmentsItem = buildEnvironmentsItem(
    connected,
    enabledCadences,
    backupStatus,
  );

  return [secretItem, connectionItem, cadenceItem, environmentsItem];
};

const buildEnvironmentsItem = (
  connected: boolean,
  enabledCadences: BackupCadence[],
  backupStatus?: LambdaBackupStatus,
): ChecklistItem => {
  const label = 'Backup environments';
  if (!connected) {
    return {
      id: 'environments',
      label,
      status: 'pending',
      detail: 'Waiting for a healthy connection.',
    };
  }

  if (!backupStatus) {
    return {
      id: 'environments',
      label,
      status: 'pending',
      detail: 'Loading backup status…',
    };
  }

  const total = enabledCadences.length;
  const created = enabledCadences.filter(
    (cadence) => backupStatus.slots[cadence]?.lastBackupAt,
  ).length;

  return {
    id: 'environments',
    label,
    status: total > 0 && created === total ? 'ok' : 'pending',
    detail: `${created} of ${total} created`,
  };
};
