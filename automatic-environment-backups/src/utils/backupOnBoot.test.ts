import { afterEach, describe, expect, it, vi } from "vitest";
import backupOnBoot, {
  LOCK_PROPAGATION_WAIT_MS,
  toUtcDateKey,
  toUtcIsoWeekKey,
} from "./backupOnBoot";
import { backupEnvironmentSlotWithoutLambda } from "./lambdaLessBackup";

vi.mock("./lambdaLessBackup", () => ({
  backupEnvironmentSlotWithoutLambda: vi.fn(),
}));

type PluginParameters = Record<string, unknown>;

type Ctx = {
  plugin: {
    attributes: {
      parameters: PluginParameters;
    };
  };
  currentUserAccessToken: string;
  currentUser: {
    id: string;
  };
  updatePluginParameters: ReturnType<typeof vi.fn>;
};

type ParameterStore = {
  current: PluginParameters;
};

const getSchedule = (parameters: PluginParameters): Record<string, unknown> => {
  const candidate = parameters.automaticBackupsSchedule;
  return candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : {};
};

const createBackupSchedule = (
  overrides: Partial<{
    enabledCadences: ("daily" | "weekly" | "biweekly" | "monthly")[];
    timezone: string;
    anchorLocalDate: string;
  }> = {},
) => ({
  version: 1 as const,
  enabledCadences: ["daily", "weekly"],
  timezone: "UTC",
  anchorLocalDate: new Date().toISOString().split("T")[0],
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const createCtx = ({
  initialParameters = {},
  store,
  userId = "user-1",
  onUpdate,
}: {
  initialParameters?: PluginParameters;
  store?: ParameterStore;
  userId?: string;
  onUpdate?: (
    nextParameters: PluginParameters,
    parameterStore: ParameterStore,
  ) => Promise<void> | void;
} = {}): {
  ctx: Ctx;
  store: ParameterStore;
} => {
  const normalizedInitialParameters: PluginParameters = { ...initialParameters };
  if (
    normalizedInitialParameters.runtimeMode === "lambdaless" &&
    !("backupSchedule" in normalizedInitialParameters)
  ) {
    normalizedInitialParameters.backupSchedule = createBackupSchedule();
  }

  const parameterStore: ParameterStore = store ?? {
    current: { ...normalizedInitialParameters },
  };

  if (!store) {
    parameterStore.current = { ...normalizedInitialParameters };
  }

  const attributes = {} as { parameters: PluginParameters };

  Object.defineProperty(attributes, "parameters", {
    get: () => parameterStore.current,
    set: (value: PluginParameters) => {
      parameterStore.current = value;
    },
    enumerable: true,
    configurable: true,
  });

  const updatePluginParameters = vi.fn(
    async (nextParameters: PluginParameters): Promise<void> => {
      if (onUpdate) {
        await onUpdate(nextParameters, parameterStore);
        return;
      }

      parameterStore.current = nextParameters;
    },
  );

  return {
    ctx: {
      plugin: {
        attributes,
      },
      currentUserAccessToken: "token",
      currentUser: {
        id: userId,
      },
      updatePluginParameters,
    },
    store: parameterStore,
  };
};

const runWithPropagationWindow = async (ctx: Ctx) => {
  const execution = backupOnBoot(ctx as never);
  await vi.advanceTimersByTimeAsync(LOCK_PROPAGATION_WAIT_MS + 100);
  await execution;
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("backupOnBoot", () => {
  it("skips lambdaless execution when runtime mode is lambda", async () => {
    const { ctx } = createCtx({ initialParameters: { runtimeMode: "lambda" } });

    await backupOnBoot(ctx as never);

    expect(backupEnvironmentSlotWithoutLambda).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it("runs both daily and weekly backups when both are due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    vi.mocked(backupEnvironmentSlotWithoutLambda).mockResolvedValueOnce({
      slot: "daily",
      managedEnvironmentId: "automatic-backups-daily",
      sourceEnvironmentId: "main",
      replacedExistingEnvironment: false,
      completedAt: "2026-02-26T08:10:01.000Z",
    });
    vi.mocked(backupEnvironmentSlotWithoutLambda).mockResolvedValueOnce({
      slot: "weekly",
      managedEnvironmentId: "automatic-backups-weekly",
      sourceEnvironmentId: "main",
      replacedExistingEnvironment: false,
      completedAt: "2026-02-26T08:10:02.000Z",
    });

    const { ctx, store } = createCtx({
      initialParameters: { runtimeMode: "lambdaless" },
    });

    await runWithPropagationWindow(ctx);

    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenCalledTimes(2);
    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenNthCalledWith(1, {
      currentUserAccessToken: "token",
      slot: "daily",
    });
    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenNthCalledWith(2, {
      currentUserAccessToken: "token",
      slot: "weekly",
    });

    const schedule = getSchedule(store.current);
    expect(schedule).toMatchObject({
      dailyLastRunDate: toUtcDateKey(new Date("2026-02-26T08:10:00.000Z")),
      weeklyLastRunKey: toUtcIsoWeekKey(new Date("2026-02-26T08:10:00.000Z")),
      lastDailyManagedEnvironmentId: "automatic-backups-daily",
      lastWeeklyManagedEnvironmentId: "automatic-backups-weekly",
      lastDailyExecutionMode: "lambdaless_on_boot",
      lastWeeklyExecutionMode: "lambdaless_on_boot",
    });
    expect(schedule.executionLockRunId).toBeUndefined();
  });

  it("runs due cadences even when legacy schedule includes lambdalessTime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    vi.mocked(backupEnvironmentSlotWithoutLambda).mockResolvedValueOnce({
      slot: "daily",
      managedEnvironmentId: "automatic-backups-daily",
      sourceEnvironmentId: "main",
      replacedExistingEnvironment: false,
      completedAt: "2026-02-26T08:10:01.000Z",
    });

    const { ctx, store } = createCtx({
      initialParameters: {
        runtimeMode: "lambdaless",
        backupSchedule: {
          version: 1,
          enabledCadences: ["daily"],
          timezone: "UTC",
          lambdalessTime: "23:59",
          anchorLocalDate: "2026-02-26",
          updatedAt: "2026-02-25T08:00:00.000Z",
        },
      },
    });

    await runWithPropagationWindow(ctx);

    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenCalledTimes(1);
    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenCalledWith({
      currentUserAccessToken: "token",
      slot: "daily",
    });

    const backupSchedule = store.current.backupSchedule as Record<string, unknown>;
    expect(backupSchedule).toMatchObject({
      version: 1,
      enabledCadences: ["daily"],
      timezone: "UTC",
      anchorLocalDate: "2026-02-26",
      updatedAt: "2026-02-25T08:00:00.000Z",
    });
    expect("lambdalessTime" in backupSchedule).toBe(false);
  });

  it("skips execution when daily and weekly schedules are up to date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    const now = new Date();
    const { ctx } = createCtx({
      initialParameters: {
        runtimeMode: "lambdaless",
        automaticBackupsSchedule: {
          dailyLastRunDate: toUtcDateKey(now),
          weeklyLastRunKey: toUtcIsoWeekKey(now),
        },
      },
    });

    await backupOnBoot(ctx as never);

    expect(backupEnvironmentSlotWithoutLambda).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it("persists only successful watermark updates when one slot fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    vi.mocked(backupEnvironmentSlotWithoutLambda).mockResolvedValueOnce({
      slot: "daily",
      managedEnvironmentId: "automatic-backups-daily",
      sourceEnvironmentId: "main",
      replacedExistingEnvironment: true,
      completedAt: "2026-02-26T08:10:01.000Z",
    });
    vi.mocked(backupEnvironmentSlotWithoutLambda).mockRejectedValueOnce(
      new Error("Weekly backup failed"),
    );

    const { ctx, store } = createCtx({
      initialParameters: {
        runtimeMode: "lambdaless",
        automaticBackupsSchedule: {
          weeklyLastRunKey: "2026-W01",
        },
      },
    });

    await runWithPropagationWindow(ctx);

    const schedule = getSchedule(store.current);
    expect(schedule).toMatchObject({
      dailyLastRunDate: "2026-02-26",
      weeklyLastRunKey: "2026-W01",
      lastDailyManagedEnvironmentId: "automatic-backups-daily",
      lastDailyExecutionMode: "lambdaless_on_boot",
      lastWeeklyError: "Weekly backup failed",
    });
  });

  it("defaults legacy installs with deploymentURL to lambda mode and skips on-boot backups", async () => {
    const { ctx } = createCtx({
      initialParameters: {
        deploymentURL: "https://backups.example.com",
      },
    });

    await backupOnBoot(ctx as never);

    expect(backupEnvironmentSlotWithoutLambda).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it("skips execution when an active lock is present", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    const { ctx } = createCtx({
      initialParameters: {
        runtimeMode: "lambdaless",
        automaticBackupsSchedule: {
          executionLockRunId: "existing-lock",
          executionLockExpiresAt: "2026-02-26T08:30:00.000Z",
        },
      },
    });

    await backupOnBoot(ctx as never);

    expect(backupEnvironmentSlotWithoutLambda).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });

  it("fails closed when lock write fails", async () => {
    const { ctx } = createCtx({
      initialParameters: {
        runtimeMode: "lambdaless",
      },
      onUpdate: async () => {
        throw new Error("lock write failed");
      },
    });

    await backupOnBoot(ctx as never);

    expect(ctx.updatePluginParameters).toHaveBeenCalledTimes(1);
    expect(backupEnvironmentSlotWithoutLambda).not.toHaveBeenCalled();
  });

  it("does not clear the lock when ownership changed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    const now = new Date();
    const { ctx, store } = createCtx({
      initialParameters: {
        runtimeMode: "lambdaless",
        automaticBackupsSchedule: {
          weeklyLastRunKey: toUtcIsoWeekKey(now),
        },
      },
    });

    vi.mocked(backupEnvironmentSlotWithoutLambda).mockImplementationOnce(async () => {
      const currentSchedule = getSchedule(store.current);
      store.current = {
        ...store.current,
        automaticBackupsSchedule: {
          ...currentSchedule,
          executionLockRunId: "other-run",
          executionLockOwnerUserId: "user-2",
          executionLockAcquiredAt: "2026-02-26T08:10:03.000Z",
          executionLockExpiresAt: "2026-02-26T08:30:00.000Z",
        },
      };

      return {
        slot: "daily",
        managedEnvironmentId: "automatic-backups-daily",
        sourceEnvironmentId: "main",
        replacedExistingEnvironment: false,
        completedAt: "2026-02-26T08:10:04.000Z",
      };
    });

    await runWithPropagationWindow(ctx);

    const schedule = getSchedule(store.current);
    expect(schedule.dailyLastRunDate).toBe("2026-02-26");
    expect(schedule.executionLockRunId).toBe("other-run");
    expect(schedule.executionLockOwnerUserId).toBe("user-2");
  });

  it("recomputes due state after lock acquisition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    const now = new Date();
    const currentDateKey = toUtcDateKey(now);
    const currentWeekKey = toUtcIsoWeekKey(now);
    const { ctx, store } = createCtx({
      initialParameters: {
        runtimeMode: "lambdaless",
      },
      onUpdate: async (nextParameters, parameterStore) => {
        parameterStore.current = nextParameters;
      },
    });

    let updateCount = 0;
    ctx.updatePluginParameters.mockImplementationOnce(
      async (nextParameters: PluginParameters) => {
        updateCount += 1;
        store.current = nextParameters;
        setTimeout(() => {
          const currentSchedule = getSchedule(store.current);
          store.current = {
            ...store.current,
            automaticBackupsSchedule: {
              ...currentSchedule,
              dailyLastRunDate: currentDateKey,
              weeklyLastRunKey: currentWeekKey,
            },
          };
        }, 1000);
      },
    );
    ctx.updatePluginParameters.mockImplementation(async (nextParameters: PluginParameters) => {
      updateCount += 1;
      store.current = nextParameters;
    });

    await runWithPropagationWindow(ctx);

    expect(updateCount).toBeGreaterThanOrEqual(2);
    expect(backupEnvironmentSlotWithoutLambda).not.toHaveBeenCalled();
    const schedule = getSchedule(store.current);
    expect(schedule.dailyLastRunDate).toBe(currentDateKey);
    expect(schedule.weeklyLastRunKey).toBe(currentWeekKey);
    expect(schedule.executionLockRunId).toBeUndefined();
  });

  it("prevents duplicate execution for two concurrent onBoot calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    const sharedStore: ParameterStore = {
      current: {
        runtimeMode: "lambdaless",
      },
    };
    const { ctx: firstCtx } = createCtx({
      store: sharedStore,
      userId: "user-a",
    });
    const { ctx: secondCtx } = createCtx({
      store: sharedStore,
      userId: "user-b",
    });

    vi.mocked(backupEnvironmentSlotWithoutLambda).mockImplementation(async ({ slot }) => ({
      slot,
      managedEnvironmentId:
        slot === "daily" ? "automatic-backups-daily" : "automatic-backups-weekly",
      sourceEnvironmentId: "main",
      replacedExistingEnvironment: false,
      completedAt: "2026-02-26T08:10:01.000Z",
    }));

    const firstExecution = backupOnBoot(firstCtx as never);
    const secondExecution = backupOnBoot(secondCtx as never);
    await vi.advanceTimersByTimeAsync(LOCK_PROPAGATION_WAIT_MS + 100);
    await Promise.all([firstExecution, secondExecution]);

    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenCalledTimes(2);
    const schedule = getSchedule(sharedStore.current);
    expect(schedule.dailyLastRunDate).toBe("2026-02-26");
    expect(schedule.weeklyLastRunKey).toBe(
      toUtcIsoWeekKey(new Date("2026-02-26T08:10:00.000Z")),
    );
    expect(schedule.executionLockRunId).toBeUndefined();
  });
});
