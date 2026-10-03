import type { BackupCadence, LambdaBackupStatus } from '../types/types';
import { BACKUP_CADENCES, getCadenceLabel } from './backupSchedule';
import { isAbortError, isValidLambdaTimestamp } from './lambdaHttp';
import {
  LambdaBackupNowError,
  type LambdaBackupNowResult,
} from './triggerLambdaBackupNow';

const PREFLIGHT_TIMEOUT_MS = 30000;
const OBSERVATION_TIMEOUT_MS = 30 * 60 * 1000;
const INITIAL_POLL_INTERVAL_MS = 5000;
const MAX_POLL_INTERVAL_MS = 30000;

type ExecuteBackupCadencesInput = {
  cadences: readonly BackupCadence[];
  readStatus: () => Promise<LambdaBackupStatus>;
  trigger: (cadence: BackupCadence) => Promise<LambdaBackupNowResult>;
  onProgress: (message: string) => void;
  onStatus?: (status: LambdaBackupStatus) => void;
  onCadence?: (cadence: BackupCadence) => void;
  confirmCompletion?: (
    cadence: BackupCadence,
    status: LambdaBackupStatus,
  ) => Promise<boolean>;
  signal?: AbortSignal;
  onlyMissing?: boolean;
  continuousObservation?: boolean;
};

export type BackupCadencesResult = {
  completed: BackupCadence[];
  failures: string[];
  uncertain: boolean;
};

class ObservationTimeoutError extends Error {
  constructor() {
    super('Backup monitoring exceeded its time limit.');
    this.name = 'ObservationTimeoutError';
  }
}

const cancelledError = () =>
  new DOMException(
    'Backup monitoring was cancelled. An external backup may still be running.',
    'AbortError',
  );

const throwIfCancelled = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) {
    throw cancelledError();
  }
};

