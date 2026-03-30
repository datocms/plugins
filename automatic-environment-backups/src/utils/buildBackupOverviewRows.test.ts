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
  it("maps lambda status payload into overview rows for all enabled cadences", () => {
    const rows = buildBackupOverviewRows({
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
      scheduleConfig: {
        ...baseScheduleConfig,
        enabledCadences: ["daily"],
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
            lastBackupAt: "2026-02-26T08:09:59.000Z",
            nextBackupAt: "2026-02-27T08:09:59.000Z",
          },
          weekly: {
            scope: "weekly",
            executionMode: "lambda_cron",
            lastBackupAt: null,
            nextBackupAt: "2026-03-05T08:09:59.000Z",
          },
        },
        checkedAt: "2026-02-26T08:10:00.000Z",
      },
      availableEnvironmentIds: ["main", "staging"],
      now: new Date("2026-02-26T08:10:00.000Z"),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "daily",
      environmentName: "backup-plugin-daily-2026-02-26",
      environmentLinked: false,
      environmentStatusNote:
        "Missing in current environments list (deleted or renamed).",
    });
  });
});
