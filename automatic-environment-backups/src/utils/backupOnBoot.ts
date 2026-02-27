import { OnBootCtx } from "datocms-plugin-sdk";
import {
  AutomaticBackupsScheduleState,
  BackupCadence,
  BackupScheduleConfig,
} from "../types/types";
import {
  getLastRunLocalDateForCadence,
  isBackupCadence,
  isCadenceDueNow,
  normalizeBackupScheduleConfig,
  parseTimeToMinuteOfDay,
  toLocalDateKey,
  toLocalMinuteOfDay,
} from "./backupSchedule";
import { createDebugLogger, isDebugEnabled } from "./debugLogger";
import { getRuntimeMode } from "./getRuntimeMode";
import { backupEnvironmentSlotWithoutLambda } from "./lambdaLessBackup";

type PluginParameters = Record<string, unknown> | undefined;
type SchedulePatch = Partial<AutomaticBackupsScheduleState>;

export const LOCK_TTL_MS = 20 * 60 * 1000;
export const LOCK_PROPAGATION_WAIT_MS = 5500;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asOptionalUserId = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

const getProjectTimezone = (site: unknown): string => {
  if (
    site &&
    typeof site === "object" &&
    "timezone" in site &&
    typeof (site as { timezone?: unknown }).timezone === "string" &&
    (site as { timezone: string }).timezone.trim()
  ) {
    return (site as { timezone: string }).timezone.trim();
  }

  return "UTC";
};

const toCadenceStringMap = (
  value: unknown,
): Partial<Record<BackupCadence, string>> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const next: Partial<Record<BackupCadence, string>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isBackupCadence(key) || typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    next[key] = entry.trim();
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const getAutomaticBackupsScheduleState = (
  parameters: PluginParameters,
): AutomaticBackupsScheduleState => {
  const candidate = parameters?.automaticBackupsSchedule;
  if (!isObject(candidate)) {
    return {};
  }

  return {
    ...candidate,
    lastRunLocalDateByCadence: toCadenceStringMap(candidate.lastRunLocalDateByCadence),
    lastRunAtByCadence: toCadenceStringMap(candidate.lastRunAtByCadence),
    lastManagedEnvironmentIdByCadence: toCadenceStringMap(
      candidate.lastManagedEnvironmentIdByCadence,
    ),
    lastExecutionModeByCadence: toCadenceStringMap(
      candidate.lastExecutionModeByCadence,
    ) as AutomaticBackupsScheduleState["lastExecutionModeByCadence"],
    lastErrorByCadence: toCadenceStringMap(candidate.lastErrorByCadence),
    dailyLastRunDate: asOptionalString(candidate.dailyLastRunDate),
    weeklyLastRunKey: asOptionalString(candidate.weeklyLastRunKey),
    lastDailyRunAt: asOptionalString(candidate.lastDailyRunAt),
    lastWeeklyRunAt: asOptionalString(candidate.lastWeeklyRunAt),
    lastDailyManagedEnvironmentId: asOptionalString(
      candidate.lastDailyManagedEnvironmentId,
    ),
    lastWeeklyManagedEnvironmentId: asOptionalString(
      candidate.lastWeeklyManagedEnvironmentId,
    ),
    lastDailyExecutionMode:
      candidate.lastDailyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastWeeklyExecutionMode:
      candidate.lastWeeklyExecutionMode === "lambdaless_on_boot"
        ? "lambdaless_on_boot"
        : undefined,
    lastDailyError: asOptionalString(candidate.lastDailyError),
    lastWeeklyError: asOptionalString(candidate.lastWeeklyError),
    executionLockRunId: asOptionalString(candidate.executionLockRunId),
    executionLockOwnerUserId: asOptionalString(candidate.executionLockOwnerUserId),
    executionLockAcquiredAt: asOptionalString(candidate.executionLockAcquiredAt),
    executionLockExpiresAt: asOptionalString(candidate.executionLockExpiresAt),
  };
};

const getCurrentPluginParameters = (ctx: OnBootCtx): PluginParameters =>
  ctx.plugin.attributes.parameters as PluginParameters;