/** Bound even a stalled callback; never start another request after it expires. */
const awaitOperation = <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  deadline?: number,
): Promise<T> => {
  throwIfCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(cancelledError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (deadline !== undefined) {
      timeout = setTimeout(
        () => finish(() => reject(new ObservationTimeoutError())),
        Math.max(0, deadline - Date.now()),
      );
    }
    Promise.resolve()
      .then(() => {
        throwIfCancelled(signal);
        if (deadline !== undefined && Date.now() >= deadline) {
          throw new ObservationTimeoutError();
        }
        return operation();
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
};

const waitForPoll = (milliseconds: number, signal?: AbortSignal) => {
  throwIfCancelled(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(cancelledError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const lastBackupTime = (
  status: LambdaBackupStatus,
  cadence: BackupCadence,
): number | null => {
  const slot = status?.slots?.[cadence];
  if (
    slot?.scope !== cadence ||
    slot.executionMode !== 'lambda_cron' ||
    !isValidLambdaTimestamp(slot.lastBackupAt)
  ) {
    return null;
  }
  return Date.parse(slot.lastBackupAt);
};

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 560)
    : 'Unknown backup service error.';

const statusDiagnostic = (message: string | undefined) =>
  message ? ` Latest status unavailable: ${message}` : '';

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
      (slot.lastBackupAt !== null && lastBackupTime(status, cadence) === null)
    ) {
      throw new Error(
        `${getCadenceLabel(cadence)}: backup status is missing or invalid. No backups were started.`,
      );
    }
  }
};

const isDefinitiveTriggerFailure = (error: unknown) =>
  error instanceof LambdaBackupNowError &&
  (error.code === 'MISSING_AUTH_SECRET' ||
    (error.code === 'HTTP' &&
      error.httpStatus !== undefined &&
      error.httpStatus >= 400 &&
      error.httpStatus < 500));

type ObservationResult = {
  status: LambdaBackupStatus;
  confirmed: boolean;
  lastError?: string;
};

type ExecutionContext = Omit<
  ExecuteBackupCadencesInput,
  'cadences' | 'onlyMissing' | 'continuousObservation'
> & { continuousObservation: boolean };

type ConfirmationInput = {
  cadence: BackupCadence;
  baseline: number | null;
  mustAdvance: boolean;
  confirmCompletion: ExecuteBackupCadencesInput['confirmCompletion'];
  signal: AbortSignal | undefined;
  deadline: number;
};

const confirmsReady = async (
  status: LambdaBackupStatus,
  {
    cadence,
    baseline,
    mustAdvance,
    confirmCompletion,
    signal,
    deadline,
  }: ConfirmationInput,
): Promise<boolean> => {
  const timestamp = lastBackupTime(status, cadence);
  if (timestamp === null || !confirmCompletion) {
    return false;
  }
  if (
    baseline !== null &&
    (mustAdvance ? timestamp <= baseline : timestamp < baseline)
  ) {
    return false;
  }
  return awaitOperation(
    () => confirmCompletion(cadence, status),
    signal,
    deadline,
  );
};

const statusRetryDelay = (error: unknown): number => {
  const retryAfterMs =
    typeof error === 'object' && error !== null && 'retryAfterMs' in error
      ? error.retryAfterMs
      : undefined;
  if (
    typeof retryAfterMs === 'number' &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
  ) {
    return retryAfterMs;
  }
  return 0;
};

type ObservationInput = ConfirmationInput & {
  status: LambdaBackupStatus;
  readStatus: ExecuteBackupCadencesInput['readStatus'];
  onStatus: ExecuteBackupCadencesInput['onStatus'];
  onProgress: (stillWaiting: boolean, lastError?: string) => void;
  continuousObservation: boolean;
  initialRetryAfterMs?: number;
};

type PollResult = ObservationResult & {
  stop?: boolean;
  retryAfterMs: number;
};

const pollCompletion = async (
  input: ObservationInput,
  status: LambdaBackupStatus,
  deadline: number,
): Promise<PollResult> => {
  const { readStatus, onStatus, signal, continuousObservation } = input;
  try {
    const refreshed = await awaitOperation(readStatus, signal, deadline);
    onStatus?.(refreshed);
    const confirmed = await confirmsReady(refreshed, { ...input, deadline });
    return { status: refreshed, confirmed, retryAfterMs: 0 };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw cancelledError();
    }
    const retryAfterMs = statusRetryDelay(error);
    // A stalled callback may still be running. Do not renew and overlap it.
    const stop =
      error instanceof ObservationTimeoutError ||
      (!continuousObservation && retryAfterMs >= deadline - Date.now());
    return {
      status,
      confirmed: false,
      stop,
      retryAfterMs,
      lastError: errorMessage(error),
    };
  }
};

const renewedDeadline = (
  deadline: number,
  continuousObservation: boolean,
): number | null => {
  if (Date.now() < deadline) {
    return deadline;
  }
  return continuousObservation ? Date.now() + OBSERVATION_TIMEOUT_MS : null;
};

/** A changed timestamp requires independent CMA readiness before another POST. */
const observeCompletion = async (
  input: ObservationInput,
): Promise<ObservationResult> => {
  const {
    signal,
    continuousObservation,
    onProgress,
    initialRetryAfterMs = 0,
  } = input;
  let status = input.status;
  let interval = Math.max(INITIAL_POLL_INTERVAL_MS, initialRetryAfterMs);
  let backoff = INITIAL_POLL_INTERVAL_MS;
  let lastError: string | undefined;
  let deadline = input.deadline;
  let stillWaiting = false;
  while (true) {
    const beforeWait = renewedDeadline(deadline, continuousObservation);
    if (beforeWait === null) {
      break;
    }
    stillWaiting = stillWaiting || beforeWait !== deadline;
    deadline = beforeWait;
    onProgress(stillWaiting, lastError);
    // biome-ignore lint/performance/noAwaitInLoops: Sequential polling prevents overlapping status requests and obeys Retry-After.
    await waitForPoll(
      continuousObservation
        ? interval
        : Math.min(interval, deadline - Date.now()),
      signal,
    );
    const afterWait = renewedDeadline(deadline, continuousObservation);
    if (afterWait === null) {
      break;
    }
    stillWaiting = stillWaiting || afterWait !== deadline;
    deadline = afterWait;
    const polled = await pollCompletion(input, status, deadline);
    status = polled.status;
    lastError = polled.lastError;
    if (polled.confirmed) {
      return { status, confirmed: true };
    }
    if (polled.stop) {
      break;
    }
    backoff = Math.min(backoff * 2, MAX_POLL_INTERVAL_MS);
    interval = Math.max(backoff, polled.retryAfterMs);
  }
  return { status, confirmed: false, lastError };
};

type PreparedExecution = {
  status: LambdaBackupStatus;
  failure?: string;
};

const checkExistingReadiness = async (
  cadence: BackupCadence,
  status: LambdaBackupStatus,
  deadline: number,
  { confirmCompletion, signal }: ExecutionContext,
): Promise<'ready' | 'pending' | 'stalled'> => {
  if (!confirmCompletion) {
    return 'pending';
  }
  try {
    const ready = await awaitOperation(
      () => confirmCompletion(cadence, status),
      signal,
      deadline,
    );
    return ready ? 'ready' : 'pending';
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw cancelledError();
    }
    return error instanceof ObservationTimeoutError ? 'stalled' : 'pending';
  }
};

