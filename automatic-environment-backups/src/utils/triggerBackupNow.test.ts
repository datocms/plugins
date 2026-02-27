import { afterEach, describe, expect, it, vi } from "vitest";
import { LambdaHealthCheckError } from "./verifyLambdaHealth";
import { triggerBackupNow, TriggerBackupNowError } from "./triggerBackupNow";

const expectRejected = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    return error;
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("triggerBackupNow", () => {
  it("uses the primary /api/datocms/backup-now endpoint when available", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await triggerBackupNow({
      baseUrl: "backups.netlify.app",
      environment: "main",
      lambdaAuthSecret: "shared-secret",
    });

    expect(result.endpoint).toBe("https://backups.netlify.app/api/datocms/backup-now");
    expect(result.attemptName).toBe("/api/datocms/backup-now (backup_now)");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const typedCalls =
      fetchMock.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
    const requestInit = typedCalls[0]?.[1];
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toMatchObject({
      "X-Datocms-Backups-Auth": "shared-secret",
    });
    expect(String(requestInit?.body)).toContain("\"event_type\":\"backup_now\"");
  });

  it("sends the selected scope in backup-now payloads", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await triggerBackupNow({
      baseUrl: "https://backups.vercel.app",
      environment: "main",
      lambdaAuthSecret: "shared-secret",
      scope: "monthly",
    });

    const typedCalls =
      fetchMock.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
    const requestInit = typedCalls[0]?.[1];
    expect(String(requestInit?.body)).toContain("\"scope\":\"monthly\"");
  });

  it("returns detailed failure info when all attempts fail", async () => {
    const fetchMock = vi.fn(async () => new Response("route not available", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      triggerBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        lambdaAuthSecret: "shared-secret",
      }),
    )) as TriggerBackupNowError;

    expect(error).toBeInstanceOf(TriggerBackupNowError);
    expect(error.failures).toHaveLength(2);
    expect(error.failures[0].endpoint).toBe("https://backups.vercel.app/api/datocms/backup-now");
    expect(error.failures[0].httpStatus).toBe(404);
  });

  it("fails when lambda auth secret is missing", async () => {
    const error = (await expectRejected(
      triggerBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        lambdaAuthSecret: "",
      }),
    )) as TriggerBackupNowError;

    expect(error).toBeInstanceOf(TriggerBackupNowError);
    expect(error.failures).toHaveLength(1);
  });

  it("fails fast when URL is invalid", async () => {
    const error = (await expectRejected(
      triggerBackupNow({
        baseUrl: "not-a-valid-url",
        environment: "main",
        lambdaAuthSecret: "shared-secret",
      }),
    )) as LambdaHealthCheckError;

    expect(error).toBeInstanceOf(LambdaHealthCheckError);
    expect(error.code).toBe("INVALID_URL");
  });
});
