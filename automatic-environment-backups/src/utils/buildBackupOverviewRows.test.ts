import { describe, expect, it } from "vitest";
import { buildBackupOverviewRows } from "./buildBackupOverviewRows";

describe("buildBackupOverviewRows", () => {
  it("returns lambdaless defaults when no runs were recorded", () => {
    const rows = buildBackupOverviewRows({
      runtimeMode: "lambdaless",
      scheduleState: {},
      now: new Date("2026-02-26T08:10:00.000Z"),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      scope: "daily",
      lastBackup: "Never",
      nextBackup: "Due now (on next dashboard login)",
      source: "Lambdaless on boot",
      sourceDetails: "Managed env: automatic-backups-daily",
    });
    expect(rows[1]).toMatchObject({
      scope: "weekly",
      lastBackup: "Never",
      nextBackup: "Due now (on next dashboard login)",
      sourceDetails: "Managed env: automatic-backups-weekly",
    });
  });

  it("computes future on-boot due dates when schedules are already up to date", () => {
    const rows = buildBackupOverviewRows({
      runtimeMode: "lambdaless",
      scheduleState: {
        dailyLastRunDate: "2026-02-26",
        weeklyLastRunKey: "2026-W09",
        lastDailyRunAt: "2026-02-26T08:10:01.000Z",
        lastWeeklyRunAt: "2026-02-26T08:10:02.000Z",
        lastDailyManagedEnvironmentId: "automatic-backups-daily",
        lastWeeklyManagedEnvironmentId: "automatic-backups-weekly",
      },
      now: new Date("2026-02-26T08:10:00.000Z"),
    });

    expect(rows[0].lastBackup).toBe("2026-02-26 08:10:01 UTC");
    expect(rows[0].nextBackup).toBe(
      "2026-02-27 00:00:00 UTC (on next dashboard login)",
    );
    expect(rows[1].lastBackup).toBe("2026-02-26 08:10:02 UTC");
    expect(rows[1].nextBackup).toBe(
      "2026-03-02 00:00:00 UTC (on next dashboard login)",
    );
  });

  it("maps lambda status payload into overview rows", () => {
    const rows = buildBackupOverviewRows({
      runtimeMode: "lambda",
      scheduleState: {},
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
            nextBackupAt: "2026-03-02T02:35:00.000Z",
          },
        },
        checkedAt: "2026-02-26T12:00:00.000Z",
      },
    });

    expect(rows[0]).toMatchObject({
      scope: "daily",
      lastBackup: "2026-02-26 02:05:00 UTC",
      nextBackup: "2026-02-27 02:05:00 UTC",
      source: "Cronjobs (Lambda)",
    });
    expect(rows[1]).toMatchObject({
      scope: "weekly",
      lastBackup: "Never",
      nextBackup: "2026-03-02 02:35:00 UTC",
      source: "Cronjobs (Lambda)",
    });
  });
});