const observeExistingFork = async (
  cadence: BackupCadence,
  timestamp: number,
  status: LambdaBackupStatus,
  context: ExecutionContext,
): Promise<PreparedExecution> => {
  const {
    readStatus,
    confirmCompletion,
    onStatus,
    onCadence,
    onProgress,
    signal,
    continuousObservation,
  } = context;
  const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
  const readiness = await checkExistingReadiness(
    cadence,
    status,
    deadline,
    context,
  );
  if (readiness === 'ready') {
    return { status };
  }
  if (readiness === 'stalled') {
    return {
      status,
      failure: `${getCadenceLabel(cadence)}: the readiness check did not finish. No backups were started.`,
    };
  }
  onCadence?.(cadence);
  const observed = await observeCompletion({
    cadence,
    baseline: timestamp,
    mustAdvance: false,
    status,
    readStatus,
    confirmCompletion,
    onStatus,
    onProgress: (stillWaiting, lastError) =>
      onProgress(
        `${stillWaiting ? 'Still waiting' : 'Waiting'} for the existing ${getCadenceLabel(cadence).toLowerCase()} backup environment to become ready before starting backups…${statusDiagnostic(lastError)}`,
      ),
    signal,
    deadline,
    continuousObservation,
  });
  if (observed.confirmed) {
    return { status: observed.status };
  }
  return {
    status: observed.status,
    failure: `${getCadenceLabel(cadence)}: the existing backup could not be confirmed ready. No backups were started.${observed.lastError ? ` ${observed.lastError}` : ''}`,
  };
};

const prepareExecution = async (
  cadences: readonly BackupCadence[],
  context: ExecutionContext,
): Promise<PreparedExecution> => {
  const { readStatus, onStatus, confirmCompletion, signal } = context;
  let status = await awaitOperation(
    readStatus,
    signal,
    Date.now() + PREFLIGHT_TIMEOUT_MS,
  );
  onStatus?.(status);
  // Older deployments may omit newer cadences. Validate every requested slot
  // before treating an absent environment as a missing backup.
  assertRequestedSlots(status, cadences);
  // Check every cadence, even one the user did not request, to avoid overlapping
  // a scheduled fork with a manual backup.
  for (const cadence of BACKUP_CADENCES) {
    const timestamp = lastBackupTime(status, cadence);
    if (timestamp === null || !confirmCompletion) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: All existing forks must be confirmed ready sequentially before mutations.
    const observed = await observeExistingFork(
      cadence,
      timestamp,
      status,
      context,
    );
    status = observed.status;
    if (observed.failure) {
      return observed;
    }
  }
  // Polling may observe a different contract after the external service redeploys.
  assertRequestedSlots(status, cadences);
  return { status };
};

const validateBackupResponse = (
  backup: LambdaBackupNowResult,
  cadence: BackupCadence,
) => {
  if (
    backup?.scope !== cadence ||
    backup.executionMode !== 'lambda_cron' ||
    !backup.createdEnvironmentId?.trim() ||
    !isValidLambdaTimestamp(backup.completedAt) ||
    !isValidLambdaTimestamp(backup.checkedAt)
  ) {
    throw new Error('Backup now response did not confirm completion.');
  }
};

const verifySuccessfulBackup = async (
  cadence: BackupCadence,
  baseline: number | null,
  status: LambdaBackupStatus,
  { readStatus, onStatus, confirmCompletion, signal }: ExecutionContext,
): Promise<LambdaBackupStatus> => {
  if (!confirmCompletion) {
    return status;
  }
  const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
  const refreshed = await awaitOperation(readStatus, signal, deadline);
  onStatus?.(refreshed);
  if (
    !(await confirmsReady(refreshed, {
      cadence,
      baseline,
      mustAdvance: true,
      confirmCompletion,
      signal,
      deadline,
    }))
  ) {
    throw new Error('The backup environment is not confirmed ready yet.');
  }
  return refreshed;
};

