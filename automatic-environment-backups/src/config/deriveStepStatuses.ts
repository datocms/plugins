import {
  type BackupsParameters,
  hasStoredBackupSchedule,
  isConnectionHealthy,
  readAuthSecret,
  readConnection,
  readDeploymentUrl,
} from './pluginParams';

/** Per-step status in the gated accordion. `disabled` renders grayed (unreached). */
export type StepStatus = 'ok' | 'current' | 'error' | 'disabled';

export type SetupStepId = 'secret' | 'deploy' | 'connect' | 'schedule';

export type StepStatuses = {
  secret: StepStatus;
  deploy: StepStatus;
  connect: StepStatus;
  schedule: StepStatus;
  /** First non-ok setup step (the one to work on), or null when all are ok. */
  currentStep: SetupStepId | null;
};

/**
 * Derive the accordion step statuses purely from the saved plugin parameters.
 * Exactly one setup step is `current`/`error` at a time; earlier steps are `ok`,
 * later steps `disabled`. When all four are `ok`, `currentStep` is null.
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

  let deploy: StepStatus;
  if (!secretSet) {
    deploy = 'disabled';
  } else if (urlSet) {
    deploy = 'ok';
  } else {
    deploy = 'current';
  }

  let connect: StepStatus;
  if (!secretSet || !urlSet) {
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
      : deploy !== 'ok'
        ? 'deploy'
        : connect !== 'ok'
          ? 'connect'
          : schedule !== 'ok'
            ? 'schedule'
            : null;

  return { secret, deploy, connect, schedule, currentStep };
};
