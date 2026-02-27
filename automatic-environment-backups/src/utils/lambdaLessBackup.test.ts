import { afterEach, describe, expect, it, vi } from "vitest";
import { backupEnvironmentSlotWithoutLambda } from "./lambdaLessBackup";

const buildClientMock = vi.fn();

vi.mock("@datocms/cma-client-browser", () => ({
  buildClient: (...args: unknown[]) => buildClientMock(...args),
}));

const createEnvironment = (
  id: string,
  { primary = false }: { primary?: boolean } = {},
) => ({
  id,
  meta: {
    primary,
  },
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("backupEnvironmentSlotWithoutLambda", () => {
  it("throws when currentUserAccessToken is missing", async () => {
    await expect(
      backupEnvironmentSlotWithoutLambda({
        currentUserAccessToken: undefined,
        slot: "daily",
      }),
    ).rejects.toThrow("Missing currentUserAccessToken");
  });

  it("throws when no primary environment exists", async () => {
    const list = vi.fn().mockResolvedValue([createEnvironment("sandbox-1")]);
    const destroy = vi.fn();
    const fork = vi.fn();
    buildClientMock.mockReturnValue({
      environments: { list, destroy, fork },
    });

    await expect(
      backupEnvironmentSlotWithoutLambda({
        currentUserAccessToken: "token",
        slot: "daily",
      }),
    ).rejects.toThrow("Could not find the primary environment");
  });

  it("destroys an existing managed slot and recreates it from primary", async () => {
    const list = vi.fn().mockResolvedValue([
      createEnvironment("main", { primary: true }),
      createEnvironment("automatic-backups-daily"),
    ]);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const fork = vi.fn().mockResolvedValue(undefined);
    buildClientMock.mockReturnValue({
      environments: { list, destroy, fork },
    });

    const result = await backupEnvironmentSlotWithoutLambda({
      currentUserAccessToken: "token",
      slot: "daily",
    });

    expect(destroy).toHaveBeenCalledWith("automatic-backups-daily");
    expect(fork).toHaveBeenCalledWith(
      "main",
      { id: "automatic-backups-daily" },
      { immediate_return: false },
    );
    expect(result.replacedExistingEnvironment).toBe(true);
    expect(result.sourceEnvironmentId).toBe("main");
  });

  it("creates a managed slot when it does not exist", async () => {
    const list = vi
      .fn()
      .mockResolvedValue([createEnvironment("main", { primary: true })]);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const fork = vi.fn().mockResolvedValue(undefined);
    buildClientMock.mockReturnValue({
      environments: { list, destroy, fork },
    });

    const result = await backupEnvironmentSlotWithoutLambda({
      currentUserAccessToken: "token",
      slot: "weekly",
    });

    expect(destroy).not.toHaveBeenCalled();
    expect(fork).toHaveBeenCalledWith(
      "main",
      { id: "automatic-backups-weekly" },
      { immediate_return: false },
    );
    expect(result.replacedExistingEnvironment).toBe(false);
  });

  it("refuses to destroy the managed slot when it is marked as primary", async () => {
    const list = vi.fn().mockResolvedValue([
      createEnvironment("main", { primary: true }),
      createEnvironment("automatic-backups-daily", { primary: true }),
    ]);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const fork = vi.fn().mockResolvedValue(undefined);
    buildClientMock.mockReturnValue({
      environments: { list, destroy, fork },
    });

    await expect(
      backupEnvironmentSlotWithoutLambda({
        currentUserAccessToken: "token",
        slot: "daily",
      }),
    ).rejects.toThrow("Refusing to destroy managed environment");

    expect(destroy).not.toHaveBeenCalled();
    expect(fork).not.toHaveBeenCalled();
  });
});
