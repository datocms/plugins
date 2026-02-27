import { buildClient } from "@datocms/cma-client-browser";
import { OnBootCtx } from "datocms-plugin-sdk";
import {
  AutomaticBackupsScheduleState,
  BackupCadence,
} from "../types/types";
import {
  getLastRunLocalDateForCadence,
  isCadenceDueNow,
  normalizeBackupScheduleConfig,
  toLocalDateKey,
} from "./backupSchedule";
import { createDebugLogger, isDebugEnabled } from "./debugLogger";
import { getRuntimeMode } from "./getRuntimeMode";
import {
  backupEnvironmentSlotWithoutLambda,
  getManagedBackupForkStatusWithoutLambda,
} from "./lambdaLessBackup";
import { toAutomaticBackupsScheduleState } from "./automaticBackupsScheduleState";

type PluginParameters = Record<string, unknown> | undefined;
type SchedulePatch = Partial<AutomaticBackupsScheduleState>;
type LockStatus = "none" | "active" | "stale" | "unknown";
type LockDebugSnapshot = {
  status: LockStatus;
  runId: string | undefined;
  ownerUserId: string | undefined;
  cadenceInFlight: BackupCadence | undefined;
  acquiredAt: string | undefined;
  heartbeatAt: string | undefined;
  expiresAt: string | undefined;
  expiresAtValid: boolean;
  remainingLeaseMs: number | null;
};

export const LOCK_LEASE_MS = 3 * 60 * 1000;
export const LOCK_HEARTBEAT_INTERVAL_MS = 45 * 1000;
export const LOCK_PROPAGATION_WAIT_MS = 5500;
const ACTIVE_LOCK_RECONCILIATION_MIN_IDLE_MS =
  LOCK_HEARTBEAT_INTERVAL_MS * 2 + LOCK_PROPAGATION_WAIT_MS;
const ACTIVE_LOCK_BOOTSTRAP_STUCK_MS = LOCK_PROPAGATION_WAIT_MS + 10 * 1000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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


const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const getAutomaticBackupsScheduleState = (
  parameters: PluginParameters,
): AutomaticBackupsScheduleState => {
  return toAutomaticBackupsScheduleState(parameters?.automaticBackupsSchedule);
};

const getCurrentPluginParameters = (ctx: OnBootCtx): PluginParameters =>
  ctx.plugin.attributes.parameters as PluginParameters;

const getCurrentPluginId = (ctx: OnBootCtx): string | undefined => {
  const candidate = (ctx.plugin as { id?: unknown } | undefined)?.id;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
};

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