const getCurrentScheduleState = (ctx: OnBootCtx): AutomaticBackupsScheduleState =>
  getAutomaticBackupsScheduleState(getCurrentPluginParameters(ctx));

const mergeSchedulePatchIntoParameters = (
  parameters: PluginParameters,
  schedulePatch: SchedulePatch,
): Record<string, unknown> => {
  const nextParameters = isObject(parameters) ? { ...parameters } : {};
  const currentSchedule = isObject(nextParameters.automaticBackupsSchedule)
    ? { ...nextParameters.automaticBackupsSchedule }
    : {};
  const mergedSchedule: Record<string, unknown> = {
    ...currentSchedule,
    ...schedulePatch,
  };

  for (const [key, value] of Object.entries(schedulePatch)) {
    if (value === undefined) {
      delete mergedSchedule[key];
    }
  }

  nextParameters.automaticBackupsSchedule = mergedSchedule;
  return nextParameters;
};

const persistSchedulePatch = async (
  ctx: OnBootCtx,
  schedulePatch: SchedulePatch,
): Promise<void> => {
  const latestParameters = getCurrentPluginParameters(ctx);
  await ctx.updatePluginParameters(
    mergeSchedulePatchIntoParameters(latestParameters, schedulePatch),
  );
};

const parseIsoDate = (value: string | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const isLockActive = (
  scheduleState: AutomaticBackupsScheduleState,
  now: Date,
): boolean => {
  if (!scheduleState.executionLockRunId) {
    return false;
  }

  const expiresAt = parseIsoDate(scheduleState.executionLockExpiresAt);
  if (!expiresAt) {
    return false;
  }

  return expiresAt.getTime() > now.getTime();
};

const hasActiveLockOwnership = (
  ctx: OnBootCtx,
  runId: string,
  now: Date = new Date(),
): boolean => {
  const scheduleState = getCurrentScheduleState(ctx);
  return scheduleState.executionLockRunId === runId && isLockActive(scheduleState, now);
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const newRunId = (): string => {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const toUtcDateKey = (date: Date): string => date.toISOString().split("T")[0];

export const toUtcIsoWeekKey = (date: Date): string => {
  const workingDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = workingDate.getUTCDay() || 7;
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((workingDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${workingDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const shouldRunInLambdalessTimeWindow = (
  now: Date,
  scheduleConfig: BackupScheduleConfig,
): boolean => {
  const minuteThreshold = parseTimeToMinuteOfDay(scheduleConfig.lambdalessTime);
  if (minuteThreshold === null) {
    return true;
  }

  const currentLocalMinute = toLocalMinuteOfDay(now, scheduleConfig.timezone);
  return currentLocalMinute >= minuteThreshold;
};

const backupOnBoot = async (ctx: OnBootCtx) => {
  const pluginParameters = getCurrentPluginParameters(ctx);
  const debugLogger = createDebugLogger(
    isDebugEnabled(pluginParameters),
    "backupOnBoot",
  );
  const runtimeMode = getRuntimeMode(pluginParameters);

  debugLogger.log("Evaluating on-boot backup execution", { runtimeMode });

  if (runtimeMode === "lambda") {
    debugLogger.log("Skipping on-boot backup because cron mode is enabled");
    return;
  }

  const initialNow = new Date();
  const projectTimezone = getProjectTimezone(ctx.site);
  const { config: scheduleConfig, requiresMigration } = normalizeBackupScheduleConfig({
    value: pluginParameters?.backupSchedule,
    timezoneFallback: projectTimezone,
    now: initialNow,
  });

  if (requiresMigration) {
    try {
      await ctx.updatePluginParameters({
        ...(pluginParameters ?? {}),
        backupSchedule: scheduleConfig,
      });
      debugLogger.log("Persisted normalized backup schedule config", {
        backupSchedule: scheduleConfig,
      });
    } catch (error) {
      debugLogger.warn("Could not persist normalized backup schedule config", error);
    }
  }

  if (!shouldRunInLambdalessTimeWindow(initialNow, scheduleConfig)) {
    debugLogger.log("Skipping on-boot backup because configured lambdaless time was not reached", {
      timezone: scheduleConfig.timezone,
      lambdalessTime: scheduleConfig.lambdalessTime,
    });
    return;
  }

  const initialScheduleState = getCurrentScheduleState(ctx);
  const initialCurrentLocalDate = toLocalDateKey(initialNow, scheduleConfig.timezone);
  const dueCadencesBeforeLock = scheduleConfig.enabledCadences.filter((cadence) => {
    const lastRunLocalDate = getLastRunLocalDateForCadence({
      scheduleState: initialScheduleState,
      cadence,
      now: initialNow,
    });

    return isCadenceDueNow({
      cadence,
      anchorLocalDate: scheduleConfig.anchorLocalDate,
      currentLocalDate: initialCurrentLocalDate,
      lastRunLocalDate,
    });
  });

  if (dueCadencesBeforeLock.length === 0) {
    debugLogger.log("Skipping on-boot backup because no cadence is due", {
      currentLocalDate: initialCurrentLocalDate,
      timezone: scheduleConfig.timezone,
      enabledCadenceCount: scheduleConfig.enabledCadences.length,
    });
    return;
  }

  if (isLockActive(initialScheduleState, initialNow)) {
    debugLogger.log("Skipping on-boot backup because another run holds the lock");
    return;
  }

  const runId = newRunId();
  const lockPatch: SchedulePatch = {
    executionLockRunId: runId,
    executionLockOwnerUserId: asOptionalUserId(ctx.currentUser?.id),
    executionLockAcquiredAt: initialNow.toISOString(),
    executionLockExpiresAt: new Date(initialNow.getTime() + LOCK_TTL_MS).toISOString(),
  };

  let lockWriteSucceeded = false;

  try {
    debugLogger.log("Attempting to acquire on-boot backup lock", {
      runId,
      lockExpiresAt: lockPatch.executionLockExpiresAt,
    });
    await persistSchedulePatch(ctx, lockPatch);
    lockWriteSucceeded = true;
  } catch (error) {
    debugLogger.error("Could not acquire on-boot backup lock", error);
    return;
  }

  try {
    await wait(LOCK_PROPAGATION_WAIT_MS);

    if (!hasActiveLockOwnership(ctx, runId)) {
      debugLogger.warn("Lock ownership verification failed after propagation window", {
        runId,
      });
      return;
    }

    const executionNow = new Date();
    if (!shouldRunInLambdalessTimeWindow(executionNow, scheduleConfig)) {
      debugLogger.log("Skipping on-boot backup after lock because configured time window is still not due", {
        timezone: scheduleConfig.timezone,
        lambdalessTime: scheduleConfig.lambdalessTime,
      });
      return;
    }

    const scheduleAfterLock = getCurrentScheduleState(ctx);
    const currentLocalDate = toLocalDateKey(executionNow, scheduleConfig.timezone);
    const runAtByCadence: Partial<Record<BackupCadence, string>> = {
      ...(scheduleAfterLock.lastRunAtByCadence ?? {}),
    };
    const runLocalDateByCadence: Partial<Record<BackupCadence, string>> = {
      ...(scheduleAfterLock.lastRunLocalDateByCadence ?? {}),
    };
    const managedEnvironmentIdByCadence: Partial<Record<BackupCadence, string>> = {
      ...(scheduleAfterLock.lastManagedEnvironmentIdByCadence ?? {}),
    };
    const executionModeByCadence: Partial<
      Record<BackupCadence, "lambdaless_on_boot">
    > = {
      ...(scheduleAfterLock.lastExecutionModeByCadence as Partial<
        Record<BackupCadence, "lambdaless_on_boot">
      >),
    };
    const errorByCadence: Partial<Record<BackupCadence, string>> = {
      ...(scheduleAfterLock.lastErrorByCadence ?? {}),
    };

    const schedulePatch: SchedulePatch = {};
    let didMutateSchedule = false;
    let dueCadenceCount = 0;

    for (const cadence of scheduleConfig.enabledCadences) {
      const lastRunLocalDate =
        runLocalDateByCadence[cadence] ??
        getLastRunLocalDateForCadence({
          scheduleState: scheduleAfterLock,
          cadence,
          now: executionNow,
        });
      const cadenceDue = isCadenceDueNow({
        cadence,
        anchorLocalDate: scheduleConfig.anchorLocalDate,
        currentLocalDate,
        lastRunLocalDate,
      });

      if (!cadenceDue) {
        continue;
      }
      dueCadenceCount += 1;

      if (!hasActiveLockOwnership(ctx, runId)) {
        debugLogger.warn("Skipping cadence backup because lock ownership was lost", {
          runId,
          cadence,
        });
        break;
      }

      try {
        const result = await backupEnvironmentSlotWithoutLambda({
          currentUserAccessToken: ctx.currentUserAccessToken,
          slot: cadence,
        });
        debugLogger.log("Lambdaless cadence backup completed", { cadence, result });

        runLocalDateByCadence[cadence] = currentLocalDate;
        runAtByCadence[cadence] = result.completedAt;
        managedEnvironmentIdByCadence[cadence] = result.managedEnvironmentId;
        executionModeByCadence[cadence] = "lambdaless_on_boot";
        delete errorByCadence[cadence];
        didMutateSchedule = true;

        if (cadence === "daily") {
          schedulePatch.dailyLastRunDate = currentLocalDate;
          schedulePatch.lastDailyRunAt = result.completedAt;
          schedulePatch.lastDailyManagedEnvironmentId = result.managedEnvironmentId;
          schedulePatch.lastDailyExecutionMode = "lambdaless_on_boot";
          schedulePatch.lastDailyError = undefined;
        }

        if (cadence === "weekly") {
          schedulePatch.weeklyLastRunKey = toUtcIsoWeekKey(executionNow);
          schedulePatch.lastWeeklyRunAt = result.completedAt;
          schedulePatch.lastWeeklyManagedEnvironmentId = result.managedEnvironmentId;
          schedulePatch.lastWeeklyExecutionMode = "lambdaless_on_boot";
          schedulePatch.lastWeeklyError = undefined;
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        debugLogger.error("Lambdaless cadence backup failed", {
          cadence,
          error: errorMessage,
        });
        errorByCadence[cadence] = errorMessage;
        didMutateSchedule = true;

        if (cadence === "daily") {
          schedulePatch.lastDailyError = errorMessage;
        }
        if (cadence === "weekly") {
          schedulePatch.lastWeeklyError = errorMessage;
        }
      }
    }

    debugLogger.log("Computed due lambdaless cadences", {
      currentLocalDate,
      timezone: scheduleConfig.timezone,
      dueCadenceCount,
      enabledCadenceCount: scheduleConfig.enabledCadences.length,
    });

    if (!didMutateSchedule) {
      return;
    }

    schedulePatch.lastRunLocalDateByCadence = runLocalDateByCadence;
    schedulePatch.lastRunAtByCadence = runAtByCadence;
    schedulePatch.lastManagedEnvironmentIdByCadence = managedEnvironmentIdByCadence;
    schedulePatch.lastExecutionModeByCadence = executionModeByCadence;
    schedulePatch.lastErrorByCadence = errorByCadence;

    await persistSchedulePatch(ctx, schedulePatch);
    debugLogger.log("Persisted on-boot backup schedule patch", {
      automaticBackupsSchedule: schedulePatch,
    });
  } finally {
    if (!lockWriteSucceeded) {
      return;
    }

    const scheduleBeforeRelease = getCurrentScheduleState(ctx);
    if (scheduleBeforeRelease.executionLockRunId !== runId) {
      debugLogger.log("Skipping lock release because ownership changed", { runId });
      return;
    }

    try {
      await persistSchedulePatch(ctx, {
        executionLockRunId: undefined,
        executionLockOwnerUserId: undefined,
        executionLockAcquiredAt: undefined,
        executionLockExpiresAt: undefined,
      });
      debugLogger.log("Released on-boot backup lock", { runId });
    } catch (error) {
      debugLogger.error("Could not release on-boot backup lock", error);
    }
  }
};

export default backupOnBoot;
