import { afterEach, describe, expect, it, vi } from "vitest";
import backupOnBoot, { toUtcDateKey, toUtcIsoWeekKey } from "./backupOnBoot";
import { backupEnvironmentSlotWithoutLambda } from "./lambdaLessBackup";

vi.mock("./lambdaLessBackup", () => ({
  backupEnvironmentSlotWithoutLambda: vi.fn(),
}));

type Ctx = {
  plugin: {
    attributes: {
      parameters: Record<string, unknown>;
    };
  };
  currentUserAccessToken: string;
  updatePluginParameters: ReturnType<typeof vi.fn>;
};

const createCtx = (parameters: Record<string, unknown>): Ctx => ({
  plugin: {
    attributes: {
      parameters,
    },
  },
  currentUserAccessToken: "token",
  updatePluginParameters: vi.fn(),
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("backupOnBoot", () => {
  it("skips lambdaless execution when runtime mode is lambda", async () => {
    const ctx = createCtx({ runtimeMode: "lambda" });

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

    const ctx = createCtx({ runtimeMode: "lambdaless" });

    await backupOnBoot(ctx as never);

    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenCalledTimes(2);
    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenNthCalledWith(1, {
      currentUserAccessToken: "token",
      slot: "daily",
    });
    expect(backupEnvironmentSlotWithoutLambda).toHaveBeenNthCalledWith(2, {
      currentUserAccessToken: "token",
      slot: "weekly",
    });

    expect(ctx.updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        automaticBackupsSchedule: expect.objectContaining({
          dailyLastRunDate: toUtcDateKey(new Date("2026-02-26T08:10:00.000Z")),
          weeklyLastRunKey: toUtcIsoWeekKey(
            new Date("2026-02-26T08:10:00.000Z"),
          ),
          lastDailyManagedEnvironmentId: "automatic-backups-daily",
          lastWeeklyManagedEnvironmentId: "automatic-backups-weekly",
          lastDailyExecutionMode: "lambdaless_on_boot",
          lastWeeklyExecutionMode: "lambdaless_on_boot",
        }),
      }),
    );
  });

  it("skips execution when daily and weekly schedules are up to date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T08:10:00.000Z"));
    const now = new Date();
    const ctx = createCtx({
      runtimeMode: "lambdaless",
      automaticBackupsSchedule: {
        dailyLastRunDate: toUtcDateKey(now),
        weeklyLastRunKey: toUtcIsoWeekKey(now),
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

    const ctx = createCtx({
      runtimeMode: "lambdaless",
      automaticBackupsSchedule: {
        weeklyLastRunKey: "2026-W01",
      },
    });

    await backupOnBoot(ctx as never);

    expect(ctx.updatePluginParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        automaticBackupsSchedule: expect.objectContaining({
          dailyLastRunDate: "2026-02-26",
          weeklyLastRunKey: "2026-W01",
          lastDailyManagedEnvironmentId: "automatic-backups-daily",
          lastDailyExecutionMode: "lambdaless_on_boot",
          lastWeeklyError: "Weekly backup failed",
        }),
      }),
    );
  });

  it("defaults legacy installs with deploymentURL to lambda mode and skips on-boot backups", async () => {
    const ctx = createCtx({
      deploymentURL: "https://backups.example.com",
    });

    await backupOnBoot(ctx as never);

    expect(backupEnvironmentSlotWithoutLambda).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });
});