type CadenceExecutionResult = {
  status: LambdaBackupStatus;
  completed: boolean;
  uncertain: boolean;
  failure?: string;
};

const executeCadence = async (
  cadence: BackupCadence,
  status: LambdaBackupStatus,
  progress: string,
  context: ExecutionContext,
): Promise<CadenceExecutionResult> => {
  const {
    trigger,
    readStatus,
    confirmCompletion,
    onStatus,
    onProgress,
    onCadence,
    signal,
    continuousObservation,
  } = context;
  throwIfCancelled(signal);
  onCadence?.(cadence);
  onProgress(
    `Creating ${getCadenceLabel(cadence).toLowerCase()} backup (${progress})…`,
  );
  const baseline = lastBackupTime(status, cadence);
  try {
    const backup = await awaitOperation(() => trigger(cadence), signal);
    validateBackupResponse(backup, cadence);
    const verified = await verifySuccessfulBackup(
      cadence,
      baseline,
      status,
      context,
    );
    return { status: verified, completed: true, uncertain: false };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw cancelledError();
    }
    if (isDefinitiveTriggerFailure(error)) {
      return {
        status,
        completed: false,
        uncertain: false,
        failure: `${getCadenceLabel(cadence)}: ${errorMessage(error)}`,
      };
    }
    if (error instanceof ObservationTimeoutError) {
      return {
        status,
        completed: false,
        uncertain: true,
        failure: `${getCadenceLabel(cadence)}: the readiness check did not finish. The external backup may still be running. No further backups were started.`,
      };
    }
    // The POST may have reached the service: never resend it, even after a
    // timeout or HTTP 5xx. Observe its environment until it is actually ready.
    const observed = await observeCompletion({
      cadence,
      baseline,
      mustAdvance: true,
      status,
      readStatus,
      confirmCompletion,
      onStatus,
      onProgress: (stillWaiting, lastError) =>
        onProgress(
          `${stillWaiting ? 'Still waiting' : 'Waiting'} for ${getCadenceLabel(cadence).toLowerCase()} backup confirmation (${progress})…${statusDiagnostic(lastError)}`,
        ),
      signal,
      deadline: Date.now() + OBSERVATION_TIMEOUT_MS,
      continuousObservation,
      initialRetryAfterMs: statusRetryDelay(error),
    });
    if (observed.confirmed) {
      return { status: observed.status, completed: true, uncertain: false };
    }
    return {
      status: observed.status,
      completed: false,
      uncertain: true,
      failure: `${getCadenceLabel(cadence)}: ${errorMessage(error)} Completion could not be confirmed; the external backup may still be running. No further backups were started.${observed.lastError ? ` Last status error: ${observed.lastError}` : ''}`,
    };
  }
};

/** Execute at most one backup mutation per cadence, keeping every failure. */
export const executeBackupCadences = async (
  input: ExecuteBackupCadencesInput,
): Promise<BackupCadencesResult> => {
  const { cadences, signal, onlyMissing = false } = input;
  throwIfCancelled(signal);
  const uniqueCadences = cadences.filter(
    (cadence, index) => cadences.indexOf(cadence) === index,
  );
  const result: BackupCadencesResult = {
    completed: [],
    failures: [],
    uncertain: false,
  };
  if (uniqueCadences.length === 0) {
    return result;
  }
  const context: ExecutionContext = {
    ...input,
    continuousObservation: input.continuousObservation ?? false,
  };
  const prepared = await prepareExecution(uniqueCadences, context);
  if (prepared.failure) {
    return { ...result, failures: [prepared.failure], uncertain: true };
  }
  let status = prepared.status;
  const pendingCadences = uniqueCadences.filter(
    (cadence) => !onlyMissing || lastBackupTime(status, cadence) === null,
  );
  for (const cadence of pendingCadences) {
    const progress = `${result.completed.length}/${pendingCadences.length} backup cadences completed`;
    // biome-ignore lint/performance/noAwaitInLoops: Creating and rotating environments must not overlap between cadences.
    const executed = await executeCadence(cadence, status, progress, context);
    status = executed.status;
    if (executed.completed) {
      result.completed.push(cadence);
      input.onProgress(
        `${result.completed.length}/${pendingCadences.length} backup cadences completed.`,
      );
    }
    if (executed.failure) {
      result.failures.push(executed.failure);
    }
    if (executed.uncertain) {
      result.uncertain = true;
      return result;
    }
  }
  return result;
};