const parseIsoDate = (value: string | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const getLockStatus = (
  scheduleState: AutomaticBackupsScheduleState,
  now: Date,
): LockStatus => {
  if (!scheduleState.executionLockRunId) {
    return "none";
  }

  const expiresAt = parseIsoDate(scheduleState.executionLockExpiresAt);
  if (!expiresAt) {
    return "unknown";
  }

  return expiresAt.getTime() > now.getTime() ? "active" : "stale";
};

const isLockActive = (
  scheduleState: AutomaticBackupsScheduleState,
  now: Date,
): boolean => getLockStatus(scheduleState, now) === "active";

const buildLockDebugSnapshot = (
  scheduleState: AutomaticBackupsScheduleState,
  now: Date,
): LockDebugSnapshot => {
  const expiresAtDate = parseIsoDate(scheduleState.executionLockExpiresAt);
  const remainingLeaseMs = expiresAtDate
    ? expiresAtDate.getTime() - now.getTime()
    : null;

  return {
    status: getLockStatus(scheduleState, now),
    runId: scheduleState.executionLockRunId,
    ownerUserId: scheduleState.executionLockOwnerUserId,
    cadenceInFlight: scheduleState.executionLockCadenceInFlight,
    acquiredAt: scheduleState.executionLockAcquiredAt,
    heartbeatAt: scheduleState.executionLockHeartbeatAt,
    expiresAt: scheduleState.executionLockExpiresAt,
    expiresAtValid: Boolean(expiresAtDate),
    remainingLeaseMs,
  };
};

const getMostRecentLockActivityAt = (
  scheduleState: AutomaticBackupsScheduleState,
): Date | undefined => {
  const heartbeatAt = parseIsoDate(scheduleState.executionLockHeartbeatAt);
  const acquiredAt = parseIsoDate(scheduleState.executionLockAcquiredAt);

  if (heartbeatAt && acquiredAt) {
    return heartbeatAt.getTime() > acquiredAt.getTime() ? heartbeatAt : acquiredAt;
  }

  return heartbeatAt ?? acquiredAt;
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

let inFlightOnBootExecution: Promise<void> | undefined;

const runBackupOnBoot = async (ctx: OnBootCtx) => {
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

  const pluginId = getCurrentPluginId(ctx);
  const lockReadClient =
    pluginId && ctx.currentUserAccessToken
      ? buildClient({
          apiToken: ctx.currentUserAccessToken,
        })
      : undefined;

  debugLogger.log("Configured lock-state read strategy", {
    source: lockReadClient ? "cma_plugins_find" : "ctx_plugin_attributes",
    pluginId,
    hasCurrentUserAccessToken: Boolean(ctx.currentUserAccessToken),
  });

  const readScheduleStateForLocking = async (): Promise<AutomaticBackupsScheduleState> => {
    if (!lockReadClient || !pluginId) {
      return getCurrentScheduleState(ctx);
    }

    const plugin = await lockReadClient.plugins.find(pluginId);
    return getAutomaticBackupsScheduleState(plugin.parameters);
  };

  const readPluginParametersForWrites = async (): Promise<PluginParameters> => {
    if (!lockReadClient || !pluginId) {
      return getCurrentPluginParameters(ctx);
    }

    const plugin = await lockReadClient.plugins.find(pluginId);
    return (plugin.parameters as PluginParameters) ?? {};
  };

  const persistSchedulePatchForLocking = async (
    schedulePatch: SchedulePatch,
  ): Promise<void> => {
    const latestParameters = await readPluginParametersForWrites();
    await ctx.updatePluginParameters(
      mergeSchedulePatchIntoParameters(latestParameters, schedulePatch),
    );
  };

  const getCurrentLockDebugSnapshotForLocking = async (
    now: Date = new Date(),
  ): Promise<LockDebugSnapshot> =>
    buildLockDebugSnapshot(await readScheduleStateForLocking(), now);

  const getSafeCurrentLockDebugSnapshotForLocking = async (
    now: Date = new Date(),
  ): Promise<LockDebugSnapshot> => {
    try {
      return await getCurrentLockDebugSnapshotForLocking(now);
    } catch (error) {
      debugLogger.warn(
        "Using local lock snapshot fallback because authoritative lock read failed",
        {
          error: getErrorMessage(error),
        },
      );
      return buildLockDebugSnapshot(getCurrentScheduleState(ctx), now);
    }
  };

  const hasActiveLockOwnershipForLocking = async (
    runId: string,
    now: Date = new Date(),
  ): Promise<boolean> => {
    const scheduleState = await readScheduleStateForLocking();
    return (
      scheduleState.executionLockRunId === runId && isLockActive(scheduleState, now)
    );
  };

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

  let initialScheduleState: AutomaticBackupsScheduleState;
  try {
    initialScheduleState = await readScheduleStateForLocking();
  } catch (error) {
    debugLogger.error(
      "Skipping on-boot backup because authoritative lock state could not be read",
      {
        error: getErrorMessage(error),
      },
    );
    return;
  }
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

  let currentLockStatus = getLockStatus(initialScheduleState, initialNow);
  let currentLockSnapshot = buildLockDebugSnapshot(initialScheduleState, initialNow);
  debugLogger.log("Current lock snapshot before on-boot execution", currentLockSnapshot);

  if (currentLockStatus === "active") {
    debugLogger.log(
      "Detected active lock; evaluating managed environment status before deciding whether to keep it",
      {
        lock: currentLockSnapshot,
      },
    );

    const mostRecentLockActivityAt = getMostRecentLockActivityAt(initialScheduleState);
    const activeLockIdleMs = mostRecentLockActivityAt
      ? initialNow.getTime() - mostRecentLockActivityAt.getTime()
      : null;
    const heartbeatMatchesAcquiredAt =
      initialScheduleState.executionLockHeartbeatAt &&
      initialScheduleState.executionLockAcquiredAt &&
      initialScheduleState.executionLockHeartbeatAt ===
        initialScheduleState.executionLockAcquiredAt;
    const appearsStuckBeforeCadence =
      !initialScheduleState.executionLockCadenceInFlight &&
      heartbeatMatchesAcquiredAt &&
      typeof activeLockIdleMs === "number" &&
      activeLockIdleMs > ACTIVE_LOCK_BOOTSTRAP_STUCK_MS;

    if (appearsStuckBeforeCadence) {
      debugLogger.log(
        "Active lock appears stuck before cadence execution; allowing reconciliation",
        {
          lock: currentLockSnapshot,
          activeLockIdleMs,
          bootstrapStuckThresholdMs: ACTIVE_LOCK_BOOTSTRAP_STUCK_MS,
        },
      );
    }

    if (
      !appearsStuckBeforeCadence &&
      (initialScheduleState.executionLockCadenceInFlight ||
      (typeof activeLockIdleMs === "number" &&
        activeLockIdleMs < ACTIVE_LOCK_RECONCILIATION_MIN_IDLE_MS))
    ) {
      debugLogger.log(
        "Keeping active lock because it appears to belong to a live execution",
        {
          lock: currentLockSnapshot,
          activeLockIdleMs,
          minIdleBeforeReconciliationMs: ACTIVE_LOCK_RECONCILIATION_MIN_IDLE_MS,
        },
      );
      return;
    }

    if (!ctx.currentUserAccessToken) {
      debugLogger.warn(
        "Skipping active lock reconciliation because currentUserAccessToken is unavailable",
        {
          lock: currentLockSnapshot,
        },
      );
      return;
    }

    try {
      const forkStatus = await getManagedBackupForkStatusWithoutLambda({
        currentUserAccessToken: ctx.currentUserAccessToken,
      });

      if (forkStatus.hasInProgressManagedFork) {
        debugLogger.log("Keeping active lock because managed fork activity is in progress", {
          lock: currentLockSnapshot,
          inProgressManagedEnvironmentIds:
            forkStatus.inProgressManagedEnvironmentIds,
        });
        return;
      }

      const lockBeforeInvalidation = await getCurrentLockDebugSnapshotForLocking();
      if (
        lockBeforeInvalidation.runId !== currentLockSnapshot.runId ||
        lockBeforeInvalidation.status !== "active"
      ) {
        currentLockSnapshot = lockBeforeInvalidation;
        currentLockStatus = lockBeforeInvalidation.status;
        debugLogger.log(
          "Active lock changed while reconciling; continuing with refreshed lock state",
          { lock: currentLockSnapshot },
        );
      } else {
        await persistSchedulePatchForLocking({
          executionLockRunId: undefined,
          executionLockOwnerUserId: undefined,
          executionLockAcquiredAt: undefined,
          executionLockHeartbeatAt: undefined,
          executionLockExpiresAt: undefined,
          executionLockCadenceInFlight: undefined,
        });
        currentLockSnapshot = {
          ...lockBeforeInvalidation,
          status: "none",
          runId: undefined,
          ownerUserId: undefined,
          cadenceInFlight: undefined,
          acquiredAt: undefined,
          heartbeatAt: undefined,
          expiresAt: undefined,
          expiresAtValid: false,
          remainingLeaseMs: null,
        };
        currentLockStatus = "none";
        debugLogger.log(
          "Invalidated active lock because managed environments are ready",
          {
            previousLock: lockBeforeInvalidation,
            lock: currentLockSnapshot,
          },
        );
      }
    } catch (error) {
      debugLogger.error(
        "Could not reconcile active lock against managed environment status",
        {
          lock: currentLockSnapshot,
          error: getErrorMessage(error),
        },
      );
      return;
    }

    if (currentLockStatus === "active") {
      debugLogger.log("Skipping on-boot backup because another run still holds the lock", {
        lock: currentLockSnapshot,
      });
      return;
    }
  }

  if (currentLockStatus === "unknown") {
    debugLogger.warn(
      "Skipping on-boot backup because lock metadata is invalid and ownership is uncertain",
      { lock: currentLockSnapshot },
    );
    return;
  }

  if (currentLockStatus === "stale") {
    debugLogger.log("Detected stale lock; evaluating takeover safety", {
      lock: currentLockSnapshot,
    });

    if (!ctx.currentUserAccessToken) {
      debugLogger.warn(
        "Skipping stale lock takeover because currentUserAccessToken is unavailable",
        {
          lock: currentLockSnapshot,
        },
      );
      return;
    }

    try {
      const forkStatus = await getManagedBackupForkStatusWithoutLambda({
        currentUserAccessToken: ctx.currentUserAccessToken,
      });

      if (forkStatus.hasInProgressManagedFork) {
        debugLogger.log(
          "Skipping stale lock takeover because managed fork activity is in progress",
          {
            lock: currentLockSnapshot,
            inProgressManagedEnvironmentIds:
              forkStatus.inProgressManagedEnvironmentIds,
          },
        );
        return;
      }

      debugLogger.log(
        "Stale lock takeover check passed; no managed fork activity detected",
        {
          lock: currentLockSnapshot,
        },
      );
    } catch (error) {
      debugLogger.error(
        "Could not verify managed environment fork status for stale lock takeover",
        {
          lock: currentLockSnapshot,
          error: getErrorMessage(error),
        },
      );
      return;
    }
  }

  const runId = newRunId();
  const lockAcquiredAt = initialNow.toISOString();
  const lockPatch: SchedulePatch = {
    executionLockRunId: runId,
    executionLockOwnerUserId: asOptionalUserId(ctx.currentUser?.id),
    executionLockAcquiredAt: lockAcquiredAt,
    executionLockHeartbeatAt: lockAcquiredAt,
    executionLockExpiresAt: new Date(initialNow.getTime() + LOCK_LEASE_MS).toISOString(),
    executionLockCadenceInFlight: undefined,
  };

  let lockWriteSucceeded = false;
  let leaseHealthy = true;
  let cadenceInFlight: BackupCadence | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatPromise: Promise<boolean> | undefined;
  let schedulePatchQueue: Promise<void> = Promise.resolve();

  const persistSchedulePatchSerial = (schedulePatch: SchedulePatch): Promise<void> => {
    const write = schedulePatchQueue.then(() =>
      persistSchedulePatchForLocking(schedulePatch),
    );
    schedulePatchQueue = write.catch(() => undefined);
    return write;
  };

  const renewLease = async ({
    reason,
    nextCadenceInFlight,
  }: {
    reason: "cadence_start" | "cadence_complete" | "heartbeat";
    nextCadenceInFlight?: BackupCadence;
  }): Promise<boolean> => {
    if (!leaseHealthy) {
      return false;
    }

    const now = new Date();
    let lockOwnedBeforeRenewal = false;
    try {
      lockOwnedBeforeRenewal = await hasActiveLockOwnershipForLocking(runId, now);
    } catch (error) {
      leaseHealthy = false;
      debugLogger.error(
        "Could not verify lock ownership before renewing lock lease",
        {
          runId,
          reason,
          cadence: nextCadenceInFlight,
          error: getErrorMessage(error),
        },
      );
      return false;
    }

    if (!lockOwnedBeforeRenewal) {
      leaseHealthy = false;
      debugLogger.warn("Skipping lock lease renewal because lock ownership was lost", {
        runId,
        reason,
        cadence: nextCadenceInFlight,
        lock: await getSafeCurrentLockDebugSnapshotForLocking(now),
      });
      return false;
    }

    try {
      await persistSchedulePatchSerial({
        executionLockHeartbeatAt: now.toISOString(),
        executionLockExpiresAt: new Date(now.getTime() + LOCK_LEASE_MS).toISOString(),
        executionLockCadenceInFlight: nextCadenceInFlight,
      });
    } catch (error) {
      leaseHealthy = false;
      debugLogger.error("Could not renew on-boot backup lease", {
        runId,
        reason,
        cadence: nextCadenceInFlight,
        error: getErrorMessage(error),
        lock: await getSafeCurrentLockDebugSnapshotForLocking(),
      });
      return false;
    }

    debugLogger.log("Renewed on-boot backup lease", {
      runId,
      reason,
      cadence: nextCadenceInFlight,
      lock: await getSafeCurrentLockDebugSnapshotForLocking(),
    });

    return true;
  };

  const startLeaseHeartbeat = () => {
    debugLogger.log("Starting lock lease heartbeat", {
      runId,
      heartbeatIntervalMs: LOCK_HEARTBEAT_INTERVAL_MS,
      leaseDurationMs: LOCK_LEASE_MS,
    });

    heartbeatTimer = setInterval(() => {
      if (!leaseHealthy || heartbeatPromise) {
        return;
      }

      heartbeatPromise = renewLease({
        reason: "heartbeat",
        nextCadenceInFlight: cadenceInFlight,
      }).finally(() => {
        heartbeatPromise = undefined;
      });
    }, LOCK_HEARTBEAT_INTERVAL_MS);
  };

  const stopLeaseHeartbeat = async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      debugLogger.log("Stopped lock lease heartbeat interval", { runId });
    }

    if (heartbeatPromise) {
      await heartbeatPromise;
      debugLogger.log("Awaited pending lock lease heartbeat renewal", { runId });
    }
  };

  try {
    debugLogger.log("Attempting to acquire on-boot backup lock", {
      runId,
      lockExpiresAt: lockPatch.executionLockExpiresAt,
      previousLock: currentLockSnapshot,
    });
    await persistSchedulePatchSerial(lockPatch);
    lockWriteSucceeded = true;
    debugLogger.log("Lock write submitted; waiting for propagation window", {
      runId,
      lock: lockPatch,
    });
  } catch (error) {
    debugLogger.error("Could not acquire on-boot backup lock", {
      runId,
      error: getErrorMessage(error),
      previousLock: currentLockSnapshot,
    });
    return;
  }

  try {
    await wait(LOCK_PROPAGATION_WAIT_MS);

    let lockOwnedAfterPropagation = false;
    try {
      lockOwnedAfterPropagation = await hasActiveLockOwnershipForLocking(runId);
    } catch (error) {
      debugLogger.error(
        "Could not verify lock ownership after propagation window",
        {
          runId,
          error: getErrorMessage(error),
        },
      );
      return;
    }

    if (!lockOwnedAfterPropagation) {
      debugLogger.warn("Lock ownership verification failed after propagation window", {
        runId,
        lock: await getSafeCurrentLockDebugSnapshotForLocking(),
      });
      return;
    }

    debugLogger.log("Lock ownership verified after propagation window", {
      runId,
      lock: await getSafeCurrentLockDebugSnapshotForLocking(),
    });

    startLeaseHeartbeat();

    const executionNow = new Date();
    let scheduleAfterLock: AutomaticBackupsScheduleState;
    try {
      scheduleAfterLock = await readScheduleStateForLocking();
    } catch (error) {
      debugLogger.error(
        "Could not read lock state after acquisition; aborting on-boot backup run",
        {
          runId,
          error: getErrorMessage(error),
        },
      );
      return;
    }
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

      if (!leaseHealthy) {
        debugLogger.warn("Skipping cadence backup because lock lease is unhealthy", {
          runId,
          cadence,
          lock: await getSafeCurrentLockDebugSnapshotForLocking(),
        });
        break;
      }

      let lockOwnershipStillValid = false;
      try {
        lockOwnershipStillValid = await hasActiveLockOwnershipForLocking(runId);
      } catch (error) {
        debugLogger.error(
          "Could not verify lock ownership before cadence execution",
          {
            runId,
            cadence,
            error: getErrorMessage(error),
          },
        );
        break;
      }

      if (!lockOwnershipStillValid) {
        debugLogger.warn("Skipping cadence backup because lock ownership was lost", {
          runId,
          cadence,
          lock: await getSafeCurrentLockDebugSnapshotForLocking(),
        });
        break;
      }

      cadenceInFlight = cadence;
      const markedCadence = await renewLease({
        reason: "cadence_start",
        nextCadenceInFlight: cadenceInFlight,
      });
      if (!markedCadence) {
        debugLogger.warn(
          "Skipping cadence backup because lock lease renewal failed before execution",
          {
            runId,
            cadence,
            lock: await getSafeCurrentLockDebugSnapshotForLocking(),
          },
        );
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

      cadenceInFlight = undefined;
      const clearedCadence = await renewLease({
        reason: "cadence_complete",
        nextCadenceInFlight: undefined,
      });
      if (!clearedCadence) {
        debugLogger.warn(
          "Stopping cadence loop because lock lease renewal failed after execution",
          {
            runId,
            cadence,
            lock: await getSafeCurrentLockDebugSnapshotForLocking(),
          },
        );
        break;
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

    await persistSchedulePatchSerial(schedulePatch);
    debugLogger.log("Persisted on-boot backup schedule patch", {
      automaticBackupsSchedule: schedulePatch,
    });
  } finally {
    cadenceInFlight = undefined;
    await stopLeaseHeartbeat();
    await schedulePatchQueue;

    if (!lockWriteSucceeded) {
      return;
    }

    let scheduleBeforeRelease: AutomaticBackupsScheduleState;
    try {
      scheduleBeforeRelease = await readScheduleStateForLocking();
    } catch (error) {
      debugLogger.error(
        "Could not verify lock ownership before release; keeping lock intact",
        {
          runId,
          error: getErrorMessage(error),
        },
      );
      return;
    }

    if (scheduleBeforeRelease.executionLockRunId !== runId) {
      debugLogger.log("Skipping lock release because ownership changed", {
        runId,
        lock: buildLockDebugSnapshot(scheduleBeforeRelease, new Date()),
      });
      return;
    }

    try {
      await persistSchedulePatchSerial({
        executionLockRunId: undefined,
        executionLockOwnerUserId: undefined,
        executionLockAcquiredAt: undefined,
        executionLockHeartbeatAt: undefined,
        executionLockExpiresAt: undefined,
        executionLockCadenceInFlight: undefined,
      });
      await schedulePatchQueue;
      debugLogger.log("Released on-boot backup lock", {
        runId,
        lock: await getSafeCurrentLockDebugSnapshotForLocking(),
      });
    } catch (error) {
      debugLogger.error("Could not release on-boot backup lock", {
        runId,
        error: getErrorMessage(error),
        lock: await getSafeCurrentLockDebugSnapshotForLocking(),
      });
    }
  }
};

const backupOnBoot = async (ctx: OnBootCtx) => {
  const pluginParameters = getCurrentPluginParameters(ctx);
  const debugLogger = createDebugLogger(
    isDebugEnabled(pluginParameters),
    "backupOnBoot",
  );

  if (inFlightOnBootExecution) {
    debugLogger.log(
      "Joining existing on-boot backup execution in the current browser context",
    );
    await inFlightOnBootExecution;
    return;
  }

  const execution = runBackupOnBoot(ctx);
  inFlightOnBootExecution = execution;

  try {
    await execution;
  } finally {
    if (inFlightOnBootExecution === execution) {
      inFlightOnBootExecution = undefined;
    }
  }
};

export default backupOnBoot;
