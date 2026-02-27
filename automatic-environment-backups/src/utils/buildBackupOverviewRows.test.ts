import { describe, expect, it } from "vitest";
import { buildBackupOverviewRows } from "./buildBackupOverviewRows";

const baseScheduleConfig = {
  version: 1 as const,
  enabledCadences: ["daily", "weekly"] as const,
  timezone: "UTC",
  anchorLocalDate: "2026-02-26",
  updatedAt: "2026-02-26T08:00:00.000Z",
};

describe("buildBackupOverviewRows", () => {
  it("returns lambdaless defaults when no runs were recorded", () => {
    const rows = buildBackupOverviewRows({
      runtimeMode: "lambdaless",
      scheduleState: {},
      scheduleConfig: {
        ...baseScheduleConfig,
        enabledCadences: ["daily", "weekly"],
      },
      now: new Date("2026-02-26T08:10:00.000Z"),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      scope: "daily",
      lastBackup: "Never",
      nextBackup: "Due now",
      environmentName: "Not yet created",
      environmentLinked: false,
    });
    expect(rows[1]).toMatchObject({
      scope: "weekly",
      lastBackup: "Never",
      nextBackup: "Due now",
      environmentName: "Not yet created",
      environmentLinked: false,
    });
  });

  it("computes future on-boot due dates when schedules are already up to date", () => {
    const rows = buildBackupOverviewRows({
      runtimeMode: "lambdaless",
      scheduleState: {
        lastRunLocalDateByCadence: {
          daily: "2026-02-26",
          weekly: "2026-02-26",
        },
        lastRunAtByCadence: {
          daily: "2026-02-26T08:09:59.000Z",
          weekly: "2026-02-26T08:09:58.000Z",
        },
        lastManagedEnvironmentIdByCadence: {
          daily: "automatic-backups-daily",
          weekly: "automatic-backups-weekly",
        },
      },
      scheduleConfig: {
        ...baseScheduleConfig,
        enabledCadences: ["daily", "weekly"],
      },
      now: new Date("2026-02-26T08:10:00.000Z"),
    });

    expect(rows[0].lastBackup).toBe("1 second ago");
    expect(rows[0].nextBackup).toBe("in 16 hours");
    expect(rows[0].environmentName).toBe("automatic-backups-daily");
    expect(rows[0].environmentLinked).toBe(true);
    expect(rows[1].lastBackup).toBe("2 seconds ago");
    expect(rows[1].nextBackup).toBe("in 7 days");
    expect(rows[1].environmentName).toBe("automatic-backups-weekly");
    expect(rows[1].environmentLinked).toBe(true);
  });

  it("maps lambda status payload into overview rows for all enabled cadences", () => {
    const rows = buildBackupOverviewRows({
      runtimeMode: "lambda",
      scheduleState: {},
      scheduleConfig: {
        ...baseScheduleConfig,
        enabledCadences: ["daily", "weekly", "biweekly", "monthly"],
      },
      lambdaStatus: {
        scheduler: {
          provider: "vercel",
          cadence: "daily",
        },
        slots: {
          daily: {
            scope: "daily",
            executionMode: "lambda_cron",
            lastBackupAt: "2026-02-26T02:05:00.000Z",
            nextBackupAt: "2026-02-27T02:05:00.000Z",
          },
          weekly: {
            scope: "weekly",
            executionMode: "lambda_cron",
            lastBackupAt: null,
            nextBackupAt: "2026-03-05T02:05:00.000Z",
          },
          biweekly: {
            scope: "biweekly",
            executionMode: "lambda_cron",
            lastBackupAt: "2026-02-12T02:05:00.000Z",
            nextBackupAt: "2026-03-12T02:05:00.000Z",
          },
          monthly: {
            scope: "monthly",
            executionMode: "lambda_cron",
            lastBackupAt: null,
            nextBackupAt: "2026-03-26T02:05:00.000Z",
          },
        },
        checkedAt: "2026-02-26T12:00:00.000Z",
      },
      now: new Date("2026-02-26T08:10:00.000Z"),
    });

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      scope: "daily",
      environmentName: "backup-plugin-daily-2026-02-26",
      environmentLinked: true,
    });
    expect(rows[1]).toMatchObject({
      scope: "weekly",
      lastBackup: "Never",
      environmentName: "Not yet created",
      environmentLinked: false,
    });
    expect(rows[2]).toMatchObject({
      scope: "biweekly",
      environmentName: "backup-plugin-biweekly-2026-02-12",
      environmentLinked: true,
    });
    expect(rows[3]).toMatchObject({
      scope: "monthly",
      lastBackup: "Never",
      environmentName: "Not yet created",
      environmentLinked: false,
    });
  });

  it("marks missing environments as deleted or renamed when absent from CMA list", () => {
    const rows = buildBackupOverviewRows({
      runtimeMode: "lambdaless",
      scheduleState: {
        lastRunLocalDateByCadence: {
          daily: "2026-02-26",
        },
        lastRunAtByCadence: {
          daily: "2026-02-26T08:09:59.000Z",
        },
        lastManagedEnvironmentIdByCadence: {
          daily: "automatic-backups-daily",
        },
      },
      scheduleConfig: {
        ...baseScheduleConfig,
        enabledCadences: ["daily"],
      },
      availableEnvironmentIds: ["main", "staging"],
      now: new Date("2026-02-26T08:10:00.000Z"),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "daily",
      environmentName: "automatic-backups-daily",
      environmentLinked: false,
      environmentStatusNote:
        "Missing in current environments list (deleted or renamed).",
    });
  });
});
