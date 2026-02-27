import { describe, expect, it } from "vitest";
import { toAutomaticBackupsScheduleState } from "./automaticBackupsScheduleState";

describe("toAutomaticBackupsScheduleState", () => {
  it("returns empty state when value is not an object", () => {
    expect(toAutomaticBackupsScheduleState(undefined)).toEqual({});
    expect(toAutomaticBackupsScheduleState(null)).toEqual({});
    expect(toAutomaticBackupsScheduleState("invalid")).toEqual({});
  });

  it("normalizes and trims cadence maps and lock fields", () => {
    const parsed = toAutomaticBackupsScheduleState({
      lastRunLocalDateByCadence: {
        daily: " 2026-02-27 ",
        weekly: "   ",
        invalid: "2026-02-27",
      },
      lastRunAtByCadence: {
        daily: " 2026-02-27T02:05:00.000Z ",
      },
      executionLockRunId: " run-123 ",
      executionLockOwnerUserId: " user-9 ",
      executionLockAcquiredAt: " 2026-02-27T02:00:00.000Z ",
      executionLockHeartbeatAt: " 2026-02-27T02:01:00.000Z ",
      executionLockExpiresAt: " 2026-02-27T02:03:00.000Z ",
      executionLockCadenceInFlight: "daily",
      lastDailyError: " failed ",
    });

    expect(parsed.lastRunLocalDateByCadence).toEqual({
      daily: "2026-02-27",
    });
    expect(parsed.lastRunAtByCadence).toEqual({
      daily: "2026-02-27T02:05:00.000Z",
    });
    expect(parsed.executionLockRunId).toBe("run-123");
    expect(parsed.executionLockOwnerUserId).toBe("user-9");
    expect(parsed.executionLockAcquiredAt).toBe("2026-02-27T02:00:00.000Z");
    expect(parsed.executionLockHeartbeatAt).toBe("2026-02-27T02:01:00.000Z");
    expect(parsed.executionLockExpiresAt).toBe("2026-02-27T02:03:00.000Z");
    expect(parsed.executionLockCadenceInFlight).toBe("daily");
    expect(parsed.lastDailyError).toBe("failed");
  });
});
