import { describe, expect, it } from "vitest";
import {
  BACKUP_SCHEDULE_VERSION,
  normalizeBackupScheduleConfig,
} from "./backupSchedule";

describe("normalizeBackupScheduleConfig", () => {
  const now = new Date("2026-02-26T08:10:00.000Z");

  it("returns cadence-only defaults when schedule is missing", () => {
    const { config, requiresMigration } = normalizeBackupScheduleConfig({
      value: undefined,
      timezoneFallback: "UTC",
      now,
    });

    expect(requiresMigration).toBe(true);
    expect(config).toEqual({
      version: BACKUP_SCHEDULE_VERSION,
      enabledCadences: ["daily", "weekly"],
      timezone: "UTC",
      anchorLocalDate: "2026-02-26",
      updatedAt: "2026-02-26T08:10:00.000Z",
    });
    expect("lambdalessTime" in config).toBe(false);
  });

  it("migrates legacy schedule objects that include lambdalessTime", () => {
    const { config, requiresMigration } = normalizeBackupScheduleConfig({
      value: {
        version: 1,
        enabledCadences: ["daily", "monthly"],
        timezone: "UTC",
        lambdalessTime: "23:59",
        anchorLocalDate: "2026-02-26",
        updatedAt: "2026-02-25T07:00:00.000Z",
      },
      timezoneFallback: "UTC",
      now,
    });

    expect(requiresMigration).toBe(true);
    expect(config).toEqual({
      version: BACKUP_SCHEDULE_VERSION,
      enabledCadences: ["daily", "monthly"],
      timezone: "UTC",
      anchorLocalDate: "2026-02-26",
      updatedAt: "2026-02-25T07:00:00.000Z",
    });
    expect("lambdalessTime" in config).toBe(false);
  });

  it("does not request migration for valid cadence-only schedule objects", () => {
    const { config, requiresMigration } = normalizeBackupScheduleConfig({
      value: {
        version: 1,
        enabledCadences: ["daily", "biweekly", "monthly"],
        timezone: "America/New_York",
        anchorLocalDate: "2026-02-25",
        updatedAt: "2026-02-25T07:00:00.000Z",
      },
      timezoneFallback: "UTC",
      now,
    });

    expect(requiresMigration).toBe(false);
    expect(config).toEqual({
      version: BACKUP_SCHEDULE_VERSION,
      enabledCadences: ["daily", "biweekly", "monthly"],
      timezone: "America/New_York",
      anchorLocalDate: "2026-02-25",
      updatedAt: "2026-02-25T07:00:00.000Z",
    });
  });
});
